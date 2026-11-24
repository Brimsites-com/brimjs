import { Accounts } from "../auth/accounts.ts";
import { HistoryStore } from "../content/history.ts";
import { ItemStore } from "../content/items.ts";
import { ContentStore } from "../content/store.ts";
import { DraftStore } from "../content/drafts.ts";
import type { Database } from "../db/database.ts";
import { FormStore } from "../forms/store.ts";
import { ensureChangeTracking, keepingReads } from "../db/cached.ts";
import { openDatabase } from "../db/libsql.ts";
import { migrate } from "../db/schema.ts";

export interface Brim {
  db: Database;
  content: ContentStore;
  items: ItemStore;
  forms: FormStore;
  history: HistoryStore;
  drafts: DraftStore;
  accounts: Accounts;
}

const connections = new Map<string, Promise<Brim>>();

/** One migrated connection per database for the lifetime of the process. */
export function connect(url: string, authToken?: string): Promise<Brim> {
  let connection = connections.get(url);
  if (!connection) {
    connection = (async () => {
      const opened = openDatabase(url, authToken);
      await migrate(opened);
      // Pages keep what they read of the content until it changes (see `keepingReads`): one round trip per visit.
      await ensureChangeTracking(opened);
      const db = keepingReads(opened);
      return {
        db,
        content: new ContentStore(db),
        items: new ItemStore(db),
        forms: new FormStore(db),
        history: new HistoryStore(db),
        drafts: new DraftStore(db),
        accounts: new Accounts(db),
      };
    })();
    connections.set(url, connection);
    // A connection that failed (a network error at start, a folder not made yet) is not kept: the next request
    // tries again instead of failing until the server restarts.
    const failed = connection;
    failed.catch(() => {
      if (connections.get(url) === failed) connections.delete(url);
    });
  }
  return connection;
}
