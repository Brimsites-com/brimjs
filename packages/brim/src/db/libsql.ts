import { createClient } from "@libsql/client";
import type { Database, Row, SqlValue, Statement } from "./database.ts";
import { assertSecureDatabaseUrl } from "./url.ts";

/** Opens a SQLite file (`file:./data.db`), an in-memory database (`:memory:`) or a remote libSQL URL. */
export function openDatabase(url: string, authToken?: string): Database {
  assertSecureDatabaseUrl(url);
  const client = createClient(authToken ? { url, authToken } : { url });

  return {
    async query(sql: string, args: SqlValue[] = []): Promise<Row[]> {
      const result = await client.execute({ sql, args });
      return result.rows.map((row) => {
        const record: Row = {};
        for (const column of result.columns) record[column] = row[column] as SqlValue;
        return record;
      });
    },
    async batch(statements: Statement[]): Promise<void> {
      await client.batch(
        statements.map(({ sql, args = [] }) => ({ sql, args })),
        "write",
      );
    },
    close(): void {
      client.close();
    },
  };
}
