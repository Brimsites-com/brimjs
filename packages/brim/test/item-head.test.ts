import { describe, expect, it } from "vitest";
import {
  type ContentField,
  type ContentType,
  defineContentType,
  defineVocabulary,
} from "../src/content/content-types.ts";
import { itemHead } from "../src/content/item-head.ts";
import { itemImage } from "../src/content/item-image.ts";
import type { Item } from "../src/content/items.ts";

const component = () => "";
const locales = { defaultLocale: "ro", locales: ["ro", "en"] };
const now = new Date("2026-11-25T12:00:00Z");

const writers = (more: Partial<ContentType> = {}) =>
  defineVocabulary({
    key: "writer",
    label: "Autori",
    singular: "Autor",
    slug: "autori",
    fields: [{ name: "site", label: "Site", type: "url" }],
    ...more,
  });

const article = (fields: ContentField[] = [], more: Partial<ContentType> = {}) =>
  defineContentType({
    key: "article",
    label: "Articole",
    singular: "Articol",
    slug: "blog",
    component,
    article: true,
    fields,
    ...more,
  });

function term(slug: string, title: string, extra: Partial<Item> = {}): Item {
  return {
    id: `${slug}${extra.locale ?? ""}`,
    type: "writer",
    slug,
    title,
    visibility: "published",
    data: {},
    locale: "",
    translationOf: null,
    position: 1,
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

const head = (
  type: ContentType,
  data: Record<string, unknown>,
  { terms = [], types = [], locale = "" }: { terms?: Item[]; types?: ContentType[]; locale?: string } = {},
) =>
  itemHead(
    type,
    { title: "Casa de la lac", data, locale },
    { types: [type, ...types], publishedItems: () => Promise.resolve(terms), locales, now },
  );

const byReference = (multiple = false): ContentField => ({
  name: "author",
  label: "Autor",
  type: "reference",
  to: "writer",
  ...(multiple && { multiple }),
});

describe("what an item's page says about itself", () => {
  it("reads the standard fields, whatever they are labelled", async () => {
    const type = article([{ name: "description", label: "Rezumat", type: "textarea" }]);
    const data = {
      description: "  Un rezumat. ",
      image: { src: "/uploads/lac.jpg", alt: "Lacul" },
      published: "2026-11-20",
      author: " Ana Pop ",
    };
    expect(await head(type, data)).toEqual({
      title: "Casa de la lac",
      description: "Un rezumat.",
      image: "/uploads/lac.jpg",
      authors: [{ name: "Ana Pop" }],
      article: { published: "2026-11-20" },
    });
  });

  it("invents nothing that is not filled in", async () => {
    expect(await head(article(), { description: " ", author: "" })).toEqual({
      title: "Casa de la lac",
      authors: [],
      article: {},
    });
    expect(await head(article([], { article: false, author: false }), { author: "Ana" })).toEqual({
      title: "Casa de la lac",
      authors: [],
    });
  });

  it("leaves a field of a standard name but another type to the site", async () => {
    const type = article([
      { name: "description", label: "Text", type: "richtext" },
      { name: "published", label: "Publicat?", type: "boolean" },
    ]);
    const found = await head(type, { description: { blocks: [] }, published: true });
    expect(found).not.toHaveProperty("description");
    expect(found.article).toEqual({});
  });

  it("gives no date still to come, and no revision before the publication", async () => {
    const type = article([{ name: "modified", label: "Actualizat", type: "date" }]);
    expect((await head(type, { published: "2026-12-24" })).article).toEqual({});
    expect((await head(type, { published: "2026-11-20", modified: "2026-11-01" })).article).toEqual({
      published: "2026-11-20",
    });
    expect((await head(type, { published: "2026-11-20", modified: "2026-11-22" })).article).toEqual({
      published: "2026-11-20",
      modified: "2026-11-22",
    });
  });
});

describe("who wrote an item", () => {
  it("names a chosen author by label, and several names each on their own", async () => {
    const chosen = article([
      { name: "author", label: "Autor", type: "select", options: [{ value: "ana", label: "Ana Pop" }, "Ion"] },
    ]);
    expect((await head(chosen, { author: "ana" })).authors).toEqual([{ name: "Ana Pop" }]);
    const several = article([{ name: "author", label: "Autori", type: "tags" }]);
    expect((await head(several, { author: ["Ana Pop", "Ion Dan"] })).authors).toEqual([
      { name: "Ana Pop" },
      { name: "Ion Dan" },
    ]);
  });

  it("names the items it points at, in its language, never a bare slug or an author nobody can see", async () => {
    const terms = [term("ana", "Ana Pop"), term("ana", "Anne Pop", { locale: "en", translationOf: "ana" })];
    const type = article([byReference(true)]);
    const types = [writers()];
    expect((await head(type, { author: ["ana", "ascuns"] }, { terms, types })).authors).toEqual([{ name: "Ana Pop" }]);
    expect((await head(type, { author: ["ana"] }, { terms, types, locale: "en" })).authors).toEqual([
      { name: "Anne Pop" },
    ]);
  });

  it("links an author to their page, else to the address they give", async () => {
    const terms = [term("ana", "Ana Pop", { data: { site: "https://ana.ro" } })];
    const type = article([byReference()]);
    expect((await head(type, { author: "ana" }, { terms, types: [writers({ component })] })).authors).toEqual([
      { name: "Ana Pop", url: "/autori/ana" },
    ]);
    expect((await head(type, { author: "ana" }, { terms, types: [writers()] })).authors).toEqual([
      { name: "Ana Pop", url: "https://ana.ro" },
    ]);
  });
});

describe("an item's own picture", () => {
  it("is its image, and only a type without one takes its first other image field", () => {
    const type = article([{ name: "cover", label: "Copertă", type: "image" }]);
    const cover = { src: "/uploads/cover.jpg", alt: "" };
    expect(itemImage(type, { data: { cover, image: { src: "/uploads/main.jpg", alt: "" } } })).toBe(
      "/uploads/main.jpg",
    );
    expect(itemImage(type, { data: { cover } })).toBeUndefined();
    const without = article([{ name: "cover", label: "Copertă", type: "image" }], { image: false });
    expect(itemImage(without, { data: { cover } })).toBe("/uploads/cover.jpg");
    expect(itemImage(type, { data: {} })).toBeUndefined();
  });
});
