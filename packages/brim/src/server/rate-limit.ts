import type { Database } from "../db/database.ts";

/** The longest window a limit may count in. Rows older than twice this are spent, whatever their key. */
export const MAX_WINDOW_SECONDS = 24 * 60 * 60;
/** How often one limiter clears spent rows away. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

/**
 * Fixed-window counter in SQLite, for sign-ins and forms. Every key leaves a row (a form's token
 * leaves one per message), so rows whose window ended long ago are deleted now and then: without that, anyone
 * sending forms all day would make the table, and the database, grow without end.
 */
export class RateLimiter {
  readonly #db: Database;
  #prunedAt = 0;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Deletes the rows of windows that ended long ago, at most once an hour, never failing the caller. */
  async #prune(now: number): Promise<void> {
    if (Date.now() - this.#prunedAt < PRUNE_EVERY_MS) return;
    this.#prunedAt = Date.now();
    try {
      await this.#db.query("DELETE FROM brim_rate_limits WHERE window_start < ?", [now - 2 * MAX_WINDOW_SECONDS]);
    } catch (error) {
      console.error("[brim] Old rate limit rows were not cleared:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Gives back an attempt counted with `allow` in this window (one that turned out fine). Counting first and giving
   * back after is what keeps concurrent attempts within the limit: a check that counts only afterwards lets any
   * number of requests sent at once through before the first one is counted.
   */
  async release(key: string, windowSeconds: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.#db.query(
      "UPDATE brim_rate_limits SET count = count - 1 WHERE key = ? AND window_start = ? AND count > 0",
      [key, now - (now % windowSeconds)],
    );
  }

  /** How many attempts the key counted in its latest window (0 when none). For keys that name their window. */
  async count(key: string): Promise<number> {
    const rows = await this.#db.query("SELECT count FROM brim_rate_limits WHERE key = ?", [key]);
    return Number(rows[0]?.count ?? 0);
  }

  /** Counts one attempt and says whether it is still within `limit` per `windowSeconds`. */
  allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    return this.add(key, 1, limit, windowSeconds);
  }

  /** Counts `amount` at once (the bytes of a message's files) and says whether the total is still within `limit`. */
  async add(key: string, amount: number, limit: number, windowSeconds: number): Promise<boolean> {
    if (windowSeconds > MAX_WINDOW_SECONDS) throw new Error(`A rate limit window is at most ${MAX_WINDOW_SECONDS}s.`);
    const now = Math.floor(Date.now() / 1000);
    await this.#prune(now);
    const windowStart = now - (now % windowSeconds);
    const rows = await this.#db.query(
      `INSERT INTO brim_rate_limits (key, window_start, count) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + excluded.count ELSE excluded.count END,
         window_start = excluded.window_start
       RETURNING count`,
      [key, windowStart, amount],
    );
    return Number(rows[0]?.count ?? amount) <= limit;
  }
}
