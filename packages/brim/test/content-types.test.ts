import { describe, expect, it } from "vitest";
import { blockDefinitions } from "../src/blocks/schemas/index.ts";
import {
  BLOCK_TYPES,
  type ContentField,
  type ContentType,
  defineContentType,
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

const description = expect.objectContaining({ name: "description", type: "textarea" });
const image = expect.objectContaining({ name: "image", type: "image" });
const published = expect.objectContaining({ name: "published", type: "date" });

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
    expect(declare(summary, false).fields).toEqual([summary, author, tags]);
  });

  it("leaves out the author or the tags of a type that asks for none", () => {
    expect(declare(summary, false, { author: false }).fields).toEqual([summary, tags]);
    expect(declare(summary, false, { tags: false }).fields).toEqual([summary, author]);
    expect(declare(summary, false, { author: false, tags: false }).fields).toEqual([summary]);
  });

  it("keeps a type's own author and tags fields in place of the default ones", () => {
    const writers: ContentField = { name: "author", label: "Written by", type: "select", options: ["Ana", "Ion"] };
    const rooms: ContentField = { name: "tags", label: "Rooms", type: "tags", options: ["Kitchen", "Bedroom"] };

    expect(declare(summary, false, { fields: [writers, summary] }).fields).toEqual([writers, summary, tags]);
    expect(declare(summary, false, { fields: [rooms, summary] }).fields).toEqual([rooms, summary, author]);
  });
});

describe("the fields Brim adds to a type with pages", () => {
  it("gives items with a page a description and an image, first", () => {
    expect(declare(summary).fields).toEqual([description, image, summary, author, tags]);
    expect(declare(summary, false).fields).toEqual([summary, author, tags]);
  });

  it("leaves out the ones a type asks not to have", () => {
    const fields = declare(summary, true, { description: false, image: false, author: false, tags: false }).fields;
    expect(fields).toEqual([summary]);
  });

  it("keeps a type's own field of a standard name, with its label", () => {
    const own: ContentField = { name: "description", label: "Rezumat", type: "textarea", required: true };
    expect(declare(own).fields).toEqual([image, own, author, tags]);
  });

  it("gives articles a published date, and wants a page for them", () => {
    expect(declare(summary, true, { article: true }).fields).toEqual([
      description,
      image,
      summary,
      published,
      author,
      tags,
    ]);
    expect(() => declare(summary, false, { article: true })).toThrow(/give it a component/);
  });

  it("lets a feed read the fields it added", () => {
    const feed = { date: "published", summary: "description" };
    expect(() => declare(summary, true, { article: true, feed })).not.toThrow();
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
