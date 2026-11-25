import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { browseItems } from "../src/blocks/listing/query.ts";
import { defineContentType, defineVocabulary } from "../src/content/content-types.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { type Item, ItemStore, parseItem } from "../src/content/items.ts";
import { checkReferenceTargets, termsBySlug } from "../src/content/references.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";
import { itemPagePath } from "../src/server/locales.ts";

const ORIGIN = "http://localhost:4321";
const EMAIL = "owner@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow (a test account in a memory database)

const category = defineVocabulary({
  key: "category",
  label: "Categories",
  singular: "Category",
  slug: "categories",
  fields: [{ name: "description", label: "Description", type: "textarea" }],
});
const brand = defineVocabulary({ key: "brand", label: "Brands", singular: "Brand", slug: "brands", fields: [] });
const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "products",
  path: "/produse/[category]/[slug]",
  component: () => "",
  author: false,
  tags: false,
  fields: [
    { name: "category", label: "Category", vocabulary: "category", required: true },
    { name: "brands", label: "Brands", vocabulary: "brand", multiple: true },
  ],
});
const types = [category, brand, product];

describe("declaring a vocabulary and the fields that use it", () => {
  it("makes a vocabulary a content type of terms, without an author or tags", () => {
    expect(category).toMatchObject({ key: "category", vocabulary: true });
    expect(category.fields.map((field) => field.name)).toEqual(["description"]);
  });

  it("reads a field naming its vocabulary as a reference to it, and says which vocabulary it uses", () => {
    expect(product.fields.find(({ name }) => name === "category")).toMatchObject({ type: "reference", to: "category", vocabulary: "category" });
    expect(product.fields.find(({ name }) => name === "brands")).toMatchObject({ type: "reference", to: "brand", multiple: true });
    expect(() => checkReferenceTargets(types)).not.toThrow();
  });

  it("refuses a field that names a vocabulary and another type, or a vocabulary that is not one", () => {
    const declare = (field: object) =>
      defineContentType({
        key: "x",
        label: "X",
        singular: "X",
        slug: "x",
        fields: [{ name: "f", label: "F", ...field } as never],
      });
    expect(() => declare({ type: "text", vocabulary: "category" })).toThrow(/leave its type out/);
    expect(() => declare({ type: "reference" })).toThrow(/needs "to"/);
    expect(() => declare({ type: "text", multiple: true })).toThrow(/only a reference field/);
    const plain = defineContentType({ key: "tag", label: "Tags", singular: "Tag", slug: "t", fields: [] });
    const using = declare({ vocabulary: "tag" });
    expect(() => checkReferenceTargets([plain, using])).toThrow(/declare it with defineVocabulary/);
    expect(() => checkReferenceTargets([using])).toThrow(/not a declared content type/);
  });

  it("keeps one slug, or a list without repeats, and puts a single reference in the address", () => {
    const draft = parseItem(product, {
      title: "Art",
      visibility: "published",
      data: { category: "ceramica", brands: ["marazzi", "marazzi", "rako"] },
    });
    expect(draft.data).toEqual({ category: "ceramica", brands: ["marazzi", "rako"] });
    expect(() => parseItem(product, { title: "Art", visibility: "published", data: { category: ["a", "b"] } })).toThrow(
      /takes one item/,
    );
    expect(() =>
      parseItem(product, { title: "Art", visibility: "published", data: { category: "Not A Slug" } }),
    ).toThrow(/by their address/);
    expect(itemPagePath(product, { slug: "art", data: { category: "ceramica" } }, undefined)).toBe(
      "/produse/ceramica/art",
    );
    expect(() =>
      defineContentType({ ...product, key: "p2", path: "/p/[brands]/[slug]", fields: product.fields }),
    ).toThrow(/multiple reference field/);
  });
});

let brim: Brim;
let admin: AdminHandler;
let cookie: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await admin(
    new Request(`${ORIGIN}${path}`, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) }),
    { clientAddress: "203.0.113.7" },
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

const create = async (type: string, title: string, data: Record<string, unknown> = {}, slug?: string) =>
  call("POST", "/admin/api/items", { type, title, ...(slug && { slug }), visibility: "published", data });
const json = async (response: Response) => (await response.json()) as { item: Item; error?: string };

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  brim = {
    db,
    content: new ContentStore(db),
    items: new ItemStore(db),
    forms: new FormStore(db),
    history: new HistoryStore(db),
    drafts: new DraftStore(db),
    accounts: new Accounts(db),
  };
  await brim.accounts.createUser(EMAIL, PASSWORD, "owner");
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    pages: () => [],
    locales: { defaultLocale: "ro", locales: ["ro", "en"] },
    contentTypes: () => types,
    pageTemplates: () => [],
  });
  cookie = "";
  const session = await call("POST", "/admin/api/session", { email: EMAIL, password: PASSWORD }); // betterleaks:allow
  cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
});

