import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import {
  faviconType,
  pageTitleOf,
  profileAddresses,
  resolveBrandColors,
  resolveFavicon,
  resolveHostSignIn,
  resolveIdentity,
} from "../src/config.ts";
import type { Item } from "../src/content/items.ts";
import { itemPagePath, pathInLocale, storedLocale } from "../src/server/locales.ts";
import { defineContentType } from "../src/content/content-types.ts";
import { ItemStore } from "../src/content/items.ts";
import { definePageTemplate } from "../src/content/page-templates.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { FormStore } from "../src/forms/store.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";
import { clientAddress } from "../src/server/http.ts";

const ORIGIN = "http://localhost:4321";
const EMAIL = "owner@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow
const visitor = { clientAddress: "203.0.113.7" };

const project = defineContentType({
  key: "project",
  label: "Projects",
  singular: "Project",
  slug: "projects",
  // Never rendered here; the API only needs to know that the type has a template.
  component: () => "",
  fields: [
    { name: "location", label: "Location", type: "text", required: true },
    { name: "area", label: "Area", type: "number" },
    { name: "style", label: "Style", type: "select", options: ["modern", "classic"] },
    { name: "cover", label: "Cover", type: "image" },
    { name: "content", label: "Content", type: "blocks", blocks: ["richtext", "image"] },
  ],
});

const post = defineContentType({
  key: "post",
  label: "Posts",
  singular: "Post",
  slug: "blog",
  component: () => "",
  article: true,
  fields: [],
});

// Its item pages are written in the site's code (`src/pages/notes/[slug].astro`), without a template.
const note = defineContentType({
  key: "note",
  label: "Notes",
  singular: "Note",
  slug: "notes",
  fields: [{ name: "body", label: "Body", type: "text" }],
});

// The component is never rendered here; the API only needs to know the template exists.
const service = definePageTemplate({
  key: "service",
  label: "Service page",
  description: "A hero and a contact form.",
  folder: "services",
  component: () => "",
});

const uploads = mkdtempSync(join(tmpdir(), "brim-uploads-"));
const mediaDirectory = pathToFileURL(`${uploads}/`);

let brim: Brim;
let admin: AdminHandler;
let changes: (string | undefined)[];
/** Pages written in code; the language tests add a Romanian one. */
let codePages: string[];

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
  changes = [];
  codePages = ["/", "/about/", "/about"];
  admin = createAdminHandler({
    brim,
    locales: { defaultLocale: "en", locales: ["en", "ro"] },
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    pages: () => codePages,
    contentTypes: () => [project, note, post],
    pageTemplates: () => [service],
    mediaDirectory,
    brandColors: resolveBrandColors({ Primary: "#FF7138", Ink: "#242420" }),
    onChange: (path) => void changes.push(path),
  });
});

