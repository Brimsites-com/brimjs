import { beforeEach, describe, expect, it } from "vitest";
import { defineContentType } from "../src/content/content-types.ts";
import { buildFeed, feedAddresses, feedAt, rssXml } from "../src/content/feed.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

const locales = { defaultLocale: "en", locales: ["en", "ro"] };
const post = defineContentType({
  key: "post",
  label: "Blog",
  singular: "Post",
  slug: "blog",
  component: () => "",
  feed: true,
  fields: [
    { name: "description", label: "Excerpt", type: "textarea" },
    { name: "published", label: "Published on", type: "date" },
    { name: "image", label: "Cover", type: "image" },
    { name: "body", label: "Body", type: "richtext" },
  ],
});
const project = defineContentType({ key: "project", label: "Projects", singular: "Project", slug: "projects", fields: [] });
const routes = { pages: ["/", "/blog"], patterns: [] };

let content: ContentStore;
let items: ItemStore;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  content = new ContentStore(db);
  items = new ItemStore(db);
});

const create = (slug: string, data: Record<string, unknown>, extra: { visibility?: "private"; locale?: string } = {}) =>
  items.create(
    "post",
    { title: `Post ${slug}`, slug, visibility: extra.visibility ?? "published", data },
    extra.locale ? { locale: extra.locale } : {},
  );

async function feedOf(locale = "", options: { siteName?: string; withLocales?: boolean } = {}) {
  const withLocales = options.withLocales ?? false;
  const address = feedAddresses([post], withLocales ? locales : undefined).find((feed) => feed.locale === locale)!;
  return buildFeed(address, {
    types: [post, project],
    content,
    items,
    routes,
    locales: withLocales ? locales : undefined,
    siteName: options.siteName,
  });
}

describe("feed addresses", () => {
  it("gives a feed to the types that ask for one, in every language", () => {
    expect(feedAddresses([post, project], undefined).map((feed) => feed.path)).toEqual(["/rss/blog.xml"]);
    expect(feedAddresses([post, project], locales).map((feed) => feed.path)).toEqual([
      "/rss/blog.xml",
      "/rss/ro/blog.xml",
    ]);
    expect(feedAt("ro/blog.xml", [post], locales)?.locale).toBe("ro");
    expect(feedAt("projects.xml", [post, project], locales)).toBeUndefined();
    expect(feedAt("../blog.xml", [post], locales)).toBeUndefined();
  });

  it("refuses feed options that name fields the type does not have", () => {
    const declare = (feed: object) =>
      defineContentType({ key: "x", label: "X", singular: "X", slug: "x", fields: [{ name: "a", label: "A", type: "text" }], feed });
    expect(() => declare({ date: "a" })).toThrow(/not a date field/);
    expect(() => declare({ summary: "missing" })).toThrow(/summary/);
    expect(() => declare({ limit: 0 })).toThrow(/limit/);
    expect(() => declare({ summary: "a", limit: 5 })).not.toThrow();
  });
});

describe("the items of a feed", () => {
  it("lists published items newest first by their date field, with summary and picture", async () => {
    await create("older", { published: "2026-01-05", description: "First words.", author: "Ana Pop" });
    await create("newer", { published: "2026-03-01", image: { src: "/uploads/spring.jpg", alt: "" } });
    await create("draft", { published: "2026-04-01" }, { visibility: "private" });

    const feed = await feedOf("", { siteName: "Studio" });
    expect(feed.title).toBe("Studio · Blog");
    expect(feed.homePath).toBe("/blog");
    expect(feed.items.map((item) => item.path)).toEqual(["/blog/newer", "/blog/older"]);
    expect(feed.items[0]?.image).toBe("/uploads/spring.jpg");
    expect(feed.items[1]?.summary).toBe("First words.");
    expect(feed.items.map((item) => item.authors)).toEqual([[], ["Ana Pop"]]);
    expect(feed.items[1]?.published.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("leaves out an item whose page is behind a password", async () => {
    await create("open", {});
    await create("members", {});
    await content.setPagePassword("/blog/members", "hash");
    expect((await feedOf()).items.map((item) => item.path)).toEqual(["/blog/open"]);
  });

  it("sums an item up from its page's description, then the opening of its rich text", async () => {
    await create("described", {});
    await content.setPageSeo("/blog/described", { description: "From the page settings." });
    const long = "word ".repeat(100);
    await create("written", { body: { blocks: [{ tag: "h2", children: ["Title"] }, { tag: "p", children: [long] }] } });

    const feed = await feedOf();
    const summary = (slug: string) => feed.items.find((item) => item.path === `/blog/${slug}`)?.summary;
    expect(summary("described")).toBe("From the page settings.");
    expect(summary("written")?.startsWith("Title word word")).toBe(true);
    expect(summary("written")?.endsWith("…")).toBe(true);
    expect(summary("written")!.length).toBeLessThanOrEqual(301);
  });

  it("keeps each language in its own feed", async () => {
    await create("spring", {});
    await create("primavara", {}, { locale: "ro" });
    expect((await feedOf("", { withLocales: true })).items.map((item) => item.path)).toEqual(["/blog/spring"]);
    const ro = await feedOf("ro", { withLocales: true });
    expect(ro.items.map((item) => item.path)).toEqual(["/ro/blog/primavara"]);
    expect(ro.language).toBe("ro");
    expect(ro.homePath).toBe("/ro/");
  });

  it("holds the type's items only where they have pages", async () => {
    const note = defineContentType({ key: "note", label: "Notes", singular: "Note", slug: "notes", fields: [], feed: true });
    await items.create("note", { title: "Garden", slug: "garden", visibility: "published", data: {} });
    const address = feedAddresses([note], undefined)[0]!;
    expect((await buildFeed(address, { types: [note], content, items, routes })).items).toEqual([]);
    const coded = { pages: [], patterns: ["/notes/[slug]"] };
    expect((await buildFeed(address, { types: [note], content, items, routes: coded })).items.map((item) => item.path)).toEqual([
      "/notes/garden",
    ]);
  });
});

describe("the feed's XML", () => {
  it("is RSS 2.0 with full addresses and escaped text", async () => {
    await create("tea", { published: "2026-02-10", description: "Tea & <cake>", author: "Ana & Ion", image: { src: "/uploads/a b.jpg", alt: "" } });
    const xml = rssXml(await feedOf(), "https://example.com");

    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
    expect(xml).toContain('<atom:link href="https://example.com/rss/blog.xml" rel="self" type="application/rss+xml" />');
    expect(xml).toContain("<link>https://example.com/blog</link>");
    expect(xml).toContain("<link>https://example.com/blog/tea</link>");
    expect(xml).toContain("<pubDate>Tue, 10 Feb 2026 00:00:00 GMT</pubDate>");
    expect(xml).toContain("<description>Tea &#38; &#60;cake&#62;</description>");
    expect(xml).toContain("<dc:creator>Ana &#38; Ion</dc:creator>");
    expect(xml).toContain('<media:content url="https://example.com/uploads/a%20b.jpg" medium="image" />');
    expect(xml).not.toMatch(/&(?!#\d+;)/);
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });

  it("is a valid channel with no items", async () => {
    const xml = rssXml(await feedOf(), "https://example.com");
    expect(xml).toContain("<title>Blog</title>");
    expect(xml).toContain("<description>Blog</description>");
    expect(xml).not.toContain("<item>");
    expect(xml).not.toContain("<lastBuildDate>");
  });
});
