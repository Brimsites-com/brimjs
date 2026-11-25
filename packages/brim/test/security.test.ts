import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts, type Role } from "../src/auth/accounts.ts";
import { defineContentType, defineVocabulary } from "../src/content/content-types.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { HistoryStore } from "../src/content/history.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import { smtpOptions } from "../src/mail/mailer.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";
import { givenOrigin, trustedOrigin } from "../src/server/http.ts";

const ORIGIN = "http://localhost:4321";
const PASSWORD = "correct horse battery"; // betterleaks:allow (a test value)

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
  path: "/shop/[category]/[kind]/[slug]",
  component: () => "",
  fields: [
    { name: "category", label: "Category", type: "reference", to: "category", required: true },
    { name: "also", label: "Also in", type: "reference", to: "category" },
    { name: "kind", label: "Kind", type: "select", options: ["new", "used"], required: true },
  ],
});
/** Its pages are written in the site's code, so each keeps what the owner placed on it. */
const note = defineContentType({
  key: "note",
  label: "Notes",
  singular: "Note",
  slug: "notes",
  path: "/notes/[kind]/[slug]",
  fields: [{ name: "kind", label: "Kind", type: "select", options: ["short", "long"], required: true }],
});

let brim: Brim;
let admin: AdminHandler;

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
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    pages: () => ["/", "/contact"],
    contentTypes: () => [category, product, note],
  });
});

async function userWith(role: Role): Promise<string> {
  const email = `${role}@example.test`;
  const { id } = await brim.accounts.createUser(email, PASSWORD, role);
  return `brim_session=${(await brim.accounts.startSession(id)).token}`;
}