describe("host sign-in", () => {
  it("is offered on the sign-in form only when the host sets an address", async () => {
    const info = async () =>
      ((await (await call("GET", "/admin/api/info")).json()) as { hostSignIn: unknown }).hostSignIn;
    expect(await info()).toBeNull();

    const saved = { url: process.env.BRIM_HOST_SIGN_IN_URL, name: process.env.BRIM_HOST_SIGN_IN_NAME };
    try {
      delete process.env.BRIM_HOST_SIGN_IN_URL;
      delete process.env.BRIM_HOST_SIGN_IN_NAME;
      expect(resolveHostSignIn()).toBeUndefined();
      process.env.BRIM_HOST_SIGN_IN_URL = "javascript:alert(1)";
      expect(resolveHostSignIn()).toBeUndefined();
      process.env.BRIM_HOST_SIGN_IN_URL = "https://dashboard.example.test/site-sign-in?site=s1";
      process.env.BRIM_HOST_SIGN_IN_NAME = "Example Host";
      const hostSignIn = resolveHostSignIn();
      expect(hostSignIn).toEqual({ url: "https://dashboard.example.test/site-sign-in?site=s1", name: "Example Host" });

      admin = createAdminHandler({ brim, assetsDirectory: new URL("../editor-dist/", import.meta.url), hostSignIn });
      expect(await info()).toEqual(hostSignIn);
    } finally {
      for (const [key, value] of [
        ["BRIM_HOST_SIGN_IN_URL", saved.url],
        ["BRIM_HOST_SIGN_IN_NAME", saved.name],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("brand colors", () => {
  it("are read from the config, checked, and offered to the editor", async () => {
    const info = (await (await call("GET", "/admin/api/info")).json()) as { brandColors: unknown };
    expect(info.brandColors).toEqual([
      { name: "Primary", value: "#ff7138" },
      { name: "Ink", value: "#242420" },
    ]);
    expect(resolveBrandColors([{ name: "Accent", value: "#abc" }])).toEqual([{ name: "Accent", value: "#abc" }]);
    expect(resolveBrandColors(undefined)).toEqual([]);
    expect(() => resolveBrandColors({ Primary: "orange" })).toThrow(/use #rgb or #rrggbb/);
  });
});

interface CallOptions {
  body?: unknown;
  cookie?: string;
  origin?: string | null;
}

async function call(method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin !== null && method !== "GET") headers.set("origin", options.origin ?? ORIGIN);
  const response = await admin(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    }),
    visitor,
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

async function json<T>(response: Response): Promise<T> {
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

async function signIn(): Promise<string> {
  const response = await call("POST", "/admin/api/session", { body: { email: EMAIL, password: PASSWORD } }); // betterleaks:allow
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("signing in", () => {
  it("a sign-in link opens the editor signed in, once", async () => {
    const { token } = await brim.accounts.createSignInToken(EMAIL);
    const first = await call("GET", `/admin/api/session/link?token=${token}`);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("/admin/edit");
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(await (await call("GET", "/admin/api/session", { cookie })).json()).toMatchObject({
      user: { email: EMAIL },
    });

    const again = await call("GET", `/admin/api/session/link?token=${token}`);
    expect(again.status).toBe(303);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("issues a cookie that cannot be read by scripts and reaches the pages, so the server shows them editable", async () => {
    const response = await call("POST", "/admin/api/session", { body: { email: EMAIL, password: PASSWORD } }); // betterleaks:allow
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/;");
    expect(await response.json()).toMatchObject({ user: { email: EMAIL, role: "owner" } });
  });

  it("rejects a wrong password and an unknown email the same way", async () => {
    const wrong = await call("POST", "/admin/api/session", { body: { email: EMAIL, password: "not the password" } }); // betterleaks:allow
    const unknown = await call("POST", "/admin/api/session", {
      body: { email: "nobody@example.test", password: PASSWORD }, // betterleaks:allow
    });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("stops password guessing after ten attempts", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await call("POST", "/admin/api/session", { body: { email: EMAIL, password: "guess number " + attempt } }); // betterleaks:allow
    }
    const blocked = await call("POST", "/admin/api/session", { body: { email: EMAIL, password: PASSWORD } }); // betterleaks:allow

    expect(blocked.status).toBe(429);
  });

  it("does not count signing in correctly as an attempt", async () => {
    for (let attempt = 0; attempt < 12; attempt++) await signIn();
    for (let attempt = 0; attempt < 9; attempt++) {
      await call("POST", "/admin/api/session", { body: { email: EMAIL, password: "guess number " + attempt } }); // betterleaks:allow
    }

    await signIn();
  });

  it("is never shown inside another site's page", async () => {
    for (const path of ["/admin/edit", "/admin/api/info", "/admin/assets/editor.js"]) {
      const response = await call("GET", path);
      expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
      expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    // A sign-in link keeps its own, stricter rule: its address holds the token.
    const link = await call("GET", "/admin/api/session/link?token=nothing");
    expect(link.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("counts visitors by the address their proxy gives, when told which header holds it", () => {
    const request = new Request(ORIGIN, { headers: { "x-real-ip": "198.51.100.4", "x-forwarded-for": "1.2.3.4" } });
    expect(clientAddress(request, "10.0.0.1")).toBe("10.0.0.1");
    process.env.BRIM_CLIENT_IP_HEADER = "x-real-ip";
    try {
      expect(clientAddress(request, "10.0.0.1")).toBe("198.51.100.4");
      expect(clientAddress(new Request(ORIGIN), "10.0.0.1")).toBe("10.0.0.1");
    } finally {
      delete process.env.BRIM_CLIENT_IP_HEADER;
    }
  });

  it("refuses a body that is too large without holding it in memory", async () => {
    const send = (headers: Record<string, string>, body: BodyInit) =>
      admin(
        new Request(`${ORIGIN}/admin/api/session`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
          body,
          duplex: "half",
        } as RequestInit),
        visitor,
      );
    // A body that says how large it is is refused before any of it is read.
    let read = 0;
    const counted = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          read += 64 * 1024;
          controller.enqueue(new Uint8Array(64 * 1024).fill(97));
        },
      });
    const declared = await send({ "content-length": String(200 * 1024 * 1024) }, counted());
    expect(declared?.status).toBe(413);
    expect(read).toBeLessThanOrEqual(64 * 1024);

    // One that does not is read no further than the limit, though it never ends.
    read = 0;
    const endless = await send({}, counted());
    expect(endless?.status).toBe(413);
    expect(read).toBeLessThanOrEqual(256 * 1024);
  });

  it("keeps the editor signed in when an old cookie of the same name is sent first", async () => {
    const cookie = await signIn();
    // A cookie kept under /admin by an older version, or set by another Brim site on another port of localhost.
    const both = `brim_session=stale-token; ${cookie}`;

    expect(await (await call("GET", "/admin/api/session", { cookie: both })).json()).toMatchObject({
      user: { email: EMAIL },
    });
    expect((await call("GET", "/admin/api/pages", { cookie: both })).status).toBe(200);
  });

  it("removes the old /admin cookie when signing in", async () => {
    const response = await call("POST", "/admin/api/session", { body: { email: EMAIL, password: PASSWORD } }); // betterleaks:allow
    const cookies = response.headers.getSetCookie();

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^brim_session=[^;]+; Path=\/;/);
    expect(cookies[1]).toMatch(/^brim_session=; Path=\/admin; Max-Age=0;/);
  });

  it("forgets every session the browser sent on sign-out", async () => {
    const first = await signIn();
    const second = await signIn();
    await call("DELETE", "/admin/api/session", { cookie: `${first}; ${second}` });

    expect((await call("GET", "/admin/api/session", { cookie: first })).status).toBe(401);
    expect((await call("GET", "/admin/api/session", { cookie: second })).status).toBe(401);
  });

  it("forgets the session on sign-out", async () => {
    const cookie = await signIn();
    await call("DELETE", "/admin/api/session", { cookie });

    expect((await call("GET", "/admin/api/session", { cookie })).status).toBe(401);
  });
});

describe("protection", () => {
  const save = { path: "/", scope: "page", nodeId: "hero-title", kind: "text", value: { text: "Hi" } };

  it("refuses to save without a session", async () => {
    expect((await call("PUT", "/admin/api/nodes", { body: save })).status).toBe(401);
  });

  it("refuses a request sent from another site", async () => {
    const cookie = await signIn();
    const foreign = await call("PUT", "/admin/api/nodes", { body: save, cookie, origin: "https://evil.example" });
    const missing = await call("PUT", "/admin/api/nodes", { body: save, cookie, origin: null });

    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await brim.content.loadNodes(["page:/"])).toEqual([]);
  });

  it("leaves every path outside /admin to the site", async () => {
    expect(await admin(new Request(`${ORIGIN}/administrator`), visitor)).toBeUndefined();
    expect(await admin(new Request(`${ORIGIN}/`), visitor)).toBeUndefined();
  });
});

describe("editing", () => {
  it("saves a page node and reports the page to rebuild", async () => {
    const cookie = await signIn();
    const response = await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/about/", scope: "page", nodeId: "title", kind: "text", value: { text: "About us", extra: 1 } },
    });

    expect(response.status).toBe(200);
    expect(await brim.content.loadNodes(["page:/about"])).toEqual([
      { scope: "page:/about", nodeId: "title", kind: "text", value: { text: "About us" } },
    ]);
    expect(changes).toEqual(["/about"]);
  });

  it("shows what the owner saved on a page and on the whole site", async () => {
    const cookie = await signIn();
    await brim.content.saveNode("page:/about", "title", "text", { text: "About us" });
    await brim.content.saveNode("page:/about", "hero-image", "image", { url: "/uploads/a.jpg", alt: "" });
    await brim.content.saveNode("page:/contact", "title", "text", { text: "Elsewhere" });

    expect((await call("GET", "/admin/api/nodes?path=/about")).status).toBe(401);
    const saved = await (await call("GET", "/admin/api/nodes?path=/about/", { cookie })).json();
    expect(saved.path).toBe("/about");
    expect(saved.page).toEqual([
      { nodeId: "hero-image", kind: "image", value: { url: "/uploads/a.jpg", alt: "" } },
      { nodeId: "title", kind: "text", value: { text: "About us" } },
    ]);
    expect(Array.isArray(saved.site)).toBe(true);
    expect(saved.template).toBeUndefined();
  });

  it("stores site nodes per language and asks for a full rebuild", async () => {
    const cookie = await signIn();
    const navbar = { logoText: "Atelier", items: [{ label: "Despre", href: "/ro/despre" }] };
    await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/ro/despre", scope: "site", nodeId: "navbar", kind: "navbar", value: navbar },
    });

    expect(await brim.content.loadNodes(["site:ro"])).toHaveLength(1);
    expect(await brim.content.loadNodes(["site:en"])).toEqual([]);
    expect(changes).toEqual([undefined]);
  });

  it("saves navbar groups with their sub-links and pictures", async () => {
    const cookie = await signIn();
    const navbar = {
      items: [
        {
          label: "Products",
          href: "/products",
          image: { src: "/uploads/products.jpg", alt: "Products", width: 400 },
          children: [{ label: "Chairs", href: "/products/chairs", image: { src: "/uploads/chairs.jpg", alt: "" } }],
        },
      ],
    };
    const response = await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/ro/", scope: "site", nodeId: "navbar", kind: "navbar", value: navbar },
    });

    expect(response.status).toBe(200);
    const [saved] = await brim.content.loadNodes(["site:ro"]);
    expect(saved?.value).toEqual({
      items: [
        {
          label: "Products",
          href: "/products",
          image: { src: "/uploads/products.jpg", alt: "Products" },
          children: [{ label: "Chairs", href: "/products/chairs", image: { src: "/uploads/chairs.jpg", alt: "" } }],
        },
      ],
    });
  });

  it.each([
    ["a script link", "link", { href: "javascript:alert(1)" }],
    ["a protocol-relative image", "image", { url: "//evil.example/x.png", alt: "" }],
    ["text of the wrong type", "text", { text: 42 }],
    ["an unknown kind", "widget", {}],
  ])("rejects %s", async (_name, kind, value) => {
    const cookie = await signIn();
    const response = await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/", scope: "page", nodeId: "node", kind, value },
    });

    expect(response.status).toBe(422);
    expect(await brim.content.loadNodes(["page:/"])).toEqual([]);
  });

  it("keeps allowed text formatting and drops nothing silently", async () => {
    const cookie = await signIn();
    const rich = ["Hello ", { tag: "strong", children: ["world"] }, { tag: "a", href: "/about", children: ["!"] }];
    await call("PUT", "/admin/api/nodes", {
      cookie,
      body: {
        path: "/",
        scope: "page",
        nodeId: "title",
        kind: "text",
        value: { text: "Hello world!", rich, as: "h2" },
      },
    });

    expect((await brim.content.loadNodes(["page:/"]))[0]?.value).toEqual({ text: "Hello world!", rich, as: "h2" });
  });

  it.each([
    ["a script element", [{ tag: "script", children: ["alert(1)"] }]],
    ["a script link", [{ tag: "a", href: "javascript:alert(1)", children: ["x"] }]],
  ])("rejects text formatted with %s", async (_name, rich) => {
    const cookie = await signIn();
    const response = await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/", scope: "page", nodeId: "title", kind: "text", value: { text: "x", rich } },
    });

    expect(response.status).toBe(422);
  });

  it("saves a block's settings, keeping only what its schema declares", async () => {
    const cookie = await signIn();
    const response = await call("PUT", "/admin/api/nodes", {
      cookie,
      body: {
        path: "/",
        scope: "page",
        nodeId: "cta",
        kind: "button",
        value: { text: "Buy", url: "/shop", openInNewTab: true, size: "lg", showIcon: true, unknown: "dropped" },
      },
    });

    expect(response.status).toBe(200);
    expect((await brim.content.loadNodes(["page:/"]))[0]).toEqual({
      scope: "page:/",
      nodeId: "cta",
      kind: "button",
      value: { text: "Buy", url: "/shop", openInNewTab: true, size: "lg", showIcon: true },
    });
  });

  it.each([
    ["a script address", { url: "javascript:alert(1)" }],
    ["a setting of the wrong type", { showIcon: "yes" }],
  ])("rejects block settings with %s", async (_name, value) => {
    const cookie = await signIn();
    const response = await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/", scope: "page", nodeId: "cta", kind: "button", value },
    });

    expect(response.status).toBe(422);
  });

  it("resets a node back to its source default", async () => {
    const cookie = await signIn();
    const node = { path: "/", scope: "page", nodeId: "hero-title" };
    await call("PUT", "/admin/api/nodes", { cookie, body: { ...node, kind: "text", value: { text: "Edited" } } });
    await call("DELETE", "/admin/api/nodes", { cookie, body: node });

    expect(await brim.content.loadNodes(["page:/"])).toEqual([]);
  });

  it("makes a page private and published again", async () => {
    const cookie = await signIn();
    await call("PUT", "/admin/api/pages", { cookie, body: { path: "/about", visibility: "private" } });
    const pages = await call("GET", "/admin/api/pages", { cookie });

    expect(await pages.json()).toEqual({
      pages: [
        { path: "/", visibility: "published", seo: {} },
        { path: "/about", visibility: "private", seo: {} },
      ],
    });
  });
});

