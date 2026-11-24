import { describe, expect, it } from "vitest";
import { type ContentField, defineContentType, itemPageOf } from "../src/content/content-types.ts";
import { parseItem } from "../src/content/items.ts";
import { itemHasPage } from "../src/content/sitemap.ts";
import { itemPagePath } from "../src/server/locales.ts";

const component = () => "";
const category: ContentField = {
  name: "category",
  label: "Category",
  type: "select",
  options: ["Ceramică", "mozaic"],
  required: true,
};

function product(path: string | undefined, fields: ContentField[] = [category], withPage = true) {
  return defineContentType({
    key: "product",
    label: "Products",
    singular: "Product",
    slug: "produs",
    ...(path !== undefined && { path }),
    ...(withPage && { component }),
    fields,
  });
}

describe("a content type's path", () => {
  it("puts an item's page at the address it describes, with field values as address segments", () => {
    const type = product("/produse/[category]/[slug]");

    expect(itemPagePath(type, { slug: "marazzi-art", data: { category: "Ceramică" } }, undefined)).toBe(
      "/produse/ceramica/marazzi-art",
    );
  });

  it("keeps /<slug>/<item> without one", () => {
    expect(itemPagePath(product(undefined), { slug: "marazzi-art" }, undefined)).toBe("/produs/marazzi-art");
  });

  it("puts the language before the whole address", () => {
    const type = product("/produse/[category]/[slug]");
    const locales = { defaultLocale: "ro", locales: ["ro", "en"] };

    expect(itemPagePath(type, { slug: "art", locale: "en", data: { category: "mozaic" } }, locales)).toBe(
      "/en/produse/mozaic/art",
    );
  });

  it.each([
    ["produse/[slug]", /must start with "\/"/],
    ["/produse/[slug]/", /must start with "\/"/],
    ["/[category]/[slug]", /fixed segment/],
    ["/produse/[category]", /\[slug\] once/],
    ["/produse/[slug]/[slug]", /\[slug\] once/],
    ["/Produse/[slug]", /lowercase words/],
    ["/produse/[brand]/[slug]", /not one of its fields/],
  ])("refuses %s", (path, error) => {
    expect(() => product(path)).toThrow(error);
  });

  it("takes only required select or text fields, so every item has an address", () => {
    expect(() => product("/p/[category]/[slug]", [{ ...category, required: false }])).toThrow(/make that field required/);
    expect(() =>
      product("/p/[year]/[slug]", [{ name: "year", label: "Year", type: "number", required: true }]),
    ).toThrow(/number field/);
    expect(() =>
      product("/p/[brand]/[slug]", [{ name: "brand", label: "Brand", type: "text", required: true }]),
    ).not.toThrow();
  });
});

describe("the page of an item at its type's path", () => {
  const types = [product("/produse/[category]/[slug]")];

  it("is found by its shape; the item's category is checked once it is loaded", () => {
    expect(itemPageOf(types, "/produse/ceramica/marazzi-art")).toMatchObject({
      type: { key: "product" },
      slug: "marazzi-art",
      locale: "",
    });
    expect(itemPageOf(types, "/produse/anything/marazzi-art")).toMatchObject({ slug: "marazzi-art" });
  });

  it.each(["/produs/marazzi-art", "/produse/marazzi-art", "/produse/a/b/c", "/alte/ceramica/marazzi-art"])(
    "is not at %s",
    (path) => {
      expect(itemPageOf(types, path)).toBeUndefined();
    },
  );

  it("follows the language rules of other item pages", () => {
    const locales = { defaultLocale: "ro", locales: ["ro", "en"] };

    expect(itemPageOf(types, "/en/produse/ceramica/art", locales)).toMatchObject({ slug: "art", locale: "en" });
    expect(itemPageOf(types, "/ro/produse/ceramica/art", locales)).toBeUndefined();
  });
});

describe("an item of a type with a path", () => {
  const brand: ContentField = { name: "brand", label: "Brand", type: "text", required: true };
  const type = product("/p/[brand]/[slug]", [brand]);

  it("needs letters or digits in the fields its address is made of", () => {
    const input = { title: "Lamp", visibility: "published", data: { brand: "—" } };

    expect(() => parseItem(type, input)).toThrow(/part of the item's address/);
    expect(parseItem(type, { ...input, data: { brand: "Marazzi" } }).data).toEqual({ brand: "Marazzi" });
  });

  it("is in the sitemap where the code draws a page of that shape, for a type without a template", () => {
    const own = product("/produse/[category]/[slug]", [category], false);
    const item = { slug: "art", data: { category: "mozaic" } };
    const path = itemPagePath(own, item, undefined);

    expect(itemHasPage(own, item, path, { pages: [], patterns: ["/produse/[cat]/[id]"] })).toBe(true);
    expect(itemHasPage(own, item, path, { pages: [], patterns: ["/produs/[slug]"] })).toBe(false);
    expect(itemHasPage(own, item, path, { pages: [], patterns: ["/produse/[...rest]"] })).toBe(false);
  });
});
