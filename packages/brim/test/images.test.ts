import { describe, expect, it } from "vitest";
import { readImages, toSaved } from "../src/blocks/images.ts";
import { defineContentType } from "../src/content/content-types.ts";
import { applyToItem } from "../src/content/item-fields.ts";
import type { Item } from "../src/content/items.ts";

const sources = (src: string) => ({ src, srcset: `${src}?width=640 640w`, sizes: "50vw" });

describe("the images of a Gallery or a Carousel", () => {
  it("reads them however they were saved, with what an <img> needs", () => {
    const images = readImages(
      [
        { url: "/uploads/a.webp", alt: "A", caption: "First", link: "/produse" },
        { src: "/uploads/b.webp", alt: "B" },
        { url: "/uploads/c.webp", title: "Old gallery title" },
        { url: "", alt: "nothing" },
        { url: "/uploads/d.webp", link: "javascript:alert(1)" },
      ],
      sources,
    );
    expect(images.map(({ src, caption, link }) => ({ src, caption, link }))).toEqual([
      { src: "/uploads/a.webp", caption: "First", link: "/produse" },
      { src: "/uploads/b.webp", caption: undefined, link: undefined },
      { src: "/uploads/c.webp", caption: "Old gallery title", link: undefined },
      { src: "/uploads/d.webp", caption: undefined, link: undefined },
    ]);
    expect(images[1]?.img).toEqual({
      src: "/uploads/b.webp",
      srcset: "/uploads/b.webp?width=640 640w",
      sizes: "50vw",
      alt: "B",
    });
  });

  it("keeps starting images from the code in the shape the side panel saves", () => {
    expect(toSaved([{ src: "/hero.webp", alt: "Hero" }, { url: "/old.webp" }])).toEqual([
      { url: "/hero.webp", alt: "Hero" },
      { url: "/old.webp" },
    ]);
  });

  it("saves what the owner changes on an item's gallery into the item, in order", () => {
    const product = defineContentType({
      key: "product",
      label: "Products",
      singular: "Product",
      slug: "products",
      author: false,
      tags: false,
      fields: [{ name: "gallery", label: "Gallery", type: "gallery" }],
    });
    const item: Item = {
      id: "1",
      type: "product",
      slug: "art",
      title: "Art",
      visibility: "published",
      data: { gallery: [{ src: "/uploads/a.webp", alt: "A" }] },
      locale: "",
      translationOf: null,
      position: 1,
      createdAt: "1",
      updatedAt: "1",
    };
    const draft = applyToItem(product, item, "gallery", "carousel", {
      images: [
        { url: "/uploads/b.webp", alt: "B", caption: "kept by the template only" },
        { url: "/uploads/a.webp", alt: "A" },
        { url: "" },
      ],
    });
    expect(draft.data.gallery).toEqual([
      { src: "/uploads/b.webp", alt: "B" },
      { src: "/uploads/a.webp", alt: "A" },
    ]);
  });
});