describe("content items", () => {
  const draft = {
    type: "project",
    title: "Vila Nouă, etapa 2",
    visibility: "published",
    data: { location: "Cluj", area: 240, style: "modern", cover: { src: "/vila.jpg", alt: "Vila" }, extra: "dropped" },
  };

  it("creates an item, deriving its address from the title and keeping only declared fields", async () => {
    const cookie = await signIn();
    const response = await call("POST", "/admin/api/items", { cookie, body: draft });
    const { item } = (await response.json()) as { item: { slug: string; data: unknown } };

    expect(response.status).toBe(201);
    expect(item.slug).toBe("vila-noua-etapa-2");
    expect(item.data).toEqual({
      location: "Cluj",
      area: 240,
      style: "modern",
      cover: { src: "/vila.jpg", alt: "Vila" },
    });
    expect(changes).toEqual([undefined]);
  });

  it("keeps the blocks of a blocks field, each checked like its own block", async () => {
    const cookie = await signIn();
    const content = [
      { id: "b1", type: "richtext", value: { blocks: [{ tag: "p", children: ["By the lake."] }] } },
      { id: "b2", type: "image", value: { url: "/uploads/lake.jpg", alt: "The lake", size: "lg", extra: 1 } },
      {
        id: "b3",
        type: "image",
        value: { url: "/uploads/b.jpg" },
        layout: { width: "narrow", align: "left", other: 1 },
      },
    ];
    const response = await call("POST", "/admin/api/items", {
      cookie,
      body: { ...draft, data: { ...draft.data, content } },
    });

    expect(response.status).toBe(201);
    // Each block keeps how it sits in the field; one saved before that keeps the size it had, as its width.
    expect(((await response.json()) as { item: { data: { content: unknown } } }).item.data.content).toEqual([
      { ...content[0], layout: { width: "content", align: "center", space: "normal" } },
      {
        id: "b2",
        type: "image",
        value: { url: "/uploads/lake.jpg", alt: "The lake" },
        layout: { width: "wide", align: "center", space: "normal" },
      },
      {
        id: "b3",
        type: "image",
        value: { url: "/uploads/b.jpg" },
        layout: { width: "narrow", align: "left", space: "normal" },
      },
    ]);
  });

  it.each([
    [
      "two blocks with one id",
      [
        { id: "b1", type: "richtext" },
        { id: "b1", type: "image" },
      ],
    ],
    ["a block without an id", [{ type: "richtext", value: { blocks: [] } }]],
    ["a block the field does not offer", [{ id: "b1", type: "video", value: {} }]],
    ["a block with a value it does not accept", [{ id: "b1", type: "image", value: { url: "javascript:alert(1)" } }]],
  ])("refuses %s", async (_name, content) => {
    const cookie = await signIn();
    const response = await call("POST", "/admin/api/items", {
      cookie,
      body: { ...draft, data: { ...draft.data, content } },
    });

    expect(response.status).toBe(422);
  });

  it("deletes an item whose type was removed from the code", async () => {
    const cookie = await signIn();
    const orphan = await brim.items.create("gone", { title: "Old", slug: "old", visibility: "private", data: {} });

    expect((await call("DELETE", "/admin/api/items", { cookie, body: { id: orphan.id } })).status).toBe(200);
    expect(await brim.items.get(orphan.id)).toBeUndefined();
  });

  it("keeps a new item private unless it is published at once", async () => {
    const cookie = await signIn();
    const { visibility: _published, ...unsaid } = draft;
    const response = await call("POST", "/admin/api/items", { cookie, body: unsaid });

    expect(await response.json()).toMatchObject({ item: { visibility: "private" } });
  });

  it("lists the content types with whether they have a page per item, without the component", async () => {
    const cookie = await signIn();
    const { types } = (await (await call("GET", "/admin/api/types", { cookie })).json()) as { types: object[] };

    expect(types).toMatchObject([
      { key: "project", slug: "projects", hasPage: true },
      { key: "note", hasPage: false },
      { key: "post", hasPage: true, article: true },
    ]);
    expect(types[0]).not.toHaveProperty("component");
  });

  it.each([
    ["a missing required field", { location: "" }],
    ["a choice that is not offered", { location: "Cluj", style: "baroque" }],
    ["a number given as text", { location: "Cluj", area: "big" }],
  ])("rejects %s", async (_name, data) => {
    const cookie = await signIn();
    const response = await call("POST", "/admin/api/items", { cookie, body: { ...draft, data } });

    expect(response.status).toBe(422);
  });

  it("refuses an address another item has, when the address was typed", async () => {
    const cookie = await signIn();
    const first = await call("POST", "/admin/api/items", { cookie, body: draft });
    const { slug } = ((await first.json()) as { item: { slug: string } }).item;
    const second = await call("POST", "/admin/api/items", { cookie, body: { ...draft, slug } });

    expect(second.status).toBe(422);
  });

  it("numbers an address made from a title another item has", async () => {
    const cookie = await signIn();
    const first = await call("POST", "/admin/api/items", { cookie, body: draft });
    const second = await call("POST", "/admin/api/items", { cookie, body: draft });
    const slugOf = async (response: Response) => ((await response.json()) as { item: { slug: string } }).item.slug;

    expect(second.status).toBe(201);
    expect(await slugOf(second)).toBe(`${await slugOf(first)}-2`);
  });

  it("updates, lists and deletes an item", async () => {
    const cookie = await signIn();
    const created = await call("POST", "/admin/api/items", { cookie, body: draft });
    const { item } = (await created.json()) as { item: { id: string } };

    await call("PUT", "/admin/api/items", {
      cookie,
      body: { ...draft, id: item.id, title: "Vila", visibility: "private" },
    });
    const listed = (await (await call("GET", "/admin/api/items?type=project", { cookie })).json()) as {
      items: { title: string; visibility: string }[];
    };
    expect(listed.items).toMatchObject([{ title: "Vila", visibility: "private" }]);

    await call("DELETE", "/admin/api/items", { cookie, body: { id: item.id } });
    expect(await brim.items.list("project")).toEqual([]);
  });

  it("needs a session", async () => {
    expect((await call("GET", "/admin/api/items?type=project")).status).toBe(401);
    expect((await call("POST", "/admin/api/items", { body: draft })).status).toBe(401);
  });
});

describe("image upload", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  async function upload(body: Uint8Array, cookie?: string): Promise<Response> {
    const response = await admin(
      new Request(`${ORIGIN}/admin/api/media`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "x-file-name": encodeURIComponent("../../etc/passwd.png"),
          ...(cookie && { cookie }),
        },
        body: new Blob([body.slice()]),
      }),
      visitor,
    );
    if (!response) throw new Error("upload was not handled");
    return response;
  }

  it("stores an image under a generated name and lists it", async () => {
    const cookie = await signIn();
    const response = await upload(png, cookie);
    const { file } = (await response.json()) as { file: { url: string; name: string; mime: string } };

    expect(response.status).toBe(201);
    expect(file.mime).toBe("image/png");
    expect(file.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(existsSync(join(uploads, file.url.replace("/uploads/", "")))).toBe(true);

    const listed = (await (await call("GET", "/admin/api/media", { cookie })).json()) as { files: unknown[] };
    expect(listed.files).toHaveLength(1);
  });

  it("refuses a file that is not an image, whatever its name says", async () => {
    const cookie = await signIn();
    const response = await upload(new TextEncoder().encode("<svg onload=alert(1)>"), cookie);

    expect(response.status).toBe(422);
  });

  it("needs a session", async () => {
    expect((await upload(png)).status).toBe(401);
  });
});

