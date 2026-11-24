import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { defineContentType, defineVocabulary } from "../src/content/content-types.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { exportSeedFiles, isLocalSite, runSeed } from "../src/seed-cli.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "http://localhost:4321";
/** A real 1×1 picture: the site only takes files that are images. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const OWNER = "owner@example.test";
const EDITOR = "editor@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow (a test account in a memory database)

const category = defineVocabulary({
  key: "category",
  label: "Categories",
  singular: "Category",
  slug: "categories",
  fields: [{ name: "image", label: "Image", type: "image" }],
});
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
    { name: "price", label: "Price", type: "number" },
    { name: "gallery", label: "Gallery", type: "gallery" },
  ],
});

let brim: Brim;
let admin: AdminHandler;
let ownerToken: string;
let editorToken: string;
let uploads: string;

async function call(method: string, path: string, body: unknown, token = ownerToken): Promise<Response> {
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
  await brim.accounts.createUser(OWNER, PASSWORD, "owner");
  await brim.accounts.createUser(EDITOR, PASSWORD, "editor");
  ownerToken = await brim.accounts.createToken(OWNER, "test");
  editorToken = await brim.accounts.createToken(EDITOR, "test");
  uploads = mkdtempSync(join(tmpdir(), "brim-seed-uploads-"));
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    mediaDirectory: pathToFileURL(`${uploads}/`),
    pages: () => [],
    contentTypes: () => [category, product],
    pageTemplates: () => [],
  });
});

const seed = [
  { type: "product", title: "Marazzi Art", data: { category: "ceramica", price: 120 } },
  { type: "category", title: "Ceramică", slug: "ceramica" },
  { type: "category", title: "Mozaic", slug: "mozaic" },
];

describe("seeding a site through its admin API", () => {
  it("answers what a dry run would add, in order, and writes nothing", async () => {
    const response = await call("POST", "/seed", { items: seed, dryRun: true });
    expect(response.status).toBe(200);
    const plan = (await response.json()) as { create: { index: number; type: string; slug: string }[] };
    // The terms come before the product that points at them, wherever the seed lists them.
    expect(plan.create.map((entry) => [entry.index, entry.type, entry.slug])).toEqual([
      [1, "category", "ceramica"],
      [2, "category", "mozaic"],
      [0, "product", "marazzi-art"],
    ]);
    expect(await brim.items.list("product")).toEqual([]);
  });

  it("adds only what is missing, and never changes what the owner has", async () => {
    expect((await call("POST", "/seed", { items: seed })).status).toBe(200);
    const [art] = await brim.items.list("product");
    expect(art).toMatchObject({ title: "Marazzi Art", visibility: "published", data: { category: "ceramica" } });

    // The owner renames it; seeding again with the old title leaves it as the owner has it.
    await brim.items.update(art!, { title: "Art (nou)", slug: art!.slug, visibility: "published", data: art!.data });
    const again = (await (await call("POST", "/seed", { items: seed })).json()) as {
      added: unknown[];
      existing: unknown[];
    };
    expect(again.added).toEqual([]);
    expect(again.existing).toHaveLength(3);
    expect((await brim.items.list("product"))[0]?.title).toBe("Art (nou)");
  });

  it("adds nothing when one item is wrong, and says every mistake at once", async () => {
    const response = await call("POST", "/seed", {
      items: [
        { type: "category", title: "Ceramică", slug: "ceramica" },
        { type: "product", title: "Bloc", data: { category: "lemn" } },
        { type: "product", title: "Fără categorie", data: {} },
        { type: "nothing", title: "X" },
        { type: "category", title: "Ceramică din nou", slug: "ceramica" },
      ],
    });
    expect(response.status).toBe(422);
    const { error } = (await response.json()) as { error: string };
    expect(error).toMatch(/4 mistake/);
    expect(error).toMatch(/"lemn", which is neither in the site nor in the seed/);
    expect(error).toMatch(/"Category" is required/);
    expect(error).toMatch(/"nothing" is not one of the site's content types/);
    expect(error).toMatch(/"ceramica" twice/);
    expect(await brim.items.list("category")).toEqual([]);
  });

  it("is for the site's owners only", async () => {
    expect((await call("POST", "/seed", { items: seed, dryRun: true }, editorToken)).status).toBe(403);
    expect((await call("GET", "/seed", undefined, editorToken)).status).toBe(403);
  });
});

describe("brim seed and brim seed --export", () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "brim-seed-"));
    // The CLI's requests reach the admin handler as they would reach the dev server.
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.startsWith("/uploads/")) {
        const name = new URL(request.url).pathname.replace("/uploads/", "");
        return new Response(readFileSync(join(uploads, name)));
      }
      return (await admin(request, { clientAddress: "203.0.113.7" })) ?? new Response(null, { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const target = () => ({ url: ORIGIN, token: ownerToken });

  it("reads seed/<type>.json, uploads the pictures of what it adds, and adds it", async () => {
    mkdirSync(join(folder, "images"));
    writeFileSync(join(folder, "images", "ceramica.png"), PNG);
    writeFileSync(
      join(folder, "category.json"),
      JSON.stringify([
        { title: "Ceramică", slug: "ceramica", data: { image: { src: "images/ceramica.png", alt: "" } } },
      ]),
    );
    writeFileSync(join(folder, "product.json"), JSON.stringify([{ title: "Art", data: { category: "ceramica" } }]));

    const dry = await runSeed(folder, target(), true);
    expect(dry.create.map((entry) => entry.slug)).toEqual(["ceramica", "art"]);
    expect(await brim.items.list("category")).toEqual([]);
    expect(readdirSync(uploads)).toEqual([]);

    const done = await runSeed(folder, target(), false);
    expect(done.uploaded).toBe(1);
    const [term] = await brim.items.list("category");
    expect((term?.data.image as { src: string }).src).toMatch(/^\/uploads\/.+\.png$/);
    expect((await runSeed(folder, target(), false)).create).toEqual([]);
  });

  it("refuses a picture the seed names but does not have, before asking the site anything", async () => {
    writeFileSync(
      join(folder, "category.json"),
      JSON.stringify([{ title: "Mozaic", data: { image: { src: "images/lipsa.webp", alt: "" } } }]),
    );
    await expect(runSeed(folder, target(), true)).rejects.toThrow(/images\/lipsa\.webp does not exist/);
  });

  it("writes the site's items and their pictures into the seed folder, and reads them back the same", async () => {
    mkdirSync(join(folder, "images"));
    writeFileSync(join(folder, "images", "ceramica.png"), PNG);
    writeFileSync(
      join(folder, "category.json"),
      JSON.stringify([
        { title: "Ceramică", slug: "ceramica", data: { image: { src: "images/ceramica.png", alt: "x" } } },
      ]),
    );
    await runSeed(folder, target(), false);

    const out = mkdtempSync(join(tmpdir(), "brim-seed-out-"));
    const done = await exportSeedFiles(out, target(), false);
    expect(done).toMatchObject({ files: ["category.json"], items: 1, images: 1 });
    const written = JSON.parse(readFileSync(join(out, "category.json"), "utf8"));
    expect(written).toEqual([
      { title: "Ceramică", slug: "ceramica", data: { image: { src: expect.stringMatching(/^images\//), alt: "x" } } },
    ]);
    await expect(exportSeedFiles(out, target(), false)).rejects.toThrow(/--force/);
  });

  it("signs in by itself only to a site on this computer", () => {
    expect(isLocalSite("http://localhost:4321")).toBe(true);
    expect(isLocalSite("http://127.0.0.1:4327")).toBe(true);
    expect(isLocalSite("https://studionord.ro")).toBe(false);
  });
});
