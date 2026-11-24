import { describe, expect, it } from "vitest";
import { ValidationError, parseNodeValue } from "../src/content/validate.ts";
import { emptyValue, nodeKinds } from "../src/editor/client/kinds.ts";

const chairs = { label: "Chairs", href: "/products/chairs", image: { src: "/uploads/chairs.jpg", alt: "A chair" } };

describe("navbar values", () => {
  it("keeps a flat list saved before groups existed as it was", () => {
    const value = { logoText: "Acme", items: [{ label: "About", href: "/about" }] };

    expect(parseNodeValue("navbar", value)).toEqual(value);
  });

  it("keeps sub-links and pictures, dropping unknown fields", () => {
    const value = parseNodeValue("navbar", {
      items: [
        {
          label: "Products",
          href: "/products",
          extra: true,
          image: { src: "https://cdn.example.com/p.jpg", alt: "Products", width: 300 },
          children: [{ ...chairs, children: [{ label: "Armchairs", href: "/products/chairs/arm" }] }],
        },
      ],
    });

    expect(value.items).toEqual([
      {
        label: "Products",
        href: "/products",
        image: { src: "https://cdn.example.com/p.jpg", alt: "Products" },
        children: [{ ...chairs, children: [{ label: "Armchairs", href: "/products/chairs/arm" }] }],
      },
    ]);
  });

  it("stores a link with no sub-links without an empty list", () => {
    expect(parseNodeValue("navbar", { items: [{ label: "About", href: "/about", children: [] }] })).toEqual({
      items: [{ label: "About", href: "/about" }],
    });
  });

  it.each([
    [
      "a script link among the sub-links",
      { items: [{ ...chairs, children: [{ label: "x", href: "javascript:alert(1)" }] }] },
    ],
    ["a protocol-relative picture", { items: [{ ...chairs, image: { src: "//evil.example/x.png", alt: "" } }] }],
    ["a picture without a description", { items: [{ ...chairs, image: { src: "/x.png" } }] }],
    ["sub-links that are not a list", { items: [{ ...chairs, children: { label: "x", href: "/x" } }] }],
    [
      "sub-links three levels deep",
      { items: [{ ...chairs, children: [{ ...chairs, children: [{ ...chairs, children: [chairs] }] }] }] },
    ],
    [
      "too many links in all",
      { items: Array.from({ length: 10 }, () => ({ ...chairs, children: Array(40).fill(chairs) })) },
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => parseNodeValue("navbar", value)).toThrow(ValidationError);
  });

  it("keeps the footer's links plain", () => {
    const value = parseNodeValue("footer", { groups: [{ items: [{ ...chairs, children: [chairs] }] }] });

    expect(value.groups).toEqual([{ items: [{ label: "Chairs", href: "/products/chairs" }] }]);
  });
});

describe("the navbar in the editor", () => {
  const navbar = nodeKinds.navbar!;
  const element = {} as HTMLElement;

  it("offers a picture and sub-links on each link, two levels deep", () => {
    const items = navbar.schema(element);
    if (items.type !== "group") throw new Error("expected a group");
    const top = items.fields.items;
    if (top?.type !== "list" || top.item.type !== "group") throw new Error("expected a list of groups");
    const sub = top.item.fields.children;
    if (sub?.type !== "list" || sub.item.type !== "group") throw new Error("expected sub-links");
    const subSub = sub.item.fields.children;
    if (subSub?.type !== "list" || subSub.item.type !== "group") throw new Error("expected sub-sub-links");

    expect(top.item.fields.image).toMatchObject({ type: "image" });
    expect(top.item.fields.href).toMatchObject({ type: "url" });
    expect(sub.addLabel).toBe("Add sub-link");
    expect(subSub.item.fields.children).toBeUndefined();
  });

  it("saves new, untouched entries as plain links", () => {
    const schema = navbar.schema(element);
    if (schema.type !== "group" || schema.fields.items?.type !== "list") throw new Error("expected links");
    const added = { ...(emptyValue(schema.fields.items.item) as object), label: "About", href: "/about" };

    expect(navbar.toValue({ logoText: "", logo: { src: "", alt: "" }, items: [added] })).toEqual({
      items: [{ label: "About", href: "/about" }],
    });
  });

  it("keeps the pictures and sub-links the owner set", () => {
    const form = {
      items: [
        { label: "Products", href: "/products", image: { src: "", alt: "" }, children: [{ ...chairs, children: [] }] },
      ],
    };

    expect(navbar.toValue(form)).toEqual({ items: [{ label: "Products", href: "/products", children: [chairs] }] });
  });
});
