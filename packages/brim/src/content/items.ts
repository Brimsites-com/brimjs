import { randomUUID } from "node:crypto";
import { blockDefinitions } from "../blocks/schemas/index.ts";
import { parseSettings } from "../blocks/settings.ts";
import type { Database, Row, SqlValue } from "../db/database.ts";
import {
  BLOCK_TYPES,
  type BlockEntry,
  type BlockType,
  type ContentField,
  type ContentType,
  type KeyValueEntry,
  isSlug,
  optionValues,
  slugify,
} from "./content-types.ts";
import { isNodeId } from "./ids.ts";
import { layoutOf } from "./block-layout.ts";
import { blocksOf } from "./block-values.ts";
import { itemPathFields } from "./item-path.ts";
import { parseTags } from "./tags.ts";
import type { Visibility } from "./types.ts";
import { parseImage, parseRichText } from "./validate.ts";
import { ValidationError } from "./validation-error.ts";

export interface Item {
  id: string;
  type: string;
  slug: string;
  title: string;
  visibility: Visibility;
  /** Values of the fields the content type declares. */
  data: Record<string, unknown>;
  /** "" for the site's default language (and on a site with one language), else the language's code. */
  locale: string;
  /** The item this one translates; `null` for an item written first. */
  translationOf: string | null;
  /**
   * Its place among the items of its type (1 first), which the owner changes by dragging the items of a type
   * declared `ordered`. A translation sorts by its original's place.
   */
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** What the owner fills in for an item. */
export type ItemDraft = Pick<Item, "slug" | "title" | "visibility" | "data">;

export type ItemSort = "newest" | "oldest" | "title" | "position";

/** A translation takes its original's place, so every language lists the items in the same order. */
const PLACE =
  "COALESCE((SELECT original.position FROM brim_items AS original WHERE original.id = brim_items.translation_of), position)";

const ORDER: Record<ItemSort, string> = {
  newest: "created_at DESC",
  oldest: "created_at ASC",
  title: "title COLLATE NOCASE ASC",
  position: `${PLACE} ASC, created_at ASC`,
};

/** SQLite's NOCASE: only A–Z are folded. */
const nocase = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `ORDER` for items kept in memory, ties broken by id so a list is always the same. */
const COMPARE: Record<ItemSort, (a: Item, b: Item) => number> = {
  newest: (a, b) => byText(b.createdAt, a.createdAt) || byText(a.id, b.id),
  oldest: (a, b) => byText(a.createdAt, b.createdAt) || byText(a.id, b.id),
  title: (a, b) => byText(nocase(a.title), nocase(b.title)) || byText(a.id, b.id),
  position: (a, b) => a.position - b.position || byText(a.createdAt, b.createdAt) || byText(a.id, b.id),
};

interface KeptItems {
  fingerprint: string;
  /** As stored: each item's own position. */
  rows: Item[];
  /** As listed: a translation at its original's place. */
  items: Item[];
}

const MAX_TITLE = 300;
const MAX_TEXT = 20_000;
const MAX_GALLERY = 200;
const MAX_BLOCKS = 200;
const MAX_ROWS = 100;
const MAX_REFERENCES = 100;
const MAX_ROW_LABEL = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ItemStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** `locale`: only the items in that language ("" is the default one); without it, all languages. */
  async list(
    type: string,
    options: { publishedOnly?: boolean; sort?: ItemSort; limit?: number; locale?: string } = {},
  ): Promise<Item[]> {
    const { publishedOnly = false, sort = "newest", limit, locale } = options;
    const args: SqlValue[] = [type];
    if (locale !== undefined) args.push(locale);
    if (limit) args.push(limit);
    const rows = await this.#db.query(
      `SELECT *, ${PLACE} AS place FROM brim_items WHERE type = ?${locale !== undefined ? " AND locale = ?" : ""}${
        publishedOnly ? " AND visibility = 'published'" : ""
      }
       ORDER BY ${ORDER[sort]}${limit ? " LIMIT ?" : ""}`,
      args,
    );
    return rows.map(toItem);
  }

  /**
   * The items of a type as `list` answers them, kept in memory between requests. Each call asks the database one
   * small question (`#fingerprint`): whether an item of the type was added, edited, shown or hidden, moved or removed
   * since, by whoever. Only then are the items read again, and only the ones that changed: on a remote database a
   * type with hundreds of items takes seconds to read whole, and most pages need the same list every time.
   */
  async listCached(
    type: string,
    options: { publishedOnly?: boolean; sort?: ItemSort; limit?: number; locale?: string } = {},
  ): Promise<Item[]> {
    const { publishedOnly = false, sort = "newest", limit, locale } = options;
    const kept = await this.#kept(type);
    const listed = kept.items.filter(
      (item) => (locale === undefined || item.locale === locale) && (!publishedOnly || item.visibility === "published"),
    );
    listed.sort(COMPARE[sort]);
    return limit ? listed.slice(0, limit) : listed;
  }

  /**
   * One item by its address (`slug`) in a language ("" is the default one), with the place `list` gives it.
   * Without `locale`, the first of any language.
   */
  async bySlug(
    type: string,
    slug: string,
    options: { publishedOnly?: boolean; locale?: string } = {},
  ): Promise<Item | undefined> {
    const { publishedOnly = false, locale } = options;
    const args: SqlValue[] = [type, slug];
    if (locale !== undefined) args.push(locale);
    const rows = await this.#db.query(
      `SELECT *, ${PLACE} AS place FROM brim_items WHERE type = ? AND slug = ?${locale !== undefined ? " AND locale = ?" : ""}${
        publishedOnly ? " AND visibility = 'published'" : ""
      } ORDER BY locale LIMIT 1`,
      args,
    );
    return rows[0] ? toItem(rows[0]) : undefined;
  }

  /** Per type: its items as last read, with what the database said about them then. */
  readonly #cache = new Map<string, Promise<KeptItems>>();

  async #kept(type: string): Promise<KeptItems> {
    const fingerprint = await this.#fingerprint(type);
    const previous = this.#cache.get(type);
    const before = previous ? await previous.catch(() => undefined) : undefined;
    if (before && before.fingerprint === fingerprint) return before;
    // Another request may already be reading the same change: it is shared.
    const current = this.#cache.get(type);
    if (current && current !== previous) return current;
    const reading = this.#read(type, fingerprint, before);
    this.#cache.set(type, reading);
    reading.catch(() => {
      if (this.#cache.get(type) === reading) this.#cache.delete(type);
    });
    return reading;
  }

  async #read(type: string, fingerprint: string, before: KeptItems | undefined): Promise<KeptItems> {
    let rows: Item[];
    if (!before) {
      rows = (await this.#db.query("SELECT * FROM brim_items WHERE type = ?", [type])).map(toItem);
    } else {
      // What every item is now, in a few bytes each; the items edited since are read whole.
      const now = await this.#db.query(
        "SELECT id, updated_at, position, translation_of, visibility FROM brim_items WHERE type = ?",
        [type],
      );
      const known = new Map(before.rows.map((item) => [item.id, item]));
      const changed = now
        .filter((row) => known.get(String(row.id))?.updatedAt !== String(row.updated_at))
        .map((row) => String(row.id));
      const fresh = new Map<string, Item>();
      for (let start = 0; start < changed.length; start += 100) {
        const ids = changed.slice(start, start + 100);
        const read = await this.#db.query(
          `SELECT * FROM brim_items WHERE id IN (${ids.map(() => "?").join(", ")})`,
          ids,
        );
        for (const row of read) fresh.set(String(row.id), toItem(row));
      }
      rows = now.flatMap((row) => {
        const id = String(row.id);
        const item = fresh.get(id) ?? known.get(id);
        if (!item) return [];
        // A move or a lost original changes these without touching `updated_at`.
        return [
          {
            ...item,
            position: Number(row.position ?? 0),
            translationOf: row.translation_of == null ? null : String(row.translation_of),
            visibility: row.visibility === "private" ? "private" : "published",
          } satisfies Item,
        ];
      });
    }
    // Listed, a translation takes its original's place (see `PLACE`).
    const byId = new Map(rows.map((item) => [item.id, item.position]));
    const items = rows.map((item) => ({
      ...item,
      position: (item.translationOf !== null ? byId.get(item.translationOf) : undefined) ?? item.position,
    }));
    return { fingerprint, rows, items };
  }

  /**
   * Changes whenever an item of the type is added, removed, edited (`updated_at`), shown or hidden, or moved
   * (positions weighted by a hash of each id, so swapping two items changes the sum).
   */
  async #fingerprint(type: string): Promise<string> {
    const rows = await this.#db.query(
      `SELECT COUNT(*) AS n, MAX(updated_at) AS changed,
         SUM(position * ((unicode(substr(id, 1, 1)) * 65599 + unicode(substr(id, 2, 1)) * 257
           + unicode(substr(id, 3, 1)) * 31 + unicode(substr(id, 4, 1))) % 1000003)) AS places,
         SUM(length(COALESCE(translation_of, ''))) AS links,
         SUM(visibility = 'published') AS shown
       FROM brim_items WHERE type = ?`,
      [type],
    );
    const row = rows[0] ?? {};
    return `${row.n}|${row.changed}|${row.places}|${row.links}|${row.shown}`;
  }

  /** The item and its translations: everything written first as `item` or its original, in every language. */
  async translations(item: Item): Promise<Item[]> {
    const original = item.translationOf ?? item.id;
    const rows = await this.#db.query("SELECT * FROM brim_items WHERE id = ? OR translation_of = ? ORDER BY locale", [
      original,
      original,
    ]);
    return rows.map(toItem);
  }

  async get(id: string): Promise<Item | undefined> {
    const rows = await this.#db.query("SELECT * FROM brim_items WHERE id = ?", [id]);
    return rows[0] ? toItem(rows[0]) : undefined;
  }

  /**
   * `draft` must already be validated: see `parseItem`. `locale` and `translationOf` are checked by the caller:
   * a language of the site, and an item of the same type written first.
   */
  async create(
    type: string,
    draft: ItemDraft,
    options: { locale?: string; translationOf?: string | null } = {},
  ): Promise<Item> {
    const locale = options.locale ?? "";
    await this.#assertSlugFree(type, locale, draft.slug, undefined);
    const now = new Date().toISOString();
    // A new item goes last among the items of its type and language.
    const last = await this.#db.query(
      "SELECT COALESCE(MAX(position), 0) AS last FROM brim_items WHERE type = ? AND locale = ?",
      [type, locale],
    );
    const item: Item = {
      id: randomUUID(),
      type,
      ...draft,
      locale,
      translationOf: options.translationOf ?? null,
      position: Number(last[0]?.last ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.#db.query(
      `INSERT INTO brim_items (id, type, locale, translation_of, slug, title, visibility, data, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        type,
        locale,
        item.translationOf,
        item.slug,
        item.title,
        item.visibility,
        JSON.stringify(item.data),
        item.position,
        now,
        now,
      ],
    );
    return item;
  }

  /** `draft` must already be validated: see `parseItem`. */
  async update(existing: Item, draft: ItemDraft): Promise<Item> {
    await this.#assertSlugFree(existing.type, existing.locale, draft.slug, existing.id);
    const updatedAt = new Date().toISOString();
    await this.#db.query(
      "UPDATE brim_items SET slug = ?, title = ?, visibility = ?, data = ?, updated_at = ? WHERE id = ?",
      [draft.slug, draft.title, draft.visibility, JSON.stringify(draft.data), updatedAt, existing.id],
    );
    return { ...existing, ...draft, updatedAt };
  }

  /**
   * Puts back an item that was deleted, as it was (see the site's history). Its address must still be free; a
   * translation whose original is gone too comes back as an item of its own.
   */
  async restore(item: Item): Promise<Item> {
    await this.#assertSlugFree(item.type, item.locale, item.slug, undefined);
    const original = item.translationOf ? await this.get(item.translationOf) : undefined;
    const restored: Item = {
      ...item,
      translationOf: original ? original.id : null,
      updatedAt: new Date().toISOString(),
    };
    await this.#db.query(
      `INSERT INTO brim_items (id, type, locale, translation_of, slug, title, visibility, data, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        restored.id,
        restored.type,
        restored.locale,
        restored.translationOf,
        restored.slug,
        restored.title,
        restored.visibility,
        JSON.stringify(restored.data),
        restored.position ?? 0,
        restored.createdAt,
        restored.updatedAt,
      ],
    );
    return restored;
  }

  /**
   * Puts the items of a type in the order given: `ids` are its items written first (not translations, which follow
   * their original), first to last. Items left out keep their places after those given.
   */
  async reorder(type: string, ids: string[]): Promise<Item[]> {
    const items = (await this.list(type, { sort: "position" })).filter((item) => item.translationOf === null);
    const byId = new Map(items.map((item) => [item.id, item]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new ValidationError(`Not items of "${type}" written first: ${unknown.slice(0, 5).join(", ")}.`);
    }
    if (new Set(ids).size !== ids.length) throw new ValidationError("An item is listed twice.");
    const given = new Set(ids);
    const order = [...ids, ...items.filter((item) => !given.has(item.id)).map((item) => item.id)];
    await this.#db.batch(
      order.map((id, index) => ({ sql: "UPDATE brim_items SET position = ? WHERE id = ?", args: [index + 1, id] })),
    );
    return order.map((id, index) => ({ ...(byId.get(id) as Item), position: index + 1 }));
  }

  /**
   * Makes `originalId` the original of the items `translationIds` names again (those that still exist and are not
   * the original itself). An original that is put back after being removed takes back the translations it had
   * handed to one of them.
   */
  async relink(originalId: string, translationIds: string[]): Promise<void> {
    const ids = translationIds.filter((id) => id !== originalId);
    if (ids.length === 0) return;
    await this.#db.batch(
      ids.map((id) => ({ sql: "UPDATE brim_items SET translation_of = ? WHERE id = ?", args: [originalId, id] })),
    );
  }

  /** The ids of the items that are translations of `id`. */
  async translationIds(id: string): Promise<string[]> {
    const rows = await this.#db.query("SELECT id FROM brim_items WHERE translation_of = ?", [id]);
    return rows.map((row) => String(row.id));
  }

  /** An original that is removed hands its translations to the first of them, so they stay linked. */
  async remove(id: string): Promise<void> {
    const rows = await this.#db.query("SELECT id FROM brim_items WHERE translation_of = ? ORDER BY created_at", [id]);
    const heir = rows[0] ? String(rows[0].id) : undefined;
    await this.#db.batch([
      { sql: "DELETE FROM brim_items WHERE id = ?", args: [id] },
      ...(heir
        ? [
            { sql: "UPDATE brim_items SET translation_of = NULL WHERE id = ?", args: [heir] },
            { sql: "UPDATE brim_items SET translation_of = ? WHERE translation_of = ?", args: [heir, id] },
          ]
        : []),
    ]);
  }

  async #assertSlugFree(type: string, locale: string, slug: string, exceptId: string | undefined): Promise<void> {
    const rows = await this.#db.query("SELECT id FROM brim_items WHERE type = ? AND locale = ? AND slug = ?", [
      type,
      locale,
      slug,
    ]);
    if (rows[0] && rows[0].id !== exceptId) throw new ValidationError(`The address "${slug}" is already used.`);
  }
}

