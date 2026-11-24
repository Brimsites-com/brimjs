import { describe, expect, it } from "vitest";
import { FORMER_TEXT_ID, blocksOf, upgradeFieldValues } from "../src/content/block-values.ts";
import type { ContentType } from "../src/content/content-types.ts";
import { ItemStore, parseItem } from "../src/content/items.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

const text = {
  blocks: [
    { tag: "h2", children: ["Alegerea gresiei"] },
    { tag: "p", children: ["Primul pas."] },
  ],
};

const article = (body: "richtext" | "blocks"): ContentType => ({
  key: "articol",
  label: "Articole",
  singular: "Articol",
  slug: "blog",
  fields: [
    { name: "continut", label: "Conținut", type: body },
    { name: "descriere", label: "Descriere", type: "richtext" },
  ],
});

describe("a field that went from richtext to blocks", () => {
  it("reads its saved text as one text block", () => {
    expect(blocksOf(text)).toEqual([{ id: FORMER_TEXT_ID, type: "richtext", value: text }]);
    expect(blocksOf([{ id: "a", type: "divider", value: {} }])).toHaveLength(1);
    expect(blocksOf(undefined)).toEqual([]);
    expect(blocksOf("plain")).toEqual([]);
  });

  it("saves the old text as blocks, so the owner can add blocks after it", () => {
    const parsed = parseItem(article("blocks"), {
      title: "Ghid",
      visibility: "published",
      data: { continut: text },
    });
    const saved = parsed.data.continut as { id: string; type: string; value: { blocks: unknown[] } }[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: FORMER_TEXT_ID, type: "richtext" });
    expect(saved[0]?.value.blocks).toHaveLength(2);
  });

  it("is written as blocks in the database once, and a field kept as richtext is left alone", async () => {
    const db = openDatabase(":memory:");
    await migrate(db);
    const items = new ItemStore(db);
    const created = await items.create("articol", {
      title: "Ghid",
      slug: "ghid",
      visibility: "published",
      data: { continut: text, descriere: text },
    });

    await upgradeFieldValues(db, [article("blocks")]);
    const after = await items.get(created.id);
    expect(after?.data.continut).toEqual([{ id: FORMER_TEXT_ID, type: "richtext", value: text }]);
    expect(after?.data.descriere).toEqual(text);
    expect(after?.updatedAt).toBe(created.updatedAt);

    // Once per server: a second call asks nothing.
    const queries: string[] = [];
    const counting = { ...db, query: (sql: string, args?: never[]) => (queries.push(sql), db.query(sql, args)) };
    await upgradeFieldValues(counting, [article("blocks")]);
    await upgradeFieldValues(counting, [article("blocks")]);
    expect(queries).toHaveLength(1);
    expect((await items.get(created.id))?.data.continut).toEqual(after?.data.continut);

    // A site that keeps its body as rich text keeps it.
    const kept = openDatabase(":memory:");
    await migrate(kept);
    const keptItems = new ItemStore(kept);
    const other = await keptItems.create("articol", {
      title: "A",
      slug: "a",
      visibility: "published",
      data: { continut: text },
    });
    await upgradeFieldValues(kept, [article("richtext")]);
    expect((await keptItems.get(other.id))?.data.continut).toEqual(text);
  });
});
