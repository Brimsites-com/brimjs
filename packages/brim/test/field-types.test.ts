import { describe, expect, it } from "vitest";
import { prefillOf } from "../src/blocks/listing/query.ts";
import { defineContentType, optionLabel, optionsOf } from "../src/content/content-types.ts";
import { parseItem } from "../src/content/items.ts";
import { itemPagePath } from "../src/server/locales.ts";

const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "produs",
  path: "/produse/[category]/[slug]",
  author: false,
  tags: false,
  fields: [
    {
      name: "category",
      label: "Category",
      type: "select",
      required: true,
      options: [{ value: "ceramica", label: "Ceramică" }, { value: "mozaic", label: "Mozaic" }, "baterii"],
    },
    { name: "specs", label: "Specifications", type: "keyvalue" },
  ],
});

const item = (data: Record<string, unknown>) => parseItem(product, { title: "Art", visibility: "published", data });

describe("a select field with labelled choices", () => {
  it("saves the value and shows the label", () => {
    expect(item({ category: "ceramica" }).data.category).toBe("ceramica");
    expect(() => item({ category: "Ceramică" })).toThrow(/not one of the choices/);
    const field = product.fields[0]!;
    expect(optionLabel(field, "ceramica")).toBe("Ceramică");
    expect(optionLabel(field, "baterii")).toBe("baterii");
    expect(optionLabel(field, "gone")).toBe("gone");
    expect(optionsOf(field).map((option) => option.value)).toEqual(["ceramica", "mozaic", "baterii"]);
  });

  it("puts the value, not the label, in an item's address", () => {
    expect(itemPagePath(product, { slug: "art", data: { category: "ceramica" } }, undefined)).toBe("/produse/ceramica/art");
  });

  it("starts an item added from a listing with the declared value", () => {
    expect(prefillOf({ category: "CERAMICA" }, product.fields)).toEqual({ category: "ceramica" });
  });

  it("refuses choices that repeat, are empty, or are labelled on a tags field", () => {
    const declare = (options: unknown[], type: "select" | "tags" = "select") =>
      defineContentType({
        key: "x",
        label: "X",
        singular: "X",
        slug: "x",
        fields: [{ name: "pick", label: "Pick", type, options: options as never }],
      });
    expect(() => declare(["a", { value: "a", label: "A" }])).toThrow(/twice/);
    expect(() => declare([{ value: "", label: "Empty" }])).toThrow(/without a value/);
    expect(() => declare([{ value: "a", label: "A" }], "tags")).toThrow(/plain words/);
    expect(() => declare(["a", "b"], "tags")).not.toThrow();
  });
});

describe("a keyvalue field", () => {
  it("keeps rows of label and value, trimmed, without the empty ones", () => {
    const data = item({
      category: "mozaic",
      specs: [{ label: " Size ", value: "60 × 120 cm" }, { label: "", value: "" }, { label: "Finish" }],
    }).data;

    expect(data.specs).toEqual([
      { label: "Size", value: "60 × 120 cm" },
      { label: "Finish", value: "" },
    ]);
  });

  it("is left out when every row is empty, and required means one row at least", () => {
    expect(item({ category: "mozaic", specs: [{ label: " ", value: "" }] }).data).not.toHaveProperty("specs");
    const strict = { ...product, fields: [product.fields[0]!, { ...product.fields[1]!, required: true }] };
    expect(() =>
      parseItem(strict, { title: "Art", visibility: "published", data: { category: "mozaic", specs: [{}] } }),
    ).toThrow(/is required/);
  });

  it.each([["not a list"], [["text"]], [[{ label: 3, value: "x" }]]])("refuses %j", (specs) => {
    expect(() => item({ category: "mozaic", specs })).toThrow(/list of rows/);
  });
});