function toItem(row: Row): Item {
  return {
    id: String(row.id),
    type: String(row.type),
    slug: String(row.slug),
    title: String(row.title),
    visibility: row.visibility === "private" ? "private" : "published",
    data: JSON.parse(String(row.data)) as Record<string, unknown>,
    locale: String(row.locale ?? ""),
    translationOf: row.translation_of == null ? null : String(row.translation_of),
    // Listed, a translation answers its original's place (see `PLACE`).
    position: Number(row.place ?? row.position ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Turns untrusted input into an item of the given type, keeping only the fields it declares. */
export function parseItem(type: ContentType, input: Record<string, unknown>): ItemDraft {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title === "") throw new ValidationError("The title is required.");
  if (title.length > MAX_TITLE) throw new ValidationError("The title is too long.");

  const slug = typeof input.slug === "string" && input.slug.trim() !== "" ? input.slug.trim() : slugify(title);
  if (!isSlug(slug)) throw new ValidationError("The address can only have lowercase letters, digits and dashes.");

  if (input.visibility !== "private" && input.visibility !== "published") {
    throw new ValidationError('"visibility" must be "private" or "published".');
  }

  const values = typeof input.data === "object" && input.data !== null ? (input.data as Record<string, unknown>) : {};
  const data: Record<string, unknown> = {};
  for (const field of type.fields) {
    const value = values[field.name];
    // A value can turn out empty once checked, e.g. tags that were only spaces.
    const parsed = isEmpty(value) ? undefined : parseField(field, value);
    if (isEmpty(parsed)) {
      if (field.required) throw new ValidationError(`"${field.label}" is required.`);
    } else {
      data[field.name] = parsed;
    }
  }
  // A field in the type's address must give it a segment: "Ceramică" is `ceramica`, but "—" is nothing.
  for (const name of itemPathFields(type)) {
    const field = type.fields.find((candidate) => candidate.name === name);
    if (data[name] !== undefined && slugify(String(data[name])) === "") {
      throw new ValidationError(`"${field?.label ?? name}" is part of the item's address: use letters or digits.`);
    }
  }
  return { title, slug, visibility: input.visibility, data };
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function parseField(field: ContentField, value: unknown): unknown {
  const fail = (problem: string): never => {
    throw new ValidationError(`"${field.label}" ${problem}.`);
  };
  const text = (): string => {
    if (typeof value !== "string") return fail("must be text");
    return value.length <= MAX_TEXT ? value : fail("is too long");
  };

  switch (field.type) {
    case "text":
    case "textarea":
      return text();
    case "email":
      return EMAIL.test(text()) ? value : fail("must be an email address");
    case "date":
      return DATE.test(text()) ? value : fail("must be a date");
    case "url":
      return /^(https?:\/\/|\/(?!\/)|mailto:|tel:)/i.test(text()) ? value : fail("must be a link");
    case "select":
      return optionValues(field).includes(text()) ? value : fail("is not one of the choices");
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : fail("must be a number");
    case "boolean":
      return typeof value === "boolean" ? value : fail("must be yes or no");
    case "image":
      return parseImage(asRecord(value, field));
    case "gallery":
      if (!Array.isArray(value) || value.length > MAX_GALLERY) return fail("must be a list of images");
      return value.map((entry) => parseImage(asRecord(entry, field)));
    case "richtext":
      return parseRichText(asRecord(value, field));
    case "blocks": {
      // A text saved while the field was `richtext` is its one text block.
      const entries = Array.isArray(value) ? value : blocksOf(value);
      if (entries.length === 0 || entries.length > MAX_BLOCKS) return fail("must be a list of blocks");
      return parseBlocks(field, entries);
    }
    case "tags":
      return parseTags(value, field.label, field.options && optionValues(field));
    case "keyvalue":
      return parseRows(value, fail);
    case "reference":
      return parseReference(field, value, fail);
  }
}

/**
 * A reference keeps the slug of the item it points at, or a list of them with `multiple`. Only the shape is checked
 * here; that those items exist is checked by the server, which can see them (`checkReferences`).
 */
function parseReference(field: ContentField, value: unknown, fail: (problem: string) => never): string | string[] {
  const slugs = (Array.isArray(value) ? value : [value]).map((entry) =>
    typeof entry === "string" ? entry.trim() : entry,
  );
  if (!field.multiple && Array.isArray(value)) return fail("takes one item, not a list");
  if (slugs.length > MAX_REFERENCES) return fail(`can point at ${MAX_REFERENCES} items at most`);
  if (!slugs.every((slug): slug is string => typeof slug === "string" && isSlug(slug))) {
    return fail("must name items by their address, e.g. ceramica");
  }
  return field.multiple ? [...new Set(slugs)] : (slugs[0] as string);
}

/** Rows of a key–value list, a label and a value each, as text. Rows left wholly empty are dropped. */
function parseRows(value: unknown, fail: (problem: string) => never): KeyValueEntry[] {
  if (!Array.isArray(value)) return fail("must be a list of rows, each with a label and a value");
  if (value.length > MAX_ROWS) return fail(`can hold at most ${MAX_ROWS} rows`);
  const rows: KeyValueEntry[] = [];
  for (const entry of value) {
    const row = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : undefined;
    const { label, value: text } = row ?? {};
    const isText = (part: unknown) => part === undefined || typeof part === "string";
    if (!row || !isText(label) || !isText(text)) return fail("must be a list of rows, each with a label and a value");
    const kept = { label: String(label ?? "").trim(), value: String(text ?? "").trim() };
    if (kept.label === "" && kept.value === "") continue;
    if (kept.label.length > MAX_ROW_LABEL || kept.value.length > MAX_TEXT) return fail("has a row that is too long");
    rows.push(kept);
  }
  return rows;
}

/** Each block keeps an id of its own, is one the field offers, and holds what that block accepts. */
function parseBlocks(field: ContentField, entries: unknown[]): BlockEntry[] {
  const offered: readonly string[] = field.blocks ?? BLOCK_TYPES;
  const ids = new Set<string>();
  return entries.map((input) => {
    const entry = asRecord(input, field);
    const { id } = entry;
    if (typeof id !== "string" || !isNodeId(id) || ids.has(id)) {
      throw new ValidationError(`"${field.label}" has a block without an id of its own.`);
    }
    ids.add(id);
    if (typeof entry.type !== "string" || !offered.includes(entry.type)) {
      throw new ValidationError(`"${field.label}" does not offer the block "${String(entry.type)}".`);
    }
    const type = entry.type as BlockType;
    const value = asRecord(entry.value ?? {}, field);
    // Every block type but rich text is one of Brim's blocks, checked against its own settings. Its layout is read
    // before them, from the old size and alignment settings of a block saved without one.
    return {
      id,
      type,
      value: type === "richtext" ? { ...parseRichText(value) } : parseSettings(blockDefinitions[type]!, value),
      layout: layoutOf(type, entry.layout, value),
    };
  });
}

function asRecord(value: unknown, field: ContentField): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`"${field.label}" has the wrong shape.`);
  }
  return value as Record<string, unknown>;
}
