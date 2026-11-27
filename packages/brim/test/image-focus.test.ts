import { describe, expect, it } from "vitest";
import { readImages } from "../src/blocks/images.ts";
import { type ContentType, defineContentType } from "../src/content/content-types.ts";
import { focusStyle, readFocus } from "../src/content/image-focus.ts";
import { applyToItem } from "../src/content/item-fields.ts";
import { parseItem } from "../src/content/items.ts";
import type { Item } from "../src/content/items.ts";
import { parseImage } from "../src/content/validate.ts";
import { ValidationError } from "../src/content/validation-error.ts";

const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "products",
  author: false,
  tags: false,
  fields: [
    { name: "cover", label: "Cover", type: "image" },
    { name: "gallery", label: "Gallery", type: "gallery" },
  ],
});
const item: Item = {
  id: "1",
  type: "product",
  slug: "art",
  title: "Art",
  visibility: "published",
  data: {},
  locale: "",
  translationOf: null,
  position: 1,
  createdAt: "1",
  updatedAt: "1",
};

describe("an image's focus", () => {
  it("is kept with the picture, and left out while it is the middle", () => {
    expect(parseImage({ src: "/uploads/a.webp", alt: "A", focus: { x: 30, y: 72.25 } })).toEqual({
      src: "/uploads/a.webp",
      alt: "A",
      focus: { x: 30, y: 72.3 },
    });
    expect(parseImage({ src: "/uploads/a.webp", alt: "A", focus: { x: 50, y: 50 } })).toEqual({
      src: "/uploads/a.webp",
      alt: "A",
    });
    expect(parseImage({ src: "/uploads/a.webp", alt: "A" })).toEqual({ src: "/uploads/a.webp", alt: "A" });
  });

  it("must be two percentages", () => {
    expect(() => parseImage({ src: "/a.webp", alt: "", focus: { x: 120, y: 0 } })).toThrow(ValidationError);
    expect(() => parseImage({ src: "/a.webp", alt: "", focus: "top" })).toThrow(ValidationError);
    expect(readFocus({ x: "1", y: 2 })).toBeUndefined();
  });

  it("anchors a cropped picture", () => {
    expect(focusStyle({ x: 20, y: 80 })).toBe("object-position:20% 80%");
    expect(focusStyle({ x: 50, y: 50 })).toBeUndefined();
    expect(focusStyle(undefined)).toBeUndefined();
  });

  it("goes on a Gallery's or a Carousel's <img>", () => {
    const [moved, centered] = readImages(
      [
        { url: "/uploads/a.webp", alt: "A", focus: { x: 10, y: 90 } },
        { src: "/uploads/b.webp", alt: "B" },
      ],
      (src) => ({ src }),
    );
    expect(moved?.focus).toEqual({ x: 10, y: 90 });
    expect(moved?.img.style).toBe("object-position:10% 90%");
    expect(centered?.img).toEqual({ src: "/uploads/b.webp", alt: "B" });
  });

  it("stays with an image block in an item's blocks field", () => {
    const article: ContentType = {
      key: "article",
      label: "Articles",
      singular: "Article",
      slug: "blog",
      fields: [{ name: "body", label: "Body", type: "blocks" }],
    };
    const parsed = parseItem(article, {
      title: "Guide",
      visibility: "published",
      data: { body: [{ id: "a", type: "image", value: { url: "/uploads/a.webp", focalPointX: 15, focalPointY: 85 } }] },
    });
    const [block] = parsed.data.body as { value: Record<string, unknown> }[];
    expect(block?.value).toMatchObject({ url: "/uploads/a.webp", focalPointX: 15, focalPointY: 85 });
  });

  it("moves from an Image or a Gallery on an item's page into the item", () => {
    const cover = applyToItem(product, item, "cover", "image", {
      url: "/uploads/a.webp",
      alt: "A",
      focalPointX: 25,
      focalPointY: 40,
    });
    expect(cover.data.cover).toEqual({ src: "/uploads/a.webp", alt: "A", focus: { x: 25, y: 40 } });
    const centered = applyToItem(product, item, "cover", "image", {
      url: "/uploads/a.webp",
      alt: "A",
      focalPointX: 50,
      focalPointY: 50,
    });
    expect(centered.data.cover).toEqual({ src: "/uploads/a.webp", alt: "A" });
    const gallery = applyToItem(product, item, "gallery", "image-gallery", {
      images: [{ url: "/uploads/b.webp", alt: "B", focus: { x: 0, y: 100 } }],
    });
    expect(gallery.data.gallery).toEqual([{ src: "/uploads/b.webp", alt: "B", focus: { x: 0, y: 100 } }]);
  });
});

describe("a page's preview image focus", () => {
  it("is kept with the preview image only", async () => {
    const { parseSeo } = await import("../src/content/validate.ts");
    expect(parseSeo({ image: "/uploads/a.webp", imageFocus: { x: 40, y: 10 } })).toEqual({
      image: "/uploads/a.webp",
      imageFocus: { x: 40, y: 10 },
    });
    expect(parseSeo({ imageFocus: { x: 40, y: 10 } })).toEqual({});
    expect(parseSeo({ image: "/uploads/a.webp", imageFocus: { x: 50, y: 50 } })).toEqual({ image: "/uploads/a.webp" });
    expect(() => parseSeo({ image: "/uploads/a.webp", imageFocus: { x: -1, y: 0 } })).toThrow(ValidationError);
  });

  it("goes with an item's picture into its menu link", async () => {
    const { itemLink } = await import("../src/content/menus.ts");
    const link = itemLink(
      { title: "Art", url: "/art", data: { cover: { src: "/uploads/a.webp", alt: "A", focus: { x: 5, y: 6 } } } },
      ["cover"],
    );
    expect(link.image).toEqual({ src: "/uploads/a.webp", alt: "A", focus: { x: 5, y: 6 } });
  });
});