describe("page SEO", () => {
  it("saves what the owner filled in and drops empty fields", async () => {
    const cookie = await signIn();
    const response = await call("PUT", "/admin/api/pages", {
      cookie,
      body: { path: "/about", seo: { title: " About us ", description: "", image: "/share.jpg", noindex: true } },
    });

    expect(await response.json()).toEqual({
      path: "/about",
      visibility: "published",
      seo: { title: "About us", image: "/share.jpg", noindex: true },
    });
  });

  it("rejects an image address that is not a plain link", async () => {
    const cookie = await signIn();
    const response = await call("PUT", "/admin/api/pages", {
      cookie,
      body: { path: "/about", seo: { image: "javascript:alert(1)" } },
    });

    expect(response.status).toBe(422);
  });
});

describe("editor page", () => {
  it("is served for /admin/edit/…, kept out of search engines, and /admin leads to it", async () => {
    for (const path of ["/admin/edit", "/admin/edit/about"]) {
      const response = await call("GET", path);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
    }
    for (const path of ["/admin", "/admin/"]) {
      const response = await call("GET", path);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/admin/edit");
    }
  });
});

describe("pages from templates", () => {
  async function create(cookie: string, body: Record<string, unknown>): Promise<Response> {
    return call("POST", "/admin/api/pages", { cookie, body: { template: "service", ...body } });
  }

  it("lists the templates without their component", async () => {
    const cookie = await signIn();
    const response = await call("GET", "/admin/api/templates", { cookie });

    expect(await response.json()).toEqual({
      templates: [
        { key: "service", label: "Service page", description: "A hero and a contact form.", folder: "services" },
      ],
    });
  });

  it("creates a private page in the template's folder, addressed from its title", async () => {
    const cookie = await signIn();
    const response = await create(cookie, { title: "Lawn Care & Mowing" });

    expect(response.status).toBe(201);
    const page = { path: "/services/lawn-care-mowing", visibility: "private", seo: {}, template: "service" };
    expect(await response.json()).toEqual({ page: { ...page, title: "Lawn Care & Mowing" } });
    expect(changes).toEqual(["/services/lawn-care-mowing"]);

    const { pages } = (await (await call("GET", "/admin/api/pages", { cookie })).json()) as { pages: unknown[] };
    expect(pages).toEqual([
      { path: "/", visibility: "published", seo: {} },
      { path: "/about", visibility: "published", seo: {} },
      { ...page, title: "Lawn Care & Mowing" },
    ]);
  });

  it("takes the address the owner chose", async () => {
    const cookie = await signIn();
    const response = await create(cookie, { title: "Hedges", path: "hedge-trimming/", visibility: "published" });

    expect(await response.json()).toMatchObject({ page: { path: "/hedge-trimming", visibility: "published" } });
  });

  it("refuses addresses that belong to other pages or are not plain", async () => {
    const cookie = await signIn();
    await create(cookie, { title: "Lawn care" });

    for (const path of ["/about", "/services/lawn-care", "/projects/x", "/admin/x", "/Bad Address", "/a//b"]) {
      const response = await create(cookie, { title: "Another", path });
      expect(response.status, path).toBe(422);
    }
  });

  it("refuses an unknown template and a missing title", async () => {
    const cookie = await signIn();

    expect((await call("POST", "/admin/api/pages", { cookie, body: { template: "nope", title: "X" } })).status).toBe(
      404,
    );
    expect((await create(cookie, { title: "  " })).status).toBe(422);
  });

  it("publishes and renames a template page, but renames no page written in code", async () => {
    const cookie = await signIn();
    await create(cookie, { title: "Lawn care" });
    const response = await call("PUT", "/admin/api/pages", {
      cookie,
      body: { path: "/services/lawn-care", visibility: "published", title: "Lawn care plans" },
    });

    expect(await response.json()).toMatchObject({ visibility: "published", title: "Lawn care plans" });
    const coded = await call("PUT", "/admin/api/pages", { cookie, body: { path: "/about", title: "Renamed" } });
    expect(coded.status).toBe(404);
  });

  it("deletes a template page with everything written on it, and never a page written in code", async () => {
    const cookie = await signIn();
    await create(cookie, { title: "Lawn care" });
    await brim.content.saveNode("page:/services/lawn-care", "page-title", "text", { text: "Lawns" });

    expect((await call("DELETE", "/admin/api/pages", { cookie, body: { path: "/services/lawn-care" } })).status).toBe(
      200,
    );
    expect(await brim.content.templatePages()).toEqual([]);
    expect(await brim.content.loadNodes(["page:/services/lawn-care"])).toEqual([]);
    expect((await call("DELETE", "/admin/api/pages", { cookie, body: { path: "/about" } })).status).toBe(404);
  });

  it("needs a session", async () => {
    expect((await call("POST", "/admin/api/pages", { body: { template: "service", title: "X" } })).status).toBe(401);
  });
});

