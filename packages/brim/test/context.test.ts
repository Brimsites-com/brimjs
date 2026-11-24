import { describe, expect, it } from "vitest";
import { normalizePagePath, pageScope, typeScope } from "../src/content/ids.ts";
import { BrimContext } from "../src/runtime/context.ts";

describe("BrimContext", () => {
  const context = new BrimContext(pageScope("/about/"), undefined, [
    { scope: "page:/about", nodeId: "title", kind: "text", value: { text: "About us" } },
    { scope: "page:/", nodeId: "lead", kind: "text", value: { text: "Home lead" } },
    { scope: "site", nodeId: "navbar", kind: "navbar", value: { items: [] } },
  ]);

  it("reads the page's own nodes", () => {
    expect(context.read("text", "title")).toEqual({ text: "About us" });
  });

  it("does not see another page's nodes", () => {
    expect(context.read("text", "lead")).toBeUndefined();
  });

  it("keeps site and page nodes apart", () => {
    expect(context.read("navbar", "navbar", "site")).toEqual({ items: [] });
    expect(context.read("navbar", "navbar")).toBeUndefined();
  });

  it("ignores a stored value of another kind", () => {
    expect(context.read("richtext", "title")).toBeUndefined();
  });

  it("rejects an invalid node id", () => {
    expect(() => context.read("text", "Not Valid")).toThrow(/Invalid nodeId/);
  });
});

describe("editor markers", () => {
  it("are absent on the public site", () => {
    expect(new BrimContext(pageScope("/"), undefined, []).marker("text", "title", "page")).toEqual({});
  });

  it("identify the node while editing", () => {
    const editing = new BrimContext(pageScope("/"), undefined, [], true);

    expect(editing.marker("navbar", "navbar", "site", { items: [] })).toEqual({
      "data-brim-node": "navbar",
      "data-brim-kind": "navbar",
      "data-brim-scope": "site",
      "data-brim-value": '{"items":[]}',
    });
  });
});

describe("the page of an item", () => {
  const context = new BrimContext(
    typeScope("project"),
    undefined,
    [
      { scope: "type:project", nodeId: "back", kind: "text", value: { text: "All projects" } },
      { scope: "page:/projects/lake-house", nodeId: "back", kind: "text", value: { text: "Old, per item" } },
    ],
    true,
  );

  it("reads what the owner changed on its type's template", () => {
    expect(context.read("text", "back")).toEqual({ text: "All projects" });
  });

  it("marks the template's parts for the editor", () => {
    expect(context.marker("text", "back", "page")).toMatchObject({ "data-brim-scope": "template" });
    expect(context.marker("navbar", "navbar", "site")).toMatchObject({ "data-brim-scope": "site" });
  });
});

describe("the blocks of an item's field", () => {
  const item = {
    id: "lake",
    type: "project",
    title: "Lake House",
    data: { content: [{ id: "b1", type: "image", value: { url: "/lake.jpg", alt: "" } }] },
  };

  it("hands each block its value through its own nodeId and scope", () => {
    const context = new BrimContext(typeScope("project"), undefined, []);
    const [block] = context.blocks(item, "content");

    expect(block).toEqual({
      nodeId: "b1",
      kind: "image",
      layout: { width: "content", align: "center", space: "normal" },
      scope: "item:lake:content",
    });
    expect(context.read("text", "b1", block!.scope)).toBeUndefined();
    expect(context.blocks({ ...item, data: {} }, "content")).toEqual([]);
    // A block written some other way, with an id that is not a nodeId, is left out instead of failing the page.
    const odd = { ...item, data: { content: [{ id: "Block 1", type: "divider", value: {} }] } };
    expect(context.blocks(odd, "content")).toEqual([]);
  });

  it("marks a block as the item's content, with its place in the field", () => {
    const context = new BrimContext(typeScope("project"), undefined, [], true);
    const [block] = context.blocks(item, "content");

    expect(context.marker("image", "b1", block!.scope)).toMatchObject({
      "data-brim-node": "b1",
      "data-brim-item": "lake",
      "data-brim-field": "content",
      "data-brim-entry": "b1",
    });
  });
});

describe("multilingual site", () => {
  it("reads site nodes of the page's language only", () => {
    const romanian = new BrimContext(pageScope("/ro/despre"), "ro", [
      { scope: "site:ro", nodeId: "navbar", kind: "navbar", value: { logoText: "Atelier", items: [] } },
      { scope: "site:en", nodeId: "navbar", kind: "navbar", value: { logoText: "Studio", items: [] } },
    ]);

    expect(romanian.read("navbar", "navbar", "site")).toEqual({ logoText: "Atelier", items: [] });
  });
});

describe("normalizePagePath", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/about", "/about"],
    ["/about/", "/about"],
    ["/about/index.html", "/about"],
    ["/index.html", "/"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePagePath(input)).toBe(expected);
  });
});
