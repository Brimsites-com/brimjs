import { AsyncLocalStorage } from "node:async_hooks";
import type { Database, Row, SqlValue, Statement } from "./database.ts";

/**
 * The tables of the owner's content: what pages are drawn from. Every write to one of them, by this server or any
 * other process (the CLI, a restore, a second server), moves `brim_changes.version` forward through the triggers
 * `ensureChangeTracking` adds. Accounts, sessions, rate limits, form responses, tokens and history are not content:
 * reading them is never kept, writing them never forgets what is kept.
 */
const CONTENT_TABLES = new Set(["brim_nodes", "brim_pages", "brim_items", "brim_meta", "brim_media", "brim_drafts"]);

const TABLE = /\bbrim_\w+/g;
const READ = /^\s*SELECT\b/i;
const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|WITH)\b/i;
/** Beyond this many different reads, what is kept is dropped and read again: a bound on memory, not a cache policy. */
const MAX_KEPT = 5000;

const VERSION_SQL = "SELECT version FROM brim_changes WHERE id = 1";

/**
 * Adds `brim_changes` and the triggers that move its version on every write to a content table. Idempotent and in
 * one round trip, so it runs at every start instead of as a numbered migration.
 */
export async function ensureChangeTracking(db: Database): Promise<void> {
  const triggers = [...CONTENT_TABLES].flatMap((table) =>
    (["INSERT", "UPDATE", "DELETE"] as const).map((event) => ({
      sql: `CREATE TRIGGER IF NOT EXISTS ${table}_changed_${event.toLowerCase()} AFTER ${event} ON ${table}
            BEGIN UPDATE brim_changes SET version = version + 1 WHERE id = 1; END`,
    })),
  );
  await db.batch([
    {
      sql: "CREATE TABLE IF NOT EXISTS brim_changes (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)",
    },
    { sql: "INSERT OR IGNORE INTO brim_changes (id, version) VALUES (1, 0)" },
    ...triggers,
  ]);
}

/** One visit: the content's version, asked once, and whether something was written since. */
interface ReadScope {
  version?: Promise<number | undefined>;
}

const scopes = new AsyncLocalStorage<ReadScope>();

/**
 * Runs `run` (one visit's page) with the content kept between visits: the first read of content asks the database
 * for its version, one small query, and while it is the one last seen every other read of content is answered from
 * memory. Outside it (the editor's API, the CLI, a build) every read goes to the database.
 */
export function withKeptReads<T>(run: () => T, visit?: object): T {
  // The 404 page Astro draws after a page answered 404 is the same visit: it asks for the version only once.
  let scope = visit ? visits.get(visit) : undefined;
  if (!scope) {
    scope = {};
    if (visit) visits.set(visit, scope);
  }
  return scopes.run(scope, run);
}

const visits = new WeakMap<object, ReadScope>();

function tablesOf(sql: string): string[] {
  return sql.match(TABLE) ?? [];
}

function readsOnlyContent(sql: string): boolean {
  if (!READ.test(sql)) return false;
  const tables = tablesOf(sql);
  return tables.length > 0 && tables.every((table) => CONTENT_TABLES.has(table));
}

function writesContent(sql: string): boolean {
  return WRITE.test(sql) && tablesOf(sql).some((table) => CONTENT_TABLES.has(table));
}

const copy = (rows: Row[]): Row[] => rows.map((row) => ({ ...row }));

/**
 * `db`, keeping what pages read of the content between visits (see `withKeptReads`). On a remote database each
 * query is a round trip of 100 ms or more, and a page asks for its nodes, its record, the site's redirects and
 * settings and the lists it shows: kept, a visit costs one round trip however many parts the page has.
 */
export function keepingReads(db: Database): Database {
  let keptVersion: number | undefined;
  const kept = new Map<string, Promise<Row[]>>();

  const forget = (): void => {
    kept.clear();
    keptVersion = undefined;
    const scope = scopes.getStore();
    if (scope) delete scope.version;
  };

  const version = (scope: ReadScope): Promise<number | undefined> => {
    scope.version ??= db.query(VERSION_SQL).then(
      (rows) => (rows[0] ? Number(rows[0].version) : undefined),
      // A database without the table (made before it, and not writable to add it): nothing is kept.
      () => undefined,
    );
    return scope.version;
  };

  return {
    async query(sql: string, args: SqlValue[] = []): Promise<Row[]> {
      const scope = scopes.getStore();
      if (!scope || !readsOnlyContent(sql)) {
        const rows = await db.query(sql, args);
        if (writesContent(sql)) forget();
        return rows;
      }
      const current = await version(scope);
      if (current === undefined) return db.query(sql, args);
      if (current !== keptVersion) {
        kept.clear();
        keptVersion = current;
      }
      if (kept.size >= MAX_KEPT) kept.clear();
      const key = `${sql}\u0000${JSON.stringify(args)}`;
      let reading = kept.get(key);
      if (!reading) {
        reading = db.query(sql, args);
        kept.set(key, reading);
        reading.catch(() => {
          if (kept.get(key) === reading) kept.delete(key);
        });
      }
      return copy(await reading);
    },
    async batch(statements: Statement[]): Promise<void> {
      await db.batch(statements);
      if (statements.some((statement) => writesContent(statement.sql))) forget();
    },
    close(): void {
      kept.clear();
      db.close();
    },
  };
}