async function api(method: string, path: string, cookie: string, body?: unknown, clientAddress = "203.0.113.7") {
  const response = await admin(
    new Request(`${ORIGIN}/admin/api${path}`, {
      method,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { clientAddress },
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

describe("signing in", () => {
  const signIn = (email: string, password: string, address: string) =>
    api("POST", "/session", "", { email, password }, address).then((response) => response.status);

  it("counts every spelling of an email as the same account", async () => {
    await userWith("owner");
    for (let i = 0; i < 10; i++) {
      expect(await signIn(`${" ".repeat(i)}OWNER@example.test`, "a wrong guess", `198.51.100.${i}`)).toBe(401);
    }
    expect(await signIn("\towner@example.test \n", PASSWORD, "198.51.100.50")).toBe(429);
    expect(await signIn("owner@example.test", PASSWORD, "198.51.100.51")).toBe(429);
  });

  it("keeps no row for the emails an address past its limit goes on to name, and no long one for any", async () => {
    const rows = async () => await brim.db.query("SELECT key FROM brim_rate_limits");
    for (let i = 0; i < 10; i++) await signIn("a".repeat(5_000) + i, "a wrong guess", "198.51.100.1");
    const counted = (await rows()).length;
    for (let i = 0; i < 50; i++) expect(await signIn(`someone${i}@example.test`, "guess", "198.51.100.1")).toBe(429);

    expect(await rows()).toHaveLength(counted);
    expect(Math.max(...(await rows()).map(({ key }) => String(key).length))).toBeLessThan(100);
    expect(JSON.stringify(await rows())).not.toContain("aaaa");
  });
});

describe("a form's notification addresses", () => {
  const form = (value: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
    path: "/contact",
    nodeId: "contact-form",
    scope: "page",
    kind: "form",
    value,
    ...more,
  });
  const saved = async () =>
    (await brim.content.loadNodes(["page:/contact"]))[0]?.value as Record<string, unknown> | undefined;

  it("stay as they were when a role that may not read the messages saves the form", async () => {
    const owner = await userWith("owner");
    const writer = await userWith("writer");
    expect(
      (await api("PUT", "/nodes", writer, form({ buttonText: "Go", notificationEmail: "w@evil.test" }))).status,
    ).toBe(200);
    expect(await saved()).toEqual({ buttonText: "Go" });

    await api("PUT", "/nodes", owner, form({ notificationEmail: "sales@example.test" }));
    await api("PUT", "/nodes", writer, form({ buttonText: "Send it", notificationEmail: "w@evil.test" }));
    expect(await saved()).toEqual({ buttonText: "Send it", notificationEmail: "sales@example.test" });
    // Leaving it out is no way to remove it either.
    await api("PUT", "/nodes", writer, form({ buttonText: "Send" }));
    expect(await saved()).toEqual({ buttonText: "Send", notificationEmail: "sales@example.test" });
  });

  it("are not slipped into a draft, an undone change or an older version for someone else to save", async () => {
    const owner = await userWith("owner");
    const writer = await userWith("writer");
    await api("PUT", "/nodes", owner, form({ notificationEmail: "old@example.test" }));
    await api("PUT", "/nodes", owner, form({ notificationEmail: "sales@example.test" }));

    await api("PUT", "/nodes", writer, form({ buttonText: "Go", notificationEmail: "w@evil.test" }, { draft: true }));
    const value = { kind: "form", value: { buttonText: "Go!", notificationEmail: "w@evil.test" } };
    await api("PUT", "/drafts", writer, {
      target: "node",
      key: "page:/contact\ncontact-form",
      value,
      path: "/contact",
    });
    await api("POST", "/drafts/save", owner, {});
    expect(await saved()).toEqual({ buttonText: "Go!", notificationEmail: "sales@example.test" });

    const change = (await brim.history.list()).find((entry) => entry.title === "contact-form");
    expect((await api("POST", "/history/restore", writer, { id: change!.id })).status).toBe(200);
    expect((await saved())?.notificationEmail).toBe("sales@example.test");
  });

  it("are set by an editor, who may read the messages", async () => {
    const editor = await userWith("editor");
    await api("PUT", "/nodes", editor, form({ notificationEmail: "team@example.test" }));
    expect(await saved()).toEqual({ notificationEmail: "team@example.test" });
  });
});

describe("Site Settings", () => {
  it("are not saved, reset or drafted as an element, past their own checks", async () => {
    const owner = await userWith("owner");
    const element = { path: "/", nodeId: "site-settings", scope: "site" };
    const value = { href: "/x", label: "y" };
    const draft = { target: "node", key: "site\nsite-settings", value: { kind: "link", value }, path: "/" };

    expect((await api("PUT", "/nodes", owner, { ...element, kind: "link", value })).status).toBe(400);
    expect((await api("PUT", "/nodes", owner, { ...element, kind: "link", value, draft: true })).status).toBe(400);
    expect((await api("DELETE", "/nodes", owner, element)).status).toBe(400);
    expect((await api("PUT", "/drafts", owner, draft)).status).toBe(400);
    expect(await brim.content.allNodes()).toEqual([]);
  });
});

describe("an item that changes its address", () => {
  const create = (
    type: string,
    slug: string,
    data: Record<string, unknown>,
    visibility: "published" | "private" = "published",
  ) => brim.items.create(type, { title: slug, slug, visibility, data });
  const term = (slug: string, visibility: "published" | "private" = "published") =>
    create("category", slug, {}, visibility);
  const slugOf = async (id: string) => (await brim.items.get(id))?.slug;
  const dataOf = async (id: string) => (await brim.items.get(id))?.data;

  it("is moved by a writer in none of the ways there are, when visitors see it", async () => {
    const owner = await userWith("owner");
    const writer = await userWith("writer");
    const [lamps] = [await term("lamps"), await term("chairs")];
    const data = { category: "lamps", kind: "new" };
    const item = await create("product", "arc", data);
    const whole = { id: item.id, title: "arc", slug: "arc", visibility: "published" };
    const field = {
      path: "/shop/lamps/new/arc",
      nodeId: "kind",
      scope: "page",
      kind: "field",
      item: item.id,
      field: "kind",
      value: { value: "used" },
    };
    const moved = { slug: "arc", title: "arc", data: { ...data, kind: "used" } };

    expect((await api("PUT", "/items", writer, { ...whole, data: moved.data })).status).toBe(403);
    expect((await api("PUT", "/items", writer, { ...whole, data: moved.data, draft: true, path: "/" })).status).toBe(
      403,
    );
    expect((await api("PUT", "/nodes", writer, field)).status).toBe(403);
    expect((await api("PUT", "/nodes", writer, { ...field, draft: true })).status).toBe(403);
    expect(
      (await api("PUT", "/drafts", writer, { target: "item", key: item.id, value: moved, path: "/" })).status,
    ).toBe(403);
    // Not by saving what an owner only drafted, either.
    await api("PUT", "/items", owner, { ...whole, data: moved.data, draft: true, path: "/" });
    expect(await (await api("POST", "/drafts/save", writer, {})).json()).toMatchObject({ saved: 0, failed: [{}] });
    expect(await dataOf(item.id)).toEqual(data);
    // Nor by renaming a private term that a published item is under.
    await api("PUT", "/items/visibility", owner, { id: lamps.id, visibility: "private" });
    const renamed = { id: lamps.id, title: "lamps", slug: "lights", visibility: "private", data: {} };
    expect((await api("PUT", "/items", writer, renamed)).status).toBe(403);
    expect(await slugOf(lamps.id)).toBe("lamps");
  });

  it("is changed by a writer where that moves nothing", async () => {
    const writer = await userWith("writer");
    await term("lamps");
    const data = { category: "lamps", kind: "new" };
    const item = await create("product", "arc", data);
    const draft = await create("product", "draft", data, "private");

    const change = {
      id: item.id,
      title: "Arc lamp",
      slug: "arc",
      visibility: "published",
      data: { ...data, also: "lamps" },
    };
    expect((await api("PUT", "/items", writer, change)).status).toBe(200);
    expect((await api("PUT", "/items", writer, { ...change, title: "Arc", draft: true, path: "/" })).status).toBe(200);
    const private_ = {
      id: draft.id,
      title: "draft",
      slug: "moved",
      visibility: "private",
      data: { ...data, kind: "used" },
    };
    expect((await api("PUT", "/items", writer, private_)).status).toBe(200);
    const unused = await term("unused", "private");
    const renamed = { id: unused.id, title: "unused", slug: "renamed", visibility: "private", data: {} };
    expect((await api("PUT", "/items", writer, renamed)).status).toBe(200);
  });

  it("keeps its page's search settings and redirects the old address, however it moved", async () => {
    const owner = await userWith("owner");
    const lamps = await term("lamps");
    const item = await create("product", "arc", { category: "lamps", also: "lamps", kind: "new" });
    await brim.content.setPageSeo("/shop/lamps/new/arc", { noindex: true });

    // A field set on the item's page.
    await api("PUT", "/nodes", owner, {
      path: "/shop/lamps/new/arc",
      nodeId: "kind",
      scope: "page",
      kind: "field",
      item: item.id,
      field: "kind",
      value: { value: "used" },
    });
    expect((await brim.content.page("/shop/lamps/used/arc")).seo).toEqual({ noindex: true });
    expect((await brim.content.page("/shop/lamps/new/arc")).seo).toEqual({});

    // The term it is under renamed, which it names in two fields.
    await api("PUT", "/items", owner, {
      id: lamps.id,
      title: "Lights",
      slug: "lights",
      visibility: "published",
      data: {},
    });
    expect(await dataOf(item.id)).toEqual({ category: "lights", also: "lights", kind: "used" });
    expect((await brim.content.page("/shop/lights/used/arc")).seo).toEqual({ noindex: true });
    expect((await brim.content.redirects()).filter(({ from }) => from.endsWith("/arc"))).toEqual([
      { from: "/shop/lamps/new/arc", to: "/shop/lights/used/arc" },
      { from: "/shop/lamps/used/arc", to: "/shop/lights/used/arc" },
    ]);
  });

  it("takes along what was placed on its page, when that is written in code", async () => {
    const owner = await userWith("owner");
    const item = await create("note", "n1", { kind: "short" });
    await brim.content.saveNode("page:/notes/short/n1", "lead", "text", { text: "Placed here" });
    const moved = { id: item.id, title: "n1", slug: "n1", data: { kind: "long" }, draft: true, path: "/" };
    await api("PUT", "/items", owner, moved);
    await api("POST", "/drafts/save", owner, {});

    expect(await brim.content.loadNodes(["page:/notes/short/n1"])).toEqual([]);
    expect(await brim.content.loadNodes(["page:/notes/long/n1"])).toMatchObject([{ value: { text: "Placed here" } }]);
  });
});

describe("the site's address", () => {
  afterEach(() => vi.unstubAllEnvs());
  const asked = (headers: Record<string, string>) => new Request("http://localhost:43967/x", { headers });

  it("in what is sent to others is the one that was set, never one the request names", () => {
    const forged = asked({ host: "evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" });
    expect(trustedOrigin(forged)).toBeUndefined();
    expect(trustedOrigin(forged, "https://acme.test/base/")).toBe("https://acme.test");
    expect(trustedOrigin(asked({ host: "not a host" }))).toBeUndefined();
    vi.stubEnv("BRIM_SITE_URL", "https://www.acme.test");
    expect(trustedOrigin(forged, "https://acme.test")).toBe("https://www.acme.test");
    expect(givenOrigin()).toBe("https://www.acme.test");
  });

  it("is believed from the request on this computer, where the site is being built", () => {
    expect(trustedOrigin(asked({ host: "localhost:4321" }))).toBe("http://localhost:4321");
    expect(trustedOrigin(asked({ host: "127.0.0.1:4321" }))).toBe("http://127.0.0.1:4321");
    expect(trustedOrigin(asked({ host: "localhost.evil.test" }))).toBeUndefined();
  });
});

describe("a mail server's password", () => {
  const server = { host: "smtp.acme.example", port: 587, secure: false, user: "u", password: "p" }; // betterleaks:allow

  it("is sent only once the connection is encrypted, except on this computer", () => {
    expect(smtpOptions(server)).toMatchObject({ secure: false, requireTLS: true });
    expect(smtpOptions({ ...server, port: 465, secure: true })).toMatchObject({ secure: true, requireTLS: false });
    expect(smtpOptions({ ...server, host: "localhost", port: 1025 }).requireTLS).toBe(false);
    // Without one there is nothing to protect: a relay on the server's own network may have no encryption.
    expect(smtpOptions({ ...server, user: "", password: "" }).requireTLS).toBe(false);
  });
});
