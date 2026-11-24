import { beforeEach, describe, expect, it } from "vitest";
import { defineContentType } from "../src/content/content-types.ts";
import { ItemStore } from "../src/content/items.ts";
import { sitemapEntries } from "../src/content/sitemap.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

const locales = { defaultLocale: "en", locales: ["en", "ro"] };
const article = defineContentType({
  key: "article",
  label: "Articles",
  singular: "Article",
  slug: "blog",
  component: () => "",
  fields: [],
});
// Without a template: its pages are whatever the site's code draws.
const note = defineContentType({ key: "note", label: "Notes", singular: "Note", slug: "notes", fields: [] });

let content: ContentStore;
let items: ItemStore;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  content = new ContentStore(db);
  items = new ItemStore(db);
  const published = (title: string, slug: string) => ({ title, slug, visibility: "published" as const, data: {} });
  await items.create("article", published("Spring", "spring"));
  await items.create("article", published("Primăvara", "primavara"), { locale: "ro" });
  await items.create("note", published("Garden", "garden"));
  await items.create("note", published("Grădina", "gradina"), { locale: "ro" });
});

async function paths(patterns: string[]): Promise<string[]> {
  const routes = { pages: [], patterns };
  const entries = await sitemapEntries({
    content,
    items,
    contentTypes: [article, note],
    pageTemplates: [],
    routes,
    locales,
  });
  return entries.map((entry) => entry.path);
}

describe("the pages of items in the sitemap", () => {
  it("lists every item of a type with a template, in its language", async () => {
    expect(await paths([])).toEqual(["/blog/spring", "/ro/blog/primavara"]);
  });

  it("lists the items of a type without one where the code draws their pages", async () => {
    expect(await paths(["/notes/[slug]"])).toEqual(["/blog/spring", "/notes/garden", "/ro/blog/primavara"]);
    expect(await paths(["/notes/[slug]", "/[locale]/notes/[slug]"])).toContain("/ro/notes/gradina");
  });
});

describe("pages left out of the sitemap", () => {
  it("leaves out a page behind a password and one whose canonical address is another page's", async () => {
    const routes = { pages: ["/", "/about", "/members", "/copy", "/self"], patterns: [] };
    await content.setPagePassword("/members", "hash");
    await content.setPageSeo("/copy", { canonical: "/about" });
    await content.setPageSeo("/self", { canonical: "/self/" });
    const entries = await sitemapEntries({ content, items, contentTypes: [], pageTemplates: [], routes });

    expect(entries.map((entry) => entry.path)).toEqual(["/", "/about", "/self"]);
  });
});
