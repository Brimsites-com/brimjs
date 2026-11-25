import type { Database, Row } from "../db/database.ts";
import { assertNodeId, normalizePagePath, pageScope } from "./ids.ts";
import type { Redirect } from "./redirects.ts";
import type { PageRecord, SeoSettings, StoredNode, Visibility } from "./types.ts";

/** Kept in brim_meta, as one JSON value each: both are short lists read on every visit. */
const REDIRECTS_KEY = "redirects";

/** Reads and writes the owner's content. Source code is never touched. */
export class ContentStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async loadNodes(scopes: string[]): Promise<StoredNode[]> {
    if (scopes.length === 0) return [];
    const placeholders = scopes.map(() => "?").join(", ");
    const rows = await this.#db.query(
      `SELECT scope, node_id, kind, value FROM brim_nodes WHERE scope IN (${placeholders})`,
      scopes,
    );
    return rows.map((row) => ({
      scope: String(row.scope),
      nodeId: String(row.node_id),
      kind: String(row.kind),
      value: JSON.parse(String(row.value)) as unknown,
    }));
  }

  /** Every saved node of the site, in every scope: what a check of the whole content reads. */
  async allNodes(): Promise<StoredNode[]> {
    const rows = await this.#db.query("SELECT scope, node_id, kind, value FROM brim_nodes", []);
    return rows.map((row) => ({
      scope: String(row.scope),
      nodeId: String(row.node_id),
      kind: String(row.kind),
      value: JSON.parse(String(row.value)) as unknown,
    }));
  }

  /** `value` must already be validated: see `parseNodeValue` and `parseSettings`. */
  async saveNode(scope: string, nodeId: string, kind: string, value: unknown): Promise<void> {
    assertNodeId(nodeId);
    await this.#db.query(
      `INSERT INTO brim_nodes (scope, node_id, kind, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (scope, node_id) DO UPDATE SET kind = excluded.kind, value = excluded.value, updated_at = excluded.updated_at`,
      [scope, nodeId, kind, JSON.stringify(value), now()],
    );
  }

  /** Removes the owner's value, so the page falls back to what the source says. */
  async resetNode(scope: string, nodeId: string): Promise<void> {
    await this.#db.query("DELETE FROM brim_nodes WHERE scope = ? AND node_id = ?", [scope, nodeId]);
  }

  /** Moves everything saved on one page to another address, e.g. when an item's address changes. */
  async moveNodes(fromScope: string, toScope: string): Promise<void> {
    await this.#db.batch([
      // What was already saved at the new address gives way to what moves there.
      { sql: "DELETE FROM brim_nodes WHERE scope = ?", args: [toScope] },
      { sql: "UPDATE brim_nodes SET scope = ? WHERE scope = ?", args: [toScope, fromScope] },
    ]);
  }

  /**
   * Copies what was saved on one page to another, leaving alone what the other page already has: a translation
   * starts from the original's words and never loses what was already translated. Returns how many were copied.
   */
  async copyNodes(fromScope: string, toScope: string): Promise<number> {
    const count = async (): Promise<number> =>
      Number((await this.#db.query("SELECT COUNT(*) AS n FROM brim_nodes WHERE scope = ?", [toScope]))[0]?.n ?? 0);
    const before = await count();
    await this.#db.query(
      `INSERT INTO brim_nodes (scope, node_id, kind, value, updated_at)
       SELECT ?, node_id, kind, value, ? FROM brim_nodes WHERE scope = ?
       ON CONFLICT (scope, node_id) DO NOTHING`,
      [toScope, now(), fromScope],
    );
    return (await count()) - before;
  }

  async removeNodes(scope: string): Promise<void> {
    await this.#db.query("DELETE FROM brim_nodes WHERE scope = ?", [scope]);
  }

  /** A page nobody has touched is published and has no SEO settings: pages come from source. */
  async page(pathname: string): Promise<PageRecord> {
    const path = normalizePagePath(pathname);
    const rows = await this.#db.query("SELECT * FROM brim_pages WHERE path = ?", [path]);
    return rows[0] ? toPage(rows[0]) : { path, visibility: "published", seo: {} };
  }

  /** The search settings of every page that has some, by address (pages of items included). */
  async pageSeoSettings(): Promise<Map<string, SeoSettings>> {
    const rows = await this.#db.query("SELECT path, seo FROM brim_pages WHERE seo IS NOT NULL AND seo != '{}'");
    return new Map(rows.map((row) => [String(row.path), JSON.parse(String(row.seo)) as SeoSettings]));
  }

  /** Pages the owner added from a template, by address. The public build asks for published ones only. */
  async templatePages(options: { publishedOnly?: boolean } = {}): Promise<PageRecord[]> {
    const rows = await this.#db.query(
      `SELECT * FROM brim_pages WHERE template IS NOT NULL${options.publishedOnly ? " AND visibility = 'published'" : ""}
       ORDER BY path`,
    );
    return rows.map(toPage);
  }

  /**
   * Adds a page made from a template. It starts private, so the owner can fill it in before anyone sees it.
   * The caller checks that the address belongs to no other page.
   */
  async createPage(pathname: string, template: string, title: string, visibility: Visibility): Promise<PageRecord> {
    const path = normalizePagePath(pathname);
    // A row left by a page that was removed from the code is taken over.
    await this.#db.query(
      `INSERT INTO brim_pages (path, visibility, seo, template, title, updated_at) VALUES (?, ?, '{}', ?, ?, ?)
       ON CONFLICT (path) DO UPDATE SET visibility = excluded.visibility, seo = '{}', template = excluded.template,
       title = excluded.title, updated_at = excluded.updated_at`,
      [path, visibility, template, title, now()],
    );
    return { path, visibility, seo: {}, template, title };
  }

  async setPageTitle(pathname: string, title: string): Promise<void> {
    await this.#db.query("UPDATE brim_pages SET title = ?, updated_at = ? WHERE path = ?", [
      title,
      now(),
      normalizePagePath(pathname),
    ]);
  }

  /** Removes a page added from a template together with everything the owner wrote on it. */
  async deletePage(pathname: string): Promise<void> {
    const path = normalizePagePath(pathname);
    await this.#db.batch([
      { sql: "DELETE FROM brim_nodes WHERE scope = ?", args: [pageScope(path)] },
      { sql: "DELETE FROM brim_pages WHERE path = ? AND template IS NOT NULL", args: [path] },
    ]);
  }

  async setPageVisibility(pathname: string, visibility: Visibility): Promise<void> {
    await this.#db.query(
      `INSERT INTO brim_pages (path, visibility, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (path) DO UPDATE SET visibility = excluded.visibility, updated_at = excluded.updated_at`,
      [normalizePagePath(pathname), visibility, now()],
    );
  }

  /**
   * Moves a page added from a template to a new address, with everything the owner wrote on it. The caller checks
   * that the new address is free and adds the redirect from the old one.
   */
  async movePage(fromPath: string, toPath: string): Promise<void> {
    const from = normalizePagePath(fromPath);
    const to = normalizePagePath(toPath);
    await this.#db.batch([
      { sql: "DELETE FROM brim_nodes WHERE scope = ?", args: [pageScope(to)] },
      { sql: "UPDATE brim_nodes SET scope = ? WHERE scope = ?", args: [pageScope(to), pageScope(from)] },
      { sql: "DELETE FROM brim_pages WHERE path = ?", args: [to] },
      { sql: "UPDATE brim_pages SET path = ?, updated_at = ? WHERE path = ?", args: [to, now(), from] },
    ]);
  }

  /**
   * Carries a page's search settings to its new address, for a page whose address follows something else (an item's
   * slug or category): they are kept by address, so without this a page hidden from search engines would be listed
   * when its address changed.
   */
  async movePageSettings(fromPath: string, toPath: string): Promise<void> {
    const from = normalizePagePath(fromPath);
    const to = normalizePagePath(toPath);
    if (from === to) return;
    const { seo } = await this.page(from);
    if (Object.keys(seo).length > 0) {
      await this.setPageSeo(to, seo);
      await this.setPageSeo(from, {});
    }
  }

  /** The site's redirects, in the order the owner keeps them. */
  async redirects(): Promise<Redirect[]> {
    return (await this.#meta<Redirect[]>(REDIRECTS_KEY)) ?? [];
  }

  /** `redirects` must already be checked: see `parseRedirects`. */
  async setRedirects(redirects: Redirect[]): Promise<void> {
    await this.#setMeta(REDIRECTS_KEY, redirects);
  }

  async #meta<T>(key: string): Promise<T | undefined> {
    const rows = await this.#db.query("SELECT value FROM brim_meta WHERE key = ?", [key]);
    return rows[0] ? (JSON.parse(String(rows[0].value)) as T) : undefined;
  }

  async #setMeta(key: string, value: unknown): Promise<void> {
    await this.#db.query(
      "INSERT INTO brim_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [key, JSON.stringify(value)],
    );
  }

  /** `seo` must already be validated: see `parseSeo`. */
  async setPageSeo(pathname: string, seo: SeoSettings): Promise<void> {
    await this.#db.query(
      `INSERT INTO brim_pages (path, visibility, seo, updated_at) VALUES (?, 'published', ?, ?)
       ON CONFLICT (path) DO UPDATE SET seo = excluded.seo, updated_at = excluded.updated_at`,
      [normalizePagePath(pathname), JSON.stringify(seo), now()],
    );
  }
}

function toPage(row: Row): PageRecord {
  return {
    path: String(row.path),
    visibility: row.visibility === "private" ? "private" : "published",
    seo: JSON.parse(String(row.seo)) as SeoSettings,
    ...(row.template != null && { template: String(row.template), title: String(row.title ?? "") }),
  };
}

function now(): string {
  return new Date().toISOString();
}