describe("item fields edited on the item's page", () => {
  const path = "/projects/lake-house";

  async function setup(): Promise<{ cookie: string; id: string }> {
    const cookie = await signIn();
    const created = await call("POST", "/admin/api/items", {
      cookie,
      body: {
        type: "project",
        title: "Lake House",
        slug: "lake-house",
        visibility: "published",
        data: { location: "Cluj" },
      },
    });
    const { item } = (await created.json()) as { item: { id: string } };
    return { cookie, id: item.id };
  }

  function save(cookie: string, body: Record<string, unknown>): Promise<Response> {
    return call("PUT", "/admin/api/nodes", { cookie, body: { path, scope: "page", ...body } });
  }

  it("saves typed text into the field and nothing else", async () => {
    const { cookie, id } = await setup();
    const response = await save(cookie, {
      nodeId: "project-location",
      kind: "text",
      item: id,
      field: "location",
      value: { text: "Cluj, by the lake", as: "h2", rich: ["Cluj,", { tag: "br", children: [] }, "by the lake"] },
    });

    expect(response.status).toBe(200);
    expect((await brim.items.get(id))?.data.location).toBe("Cluj,\nby the lake");
    expect(await brim.content.loadNodes([`page:${path}`, "type:project"])).toEqual([]);
  });

  it("renames the item from its title", async () => {
    const { cookie, id } = await setup();
    await save(cookie, {
      nodeId: "project-title",
      kind: "text",
      item: id,
      field: "title",
      value: { text: "Lake Villa" },
    });

    expect(await brim.items.get(id)).toMatchObject({ title: "Lake Villa", slug: "lake-house" });
  });

  it("saves an image block's address and description into the image field, and nothing else", async () => {
    const { cookie, id } = await setup();
    await save(cookie, {
      nodeId: "project-cover",
      kind: "image",
      item: id,
      field: "cover",
      value: { url: "/uploads/lake.jpg", alt: "The lake", shape: "circle" },
    });

    expect((await brim.items.get(id))?.data.cover).toEqual({ src: "/uploads/lake.jpg", alt: "The lake" });
    expect(await brim.content.loadNodes([`page:${path}`, "type:project"])).toEqual([]);
  });

  it("checks the field like the item form does", async () => {
    const { cookie, id } = await setup();
    const emptied = await save(cookie, {
      nodeId: "project-location",
      kind: "text",
      item: id,
      field: "location",
      value: { text: "" },
    });
    const unknown = await save(cookie, { nodeId: "x", kind: "text", item: id, field: "nope", value: { text: "Hi" } });
    const mismatched = await save(cookie, {
      nodeId: "x",
      kind: "image",
      item: id,
      field: "location",
      value: { url: "/a.jpg" },
    });

    expect(emptied.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(mismatched.status).toBe(422);
    expect((await brim.items.get(id))?.data.location).toBe("Cluj");
  });

  it("keeps what the template shows once for the type and language, whichever item's page it is changed on", async () => {
    const { cookie } = await setup();
    const back = { scope: "template", nodeId: "project-back", kind: "text" };
    const saved = await save(cookie, { ...back, path: "/projects/any-project", value: { text: "All projects" } });
    await save(cookie, { ...back, path: "/ro/projects/orice-proiect", value: { text: "Toate proiectele" } });

    expect(saved.status).toBe(200);
    expect(await brim.content.loadNodes(["type:project:en"])).toEqual([
      { scope: "type:project:en", nodeId: "project-back", kind: "text", value: { text: "All projects" } },
    ]);
    expect(await brim.content.loadNodes(["type:project:ro"])).toMatchObject([{ value: { text: "Toate proiectele" } }]);

    const reset = { path, scope: "template", nodeId: "project-back" };
    expect((await call("DELETE", "/admin/api/nodes", { cookie, body: reset })).status).toBe(200);
    expect(await brim.content.loadNodes(["type:project:en"])).toEqual([]);
  });

  it("starts a translation's template from the original language's, where it has nothing yet", async () => {
    const { cookie, id } = await setup();
    await brim.content.saveNode("type:project:en", "project-back", "text", { text: "All projects" });
    await brim.content.saveNode("type:project:en", "project-note", "text", { text: "More soon" });
    await brim.content.saveNode("type:project:ro", "project-note", "text", { text: "În curând" });

    expect((await call("POST", "/admin/api/items/translate", { cookie, body: { id, locale: "ro" } })).status).toBe(201);
    const romanian = await brim.content.loadNodes(["type:project:ro"]);
    expect(romanian.map((node) => [node.nodeId, (node.value as { text: string }).text]).sort()).toEqual([
      ["project-back", "All projects"],
      ["project-note", "În curând"],
    ]);
  });

  it("refuses the template scope on a page that is not an item's", async () => {
    const { cookie } = await setup();
    const response = await save(cookie, {
      path: "/about",
      scope: "template",
      nodeId: "about-title",
      kind: "text",
      value: { text: "Hi" },
    });

    expect(response.status).toBe(400);
  });
});

describe("languages", () => {
  const draft = { type: "project", title: "Lake House", visibility: "published", data: { location: "Cluj" } };

  it("tells the editor the site's languages", async () => {
    const info = (await (await call("GET", "/admin/api/info")).json()) as { locales: unknown };
    expect(info.locales).toEqual({ defaultLocale: "en", locales: ["en", "ro"], prefixDefaultLocale: undefined });
  });

  it("maps a page between languages and stores an item's language", () => {
    const config = { defaultLocale: "en", locales: ["en", "ro"] };
    expect(pathInLocale("/about", "ro", config)).toBe("/ro/about");
    expect(pathInLocale("/ro/about", "en", config)).toBe("/about");
    expect(pathInLocale("/", "ro", config)).toBe("/ro");
    expect(pathInLocale("/about", "en", { ...config, prefixDefaultLocale: true })).toBe("/en/about");
    expect(storedLocale("en", config)).toBe("");
    expect(storedLocale("ro", config)).toBe("ro");
    expect(storedLocale("de", config)).toBeUndefined();
    expect(itemPagePath({ slug: "projects" }, { slug: "lake", locale: "ro" }, config)).toBe("/ro/projects/lake");
    expect(itemPagePath({ slug: "projects" }, { slug: "lake", locale: "" }, config)).toBe("/projects/lake");
  });

  it("keeps items per language, translates them, and keeps translations linked", async () => {
    const cookie = await signIn();
    const english = ((await (await call("POST", "/admin/api/items", { cookie, body: draft })).json()) as { item: Item })
      .item;
    expect([english.locale, english.translationOf]).toEqual(["", null]);

    const answer = await call("POST", "/admin/api/items/translate", { cookie, body: { id: english.id, locale: "ro" } });
    expect(answer.status).toBe(201);
    const romanian = ((await answer.json()) as { item: Item }).item;
    expect(romanian).toMatchObject({
      locale: "ro",
      translationOf: english.id,
      slug: english.slug,
      visibility: "private",
    });
    expect(romanian.data).toEqual(english.data);

    // The same address once per language; a second translation into the same language is refused.
    expect(
      (await call("POST", "/admin/api/items/translate", { cookie, body: { id: english.id, locale: "ro" } })).status,
    ).toBe(422);
    expect(
      (await call("POST", "/admin/api/items/translate", { cookie, body: { id: english.id, locale: "de" } })).status,
    ).toBe(422);
    expect(
      (await call("POST", "/admin/api/items", { cookie, body: { ...draft, slug: "lake-house", locale: "ro" } })).status,
    ).toBe(422);

    const listed = async (query: string) =>
      (
        (await (await call("GET", `/admin/api/items?type=project${query}`, { cookie })).json()) as { items: Item[] }
      ).items.map((item) => item.locale);
    expect((await listed("")).sort()).toEqual(["", "ro"]);
    expect(await listed("&locale=ro")).toEqual(["ro"]);
    expect(await listed("&locale=en")).toEqual([""]);

    // Removing the original hands the group to its translation.
    await call("DELETE", "/admin/api/items", { cookie, body: { id: english.id } });
    expect((await brim.items.get(romanian.id))?.translationOf).toBeNull();
  });

  it("translates a page: fills what the other language does not have yet, adds pages made from templates", async () => {
    codePages.push("/ro/about");
    const cookie = await signIn();
    const save = (path: string, text: string) =>
      call("PUT", "/admin/api/nodes", {
        cookie,
        body: { path, scope: "page", nodeId: "hero-title", kind: "text", value: { text } },
      });
    await save("/about", "About us");
    await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/about", scope: "page", nodeId: "hero-lead", kind: "text", value: { text: "We build." } },
    });
    await save("/ro/about", "Despre noi");

    const translate = (path: string, locale: string) =>
      call("POST", "/admin/api/pages/translate", { cookie, body: { path, locale } });
    const done = (await (await translate("/about", "ro")).json()) as { path: string; created: boolean; copied: number };
    expect(done).toEqual({ path: "/ro/about", created: false, copied: 1 });
    const romanian = await brim.content.loadNodes(["page:/ro/about"]);
    expect(Object.fromEntries(romanian.map((node) => [node.nodeId, (node.value as { text: string }).text]))).toEqual({
      "hero-title": "Despre noi",
      "hero-lead": "We build.",
    });

    // A page written in code must exist in that language in the code.
    expect((await translate("/", "ro")).status).toBe(422);

    // A page added from a template is added in the other language, private, with this page's content.
    const page = (await (
      await call("POST", "/admin/api/pages", { cookie, body: { template: "service", title: "Lawn care" } })
    ).json()) as {
      page: { path: string };
    };
    await save(page.page.path, "Lawn care");
    const made = (await (await translate(page.page.path, "ro")).json()) as { path: string; created: boolean };
    expect(made).toMatchObject({ path: `/ro${page.page.path}`, created: true });
    expect((await brim.content.page(made.path)).visibility).toBe("private");
    expect((await brim.content.loadNodes([`page:${made.path}`])).length).toBe(1);
  });
});

