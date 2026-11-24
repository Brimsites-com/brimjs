import { beforeEach, describe, expect, it } from "vitest";
import { ItemStore } from "../src/content/items.ts";
import type { Database } from "../src/db/database.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

const draft = (title: string, slug: string, visibility: "published" | "private" = "published") => ({
  title,
  slug,
  visibility,
  data: { text: title },
});

let db: Database;
let items: ItemStore;
let reads: string[];
beforeEach(async () => {
  const opened = openDatabase(":memory:");
  await migrate(opened);
  reads = [];
  // Counts the reads of whole items, the ones that cost seconds on a remote database.
  db = {
    ...opened,
    query: (sql, args) => {
      if (/^SELECT \*/.test(sql.trim())) reads.push(sql);
      return opened.query(sql, args);
    },
  };
  items = new ItemStore(db);
});

describe("one item by its address", () => {
  it("finds it in its language, with the place a list gives it, and leaves out private ones when asked", async () => {
    await items.create("product", draft("Imola", "imola"));
    const ro = await items.create("product", draft("Imola RO", "imola"), { locale: "ro" });
    await items.create("product", draft("Hidden", "hidden", "private"));

    expect((await items.bySlug("product", "imola", { locale: "" }))?.title).toBe("Imola");
    expect((await items.bySlug("product", "imola", { locale: "ro" }))?.id).toBe(ro.id);
    expect((await items.bySlug("product", "imola"))?.title).toBe("Imola");
    expect(await items.bySlug("product", "nope", { locale: "" })).toBeUndefined();
    expect((await items.bySlug("product", "hidden", { locale: "" }))?.visibility).toBe("private");
    expect(await items.bySlug("product", "hidden", { locale: "", publishedOnly: true })).toBeUndefined();
    const listed = await items.list("product", { locale: "" });
    expect((await items.bySlug("product", "imola", { locale: "" }))?.position).toBe(
      listed.find((item) => item.slug === "imola")?.position,
    );
  });
});

describe("lists kept between requests", () => {
  it("reads the items once while nothing changes", async () => {
    await items.create("product", draft("A", "a"));
    await items.create("product", draft("B", "b"));
    reads = [];
    const first = await items.listCached("product", { sort: "title" });
    const second = await items.listCached("product", { sort: "title" });
    expect(second).toEqual(first);
    expect(first.map((item) => item.slug)).toEqual(["a", "b"]);
    expect(reads).toHaveLength(1);
    // Other options are the same items, filtered and sorted in memory.
    await items.listCached("product", { sort: "newest", publishedOnly: true });
    expect(reads).toHaveLength(1);
  });

  it("reads them again after an item is added, edited, hidden, moved or removed", async () => {
    const a = await items.create("product", draft("A", "a"));
    const b = await items.create("product", draft("B", "b"));
    const slugs = async () =>
      (await items.listCached("product", { sort: "position" })).map((item) => `${item.slug}:${item.title}`);
    expect(await slugs()).toEqual(["a:A", "b:B"]);

    const c = await items.create("product", draft("C", "c"));
    expect(await slugs()).toEqual(["a:A", "b:B", "c:C"]);

    // Edited in the same millisecond as it was listed would keep `updated_at`: the title is what is checked.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await items.update(a, draft("A2", "a"));
    expect(await slugs()).toEqual(["a:A2", "b:B", "c:C"]);

    await items.reorder("product", [c.id, a.id, b.id]);
    expect(await slugs()).toEqual(["c:C", "a:A2", "b:B"]);
    await items.reorder("product", [c.id, b.id, a.id]);
    expect(await slugs()).toEqual(["c:C", "b:B", "a:A2"]);

    await items.remove(b.id);
    expect(await slugs()).toEqual(["c:C", "a:A2"]);
  });

  it("sees changes made by another process on the same database", async () => {
    await items.create("product", draft("A", "a"));
    expect((await items.listCached("product")).map((item) => item.slug)).toEqual(["a"]);
    const elsewhere = new ItemStore(db);
    await elsewhere.create("product", draft("B", "b"));
    expect((await items.listCached("product", {})).map((item) => item.slug).sort()).toEqual(["a", "b"]);
  });
});

describe("lists kept in memory answer what the database would", () => {
  it("in every order, language and visibility, translations at their original's place", async () => {
    // Created a moment apart, so "newest" and "oldest" have no ties for the database to break its own way.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
    const a = await items.create("product", draft("beta", "a"));
    await tick();
    const b = await items.create("product", draft("Alpha", "b"));
    await tick();
    await items.create("product", draft("gamma", "c", "private"));
    await tick();
    await items.create("product", draft("Beta RO", "a"), { locale: "ro", translationOf: a.id });
    await tick();
    await items.create("product", draft("Alfa RO", "b"), { locale: "ro", translationOf: b.id });
    await items.reorder("product", [b.id, a.id]);
    for (const sort of ["newest", "oldest", "title", "position"] as const) {
      for (const locale of [undefined, "", "ro"]) {
        for (const publishedOnly of [false, true]) {
          const options = { sort, publishedOnly, ...(locale !== undefined && { locale }) };
          const fromDb = await items.list("product", options);
          const kept = await items.listCached("product", options);
          expect(kept.map((item) => [item.id, item.position]), JSON.stringify(options)).toEqual(
            fromDb.map((item) => [item.id, item.position]),
          );
        }
      }
    }
    expect(await items.listCached("product", { sort: "title", limit: 2 })).toHaveLength(2);
  });

  it("reads again only the items that changed", async () => {
    const created = [];
    for (let index = 0; index < 30; index++) created.push(await items.create("product", draft(`P${index}`, `p${index}`)));
    await items.listCached("product");
    reads = [];
    await new Promise((resolve) => setTimeout(resolve, 5));
    await items.update(created[3]!, draft("Changed", "p3"));
    const listed = await items.listCached("product");
    expect(listed.find((item) => item.slug === "p3")?.title).toBe("Changed");
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("WHERE id IN (?)");
    // Hidden, moved or removed: no item is read whole again.
    reads = [];
    await items.remove(created[0]!.id);
    await items.reorder("product", [created[5]!.id]);
    reads = [];
    const after = await items.listCached("product", { sort: "position" });
    expect(after).toHaveLength(29);
    expect(after[0]?.slug).toBe("p5");
    expect(reads).toHaveLength(0);
  });
});
