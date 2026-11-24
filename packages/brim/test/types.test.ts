import { describe, expectTypeOf, it } from "vitest";
import { defineContentType, defineVocabulary } from "../src/content/content-types.ts";
import type { DataOf, FieldsData } from "../src/content/field-types.ts";
import { defineSiteSettings } from "../src/content/site-settings.ts";
import type { ImageValue, RichTextValue } from "../src/content/types.ts";
import type { ItemOf, ItemPageProps } from "../src/runtime/content.ts";

const category = defineVocabulary({
  key: "category",
  label: "Categories",
  singular: "Category",
  slug: "categories",
  fields: [],
});
const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "products",
  fields: [
    { name: "price", label: "Price", type: "number", required: true },
    { name: "summary", label: "Summary", type: "textarea" },
    { name: "category", label: "Category", vocabulary: "category", required: true },
    { name: "brands", label: "Brands", vocabulary: "brand", multiple: true },
    { name: "finish", label: "Finish", type: "select", options: ["matte", { value: "gloss", label: "Gloss" }] },
    { name: "specs", label: "Specs", type: "keyvalue" },
    { name: "cover", label: "Cover", type: "image" },
    { name: "gallery", label: "Gallery", type: "gallery" },
    { name: "details", label: "Details", type: "richtext" },
    { name: "featured", label: "Featured", type: "boolean" },
  ],
});

describe("types inferred from a content type's fields", () => {
  it("types each field by its kind, required ones always there", () => {
    type Data = DataOf<typeof product>;
    expectTypeOf<Data["price"]>().toEqualTypeOf<number>();
    expectTypeOf<Data["category"]>().toEqualTypeOf<string>();
    expectTypeOf<Data["summary"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Data["brands"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<Data["finish"]>().toEqualTypeOf<"matte" | "gloss" | undefined>();
    expectTypeOf<Data["specs"]>().toEqualTypeOf<{ label: string; value: string }[] | undefined>();
    expectTypeOf<Data["cover"]>().toEqualTypeOf<ImageValue | undefined>();
    expectTypeOf<Data["gallery"]>().toEqualTypeOf<ImageValue[] | undefined>();
    expectTypeOf<Data["details"]>().toEqualTypeOf<RichTextValue | undefined>();
    expectTypeOf<Data["featured"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Data["tags"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<keyof Data>().not.toEqualTypeOf<"pricee">();
  });

  it("gives items and item pages those types, and an open record without a declaration", () => {
    expectTypeOf<ItemOf<typeof product>["data"]["price"]>().toEqualTypeOf<number>();
    expectTypeOf<ItemPageProps<typeof product>["item"]["url"]>().toEqualTypeOf<string>();
    expectTypeOf<ItemPageProps["item"]["data"]>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<DataOf<typeof category>>().toEqualTypeOf<FieldsData<[]>>();
  });

  it("types the site settings, each one possibly empty", () => {
    const settings = defineSiteSettings({
      fields: [
        { name: "phone", label: "Phone", type: "text", default: "+40 700 000 000" },
        { name: "hours", label: "Hours", type: "keyvalue" },
      ],
    });
    type Values = DataOf<typeof settings>;
    expectTypeOf<Values["phone"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Values["hours"]>().toEqualTypeOf<{ label: string; value: string }[] | null | undefined>();
  });
});