describe("identity", () => {
  it("is checked from the config: favicon named or found in public/, title template, theme color", () => {
    const none = () => false;
    expect(resolveFavicon("/icon.svg", "/site/public", none)).toBe("/icon.svg");
    expect(resolveFavicon(undefined, "/site/public", (path) => path === "/site/public/favicon.ico")).toBe(
      "/favicon.ico",
    );
    expect(resolveFavicon(undefined, "/site/public", none)).toBeUndefined();
    expect(() => resolveFavicon("icon.svg", "/site/public", none)).toThrow(/must start with/);
    expect(faviconType("/favicon.svg?v=2")).toBe("image/svg+xml");
    expect(() => resolveIdentity({ titleTemplate: "Acme" }, "/p", none)).toThrow(/needs %s/);
    expect(() => resolveIdentity({ themeColor: "orange" }, "/p", none)).toThrow(/#rgb/);
    const identity = resolveIdentity({ name: "Acme", titleTemplate: "%s — Acme" }, "/p", none);
    expect(identity).not.toHaveProperty("alternateName");
    expect(pageTitleOf("About", identity)).toBe("About — Acme");
    expect(pageTitleOf("Acme", identity)).toBe("Acme");
    expect(pageTitleOf(undefined, identity)).toBe("Acme");
  });

  it("keeps the other spellings of the name once each, and only the profiles that are web addresses", () => {
    const names = (alternateName: unknown) =>
      resolveIdentity({ name: "Acme", alternateName: alternateName as string }, "/p", () => false).alternateName;
    expect(names(" AcmeStudio ")).toEqual(["AcmeStudio"]);
    expect(names(["AcmeStudio", "Acme", "", "acme.com", "AcmeStudio"])).toEqual(["AcmeStudio", "acme.com"]);
    expect(names([])).toBeUndefined();
    expect(() => names(["Acme", 3])).toThrow(/identity\.alternateName/);

    expect(
      profileAddresses([
        "https://a.test/x",
        " https://a.test/x ",
        "",
        null,
        undefined,
        "javascript:alert(1)",
        "/about",
      ]),
    ).toEqual(["https://a.test/x"]);
    expect(profileAddresses(undefined)).toEqual([]);
  });

  it("shows the site's name and favicon in the editor's tab", async () => {
    const editor = createAdminHandler({
      brim,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      identity: { name: "Acme & Co", favicon: "/favicon.svg" },
    });
    const page = await (await editor(new Request(`${ORIGIN}/admin/edit`), visitor))?.text();
    expect(page).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(page).toContain("<title>Edit · Acme &#38; Co</title>");
    const plain = await (await call("GET", "/admin/edit")).text();
    expect(plain).not.toContain('rel="icon"');
    expect(plain).toContain("<title>Edit site</title>");
  });
});

describe("items whose pages are written in the site's code", () => {
  async function create(cookie: string): Promise<Item> {
    const body = { type: "note", title: "Garden", slug: "garden", visibility: "published", data: {} };
    return ((await (await call("POST", "/admin/api/items", { cookie, body })).json()) as { item: Item }).item;
  }

  it("move what is saved on an item's page with its address, and drop it with the item", async () => {
    const cookie = await signIn();
    const item = await create(cookie);
    await brim.content.saveNode("page:/notes/garden", "note-intro", "text", { text: "Hello" });

    await call("PUT", "/admin/api/items", { cookie, body: { ...item, slug: "yard" } });
    expect(await brim.content.loadNodes(["page:/notes/garden"])).toEqual([]);
    expect(await brim.content.loadNodes(["page:/notes/yard"])).toHaveLength(1);

    await call("DELETE", "/admin/api/items", { cookie, body: { id: item.id } });
    expect(await brim.content.loadNodes(["page:/notes/yard"])).toEqual([]);
  });

  it("start a translation's page from the original's", async () => {
    const cookie = await signIn();
    const item = await create(cookie);
    await brim.content.saveNode("page:/notes/garden", "note-intro", "text", { text: "Hello" });

    await call("POST", "/admin/api/items/translate", { cookie, body: { id: item.id, locale: "ro" } });
    expect(await brim.content.loadNodes(["page:/ro/notes/garden"])).toMatchObject([{ value: { text: "Hello" } }]);
  });
});

describe("page settings for search, sharing and access", () => {
  const EDITOR = "editor@example.test";

  async function signInAsEditor(): Promise<string> {
    await brim.accounts.createUser(EDITOR, PASSWORD, "editor");
    const response = await call("POST", "/admin/api/session", { body: { email: EDITOR, password: PASSWORD } }); // betterleaks:allow
    return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }

  async function addPage(cookie: string, path: string): Promise<void> {
    const body = { template: "service", title: "Lawn care", path, visibility: "published" };
    expect((await call("POST", "/admin/api/pages", { cookie, body })).status).toBe(201);
  }

  it("saves share texts, a canonical address and nofollow", async () => {
    const cookie = await signIn();
    const seo = {
      shareTitle: " Shared ",
      shareDescription: "On chats",
      canonical: "/pricing",
      nofollow: true,
    };
    const response = await call("PUT", "/admin/api/pages", { cookie, body: { path: "/about", seo } });

    expect(((await response.json()) as { seo: unknown }).seo).toEqual({ ...seo, shareTitle: "Shared" });
  });

  it("refuses a canonical address that is not a page or a web address", async () => {
    const cookie = await signIn();
    const body = { path: "/about", seo: { canonical: "javascript:alert(1)" } };

    expect((await call("PUT", "/admin/api/pages", { cookie, body })).status).toBe(422);
  });

  it("moves a page added from a template, with its content, and redirects the old address", async () => {
    const cookie = await signIn();
    await addPage(cookie, "/services/lawn");
    await brim.content.saveNode("page:/services/lawn", "service-lead", "text", { text: "Every week" });
    await brim.content.setRedirects([{ from: "/lawn", to: "/services/lawn" }]);

    const response = await call("POST", "/admin/api/pages/move", {
      cookie,
      body: { path: "/services/lawn", to: "/services/lawn-care" },
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { page: { path: string } }).page.path).toBe("/services/lawn-care");
    expect(await brim.content.loadNodes(["page:/services/lawn-care"])).toMatchObject([
      { value: { text: "Every week" } },
    ]);
    expect(await brim.content.loadNodes(["page:/services/lawn"])).toEqual([]);
    expect(await brim.content.redirects()).toEqual([
      { from: "/lawn", to: "/services/lawn-care" },
      { from: "/services/lawn", to: "/services/lawn-care" },
    ]);
  });

  it("refuses to move a page written in code, or onto an address in use", async () => {
    const cookie = await signIn();
    await addPage(cookie, "/services/lawn");

    const coded = await call("POST", "/admin/api/pages/move", { cookie, body: { path: "/about", to: "/team" } });
    const taken = await call("POST", "/admin/api/pages/move", {
      cookie,
      body: { path: "/services/lawn", to: "/about" },
    });

    expect(coded.status).toBe(404);
    expect(taken.status).toBe(422);
  });

  it("keeps the site's redirects, checked, for owners to change", async () => {
    const owner = await signIn();
    const redirects = [
      { from: "/old/", to: "/new" },
      { from: "/promo", to: "https://shop.example.test/sale", temporary: true },
    ];
    const saved = await call("PUT", "/admin/api/redirects", { cookie: owner, body: { redirects } });

    expect(await saved.json()).toEqual({ redirects: [{ from: "/old", to: "/new" }, redirects[1]] });
    expect(await (await call("GET", "/admin/api/redirects", { cookie: owner })).json()).toEqual(
      await brim.content.redirects().then((list) => ({ redirects: list })),
    );

    const loop = [
      { from: "/a", to: "/b" },
      { from: "/b", to: "/a" },
    ];
    expect((await call("PUT", "/admin/api/redirects", { cookie: owner, body: { redirects: loop } })).status).toBe(422);

    const editor = await signInAsEditor();
    expect((await call("PUT", "/admin/api/redirects", { cookie: editor, body: { redirects: [] } })).status).toBe(403);
  });
});

describe("roles", () => {
  const EDITOR = "editor@example.test";
  const signInAsEditor = async (permissions = ["content", "publish", "pages", "responses"]): Promise<string> => {
    const response = await call("POST", "/admin/api/session", { body: { email: EDITOR, password: PASSWORD } }); // betterleaks:allow
    expect(((await response.json()) as { permissions: string[] }).permissions).toEqual(permissions);
    return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  };
  const text = (value: string) => ({ text: value });
  const status = async (method: string, path: string, cookie: string, body?: unknown): Promise<number> =>
    (await call(method, path, { cookie, ...(body !== undefined && { body }) })).status;

  it("tell the editor what the signed-in user may do", async () => {
    const response = await call("GET", "/admin/api/session", { cookie: await signIn() });
    expect(await response.json()).toMatchObject({
      user: { role: "owner" },
      permissions: ["content", "publish", "pages", "templates", "responses", "settings", "users"],
    });
  });

  it("are owner and editor: no other is given to anyone", async () => {
    const owner = await signIn();
    const body = { email: EDITOR, role: "writer" };
    const added = await call("POST", "/admin/api/users", { cookie: owner, body });
    expect(added.status).toBe(422);
    expect(await added.json()).toEqual({ error: 'The role is "owner" or "editor".' });
    await brim.accounts.createUser(EDITOR, PASSWORD, "editor");
    expect(await status("PUT", "/admin/api/users", owner, body)).toBe(422);
    await expect(brim.accounts.setRole(EDITOR, "writer" as never)).rejects.toThrow('The role is "owner" or "editor".');
  });

  it("an account whose role is none of them changes nothing and reads no message, until an owner gives it one", async () => {
    const owner = await signIn();
    const made = await call("POST", "/admin/api/items", {
      cookie: owner,
      body: { type: "project", title: "Lake house", visibility: "published", data: { location: "Cluj" } },
    });
    const { item } = (await made.json()) as { item: Item };
    await call("POST", "/admin/api/pages", { cookie: owner, body: { template: "service", title: "Lawn care" } });
    await call("PUT", "/admin/api/nodes", {
      cookie: owner,
      body: { path: "/", scope: "page", nodeId: "hero-title", kind: "text", value: text("Hi") },
    });
    const [change] = await brim.history.list();

    // As an account kept from when there was a third role, "writer".
    await brim.accounts.createUser(EDITOR, PASSWORD, "editor");
    await brim.db.query("UPDATE brim_users SET role = 'writer' WHERE email = ?", [EDITOR]);
    const leftover = await signInAsEditor([]);
    const node = { path: "/", scope: "page", nodeId: "hero-title", kind: "text", value: text("Hello") };
    const whole = { id: item.id, title: "Lake", slug: item.slug, visibility: "published", data: item.data };
    for (const [method, path, body] of [
      ["PUT", "/nodes", node],
      ["PUT", "/nodes", { ...node, draft: true }],
      ["DELETE", "/nodes", node],
      ["POST", "/drafts/save", {}],
      ["DELETE", "/drafts", {}],
      ["POST", "/items", { type: "project", title: "Draft", data: { location: "Iasi" } }],
      ["PUT", "/items", whole],
      ["PUT", "/items/visibility", { id: item.id, visibility: "private" }],
      ["DELETE", "/items", { id: item.id }],
      ["POST", "/pages", { template: "service", title: "Pruning" }],
      ["PUT", "/pages", { path: "/about", seo: { title: "About us" } }],
      ["POST", "/pages/move", { path: "/services/lawn-care", to: "/services/lawns" }],
      ["DELETE", "/pages", { path: "/services/lawn-care" }],
      ["POST", "/history/restore", { id: change!.id }],
      ["PUT", "/redirects", { redirects: [] }],
      ["GET", "/responses", undefined],
      ["GET", "/emails/form", undefined],
      ["GET", "/users", undefined],
    ] as const) {
      expect(await status(method, `/admin/api${path}`, leftover, body), `${method} ${path}`).toBe(403);
    }

    expect(await status("PUT", "/admin/api/users", owner, { email: EDITOR, role: "editor" })).toBe(200);
    expect(await status("PUT", "/admin/api/nodes", leftover, node)).toBe(200);
  });

  it("an editor runs the content, but not the templates or the settings", async () => {
    await brim.accounts.createUser(EDITOR, PASSWORD, "editor");
    const editor = await signInAsEditor();
    const made = await call("POST", "/admin/api/items", {
      cookie: editor,
      body: { type: "project", title: "Lake house", visibility: "published", data: { location: "Cluj" } },
    });
    expect(made.status).toBe(201);
    const { item } = (await made.json()) as { item: Item };
    expect(await status("POST", "/admin/api/pages", editor, { template: "service", title: "Pruning" })).toBe(201);
    expect(
      await status("PUT", "/admin/api/pages", editor, { path: "/services/pruning", visibility: "published" }),
    ).toBe(200);
    expect(await status("GET", "/admin/api/responses", editor)).toBe(200);
    expect(await status("DELETE", "/admin/api/pages", editor, { path: "/services/pruning" })).toBe(200);
    expect(await status("DELETE", "/admin/api/items", editor, { id: item.id })).toBe(200);

    const refused = await call("PUT", "/admin/api/nodes", {
      cookie: editor,
      body: { path: "/projects/x", scope: "template", nodeId: "project-back", kind: "text", value: text("Back") },
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Only the site's owners can change a content type's template." });
    expect(await status("PUT", "/admin/api/redirects", editor, { redirects: [] })).toBe(403);
    expect(await status("GET", "/admin/api/mail", editor)).toBe(403);
  });
});

describe("history", () => {
  const text = (value: string) => ({ text: value });
  type Entry = { id: string; target: string; action: string; page: string; title: string; user: string };
  const history = async (cookie: string, query = ""): Promise<Entry[]> =>
    ((await (await call("GET", `/admin/api/history${query}`, { cookie })).json()) as { history: Entry[] }).history;
  const save = (cookie: string, value: string, nodeId = "hero-title") =>
    call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/", scope: "page", nodeId, kind: "text", value: text(value) },
    });
  const saved = async (nodeId = "hero-title") =>
    (await brim.content.loadNodes(["page:/"])).find((node) => node.nodeId === nodeId)?.value;

  it("remembers what an element was, counts quick saves as one change, and takes the change back", async () => {
    const cookie = await signIn();
    await save(cookie, "One");
    await save(cookie, "Two");
    await save(cookie, "Three");
    const entries = await history(cookie, "?path=/");
    // Typing saves many times: one change, back to what the page showed before the first of them.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      target: "node",
      action: "changed",
      page: "/",
      title: "hero-title",
      user: EMAIL,
    });

    const restored = await call("POST", "/admin/api/history/restore", { cookie, body: { id: entries[0]!.id } });
    expect(restored.status).toBe(200);
    // Nothing was saved before the first change: the page shows the code's text again.
    expect(await saved()).toBeUndefined();

    // Taking a change back is a change too, so it can be taken back in turn.
    const after = await history(cookie);
    expect(after).toHaveLength(2);
    const undo = after.find((entry) => entry.id !== entries[0]!.id)!;
    await call("POST", "/admin/api/history/restore", { cookie, body: { id: undo.id } });
    expect(await saved()).toEqual(text("Three"));
  });

  it("brings back an element that was reset", async () => {
    const cookie = await signIn();
    await save(cookie, "Kept");
    await call("DELETE", "/admin/api/nodes", { cookie, body: { path: "/", scope: "page", nodeId: "hero-title" } });
    const reset = (await history(cookie)).find((entry) => entry.action === "reset")!;
    await call("POST", "/admin/api/history/restore", { cookie, body: { id: reset.id } });
    expect(await saved()).toEqual(text("Kept"));
  });

  it("brings back a deleted item and a changed one", async () => {
    const cookie = await signIn();
    const made = await call("POST", "/admin/api/items", {
      cookie,
      body: { type: "project", title: "Lake house", visibility: "published", data: { location: "Cluj" } },
    });
    const { item } = (await made.json()) as { item: Item };
    await call("PUT", "/admin/api/items", {
      cookie,
      body: { id: item.id, title: "Sea house", slug: item.slug, visibility: "published", data: { location: "Vama" } },
    });
    const changed = (await history(cookie)).find((entry) => entry.target === "item")!;
    expect(changed).toMatchObject({ action: "changed", title: "Lake house" });
    await call("POST", "/admin/api/history/restore", { cookie, body: { id: changed.id } });
    expect(await brim.items.get(item.id)).toMatchObject({ title: "Lake house", data: { location: "Cluj" } });

    await call("DELETE", "/admin/api/items", { cookie, body: { id: item.id } });
    expect(await brim.items.get(item.id)).toBeUndefined();
    const deleted = (await history(cookie)).find((entry) => entry.action === "deleted")!;
    const back = await call("POST", "/admin/api/history/restore", { cookie, body: { id: deleted.id } });
    expect(back.status).toBe(200);
    expect(await brim.items.get(item.id)).toMatchObject({ id: item.id, title: "Lake house", visibility: "published" });
    // A deletion is taken back once.
    expect((await history(cookie)).some((entry) => entry.id === deleted.id)).toBe(false);
  });

  it("brings back a deleted page with what was written on it, as a private page", async () => {
    const cookie = await signIn();
    await call("POST", "/admin/api/pages", {
      cookie,
      body: { template: "service", title: "Lawn care", visibility: "published" },
    });
    await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { path: "/services/lawn-care", scope: "page", nodeId: "intro", kind: "text", value: text("We mow.") },
    });
    await call("DELETE", "/admin/api/pages", { cookie, body: { path: "/services/lawn-care" } });
    expect(await brim.content.loadNodes(["page:/services/lawn-care"])).toEqual([]);

    const deleted = (await history(cookie)).find((entry) => entry.target === "page")!;
    expect(deleted).toMatchObject({ action: "deleted", title: "Lawn care", page: "/services/lawn-care" });
    const back = await call("POST", "/admin/api/history/restore", { cookie, body: { id: deleted.id } });
    expect(back.status).toBe(200);
    expect(await brim.content.page("/services/lawn-care")).toMatchObject({
      template: "service",
      title: "Lawn care",
      visibility: "private",
    });
    expect((await brim.content.loadNodes(["page:/services/lawn-care"]))[0]).toMatchObject({
      nodeId: "intro",
      value: text("We mow."),
    });
  });

  it("asks of whoever takes a change back the role the change itself needs", async () => {
    const cookie = await signIn();
    const made = await call("POST", "/admin/api/items", {
      cookie,
      body: { type: "project", title: "Lake house", visibility: "published", data: { location: "Cluj" } },
    });
    const { item } = (await made.json()) as { item: Item };
    const back = { scope: "template", nodeId: "project-back", kind: "text" };
    await call("PUT", "/admin/api/nodes", {
      cookie,
      body: { ...back, path: `/projects/${item.slug}`, value: text("Back") },
    });
    const template = (await history(cookie)).find((entry) => entry.title === "project-back")!;
    await call("DELETE", "/admin/api/items", { cookie, body: { id: item.id } });
    const deleted = (await history(cookie)).find((entry) => entry.action === "deleted")!;

    await brim.accounts.createUser("editor@example.test", PASSWORD, "editor");
    const response = await call("POST", "/admin/api/session", { body: { email: "editor@example.test", password: PASSWORD } }); // betterleaks:allow
    const editor = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const restore = async (id: string) =>
      (await call("POST", "/admin/api/history/restore", { cookie: editor, body: { id } })).status;
    // A template is the owners' to change, and so to change back; an item is an editor's to delete and to put back.
    expect(await restore(template.id)).toBe(403);
    expect(await restore(deleted.id)).toBe(200);
    expect(await restore("nope")).toBe(404);
    expect((await call("GET", "/admin/api/history")).status).toBe(401);
  });
});

