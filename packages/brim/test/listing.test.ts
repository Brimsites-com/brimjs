import { describe, expect, it } from "vitest";
import { browseItems, prefillOf, queryItems } from "../src/blocks/listing/query.ts";
import type { Item } from "../src/content/items.ts";
import { parseItem } from "../src/content/items.ts";
import { defineContentType } from "../src/content/content-types.ts";

function item(id: string, title: string, data: Record<string, unknown>, createdAt: string): Item {
  return {
    id,
    type: "doc",
    slug: id,
    title,
    visibility: "published",
    data,
    locale: "",
    translationOf: null,
    position: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

const items = [
  item("start", "Start here", { section: "Start", order: 1, tags: ["intro"] }, "2026-01-01"),
  item("deploy", "Deploy", { section: "Run", order: 2, featured: true }, "2026-03-01"),
  item("forms", "Forms", { section: "Guides", order: 10, tags: ["blocks", "intro"] }, "2026-02-01"),
  item("blocks", "Blocks", { section: "Guides", order: 2 }, "2026-04-01"),
  item("misc", "Misc", { section: "Guides" }, "2026-05-01"),
];
const ids = (list: Item[]) => list.map((one) => one.id);

describe("which items a listing shows", () => {
  it("lists the newest first by default", () => {
    expect(ids(queryItems(items, {}))).toEqual(["misc", "blocks", "deploy", "forms", "start"]);
  });

  it("keeps the items whose fields have the values asked for, or one of them", () => {
    expect(ids(queryItems(items, { filter: { section: "Guides" } }))).toEqual(["misc", "blocks", "forms"]);
    expect(ids(queryItems(items, { filter: { section: ["Start", "Run"] } }))).toEqual(["deploy", "start"]);
    expect(ids(queryItems(items, { filter: { featured: true } }))).toEqual(["deploy"]);
    // An unchecked box is false.
    expect(ids(queryItems(items, { filter: { featured: false, section: "Run" } }))).toEqual([]);
    expect(ids(queryItems(items, { filter: { featured: false } }))).toHaveLength(4);
    // A field holding several values matches when one of them is asked for.
    expect(ids(queryItems(items, { filter: { tags: "intro" } }))).toEqual(["forms", "start"]);
  });

  it("matches text whatever its case", () => {
    expect(ids(queryItems(items, { filter: { tags: "Intro" } }))).toEqual(["forms", "start"]);
    expect(ids(queryItems(items, { filter: { section: ["start", "RUN"] } }))).toEqual(["deploy", "start"]);
  });

  it("sorts by a field, numbers as numbers, with empty values last", () => {
    expect(ids(queryItems(items, { filter: { section: "Guides" }, sort: "order" }))).toEqual([
      "blocks",
      "forms",
      "misc",
    ]);
    expect(ids(queryItems(items, { filter: { section: "Guides" }, sort: "order", order: "descending" }))).toEqual([
      "forms",
      "blocks",
      "misc",
    ]);
    expect(ids(queryItems(items, { sort: "title" }))).toEqual(["blocks", "deploy", "forms", "misc", "start"]);
  });

  it("leaves out the items asked for and stops at the limit", () => {
    expect(ids(queryItems(items, { exclude: "misc", limit: 2 }))).toEqual(["blocks", "deploy"]);
    expect(ids(queryItems(items, { exclude: ["misc", "blocks"], sort: "title" }))).toEqual([
      "deploy",
      "forms",
      "start",
    ]);
  });
});

describe("what a new item added from a listing starts with", () => {
  it("uses the declared spelling of select options for a case-insensitive filter", () => {
    const type = defineContentType({
      key: "doc",
      label: "Docs",
      singular: "Doc",
      slug: "docs",
      fields: [{ name: "section", label: "Section", type: "select", options: ["Guides", "Run"] }],
    });
    const filter = { section: "GUIDES" };
    const data = prefillOf(filter, type.fields);
    expect(data).toEqual({ section: "Guides" });
    const draft = parseItem(type, { title: "New guide", visibility: "published", data });
    expect(queryItems([item("new", draft.title, draft.data, "2026-01-01")], { filter })).toHaveLength(1);
  });

  it("takes the fields the filter asks one value of", () => {
    expect(prefillOf({ section: "Guides", featured: true, tags: ["a", "b"] })).toEqual({
      section: "Guides",
      featured: true,
    });
    expect(prefillOf(undefined)).toEqual({});
  });

  it("starts a field of several values with the one asked for, as a list", () => {
    const fields = [{ name: "tags", type: "tags" as const }];

    expect(prefillOf({ tags: "Guides", section: "Docs" }, fields)).toEqual({ tags: ["Guides"], section: "Docs" });
    expect(prefillOf({ tags: "guides" }, [{ ...fields[0]!, options: ["Guides"] }])).toEqual({ tags: ["Guides"] });
  });
});

describe("a listing visitors narrow themselves", () => {
  const fields = [
    {
      name: "brand",
      label: "Brand",
      type: "select" as const,
      options: [{ value: "marazzi", label: "Marazzi" }, "ragno"],
    },
    { name: "tags", label: "Tags", type: "tags" as const },
    { name: "summary", label: "Summary", type: "textarea" as const },
    { name: "specs", label: "Specs", type: "keyvalue" as const },
  ];
  const products = [
    item("a", "Art", { brand: "marazzi", tags: ["Lemn", "Design"], summary: "Gresie cu aspect de lemn" }, "2026-01-01"),
    item(
      "b",
      "Block",
      { brand: "marazzi", tags: ["Piatră"], specs: [{ label: "Format", value: "60 × 120" }] },
      "2026-01-02",
    ),
    item("c", "Cotto", { brand: "ragno", tags: ["lemn"] }, "2026-01-03"),
  ];
  const browse = (
    query: string,
    options: Parameters<typeof browseItems>[2] = { facets: ["brand", "tags"], search: true },
  ) => browseItems(products, fields, options, new URLSearchParams(query));

  it("keeps the items that have one of the values picked in each facet, and all facets", () => {
    expect(ids(browse("brand=marazzi").items)).toEqual(["a", "b"]);
    expect(ids(browse("brand=marazzi&brand=ragno").items)).toEqual(["a", "b", "c"]);
    expect(ids(browse("brand=marazzi&tags=lemn").items)).toEqual(["a"]);
  });

  it("counts each value as if it were picked, given the other facets, and shows a select's labels", () => {
    const { facets } = browse("tags=lemn");
    const brand = facets.find((facet) => facet.field === "brand")!;
    expect(brand.options).toEqual([
      { value: "marazzi", label: "Marazzi", count: 1, selected: false },
      { value: "ragno", label: "ragno", count: 1, selected: false },
    ]);
    const tags = facets.find((facet) => facet.field === "tags")!;
    expect(tags.options.map((option) => [option.value, option.count, option.selected])).toEqual([
      ["Design", 1, false],
      ["Lemn", 2, true],
      ["Piatră", 1, false],
    ]);
  });

  it("finds every word, whatever its case and accents, in the title, text, choices and rows", () => {
    expect(ids(browse("q=LEMN gresie").items)).toEqual(["a"]);
    expect(ids(browse("q=piatra").items)).toEqual(["b"]);
    expect(ids(browse("q=120").items)).toEqual(["b"]);
    expect(ids(browse("q=Marazzi").items)).toEqual(["a", "b"]);
    expect(ids(browse("q=title-only", { search: ["title"] }).items)).toEqual([]);
  });

  it("turns pages, keeping what was picked and the address's other parameters", () => {
    const state = browse("utm=x&brand=marazzi&page=2", { facets: ["brand"], pageSize: 1 });
    expect(ids(state.items)).toEqual(["b"]);
    expect([state.page, state.pageCount, state.total]).toEqual([2, 2, 2]);
    expect(state.pageHref(1)).toBe("?utm=x&brand=marazzi");
    expect(state.pageHref(2)).toBe("?utm=x&brand=marazzi&page=2");
    expect(state.resetHref).toBe("?utm=x");
    expect(state.otherParams).toEqual([["utm", "x"]]);
    expect(browse("page=99", { pageSize: 2 }).page).toBe(2);
    expect(browse("page=nope", { pageSize: 2 }).page).toBe(1);
  });

  it("keeps the parameters of several listings apart with a prefix", () => {
    const state = browse("p-brand=ragno&brand=marazzi", { facets: ["brand"], paramPrefix: "p-" });
    expect(ids(state.items)).toEqual(["c"]);
    expect(state.facets[0]?.param).toBe("p-brand");
  });

  it("refuses a facet that is not a field it can offer", () => {
    expect(() => browse("", { facets: ["summary"] })).toThrow(/must be a select/);
    expect(() => browse("", { search: ["nope"] })).toThrow(/not a field/);
  });
});
