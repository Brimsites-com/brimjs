import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts, type Role } from "../src/auth/accounts.ts";
import { defineContentType } from "../src/content/content-types.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { HistoryStore } from "../src/content/history.ts";
import { ItemStore } from "../src/content/items.ts";
import { redirectFor } from "../src/content/redirects.ts";
import { sitemapEntries } from "../src/content/sitemap.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { connect } from "../src/runtime/connect.ts";
import { isPrivate } from "../src/server/fetch-image.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "http://localhost:4321";
const visitor = { clientAddress: "203.0.113.7" };

const project = defineContentType({
  key: "project",
  label: "Projects",
  singular: "Project",
  slug: "projects",
  component: () => "",
  fields: [{ name: "summary", label: "Summary", type: "textarea" }],
});

let brim: Brim;
let admin: AdminHandler;
let rendered: string[];

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
  rendered = [];
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    pages: () => ["/"],
    contentTypes: () => [project],
    mediaDirectory: pathToFileURL(`${mkdtempSync(join(tmpdir(), "brim-fixes-media-"))}/`),
    // The real fetch would leave the machine; every page the server asks for is recorded instead.
    fetch: (async (input: string | URL | Request) => {
      rendered.push(String(input instanceof Request ? input.url : input));
      return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    }) as typeof fetch,
  });
});

async function userWith(role: Role): Promise<{ token: string; cookie: string }> {
  const email = `${role}@example.test`;
  await brim.accounts.createUser(email, "correct horse battery", role);
  const token = await brim.accounts.createToken(email, "tool");
  const session = await brim.accounts.startSession((await brim.accounts.tokenUser(token))!.id);
  return { token, cookie: `brim_session=${session.token}` };
}

