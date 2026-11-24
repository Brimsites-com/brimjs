import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentStore } from "../src/content/store.ts";
import { ItemStore } from "../src/content/items.ts";
import { ensureChangeTracking, keepingReads, withKeptReads } from "../src/db/cached.ts";
import type { Database } from "../src/db/database.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

let dir: string;
let url: string;
let raw: Database;
let sent: string[];
let db: Database;
let content: ContentStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "brim-kept-"));
  url = `file:${join(dir, "data.db")}`;
  const opened = openDatabase(url);
  await migrate(opened);
  await ensureChangeTracking(opened);
  sent = [];
  // Counts what reaches the database: each is a round trip on a remote one.
  raw = {
    ...opened,
    query: (sql, args) => {
      sent.push(sql.trim());
      return opened.query(sql, args);
    },
    batch: (statements) => opened.batch(statements),
    close: () => opened.close(),
  };
  db = keepingReads(raw);
  content = new ContentStore(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const visit = <T>(run: () => Promise<T>) => withKeptReads(run);

describe("reads kept between visits", () => {
  it("asks only for the version once the content was read", async () => {
    await content.saveNode("site", "title", "text", "Studio Nord");
    const draw = () =>
      visit(async () => {
        await Promise.all([content.loadNodes(["site", "page:/"]), content.page("/"), content.redirects()]);
        return content.loadNodes(["site", "page:/"]);
      });

    expect((await draw())[0]?.value).toBe("Studio Nord");
    sent = [];
    expect((await draw())[0]?.value).toBe("Studio Nord");
    expect(sent).toEqual(["SELECT version FROM brim_changes WHERE id = 1"]);
  });

  it("reads again after a change made through it", async () => {
    await content.saveNode("site", "title", "text", "Before");
    await visit(() => content.loadNodes(["site"]));
    await content.saveNode("site", "title", "text", "After");
    expect((await visit(() => content.loadNodes(["site"])))[0]?.value).toBe("After");
  });

  it("reads again after a change made by another process", async () => {
    await content.saveNode("site", "title", "text", "Before");
    await visit(() => content.loadNodes(["site"]));
    const other = openDatabase(url);
    await new ContentStore(other).saveNode("site", "title", "text", "From the CLI");
    other.close();
    expect((await visit(() => content.loadNodes(["site"])))[0]?.value).toBe("From the CLI");
  });

  it("sees an item list change, and a write during a visit, within that visit", async () => {
    const items = new ItemStore(db);
    const draft = { title: "Imola", slug: "imola", visibility: "published" as const, data: {} };
    await items.create("product", draft);
    await visit(async () => {
      expect(await items.listCached("product")).toHaveLength(1);
      await items.create("product", { ...draft, title: "Rako", slug: "rako" });
      expect(await items.listCached("product")).toHaveLength(2);
    });
  });

  it("keeps nothing outside a visit, nor accounts and sessions", async () => {
    await content.page("/");
    await content.page("/");
    expect(sent.filter((sql) => sql.startsWith("SELECT * FROM brim_pages"))).toHaveLength(2);
    sent = [];
    await visit(async () => {
      await db.query("SELECT * FROM brim_sessions LIMIT ?", [1]);
      await db.query("SELECT * FROM brim_sessions LIMIT ?", [1]);
    });
    expect(sent.filter((sql) => sql.includes("brim_sessions"))).toHaveLength(2);
  });

  it("hands each caller its own rows", async () => {
    await content.saveNode("site", "title", "text", "Studio Nord");
    await visit(async () => {
      const first = await db.query("SELECT * FROM brim_nodes");
      first[0]!.value = "changed";
      first.pop();
      expect(await db.query("SELECT * FROM brim_nodes")).toHaveLength(1);
      expect((await db.query("SELECT * FROM brim_nodes"))[0]?.value).not.toBe("changed");
    });
  });
});
