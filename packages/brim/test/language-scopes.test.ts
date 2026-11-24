import { describe, expect, it } from "vitest";
import { adoptLanguageScopes } from "../src/content/language-scopes.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

async function site() {
  const db = openDatabase(":memory:");
  await migrate(db);
  const node = (scope: string, nodeId: string, text: string) =>
    db.query("INSERT INTO brim_nodes (scope, node_id, kind, value, updated_at) VALUES (?, ?, 'text', ?, '')", [
      scope,
      nodeId,
      JSON.stringify({ text }),
    ]);
  await node("site", "navbar", "Saved before languages");
  await node("site", "footer", "Old footer");
  await node("site:ro", "footer", "Footer saved in Romanian");
  await node("type:produs", "product-note", "Template note");
  await node("type:produs:en", "product-note", "English template note");
  await node("page:/", "hero-title", "A page's own");
  await db.query("INSERT INTO brim_drafts (target, key, value, page, updated_at) VALUES ('node', ?, '{}', '/', '')", [
    "site\nnavbar",
  ]);
  await db.query("INSERT INTO brim_drafts (target, key, value, page, updated_at) VALUES ('node', ?, '{}', '/', '')", [
    "type:produs\nproduct-note",
  ]);
  return db;
}

const nodes = async (db: Awaited<ReturnType<typeof site>>) =>
  (await db.query("SELECT scope, node_id, value FROM brim_nodes ORDER BY scope, node_id")).map(
    (row) => `${row.scope} ${row.node_id} ${JSON.parse(String(row.value)).text}`,
  );

describe("a site that turns languages on", () => {
  it("keeps what was saved before as its default language's, never over a language's own", async () => {
    const db = await site();

    await adoptLanguageScopes(db, "ro");

    expect(await nodes(db)).toEqual([
      "page:/ hero-title A page's own",
      // The Romanian footer saved already wins; the old one is left where it was, unread.
      "site footer Old footer",
      "site:ro footer Footer saved in Romanian",
      "site:ro navbar Saved before languages",
      "type:produs:en product-note English template note",
      "type:produs:ro product-note Template note",
    ]);
    const drafts = (await db.query("SELECT key FROM brim_drafts ORDER BY key")).map((row) => String(row.key));
    expect(drafts).toEqual(["site:ro\nnavbar", "type:produs:ro\nproduct-note"]);
  });

  it("finds nothing more to move the second time", async () => {
    const db = await site();
    await adoptLanguageScopes(db, "ro");
    const once = await nodes(db);

    await adoptLanguageScopes(openDatabaseShare(db), "ro");

    expect(await nodes(db)).toEqual(once);
  });
});

/** The same database, as another server process would open it: the adoption runs again and changes nothing. */
function openDatabaseShare<T extends object>(db: T): T {
  return new Proxy(db, {});
}
