import { randomUUID } from "node:crypto";
import type { Database, Row } from "../db/database.ts";

/** What was changed: an element of a page, an item, or a page added from a template. */
export type HistoryTarget = "node" | "item" | "page";
/** `reset` is an element put back to what the site's code says. */
export type HistoryAction = "changed" | "reset" | "deleted";

/** A change as the editor lists it. */
export interface HistoryEntry {
  id: string;
  target: HistoryTarget;
  action: HistoryAction;
  /** The page it was made on, "" when it was made outside a page (an item's form). */
  page: string;
  /** What changed, in words: an element's nodeId, an item's or a page's title. */
  title: string;
  /** Email of who made the change. */
  user: string;
  at: string;
}

/** A change with what is needed to take it back. */
export interface HistoryRecord extends HistoryEntry {
  key: string;
  /** The content as it was before the change; `null` when there was none (the page showed the code's default). */
  before: unknown;
}

export interface NewHistory {
  target: HistoryTarget;
  key: string;
  action: HistoryAction;
  page: string;
  title: string;
  before: unknown;
  user: string;
  /** Kept even right after another change of the same thing by the same user (see `record`). */
  always?: boolean;
}

/** Changes of the same thing by the same person within this time count as one: typing saves many times. */
const SAME_EDIT_SECONDS = 10 * 60;
const KEEP_DAYS = 90;
const KEEP_ENTRIES = 5000;

/**
 * What the site's content was before each change, so a change can be taken back: an element's saved value, an
 * item, a deleted page with what was written on it. Kept for 90 days, the newest 5000 changes at most.
 */
export class HistoryStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Call before the change is made, with the content as it is now. */
  async record(entry: NewHistory): Promise<void> {
    const now = new Date();
    if (!entry.always && entry.action === "changed") {
      const rows = await this.#db.query(
        "SELECT user_email, action, created_at FROM brim_history WHERE target = ? AND key = ? ORDER BY created_at DESC LIMIT 1",
        [entry.target, entry.key],
      );
      const last = rows[0];
      if (
        last &&
        last.action === "changed" &&
        last.user_email === entry.user &&
        now.getTime() - Date.parse(String(last.created_at)) < SAME_EDIT_SECONDS * 1000
      ) {
        return;
      }
    }
    await this.#db.batch([
      {
        sql: `INSERT INTO brim_history (id, target, key, action, page, title, before, user_email, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          randomUUID(),
          entry.target,
          entry.key,
          entry.action,
          entry.page,
          entry.title,
          entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before),
          entry.user,
          now.toISOString(),
        ],
      },
      {
        sql: "DELETE FROM brim_history WHERE created_at < ?",
        args: [new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString()],
      },
      {
        sql: `DELETE FROM brim_history WHERE id IN (SELECT id FROM brim_history ORDER BY created_at DESC LIMIT -1 OFFSET ${KEEP_ENTRIES})`,
      },
    ]);
  }

  /** Newest first; `page` narrows the list to the changes made on one page. */
  async list(options: { page?: string | undefined; limit?: number | undefined } = {}): Promise<HistoryEntry[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100) || 100, 1), 500);
    const rows =
      options.page === undefined
        ? await this.#db.query(`${SELECT} ORDER BY created_at DESC, id LIMIT ${limit}`)
        : await this.#db.query(`${SELECT} WHERE page = ? ORDER BY created_at DESC, id LIMIT ${limit}`, [options.page]);
    return rows.map(toEntry);
  }

  async get(id: string): Promise<HistoryRecord | undefined> {
    const rows = await this.#db.query("SELECT * FROM brim_history WHERE id = ?", [id]);
    const row = rows[0];
    if (!row) return undefined;
    return {
      ...toEntry(row),
      key: String(row.key),
      before: row.before === null ? null : (JSON.parse(String(row.before)) as unknown),
    };
  }

  async remove(id: string): Promise<void> {
    await this.#db.query("DELETE FROM brim_history WHERE id = ?", [id]);
  }
}

const SELECT = "SELECT id, target, action, page, title, user_email, created_at FROM brim_history";

function toEntry(row: Row): HistoryEntry {
  return {
    id: String(row.id),
    target: String(row.target) as HistoryTarget,
    action: String(row.action) as HistoryAction,
    page: String(row.page),
    title: String(row.title),
    user: String(row.user_email),
    at: String(row.created_at),
  };
}
