import { describe, expect, it } from "vitest";
import { blockDefinitions } from "../src/blocks/schemas/index.ts";
import {
  BLOCK_TYPES,
  type ContentField,
  type ContentType,
  defineContentType,
  itemAuthor,
  optionLabel,
  itemPageOf,
} from "../src/content/content-types.ts";

const component = () => "";

function declare(field: ContentField, withPage = true, more: Partial<ContentType> = {}) {
  return defineContentType({
    key: "article",
    label: "Articles",
    singular: "Article",
    slug: "blog",
    ...(withPage && { component }),
    fields: [field],
    ...more,
  });
}

const summary: ContentField = { name: "summary", label: "Summary", type: "textarea" };
const author: ContentField = { name: "author", label: "Author", type: "text" };
const tags: ContentField = { name: "tags", label: "Tags", type: "tags" };

describe("defineContentType", () => {
  it("takes a blocks field that offers some of the blocks a stack can hold", () => {
    expect(() => declare({ name: "body", label: "Body", type: "blocks", blocks: ["richtext", "image"] })).not.toThrow();
  });

  it("refuses a blocks field on a type without a page to arrange it on", () => {
    expect(() => declare({ name: "body", label: "Body", type: "blocks" }, false)).toThrow(/give the type a component/);
  });

  it("refuses a block a stack cannot hold", () => {
    const listing = ["listing"] as unknown as NonNullable<ContentField["blocks"]>;
    expect(() => declare({ name: "body", label: "Body", type: "blocks", blocks: listing })).toThrow(/"listing"/);
  });

  it("offers only rich text and Brim's own blocks", () => {
    for (const type of BLOCK_TYPES) if (type !== "richtext") expect(blockDefinitions).toHaveProperty(type);
  });

  it("gives every item an author and tags, after the fields the type declares", () => {
    expect(declare(summary).fields).toEqual([summary, author, tags]);
  });

  it("leaves out the author or the tags of a type that asks for none", () => {
    expect(declare(summary, true, { author: false }).fields).toEqual([summary, tags]);
    expect(declare(summary, true, { tags: false }).fields).toEqual([summary, author]);
    expect(declare(summary, true, { author: false, tags: false }).fields).toEqual([summary]);
  });

  it("keeps a type's own author and tags fields in place of the default ones", () => {
    const writers: ContentField = { name: "author", label: "Written by", type: "select", options: ["Ana", "Ion"] };
    const rooms: ContentField = { name: "tags", label: "Rooms", type: "tags", options: ["Kitchen", "Bedroom"] };

    expect(declare(summary, true, { fields: [writers, summary] }).fields).toEqual([writers, summary, tags]);
    expect(declare(summary, true, { fields: [rooms, summary] }).fields).toEqual([rooms, summary, author]);
  });
});

describe("itemAuthor", () => {
  it("reads the item's author, trimmed, and nothing when it has none", () => {
    const type = declare(summary);

    expect(itemAuthor(type, { data: { author: "  Ana Pop " } })).toBe("Ana Pop");
    expect(itemAuthor(type, { data: { author: "  " } })).toBeUndefined();
    expect(itemAuthor(type, { data: {} })).toBeUndefined();
  });

  it("has no author for a type without one, whatever the item's data holds", () => {
    expect(itemAuthor(declare(summary, true, { author: false }), { data: { author: "Ana" } })).toBeUndefined();
  });
});

describe("select choices in several languages", () => {
  const finish = {
    options: [{ value: "lucios", label: "Lucios", labels: { en: "Glossy" } }, "Mat"],
  };

  it("shows a choice's label in the page's language, else as declared", () => {
    expect(optionLabel(finish, "lucios", "en")).toBe("Glossy");
    expect(optionLabel(finish, "lucios", "ro")).toBe("Lucios");
    expect(optionLabel(finish, "lucios")).toBe("Lucios");
    expect(optionLabel(finish, "Mat", "en")).toBe("Mat");
    expect(optionLabel(finish, "unknown", "en")).toBe("unknown");
  });

  it("refuses an empty translated label", () => {
    expect(() =>
      defineContentType({
        key: "tile",
        label: "Tiles",
        singular: "Tile",
        slug: "tiles",
        fields: [
          {
            name: "finish",
            label: "Finish",
            type: "select",
            options: [{ value: "a", label: "A", labels: { en: " " } }],
          },
        ],
      }),
    ).toThrow(/empty label/);
  });
});

describe("itemPageOf", () => {
  const types = [declare({ name: "summary", label: "Summary", type: "text" })];

  it("finds the type and the item's slug in the address of an item's page", () => {
    expect(itemPageOf(types, "/blog/spring-planting/")).toMatchObject({
      type: { key: "article" },
      slug: "spring-planting",
    });
  });

  it("reads the language of an item's page on a site with languages", () => {
    const locales = { defaultLocale: "en", locales: ["en", "ro"] };

    expect(itemPageOf(types, "/ro/blog/plantare", locales)).toMatchObject({ slug: "plantare", locale: "ro" });
    expect(itemPageOf(types, "/blog/planting", locales)).toMatchObject({ slug: "planting", locale: "" });
    expect(itemPageOf(types, "/ro/blog", locales)).toBeUndefined();
  });

  it("knows an item's page only at its own address, with or without the default language's prefix", () => {
    const locales = { defaultLocale: "en", locales: ["en", "ro"] };
    const prefixed = { ...locales, prefixDefaultLocale: true };

    expect(itemPageOf(types, "/en/blog/planting", locales)).toBeUndefined();
    expect(itemPageOf(types, "/blog/planting", prefixed)).toBeUndefined();
    expect(itemPageOf(types, "/en/blog/planting", prefixed)).toMatchObject({ slug: "planting", locale: "" });
  });

  it.each(["/blog", "/blog/a/b", "/about/spring-planting"])("finds no item at %s", (path) => {
    expect(itemPageOf(types, path)).toBeUndefined();
  });
});