describe("drafts", () => {
  it("holds an element back from visitors until it is saved, and remembers it in the history then", async () => {
    const cookie = await signIn();
    const drafted = await json<{ change: { before: unknown; after: unknown }; drafts: number }>(
      await call("PUT", "/admin/api/nodes", {
        cookie,
        body: { path: "/about", scope: "page", nodeId: "title", kind: "text", value: { text: "Draft" }, draft: true },
      }),
    );

    expect(drafted.drafts).toBe(1);
    expect(drafted.change.before).toBeNull();
    expect(drafted.change.after).toEqual({ kind: "text", value: { text: "Draft" } });
    expect(await brim.content.loadNodes(["page:/about"])).toEqual([]);
    expect(changes).toEqual([]);
    expect(await brim.drafts.overlayNodes([], ["page:/about"])).toEqual([
      { scope: "page:/about", nodeId: "title", kind: "text", value: { text: "Draft" } },
    ]);

    const saved = await json<{ saved: number; failed: unknown[]; drafts: number }>(
      await call("POST", "/admin/api/drafts/save", { cookie }),
    );
    expect(saved).toEqual({ saved: 1, failed: [], drafts: 0 });
    expect(await brim.content.loadNodes(["page:/about"])).toEqual([
      { scope: "page:/about", nodeId: "title", kind: "text", value: { text: "Draft" } },
    ]);
    expect(changes).toEqual([undefined]);
    expect(await brim.history.list()).toHaveLength(1);
  });

  it("undoes and redoes a change by putting its draft back, and discards everything", async () => {
    const cookie = await signIn();
    const body = { path: "/", scope: "page", nodeId: "hero", kind: "text", draft: true };
    await call("PUT", "/admin/api/nodes", { cookie, body: { ...body, value: { text: "One" } } });
    const second = await json<{ change: { key: string; before: unknown; after: unknown } }>(
      await call("PUT", "/admin/api/nodes", { cookie, body: { ...body, value: { text: "Two" } } }),
    );
    expect(second.change.before).toEqual({ kind: "text", value: { text: "One" } });

    // Undo writes the draft as it was before; redo as it was after.
    await json(
      await call("PUT", "/admin/api/drafts", {
        cookie,
        body: { target: "node", key: second.change.key, path: "/", value: second.change.before },
      }),
    );
    expect(await brim.drafts.get("node", second.change.key)).toEqual({ kind: "text", value: { text: "One" } });
    await json(
      await call("PUT", "/admin/api/drafts", {
        cookie,
        body: { target: "node", key: second.change.key, path: "/", value: null },
      }),
    );
    expect(await brim.drafts.count()).toBe(0);

    // What is sent back is checked like a new change.
    const forged = await call("PUT", "/admin/api/drafts", {
      cookie,
      body: { target: "node", key: second.change.key, path: "/", value: { kind: "link", value: { href: "javascript:x" } } },
    });
    expect(forged.status).toBe(422);

    await call("PUT", "/admin/api/nodes", { cookie, body: { ...body, value: { text: "Three" } } });
    await call("DELETE", "/admin/api/nodes", { cookie, body: { path: "/", scope: "page", nodeId: "gone", draft: true } });
    expect((await json<{ drafts: number }>(await call("GET", "/admin/api/drafts", { cookie }))).drafts).toBe(2);
    await json(await call("DELETE", "/admin/api/drafts", { cookie }));
    expect(await brim.drafts.count()).toBe(0);
    expect(await brim.content.loadNodes(["page:/"])).toEqual([]);
  });

  it("drafts an item's content but changes who can see it at once", async () => {
    const cookie = await signIn();
    const { item } = (await (
      await call("POST", "/admin/api/items", {
        cookie,
        body: { type: "project", title: "Lake House", slug: "lake-house", visibility: "private", data: { location: "Cluj" } },
      })
    ).json()) as { item: Item };
    const path = "/projects/lake-house";

    const drafted = await json<{ item: Item; drafts: number }>(
      await call("PUT", "/admin/api/nodes", {
        cookie,
        body: { path, scope: "page", nodeId: "project-location", kind: "text", item: item.id, field: "location", value: { text: "Iași" }, draft: true },
      }),
    );
    expect(drafted.item.data.location).toBe("Iași");
    expect((await brim.items.get(item.id))?.data.location).toBe("Cluj");

    await json(await call("PUT", "/admin/api/items/visibility", { cookie, body: { id: item.id, visibility: "published" } }));
    expect((await brim.items.get(item.id))?.visibility).toBe("published");
    expect((await brim.items.get(item.id))?.data.location).toBe("Cluj");

    const listed = await json<{ items: Item[] }>(await call("GET", "/admin/api/items?type=project&draft", { cookie }));
    expect(listed.items[0]?.data.location).toBe("Iași");

    await json(await call("POST", "/admin/api/drafts/save", { cookie }));
    const saved = await brim.items.get(item.id);
    expect(saved?.data.location).toBe("Iași");
    expect(saved?.visibility).toBe("published");
  });

  it("drafts a page's SEO settings", async () => {
    const cookie = await signIn();
    await json(await call("PUT", "/admin/api/pages", { cookie, body: { path: "/about", seo: { title: "Draft" }, draft: true } }));
    expect((await brim.content.page("/about")).seo).toEqual({});
    const { pages } = await json<{ pages: { path: string; seo: unknown }[] }>(
      await call("GET", "/admin/api/pages?draft", { cookie }),
    );
    expect(pages.find((page) => page.path === "/about")?.seo).toEqual({ title: "Draft" });
    await json(await call("POST", "/admin/api/drafts/save", { cookie }));
    expect((await brim.content.page("/about")).seo).toEqual({ title: "Draft" });
  });
});

