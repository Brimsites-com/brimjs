import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { queryItems } from "../src/blocks/listing/query.ts";
import { defineContentType, defineVocabulary } from "../src/content/content-types.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { ItemStore } from "../src/content/items.ts";
import { expandFooter, expandNavbar, itemLink, navSources } from "../src/content/menus.ts";
import { ContentStore } from "../src/content/store.ts";
import type { NavItem } from "../src/content/types.ts";
import { parseNodeValue } from "../src/content/validate.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "http://localhost:4321";
const PASSWORD = "correct horse battery"; // betterleaks:allow (a test account in a memory database)

const category = defineVocabulary({
  key: "category",
  label: "Categories",
  singular: "Category",
  slug: "produse",
  ordered: true,
  component: () => "",
  fields: [{ name: "image", label: "Image", type: "image" }],
});
const article = defineContentType({ key: "article", label: "Articles", singular: "Article", slug: "blog", fields: [] });

const draft = (title: string, slug: string) => ({ title, slug, visibility: "published" as const, data: {} });

let items: ItemStore;
beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  items = new ItemStore(db);
});

describe("the owner's order of an ordered type's items", () => {
  it("puts a new item last, and lists the items in the order given", async () => {
    const ceramica = await items.create("category", draft("Ceramică", "ceramica"));
    const mozaic = await items.create("category", draft("Mozaic", "mozaic"));
    const baterii = await items.create("category", draft("Baterii", "baterii"));
    expect([ceramica.position, mozaic.position, baterii.position]).toEqual([1, 2, 3]);

    await items.reorder("category", [baterii.id, ceramica.id]);
    const listed = await items.list("category", { sort: "position" });
    expect(listed.map((item) => [item.slug, item.position])).toEqual([
      ["baterii", 1],
      ["ceramica", 2],
      ["mozaic", 3],
    ]);
    // Listings sort by it too, and keep it over the order the items came in.
    expect(queryItems([...listed].reverse(), { sort: "position" }).map((item) => item.slug)).toEqual([
      "baterii",
      "ceramica",
      "mozaic",
    ]);
  });

  it("lists a translation in its original's place", async () => {
    const ceramica = await items.create("category", draft("Ceramică", "ceramica"));
    const mozaic = await items.create("category", draft("Mozaic", "mozaic"));
    await items.create("category", draft("Ceramics", "ceramics"), { locale: "en", translationOf: ceramica.id });
    await items.create("category", draft("Mosaic", "mosaic"), { locale: "en", translationOf: mozaic.id });
    await items.reorder("category", [mozaic.id, ceramica.id]);

    const english = await items.list("category", { sort: "position", locale: "en" });
    expect(english.map((item) => [item.slug, item.position])).toEqual([
      ["mosaic", 1],
      ["ceramics", 2],
    ]);
  });

  it("takes only the type's items written first, each once", async () => {
    const ceramica = await items.create("category", draft("Ceramică", "ceramica"));
    const english = await items.create("category", draft("Ceramics", "ceramics"), {
      locale: "en",
      translationOf: ceramica.id,
    });
    const post = await items.create("article", draft("Ghid", "ghid"));
    await expect(items.reorder("category", [english.id])).rejects.toThrow(/written first/);
    await expect(items.reorder("category", [post.id])).rejects.toThrow(/written first/);
    await expect(items.reorder("category", [ceramica.id, ceramica.id])).rejects.toThrow(/twice/);
  });
});

describe("ordering items through the admin API", () => {
  let admin: AdminHandler;
  let token: string;

  beforeEach(async () => {
    const db = openDatabase(":memory:");
    await migrate(db);
    items = new ItemStore(db);
    const brim: Brim = {
      db,
      content: new ContentStore(db),
      items,
      forms: new FormStore(db),
      history: new HistoryStore(db),
      drafts: new DraftStore(db),
      accounts: new Accounts(db),
    };
    await brim.accounts.createUser("writer@example.test", PASSWORD, "writer");
    token = await brim.accounts.createToken("writer@example.test", "test");
    admin = createAdminHandler({
      brim,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      mediaDirectory: pathToFileURL(`${mkdtempSync(join(tmpdir(), "brim-ordered-"))}/`),
      pages: () => [],
      contentTypes: () => [category, article],
      pageTemplates: () => [],
    });
  });

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await admin(
      new Request(`${ORIGIN}/admin/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: ORIGIN },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
      { clientAddress: "203.0.113.7" },
    );
    if (!response) throw new Error(`${path} was not handled`);
    return response;
  }

  it("saves the order the owner drags the items into, and lists the type in it", async () => {
    const ceramica = await items.create("category", draft("Ceramică", "ceramica"));
    const mozaic = await items.create("category", draft("Mozaic", "mozaic"));
    expect((await call("PUT", "/items/order", { type: "category", ids: [mozaic.id, ceramica.id] })).status).toBe(200);
    const { items: listed } = (await (await call("GET", "/items?type=category")).json()) as {
      items: { slug: string }[];
    };
    expect(listed.map((item) => item.slug)).toEqual(["mozaic", "ceramica"]);
  });

  it("refuses to order a type that is not ordered", async () => {
    const post = await items.create("article", draft("Ghid", "ghid"));
    const response = await call("PUT", "/items/order", { type: "article", ids: [post.id] });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(/ordered: true/);
  });
});

describe("menus built from content", () => {
  const links = async (type: string): Promise<NavItem[]> =>
    type === "category"
      ? [
          itemLink(
            { title: "Ceramică", url: "/produse/ceramica", data: { image: { src: "/uploads/c.webp", alt: "C" } } },
            ["image"],
          ),
          itemLink({ title: "Mozaic", url: "/produse/mozaic", data: {} }, ["image"]),
        ]
      : [];

  it("fills a link's sub-links and a footer group with the type's items", async () => {
    const navbar = await expandNavbar(
      {
        items: [
          { label: "Home", href: "/" },
          { label: "Produse", href: "/produse", from: "category", children: [{ label: "Old", href: "/old" }] },
        ],
      },
      links,
    );
    expect(navbar.items[1]).toEqual({
      label: "Produse",
      href: "/produse",
      from: "category",
      children: [
        { label: "Ceramică", href: "/produse/ceramica", image: { src: "/uploads/c.webp", alt: "C" } },
        { label: "Mozaic", href: "/produse/mozaic" },
      ],
    });

    const footer = await expandFooter({ groups: [{ title: "Materiale", items: [], from: "category" }] }, links);
    expect(footer.groups[0]?.items).toEqual([
      { label: "Ceramică", href: "/produse/ceramica" },
      { label: "Mozaic", href: "/produse/mozaic" },
    ]);
  });

  it("keeps `from` when the owner saves the menu, and refuses what is not a type's key", () => {
    expect(
      parseNodeValue("navbar", { items: [{ label: "Produse", href: "/produse", from: "category" }] }).items[0],
    ).toEqual({ label: "Produse", href: "/produse", from: "category" });
    expect(parseNodeValue("footer", { groups: [{ title: "Materiale", from: "category" }] }).groups[0]).toEqual({
      title: "Materiale",
      items: [],
      from: "category",
    });
    expect(() => parseNodeValue("navbar", { items: [{ label: "X", href: "/x", from: "../etc" }] })).toThrow(
      /key of a content type/,
    );
  });

  it("offers the editor the types whose items have pages", () => {
    expect(JSON.parse(navSources([category, article]))).toEqual([{ value: "category", label: "Categories" }]);
  });
});
