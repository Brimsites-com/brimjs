export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

export interface Statement {
  sql: string;
  args?: SqlValue[];
}

/** The only thing Brim needs from a database. SQLite locally, any SQLite-compatible host in production. */
export interface Database {
  query(sql: string, args?: SqlValue[]): Promise<Row[]>;
  /** Runs all statements in one transaction. */
  batch(statements: Statement[]): Promise<void>;
  close(): void;
}
