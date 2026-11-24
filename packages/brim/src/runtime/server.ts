import config from "virtual:brim/config";
import type { User } from "../auth/accounts.ts";
import type { Database, Row, SqlValue, Statement } from "../db/database.ts";
import { requestUser } from "../server/auth.ts";
import { connect } from "./connect.ts";

export { readsQuery } from "./query-reads.ts";

export type { Row, SqlValue, Statement, User };

/** The site's database as the site's own code uses it. Brim keeps the connection, so there is nothing to close. */
export type SiteDatabase = Pick<Database, "query" | "batch">;

/**
 * The site's SQLite database, for tables of the site's own: the same database Brim keeps the content in, so it
 * is backed up and moved with it. Name your tables without the `brim_` prefix, which is Brim's.
 */
export async function getDatabase(): Promise<SiteDatabase> {
  const { db } = await connect(config.databaseUrl, config.authToken);
  return { query: (sql, args) => db.query(sql, args), batch: (statements) => db.batch(statements) };
}

/**
 * Who is signed in to the editor behind a request, or `undefined` for a visitor: the editor's session cookie,
 * or an access token from `brim token add`. For endpoints only the site's owner may call.
 */
export async function getUser(request: Request): Promise<User | undefined> {
  return requestUser(await connect(config.databaseUrl, config.authToken), request);
}