describe("an article's published date", () => {
  const today = new Date().toISOString().slice(0, 10);
  const create = async (cookie: string, body: object = {}) =>
    (
      await json<{ item: Item }>(
        await call("POST", "/admin/api/items", { cookie, body: { type: "post", title: "Spring", data: {}, ...body } }),
      )
    ).item;
  const show = (cookie: string, id: string, visibility: string) =>
    call("PUT", "/admin/api/items/visibility", { cookie, body: { id, visibility } });

  it("is the day it is first published, kept when it is hidden and shown again", async () => {
    const cookie = await signIn();
    const item = await create(cookie);
    expect(item.data.published).toBeUndefined();
    await json(await show(cookie, item.id, "published"));
    expect((await brim.items.get(item.id))?.data.published).toBe(today);
    expect((await create(cookie, { title: "Summer", visibility: "published" })).data.published).toBe(today);

    const dated = await create(cookie, { title: "Winter", data: { published: "2025-01-05" } });
    for (const visibility of ["published", "private", "published"]) await json(await show(cookie, dated.id, visibility));
    expect((await brim.items.get(dated.id))?.data.published).toBe("2025-01-05");
  });

  it("is not lost to a draft saved after, and can be emptied by hand", async () => {
    const cookie = await signIn();
    const item = await create(cookie);
    const content = { id: item.id, title: "Spring again", slug: item.slug, data: { description: "New" } };
    await json(await call("PUT", "/admin/api/items", { cookie, body: { ...content, path: "/blog/spring", draft: true } }));
    await json(await show(cookie, item.id, "published"));
    await json(await call("POST", "/admin/api/drafts/save", { cookie }));
    expect((await brim.items.get(item.id))?.data).toEqual({ description: "New", published: today });

    await json(await call("PUT", "/admin/api/items", { cookie, body: { ...content, visibility: "published" } }));
    expect((await brim.items.get(item.id))?.data).toEqual({ description: "New" });
  });

  it("is only an article's", async () => {
    const cookie = await signIn();
    const item = await create(cookie, { type: "project", visibility: "published", data: { location: "Cluj" } });
    expect(item.data).toEqual({ location: "Cluj" });
  });
});
