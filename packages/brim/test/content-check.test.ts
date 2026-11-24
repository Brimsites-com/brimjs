import { describe, expect, it } from "vitest";
import { checkContent, placeholderIn } from "../src/content/content-check.ts";
import { defineContentType, defineVocabulary } from "../src/content/content-types.ts";
import { ItemStore } from "../src/content/items.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

const category = defineVocabulary({
  key: "category",
  label: "Categories",
  singular: "Category",
  slug: "categories",
  path: "/produse/[slug]",
  component: () => "",
  fields: [],
});
const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "products",
  path: "/produse/[category]/[slug]",
  component: () => "",
  author: false,
  tags: false,
  fields: [
    { name: "category", label: "Category", vocabulary: "category", required: true },
    { name: "summary", label: "Summary", type: "textarea" },
  ],
});
const article = defineContentType({ key: "article", label: "Articles", singular: "Article", slug: "blog", fields: [] });

describe("what brim check --content takes for a stand-in", () => {
  it("finds the values left from testing or a template", () => {
    expect(placeholderIn("Lorem ipsum dolor sit amet")).toMatch(/lorem ipsum/);
    expect(placeholderIn("office@example.com")).toMatch(/example address/);
    expect(placeholderIn("admin@studionord.demo")).toMatch(/test address/);
    expect(placeholderIn("https://wa.me/40000000000")).toMatch(/stand-in number/);
    expect(placeholderIn("+40 700 000 000")).toMatch(/stand-in number/);
    expect(placeholderIn("Preț: TODO")).toMatch(/note left/);
  });

  it("leaves real content alone", () => {
    for (const text of [
      "Gresie porțelanată, 60 × 60 cm, cod M2EC",
      "+40 722 518 304",
      "contact@studionord.ro",
      "https://www.instagram.com/studionord",
      "Anul 2000, 100% lucrat manual",
      "Todo-ul săptămânii",
    ]) {
      expect(placeholderIn(text), text).toBeUndefined();
    }
  });
});

describe("brim check --content", () => {
  it("reports stand-ins with where they are, terms nothing uses, and routes the sitemap cannot list", async () => {
    const db = openDatabase(":memory:");
    await migrate(db);
    const items = new ItemStore(db);
    const draft = (title: string, slug: string, data: Record<string, unknown> = {}) => ({
      title,
      slug,
      visibility: "published" as const,
      data,
    });
    await items.create("category", draft("Ceramică", "ceramica"));
    await items.create("category", draft("Mozaic", "mozaic"));
    await items.create("product", draft("Art", "art", { category: "ceramica", summary: "Lorem ipsum." }));

    const findings = await checkContent({
      contentTypes: [category, product, article],
      items,
      nodes: [{ scope: "page:/contact", nodeId: "contact-email", kind: "text", value: { text: "hello@example.com" } }],
      settings: [{ locale: "", values: { whatsapp: "40000000000", email: "contact@studionord.ro" } }],
      patterns: [
        "/produse/[category]/[slug]",
        "/produse/[slug]",
        "/oferte/[slug]",
        "/[...rest]",
        "/_server-islands/[name]",
      ],
    });

    expect(findings.map(({ rule, where }) => [rule, where])).toEqual([
      ["placeholder", "product/art → summary"],
      ["placeholder", "site settings → whatsapp"],
      ["placeholder", "page:/contact → contact-email.text"],
      ["empty-term", "category/mozaic"],
      ["unlisted-pages", "/oferte/[slug]"],
    ]);
    expect(findings[3]?.message).toMatch(/its page lists nothing/);
  });
});
