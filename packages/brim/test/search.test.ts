import { describe, expect, it } from "vitest";
import type { Item } from "../src/content/items.ts";
import { searchItems, searchWords, textOf } from "../src/content/search.ts";

const item = (id: string, title: string, data: Record<string, unknown>, updatedAt = "2026-01-01"): Item => ({
  id,
  type: "",
  slug: id,
  title,
  visibility: "published",
  data,
  locale: "",
  translationOf: null,
  position: 0,
  createdAt: updatedAt,
  updatedAt,
});

const article = {
  key: "article",
  fields: [
    { name: "summary", type: "textarea" },
    { name: "content", type: "richtext" },
    { name: "body", type: "blocks" },
    { name: "cover", type: "image" },
    { name: "seo_description", type: "textarea" },
  ],
};
const project = { key: "project", fields: [{ name: "intro", type: "textarea" }] };

const articles = [
  item("living", "Un living luminos", {
    summary: "Idei pentru camera de zi.",
    content: "<p>Am ales <strong>lemn</strong> de stejar și textile naturale.</p><p>Lumina vine din sud.</p>",
  }),
  item("kitchen", "Bucătăria", {
    body: [
      { id: "b1", type: "image", value: { url: "/uploads/stejar.jpg", alt: "", caption: "Blat din piatră" } },
      { id: "b2", type: "richtext", value: "<p>Fronturi din &#238;mbinări de stejar masiv.</p>" },
    ],
    seo_description: "piatra",
  }),
];
const projects = [item("house", "Casă cu lemn", { intro: "Un proiect complet." }, "2026-03-01")];

describe("search across the site", () => {
  it("finds every word in titles, texts, rich text and blocks, whatever case and accents", () => {
    const found = searchItems(
      [
        { type: article, items: articles },
        { type: project, items: projects },
      ],
      "STEJAR",
    );
    expect(found.map((hit) => [hit.type, hit.item.id])).toEqual([
      ["article", "living"],
      ["article", "kitchen"],
    ]);
    expect(searchItems([{ type: article, items: articles }], "bucatari piatra").map((hit) => hit.item.id)).toEqual([
      "kitchen",
    ]);
  });

  it("puts items with the words in their title first", () => {
    const found = searchItems(
      [
        { type: article, items: articles },
        { type: project, items: projects },
      ],
      "lemn",
    );
    expect(found.map((hit) => hit.item.id)).toEqual(["house", "living"]);
  });

  it("leaves out addresses, block settings and SEO texts, and finds nothing for no words", () => {
    expect(searchItems([{ type: article, items: articles }], "uploads")).toEqual([]);
    expect(searchItems([{ type: article, items: articles }], "image")).toEqual([]);
    // "piatra" is in the SEO description only on its own; the caption has "piatră", which is found.
    expect(searchItems([{ type: article, items: articles }], "piatra").map((hit) => hit.item.id)).toEqual(["kitchen"]);
    expect(searchItems([{ type: article, items: articles }], "   ")).toEqual([]);
  });

  it("shows the sentence the words were found in, as plain text", () => {
    const [hit] = searchItems([{ type: article, items: articles }], "lumina");
    expect(hit?.excerpt).toBe("Lumina vine din sud.");
    const [kitchen] = searchItems([{ type: article, items: articles }], "îmbinări");
    expect(kitchen?.excerpt).toBe("Fronturi din îmbinări de stejar masiv.");
    const [byTitle] = searchItems([{ type: project, items: projects }], "casa");
    expect(byTitle?.excerpt).toBe("Un proiect complet.");
  });

  it("reads words as letters and digits, and text without its tags", () => {
    expect(searchWords("  Casă, cu-lemn! ")).toEqual(["casa", "cu", "lemn"]);
    expect(textOf("<p>A&amp;B</p><p>C</p>")).toBe("A&B\nC");
    expect(textOf({ "@type": "button", url: "https://x.ro", text: "Sună acum" })).toBe("Sună acum");
  });
});