describe("references kept true by the server", () => {
  it("refuses an item naming a term that does not exist", async () => {
    await create("category", "Ceramică", {}, "ceramica");
    const missing = await create("product", "Art", { category: "mozaic" });
    expect(missing.status).toBe(422);
    expect((await json(missing)).error).toMatch(/"mozaic": there is no such category/);
    expect((await create("product", "Art", { category: "ceramica" })).status).toBe(201);
  });

  it("carries the items along when a term changes its address", async () => {
    const term = (await json(await create("category", "Ceramică", {}, "ceramica"))).item;
    await create("brand", "Marazzi", {}, "marazzi");
    await create("product", "Art", { category: "ceramica", brands: ["marazzi"] }, "art");

    const renamed = await call("PUT", "/admin/api/items", {
      id: term.id,
      title: "Ceramică",
      slug: "gresie",
      visibility: "published",
      data: {},
    });
    expect(renamed.status).toBe(200);
    const [art] = await brim.items.list("product");
    expect(art?.data.category).toBe("gresie");
    expect(itemPagePath(product, art!, undefined)).toBe("/produse/gresie/art");
  });

  it("keeps a term in use from being deleted, and lets it go once nothing points at it", async () => {
    const term = (await json(await create("category", "Ceramică", {}, "ceramica"))).item;
    const art = (await json(await create("product", "Art", { category: "ceramica" }))).item;
    const refused = await call("DELETE", "/admin/api/items", { id: term.id });
    expect(refused.status).toBe(422);
    expect((await json(refused)).error).toMatch(/"Ceramică" is used by "Art"/);

    await call("DELETE", "/admin/api/items", { id: art.id });
    expect((await call("DELETE", "/admin/api/items", { id: term.id })).status).toBe(200);
  });
});

describe("terms in several languages", () => {
  const translate = async (id: string, locale: string) =>
    (await json(await call("POST", "/admin/api/items/translate", { id, locale }))).item;
  const rename = (item: Item, slug: string) =>
    call("PUT", "/admin/api/items", {
      id: item.id,
      title: item.title,
      slug,
      visibility: item.visibility,
      data: item.data,
    });

  it("keeps a translation of a term on the term's slug, so items find it in every language", async () => {
    const term = (await json(await create("category", "Ceramică", {}, "ceramica"))).item;
    const english = await translate(term.id, "en");
    expect(english.slug).toBe("ceramica");

    const refused = await rename(english, "ceramics");
    expect(refused.status).toBe(422);
    expect((await json(refused)).error).toMatch(/change it on the original/);
    const drafted = await call("PUT", "/admin/api/items", {
      id: english.id,
      title: "Ceramics",
      slug: "ceramics",
      data: {},
      draft: true,
    });
    expect(drafted.status).toBe(422);
    // Its title and fields are its own to change.
    expect((await call("PUT", "/admin/api/items", { ...english, title: "Ceramics" })).status).toBe(200);
  });

  it("moves a term's translations and the items pointing at it when the original changes its slug", async () => {
    const term = (await json(await create("category", "Ceramică", {}, "ceramica"))).item;
    await translate(term.id, "en");
    await create("product", "Art", { category: "ceramica" }, "art");

    expect((await rename(term, "gresie")).status).toBe(200);

    const categories = await brim.items.list("category");
    expect(categories.map((item) => [item.locale, item.slug]).sort()).toEqual([
      ["", "gresie"],
      ["en", "gresie"],
    ]);
    expect((await brim.items.list("product"))[0]?.data.category).toBe("gresie");
  });

  it("shows a term not translated yet in its own language rather than leaving it out", () => {
    const term = (locale: string, slug: string, translationOf: string | null, title: string) => ({
      locale,
      slug,
      translationOf,
      title,
    });
    const english = [term("en", "ceramica", "1", "Ceramics")];
    const all = [
      term("", "ceramica", null, "Ceramică"),
      term("", "mozaic", null, "Mozaic"),
      term("de", "mozaic", "2", "Mosaik"),
      ...english,
    ];

    const terms = termsBySlug(english, all);
    expect(terms.get("ceramica")?.title).toBe("Ceramics");
    expect(terms.get("mozaic")?.title).toBe("Mozaic");
  });
});

describe("a listing of items with references", () => {
  it("offers the terms by title as facets, and finds items by their terms' titles", async () => {
    const items = [
      {
        id: "a",
        type: "product",
        slug: "a",
        title: "Art",
        visibility: "published",
        data: { category: "ceramica", brands: ["marazzi"] },
        locale: "",
        translationOf: null,
        position: 0,
        createdAt: "1",
        updatedAt: "1",
      },
      {
        id: "b",
        type: "product",
        slug: "b",
        title: "Bloc",
        visibility: "published",
        data: { category: "mozaic", brands: [] },
        locale: "",
        translationOf: null,
        createdAt: "2",
        updatedAt: "2",
      },
    ] as Item[];
    const labels = { category: { ceramica: "Ceramică", mozaic: "Mozaic" }, brands: { marazzi: "Marazzi" } };
    const state = browseItems(
      items,
      product.fields,
      { facets: ["category", "brands"], search: true, labels },
      new URLSearchParams("q=ceramica"),
    );

    expect(state.items.map((item) => item.id)).toEqual(["a"]);
    expect(state.facets[0]?.options.map((option) => option.label)).toEqual(["Ceramică", "Mozaic"]);
    expect(state.facets[1]?.options).toEqual([{ value: "marazzi", label: "Marazzi", count: 1, selected: false }]);
  });
});
