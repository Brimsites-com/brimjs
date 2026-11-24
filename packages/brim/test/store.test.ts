import { beforeEach, describe, expect, it } from "vitest";
import { pageScope, siteScope } from "../src/content/ids.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

let store: ContentStore;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  await migrate(db); // running twice must be harmless
  store = new ContentStore(db);
});

describe("nodes", () => {
  it("returns only the requested scopes", async () => {
    await store.saveNode(pageScope("/"), "hero-title", "text", { text: "Home" });
    await store.saveNode(pageScope("/about"), "hero-title", "text", { text: "About" });
    await store.saveNode(siteScope(), "navbar", "navbar", { items: [] });

    const nodes = await store.loadNodes([siteScope(), pageScope("/")]);

    expect(nodes.map((node) => `${node.scope} ${node.nodeId}`).sort()).toEqual(["page:/ hero-title", "site navbar"]);
  });

  it("overwrites a saved value", async () => {
    await store.saveNode(pageScope("/"), "hero-title", "text", { text: "First" });
    await store.saveNode(pageScope("/"), "hero-title", "text", { text: "Second" });

    expect(await store.loadNodes([pageScope("/")])).toEqual([
      { scope: "page:/", nodeId: "hero-title", kind: "text", value: { text: "Second" } },
    ]);
  });

  it("falls back to source after a reset", async () => {
    await store.saveNode(pageScope("/"), "hero-title", "text", { text: "Edited" });
    await store.resetNode(pageScope("/"), "hero-title");

    expect(await store.loadNodes([pageScope("/")])).toEqual([]);
  });

  it("rejects an invalid node id", async () => {
    await expect(store.saveNode(pageScope("/"), "Hero Title", "text", { text: "x" })).rejects.toThrow(/Invalid nodeId/);
  });
});

describe("page visibility", () => {
  it("is published until someone makes the page private", async () => {
    expect((await store.page("/about")).visibility).toBe("published");

    await store.setPageVisibility("/about/", "private");
    expect((await store.page("/about")).visibility).toBe("private");

    await store.setPageVisibility("/about", "published");
    expect((await store.page("/about/index.html")).visibility).toBe("published");
  });

  it("keeps SEO settings without changing who can see the page", async () => {
    await store.setPageVisibility("/about", "private");
    await store.setPageSeo("/about", { title: "About us", noindex: true });

    expect(await store.page("/about")).toEqual({
      path: "/about",
      visibility: "private",
      seo: { title: "About us", noindex: true },
    });
  });
});