async function api(method: string, path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await admin(
    new Request(`${ORIGIN}/admin/api${path}`, {
      method,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers },
      ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    visitor,
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

async function mcp(token: string, body: unknown): Promise<Response> {
  const response = await admin(
    new Request(`${ORIGIN}/admin/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    visitor,
  );
  if (!response) throw new Error("/admin/mcp was not handled");
  return response;
}

describe("brim_read_page", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never asks another host for a page, so the token stays on this site", async () => {
    const { token } = await userWith("owner");
    const asked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      asked.push(String(input instanceof Request ? input.url : input));
      return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    });
    for (const path of ["//evil.example/steal", "/\\evil.example/steal"]) {
      const answer = (await (
        await mcp(token, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "brim_read_page", arguments: { path } },
        })
      ).json()) as { result: { isError?: boolean } };
      expect(answer.result.isError).toBe(true);
    }
    expect([...rendered, ...asked].filter((url) => !url.startsWith(ORIGIN))).toEqual([]);
  });
});

describe("addresses inside the server's network", () => {
  it("are recognised in the hex spelling the URL parser gives IPv4-mapped and NAT64 addresses", () => {
    expect(new URL("http://[::ffff:127.0.0.1]/").hostname).toBe("[::ffff:7f00:1]");
    for (const address of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "::ffff:0a00:0001", "::7f00:1"]) {
      expect(isPrivate(address), address).toBe(true);
    }
    expect(isPrivate("::ffff:808:808")).toBe(false);
    expect(isPrivate("2606:4700::1111")).toBe(false);
  });
});

describe("roles", () => {
  it("keep the newest form message from a writer, as /responses does", async () => {
    const writer = await userWith("writer");
    expect((await api("GET", "/emails/form?text", writer.cookie)).status).toBe(403);
    const owner = await userWith("owner");
    expect((await api("GET", "/emails/form?text", owner.cookie)).status).toBe(200);
  });

  it("do not let a writer move a published item through the history", async () => {
    const owner = await userWith("owner");
    const writer = await userWith("writer");
    const item = await brim.items.create("project", { title: "A", slug: "a", visibility: "published", data: {} });
    const moved = await api("PUT", "/items", owner.cookie, {
      id: item.id,
      title: "A",
      slug: "b",
      visibility: "published",
      data: {},
    });
    expect(moved.status).toBe(200);
    const [record] = (await brim.history.list()).filter((entry) => entry.target === "item");
    const restored = await api("POST", "/history/restore", writer.cookie, { id: record!.id });
    expect(restored.status).toBe(403);
    expect((await brim.items.get(item.id))?.slug).toBe("b");
  });
});

describe("signing in", () => {
  it("stays within ten wrong passwords when they are all sent at once", async () => {
    await brim.accounts.createUser("owner@example.test", "correct horse battery", "owner");
    const attempt = (guess: string) =>
      admin(
        new Request(`${ORIGIN}/admin/api/session`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json" },
          body: JSON.stringify({ email: "owner@example.test", password: guess }), // betterleaks:allow
        }),
        visitor,
      );
    const statuses = (await Promise.all(Array.from({ length: 30 }, (_, i) => attempt(`guess ${i}`)))).map(
      (r) => r?.status,
    );
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(10);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(20);
  });

  it("uses up no attempt when the password is right", async () => {
    await brim.accounts.createUser("owner@example.test", "correct horse battery", "owner");
    const signIn = () =>
      admin(
        new Request(`${ORIGIN}/admin/api/session`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json" },
          body: JSON.stringify({ email: "owner@example.test", password: "correct horse battery" }), // betterleaks:allow
        }),
        visitor,
      );
    for (let i = 0; i < 15; i++) expect((await signIn())?.status).toBe(200);
  });
});

describe("uploads", () => {
  it("answer a file name with broken percent-encoding without a server error", async () => {
    const owner = await userWith("owner");
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const response = await admin(
      new Request(`${ORIGIN}/admin/api/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${owner.token}`, "x-file-name": "%E0%A4%A" },
        body: PNG,
      }),
      visitor,
    );
    expect(response?.status).toBeLessThan(500);
  });
});

describe("MCP batches", () => {
  it("are refused past twenty requests", async () => {
    const { token } = await userWith("owner");
    const batch = Array.from({ length: 21 }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" }));
    expect((await mcp(token, batch)).status).toBe(413);
    expect((await mcp(token, batch.slice(0, 20))).status).toBe(200);
  });
});

describe("an item that changes its address", () => {
  it("keeps its page's search settings", async () => {
    const owner = await userWith("owner");
    const item = await brim.items.create("project", { title: "A", slug: "a", visibility: "published", data: {} });
    await brim.content.setPageSeo("/projects/a", { noindex: true });

    const response = await api("PUT", "/items", owner.cookie, {
      id: item.id,
      title: "A",
      slug: "b",
      visibility: "published",
      data: {},
    });
    expect(response.status).toBe(200);

    expect((await brim.content.page("/projects/b")).seo).toEqual({ noindex: true });
  });
});

describe("an original item deleted and put back", () => {
  it("is the original of its translations again", async () => {
    const owner = await userWith("owner");
    const draft = (title: string, slug: string) => ({ title, slug, visibility: "published" as const, data: {} });
    const original = await brim.items.create("project", draft("Spring", "spring"));
    const ro = await brim.items.create("project", draft("Primăvara", "primavara"), {
      locale: "ro",
      translationOf: original.id,
    });
    const de = await brim.items.create("project", draft("Frühling", "fruehling"), {
      locale: "de",
      translationOf: original.id,
    });

    expect((await api("DELETE", "/items", owner.cookie, { id: original.id })).status).toBe(200);
    const [record] = (await brim.history.list()).filter((entry) => entry.action === "deleted");
    expect((await api("POST", "/history/restore", owner.cookie, { id: record!.id })).status).toBe(200);

    expect((await brim.items.get(ro.id))?.translationOf).toBe(original.id);
    expect((await brim.items.get(de.id))?.translationOf).toBe(original.id);
  });
});

describe("the sitemap", () => {
  it("leaves out item pages hidden from search or pointing elsewhere", async () => {
    const draft = (slug: string) => ({ title: slug, slug, visibility: "published" as const, data: {} });
    for (const slug of ["open", "hidden", "moved"]) await brim.items.create("project", draft(slug));
    await brim.content.setPageSeo("/projects/hidden", { noindex: true });
    await brim.content.setPageSeo("/projects/moved", { canonical: "/elsewhere" });

    const entries = await sitemapEntries({
      content: brim.content,
      items: brim.items,
      contentTypes: [project],
      pageTemplates: [],
      routes: { pages: [], patterns: [] },
    });
    expect(entries.map((entry) => entry.path)).toEqual(["/projects/open"]);
  });
});

describe("redirects", () => {
  it("match an address with diacritics, which visitors' browsers send percent-encoded", () => {
    const response = redirectFor([{ from: "/cafea/ș", to: "/cafea/s" }], "/cafea/%C8%99", "");
    expect(response?.headers.get("location")).toBe("/cafea/s");
  });
});

describe("a database that could not be opened", () => {
  it("is tried again on the next request instead of failing until a restart", async () => {
    const folder = join(mkdtempSync(join(tmpdir(), "brim-connect-")), "not-yet");
    const url = pathToFileURL(join(folder, "data.db")).href;
    await expect(connect(url)).rejects.toThrow();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(folder);
    await expect(connect(url)).resolves.toBeTruthy();
  });
});

describe("an owner's own email server", () => {
  it("cannot be an address inside the host's network", async () => {
    const owner = await userWith("owner");
    for (const host of ["127.0.0.1", "169.254.169.254", "localhost", "mailserver"]) {
      const response = await api("PUT", "/mail", owner.cookie, {
        notify: [],
        smtp: { host, port: 25, from: "site@example.test", user: "", password: "x" }, // betterleaks:allow
      });
      expect(response.status, host).toBe(422);
    }
  });
});

describe("an item with a new address", () => {
  it("redirects its old address when it was published, and a new item there clears the redirect", async () => {
    const owner = await userWith("owner");
    const item = await brim.items.create("project", { title: "A", slug: "a", visibility: "published", data: {} });
    await api("PUT", "/items", owner.cookie, { id: item.id, title: "A", slug: "b", visibility: "published", data: {} });
    expect(await brim.content.redirects()).toEqual([{ from: "/projects/a", to: "/projects/b" }]);

    const created = await api("POST", "/items", owner.cookie, { type: "project", title: "A", slug: "a", data: {} });
    expect(created.status).toBe(201);
    expect(await brim.content.redirects()).toEqual([]);
  });

  it("leaves no redirect behind for a private item", async () => {
    const owner = await userWith("owner");
    const item = await brim.items.create("project", { title: "A", slug: "a", visibility: "private", data: {} });
    await api("PUT", "/items", owner.cookie, { id: item.id, title: "A", slug: "b", visibility: "private", data: {} });
    expect(await brim.content.redirects()).toEqual([]);
  });
});

describe("a new item whose title another item has", () => {
  it("gets a number in its address when the address comes from the title", async () => {
    const owner = await userWith("owner");
    const add = (body: Record<string, unknown>) =>
      api("POST", "/items", owner.cookie, { type: "project", data: {}, ...body });
    const slugOf = async (response: Response) => ((await response.json()) as { item: { slug: string } }).item.slug;
    expect(await slugOf(await add({ title: "Lake House" }))).toBe("lake-house");
    expect(await slugOf(await add({ title: "Lake House" }))).toBe("lake-house-2");
    expect(await slugOf(await add({ title: "Lake House", slug: "" }))).toBe("lake-house-3");
    // An address the person typed is theirs: it is refused, not changed.
    expect((await add({ title: "Other", slug: "lake-house" })).status).toBe(422);
  });
});

describe("a seed of a site in two languages", () => {
  it("links translations with their own slugs again after an export", async () => {
    const owner = await userWith("owner");
    const multilingual = createAdminHandler({
      brim,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      pages: () => ["/"],
      contentTypes: () => [project],
      locales: { defaultLocale: "en", locales: ["en", "ro"] },
      mediaDirectory: pathToFileURL(`${mkdtempSync(join(tmpdir(), "brim-fixes-media-"))}/`),
    });
    const call = async (method: string, path: string, body?: unknown) =>
      (await multilingual(
        new Request(`${ORIGIN}/admin/api${path}`, {
          method,
          headers: { cookie: owner.cookie, origin: ORIGIN, "content-type": "application/json" },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }),
        visitor,
      ))!;
    const spring = await brim.items.create("project", {
      title: "Spring",
      slug: "spring",
      visibility: "published",
      data: {},
    });
    await brim.items.create(
      "project",
      { title: "Primăvara", slug: "primavara", visibility: "published", data: {} },
      { locale: "ro", translationOf: spring.id },
    );
    const exported = ((await (await call("GET", "/seed")).json()) as { items: Record<string, unknown>[] }).items;
    expect(exported.find((entry) => entry.slug === "primavara")).toMatchObject({ locale: "ro", translates: "spring" });

    // Into an empty site: the same items, linked as before.
    await brim.db.query("DELETE FROM brim_items");
    const seeded = await call("POST", "/seed", { items: exported });
    expect(seeded.status, await seeded.clone().text()).toBeLessThan(300);
    const all = (await brim.db.query("SELECT slug, locale, translation_of FROM brim_items")) as Record<
      string,
      unknown
    >[];
    const original = (await brim.db.query("SELECT id FROM brim_items WHERE slug = 'spring'"))[0];
    expect(all.find((row) => row.slug === "primavara")?.translation_of).toBe(original?.id);
  });
});

describe("fetching an image", () => {
  it("refuses a name that resolves inside the server's network when connecting", async () => {
    const { pinnedFetch } = await import("../src/server/fetch-image.ts");
    await expect(pinnedFetch("http://localhost:9/x.png")).rejects.toThrow(/not a public address/);
  });
});

describe("a forgotten password", () => {
  async function withMail(siteUrl?: string) {
    const { Mailer } = await import("../src/mail/mailer.ts");
    const sent: { to: string[]; text: string }[] = [];
    const mailer = new Mailer(
      { smtp: "smtp://mail.example.test:587", from: "site@example.test" },
      { smtp: async (_server, _from, message) => void sent.push(message) },
    );
    const handler = createAdminHandler({
      brim,
      siteUrl,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      pages: () => ["/"],
      contentTypes: () => [project],
      mediaDirectory: pathToFileURL(`${mkdtempSync(join(tmpdir(), "brim-fixes-media-"))}/`),
      mailer,
    });
    const call = async (
      method: string,
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
      base = ORIGIN,
    ) =>
      (await handler(
        new Request(`${base}/admin/api${path}`, {
          method,
          headers: { origin: base, "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
        visitor,
      ))!;
    return { sent, call };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  it("is answered the same for an unknown email, and emails a link that sets a new one once", async () => {
    await brim.accounts.createUser("ana@example.test", "correct horse battery", "editor");
    const old = await brim.accounts.startSession(
      (await brim.accounts.authenticate("ana@example.test", "correct horse battery"))!.id,
    );
    const { sent, call } = await withMail("https://acme.example");

    const unknown = await call("POST", "/password/forgot", { email: "nobody@example.test" });
    const known = await call("POST", "/password/forgot", { email: "Ana@Example.test" });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual(await known.json());
    await settle();
    expect(sent.map((message) => message.to)).toEqual([["ana@example.test"]]);

    const link = /https:\/\/acme\.example\/admin\/edit#reset=([\w-]+)/.exec(sent[0]!.text);
    expect(link).toBeTruthy();
    const token = link![1]!;

    expect((await call("POST", "/password/reset", { token, password: "short" })).status).toBe(422); // betterleaks:allow
    const reset = await call("POST", "/password/reset", { token, password: "a brand new password" }); // betterleaks:allow
    expect(reset.status).toBe(200);
    expect(reset.headers.get("set-cookie")).toContain("brim_session=");
    expect(await brim.accounts.authenticate("ana@example.test", "a brand new password")).toBeTruthy();
    // Other sessions end, and the link works once.
    expect(await brim.accounts.sessionUser(old.token)).toBeUndefined();
    expect((await call("POST", "/password/reset", { token, password: "another new password" })).status).toBe(410); // betterleaks:allow
  });

  it("never builds the link from the request's Host away from this computer", async () => {
    await brim.accounts.createUser("ana@example.test", "correct horse battery", "editor");
    const previous = process.env.BRIM_SITE_URL;
    delete process.env.BRIM_SITE_URL;
    try {
      const { sent, call } = await withMail();
      const response = await call(
        "POST",
        "/password/forgot",
        { email: "ana@example.test" },
        {},
        "https://evil.example",
      );
      expect(response.status).toBe(501);
      expect(await response.text()).toContain("Set `site`");
      // On this computer the request's own address is used.
      expect((await call("POST", "/password/forgot", { email: "ana@example.test" })).status).toBe(200);
      await settle();
      expect(sent[0]?.text).toContain("http://localhost:4321/admin/edit#reset=");
    } finally {
      if (previous !== undefined) process.env.BRIM_SITE_URL = previous;
    }
  });

  it("sends at most three emails an hour to one address", async () => {
    await brim.accounts.createUser("ana@example.test", "correct horse battery", "editor");
    const { sent, call } = await withMail("https://acme.example");
    for (let i = 0; i < 5; i++) {
      expect(
        (await call("POST", "/password/forgot", { email: "ana@example.test" }, { "x-real-ip": `198.51.100.${i}` }))
          .status,
      ).toBe(200);
    }
    await settle();
    expect(sent.length).toBe(3);
  });
});

describe("changing one's password", () => {
  it("needs the current one, ends other sessions and keeps this browser signed in", async () => {
    const owner = await userWith("owner");
    const other = await brim.accounts.startSession((await brim.accounts.tokenUser(owner.token))!.id);

    const wrong = await api("PUT", "/password", owner.cookie, { current: "nope", password: "a brand new password" }); // betterleaks:allow
    expect(wrong.status).toBe(422);

    const changed = await api("PUT", "/password", owner.cookie, {
      current: "correct horse battery",
      password: "a brand new password", // betterleaks:allow
    });
    expect(changed.status).toBe(200);
    const cookie = (changed.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie).toMatch(/^brim_session=/);
    expect(await brim.accounts.sessionUser(other.token)).toBeUndefined();
    expect((await api("GET", "/session", cookie)).status).toBe(200);
  });
});
