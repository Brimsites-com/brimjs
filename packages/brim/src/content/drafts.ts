import type { Database } from "../db/database.ts";
import type { Item, ItemDraft } from "./items.ts";
import type { SeoSettings, StoredNode } from "./types.ts";

/**
 * What a draft holds back from the live site: an element of a page, an item's content, a page's SEO settings.
 * The key is the element's `scope\nnodeId`, the item's id, or the page's path.
 */
export type DraftTarget = "node" | "item" | "seo";

/** An element's draft: a new value, or `reset` to fall back to what the site's code says once saved. */
export type NodeDraft = { kind: string; value: unknown } | { reset: true };
/** An item's draft: its content. Who can see the item is never drafted; it changes at once. */
export type ItemContentDraft = Omit<ItemDraft, "visibility">;

export interface DraftRow {
  target: DraftTarget;
  key: string;
  value: unknown;
  /** The page it was made on, so the editor can say where the unsaved changes are. */
  page: string;
  updatedAt: string;
}

/**
 * Changes made in the editor that visitors do not see yet. The editor's preview draws the site with them; saving
 * writes them to the content visitors see, discarding throws them away. One draft for the whole site, shared by
 * everyone who edits it.
 */
export class DraftStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async all(): Promise<DraftRow[]> {
    const rows = await this.#db.query("SELECT * FROM brim_drafts ORDER BY updated_at");
    return rows.map((row) => ({
      target: String(row.target) as DraftTarget,
      key: String(row.key),
      value: JSON.parse(String(row.value)) as unknown,
      page: String(row.page),
      updatedAt: String(row.updated_at),
    }));
  }

  async count(): Promise<number> {
    return Number((await this.#db.query("SELECT COUNT(*) AS n FROM brim_drafts"))[0]?.n ?? 0);
  }

  /** The draft of one thing; `undefined` when it has none, so the live content stands. */
  async get(target: DraftTarget, key: string): Promise<unknown> {
    const rows = await this.#db.query("SELECT value FROM brim_drafts WHERE target = ? AND key = ?", [target, key]);
    return rows[0] ? (JSON.parse(String(rows[0].value)) as unknown) : undefined;
  }

  /** `undefined` removes the draft. The value must already be validated. */
  async set(target: DraftTarget, key: string, value: unknown, page: string): Promise<void> {
    if (value === undefined) {
      await this.#db.query("DELETE FROM brim_drafts WHERE target = ? AND key = ?", [target, key]);
      return;
    }
    await this.#db.query(
      `INSERT INTO brim_drafts (target, key, value, page, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (target, key) DO UPDATE SET value = excluded.value, page = excluded.page,
       updated_at = excluded.updated_at`,
      [target, key, JSON.stringify(value), page, new Date().toISOString()],
    );
  }

  async clear(): Promise<void> {
    await this.#db.query("DELETE FROM brim_drafts");
  }

  /** The elements of these scopes as the preview shows them: saved values with the drafts over them. */
  async overlayNodes(nodes: StoredNode[], scopes: string[]): Promise<StoredNode[]> {
    const drafts = (await this.#rows("node")).filter((row) => scopes.includes(row.key.split("\n")[0] ?? ""));
    if (drafts.length === 0) return nodes;
    const byKey = new Map(nodes.map((node) => [`${node.scope}\n${node.nodeId}`, node]));
    for (const { key, value } of drafts) {
      const [scope = "", nodeId = ""] = key.split("\n");
      const draft = value as NodeDraft;
      if ("reset" in draft) byKey.delete(key);
      else byKey.set(key, { scope, nodeId, kind: draft.kind, value: draft.value });
    }
    return [...byKey.values()];
  }

  /** Items as the preview shows them: their drafted content over what is saved. */
  async overlayItems<T extends Item>(items: T[]): Promise<T[]> {
    if (items.length === 0) return items;
    const drafts = new Map((await this.#rows("item")).map((row) => [row.key, row.value as ItemContentDraft]));
    if (drafts.size === 0) return items;
    return items.map((item) => {
      const draft = drafts.get(item.id);
      return draft ? { ...item, slug: draft.slug, title: draft.title, data: draft.data } : item;
    });
  }

  async overlayItem<T extends Item>(item: T): Promise<T> {
    return (await this.overlayItems([item]))[0] ?? item;
  }

  /** A page's SEO settings as the preview shows them. */
  async overlaySeo(path: string, seo: SeoSettings): Promise<SeoSettings> {
    const draft = await this.get("seo", path);
    return draft === undefined ? seo : (draft as SeoSettings);
  }

  async #rows(target: DraftTarget): Promise<{ key: string; value: unknown }[]> {
    const rows = await this.#db.query("SELECT key, value FROM brim_drafts WHERE target = ?", [target]);
    return rows.map((row) => ({ key: String(row.key), value: JSON.parse(String(row.value)) as unknown }));
  }
}
