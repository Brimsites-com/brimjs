import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { browseItems } from "../src/blocks/listing/query.ts";
import { checkSite } from "../src/check.ts";
import { defineContentType } from "../src/content/content-types.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { HistoryStore } from "../src/content/history.ts";
import { type Item, ItemStore } from "../src/content/items.ts";
import { definePageTemplate } from "../src/content/page-templates.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { QueryCollector, collectingQueryReads, noteQueryReads, readsQuery } from "../src/runtime/query-reads.ts";
import { type AdminHandler, LIVE_CHANGE_HEADER, createAdminHandler } from "../src/server/handler.ts";
import {
  QueryReads,
  composeQueryRules,
  pageRouteOf,
  parseQueryRules,
  queryPathsInConfig,
  ruleFor,
  undeclaredQueryReads,
} from "../src/server/query-params.ts";

const ORIGIN = "http://localhost:4321";
const EMAIL = "owner@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow (a test account in a memory database)
const visitor = { clientAddress: "203.0.113.7" };

const project = defineContentType({
  key: "project",
  label: "Projects",
  singular: "Project",
  slug: "projects",
  component: () => "",
  fields: [{ name: "summary", label: "Summary", type: "text" }],
});
const service = definePageTemplate({ key: "service", label: "Service page", folder: "services", component: () => "" });

let brim: Brim;
let admin: AdminHandler;
let cookie: string;
let token: string;

async function setUp(queryParams?: () => Record<string, string[] | "all">): Promise<void> {
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
  token = await brim.accounts.createToken(EMAIL, "claude");
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    pages: () => ["/", "/about"],
    contentTypes: () => [project],
    pageTemplates: () => [service],
    mediaDirectory: pathToFileURL(`${mkdtempSync(join(tmpdir(), "brim-cache-media-"))}/`),
    renderPage: async () => "<html></html>",
    ...(queryParams && { queryParams }),
  });
  const session = await call("POST", "/admin/api/session", { email: EMAIL, password: PASSWORD }); // betterleaks:allow
  cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const response = await admin(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(cookie && { cookie }),
        ...(method !== "GET" && { origin: ORIGIN }),
        ...(body !== undefined && { "content-type": "application/json" }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    visitor,
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

const changed = (response: Response) => response.headers.get(LIVE_CHANGE_HEADER);

beforeEach(async () => {
  cookie = "";
  await setUp();
});

describe("X-Brim-Changed: live", () => {
  it("is said in /admin/api/info", async () => {
    const info = (await (await call("GET", "/admin/api/info")).json()) as { capabilities: string[]; query?: unknown };
    expect(info.capabilities).toContain("live-change-header");
    // Without a way to know what pages read, the site declares nothing.
    expect(info.capabilities).not.toContain("query-params");
    expect(info.query).toBeUndefined();
  });

  it("answers a change visitors see, and nothing else", async () => {
    // Drafts being typed, undone and thrown away: nobody sees them.
    const draft = await call("PUT", "/admin/api/nodes", {
      path: "/",
      nodeId: "hero-title",
      kind: "text",
      scope: "page",
      value: { text: "Drafted" },
      draft: true,
    });
    expect(draft.status).toBe(200);
    expect(changed(draft)).toBeNull();
    expect(changed(await call("GET", "/admin/api/drafts"))).toBeNull();
    // Saving them makes them what visitors see.
    const saved = await call("POST", "/admin/api/drafts/save", {});
    expect(saved.status).toBe(200);
    expect(changed(saved)).toBe("live");
    expect(changed(await call("DELETE", "/admin/api/drafts", {}))).toBeNull();

    // A change written straight to the content.
    const node = await call("PUT", "/admin/api/nodes", {
      path: "/",
      nodeId: "hero-title",
      kind: "text",
      scope: "page",
      value: { text: "Saved" },
    });
    expect(changed(node)).toBe("live");
    expect(changed(await call("DELETE", "/admin/api/nodes", { path: "/", nodeId: "hero-title", scope: "page" }))).toBe(
      "live",
    );

    // A private page or item shows nobody anything; publishing it does.
    const page = await call("POST", "/admin/api/pages", { template: "service", title: "Lawn care" });
    expect(page.status).toBe(201);
    expect(changed(page)).toBeNull();
    expect(changed(await call("PUT", "/admin/api/pages", { path: "/services/lawn-care", visibility: "published" }))).toBe(
      "live",
    );
    const published = await call("POST", "/admin/api/pages", {
      template: "service",
      title: "Pruning",
      visibility: "published",
    });
    expect(changed(published)).toBe("live");
    const created = await call("POST", "/admin/api/items", { type: "project", title: "Lake", data: {} });
    expect(changed(created)).toBeNull();
    const { item } = (await created.json()) as { item: Item };
    expect(changed(await call("PUT", "/admin/api/items/visibility", { id: item.id, visibility: "published" }))).toBe(
      "live",
    );
    const protect = { path: "/services/lawn-care", password: "page-pass" }; // betterleaks:allow (a test value)
    expect(changed(await call("PUT", "/admin/api/pages", protect))).toBe("live");
    expect(changed(await call("PUT", "/admin/api/redirects", { redirects: [{ from: "/old", to: "/" }] }))).toBe("live");
    expect(changed(await call("DELETE", "/admin/api/items", { id: item.id }))).toBe("live");

    // Reads, sessions and uploads say nothing.
    expect(changed(await call("GET", "/admin/api/pages"))).toBeNull();
    expect(changed(await call("GET", "/admin/api/session"))).toBeNull();
    const upload = await call("POST", "/admin/api/media", undefined, { "x-file-name": "a.png" });
    expect(changed(upload)).toBeNull();
  });

  it("is never said for a refused change", async () => {
    const refused = await call("PUT", "/admin/api/redirects", { redirects: [{ from: "nope", to: "/" }] });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(changed(refused)).toBeNull();
    cookie = "";
    const signedOut = await call("PUT", "/admin/api/redirects", { redirects: [] });
    expect(signedOut.status).toBe(401);
    expect(changed(signedOut)).toBeNull();
  });

  it("reaches the MCP's answer when one of its tool calls changed what visitors see", async () => {
    cookie = "";
    const mcp = (body: unknown) =>
      call("POST", "/admin/mcp", body, { authorization: `Bearer ${token}`, origin: "" });
    const handshake = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(handshake.status).toBe(200);
    expect(changed(handshake)).toBeNull();
    expect(changed(await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).toBeNull();
    const read = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "brim_list_redirects" } });
    expect(changed(read)).toBeNull();
    const write = await mcp({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "brim_set_redirects", arguments: { redirects: [{ from: "/old", to: "/" }] } },
    });
    expect(write.status).toBe(200);
    expect(changed(write)).toBe("live");
    // A refused tool call is the tool's answer, and changed nothing.
    const refused = await mcp({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "brim_set_redirects", arguments: { redirects: [{ from: "nope", to: "/" }] } },
    });
    expect(changed(refused)).toBeNull();
  });
});

describe("query parameters each page reads", () => {
  it("are declared in /admin/api/info when the site knows them", async () => {
    await setUp(() => ({ "/shop": ["edit", "page", "q"] }));
    const info = (await (await call("GET", "/admin/api/info")).json()) as { capabilities: string[]; query: unknown };
    expect(info.capabilities).toContain("query-params");
    expect(info.query).toEqual({ "/shop": ["edit", "page", "q"] });
  });

  it("checks the config's declarations", () => {
    expect(parseQueryRules(undefined)).toEqual({});
    expect(parseQueryRules({ "/api/products": ["sort", "id", "sort"], "/legacy/*": "all" })).toEqual({
      "/api/products": ["sort", "id"],
      "/legacy/*": "all",
    });
    expect(() => parseQueryRules({ "api/products": ["sort"] })).toThrow(/not a path/);
    expect(() => parseQueryRules({ "/api": ["so rt"] })).toThrow(/parameter names/);
    expect(() => parseQueryRules({ "/api": "some" })).toThrow(/parameter names/);
    expect(() => parseQueryRules(["/api"])).toThrow(/must be an object/);
  });

  it("match a path as the host does: the longest pattern wins", () => {
    const rules = { "/shop/*": ["color"], "/shop/tiles": ["size"], "/": [] };
    expect(ruleFor(rules, "/shop/tiles")).toEqual(["size"]);
    expect(ruleFor(rules, "/shop/tiles/")).toEqual(["size"]);
    expect(ruleFor(rules, "/shop/lamps")).toEqual(["color"]);
    expect(ruleFor(rules, "/")).toEqual([]);
    expect(ruleFor(rules, "/about")).toBeUndefined();
  });

  it("keep ?edit everywhere, and what every declaration covering a page says", () => {
    const rules = composeQueryRules(
      { "/api/products": ["sort", "id"], "/shop/*": ["color"], "/legacy/*": "all" },
      { "/shop/tiles": ["page", "q"], "/about": ["edit"], "/legacy/x": ["a"], "/odd": ["naïve"] },
    );
    expect(rules).toEqual({
      "/api/products": ["edit", "id", "sort"],
      "/shop/*": ["color", "edit"],
      "/legacy/*": "all",
      // The exact path wins over `/shop/*` at the host, so it keeps `color` too.
      "/shop/tiles": ["color", "edit", "page", "q"],
      "/about": ["edit"],
      "/legacy/x": "all",
      // A name a host would drop: the page keeps every parameter rather than lose it.
      "/odd": "all",
    });
  });

  it("stay within what a host takes, leaving the rest undeclared", () => {
    const learned = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`/item-${index}`, ["edit"]]));
    learned["/bad path"] = ["edit"];
    const rules = composeQueryRules({}, learned);
    expect(Object.keys(rules)).toHaveLength(450);
    expect(rules["/bad path"]).toBeUndefined();
    expect(JSON.stringify(rules).length).toBeLessThan(100_000);
  });

  it("are remembered per build in the site's database, and only grow", async () => {
    const reads = new QueryReads(brim.db, "build-1");
    await reads.record("/shop/", ["edit", "q"]);
    await reads.record("/shop", ["page"]);
    await reads.record("/shop", ["q"]);
    await reads.record("/about", ["edit"]);
    expect(await reads.learned()).toEqual({ "/shop": ["edit", "page", "q"], "/about": ["edit"] });

    // A restarted server of the same build knows them at once.
    expect(await new QueryReads(brim.db, "build-1").learned()).toEqual({
      "/shop": ["edit", "page", "q"],
      "/about": ["edit"],
    });
    // Another build may read other parameters: it starts over.
    const next = new QueryReads(brim.db, "build-2");
    expect(await next.learned()).toEqual({});
    await next.record("/legacy", "all");
    await next.record("/legacy", ["x"]);
    expect(await next.learned()).toEqual({ "/legacy": "all" });
  });

  it("are noted by Brim's blocks and the site's code while a page is drawn", () => {
    const collector = new QueryCollector();
    // Outside a page, nothing is noted and nothing fails.
    readsQuery(["outside"]);
    collectingQueryReads(collector, () => {
      browseItems([], [{ name: "brand", label: "Brand", type: "text" }], { facets: ["brand"], search: true, pageSize: 2, paramPrefix: "p-" }, new URLSearchParams());
      noteQueryReads(["q", "qpage"]);
    });
    expect(collector.read).toEqual(["edit", "p-q", "p-page", "p-brand", "q", "qpage"]);
    expect(collector.bySite).toBe(false);
    collectingQueryReads(collector, () => readsQuery(["sort"]));
    expect(collector.bySite).toBe(true);
    collectingQueryReads(collector, () => readsQuery("all"));
    expect(collector.read).toBe("all");
  });

  it("find the site's code reading the query without saying so", () => {
    const files = [
      { file: "src/pages/shop/[slug].astro", text: "---\nconst sort = Astro.url.searchParams.get('sort');\n---" },
      { file: "src/pages/api/products.ts", text: "export const GET = ({ url }) => url.searchParams.get('id');" },
      { file: "src/pages/said.astro", text: '---\nreadsQuery(["x"]);\nAstro.url.searchParams.get("x");\n---' },
      { file: "src/components/Filter.astro", text: "---\n\n// url.searchParams in a comment\n---" },
      { file: "src/components/Client.astro", text: "<script>new URLSearchParams(location.search)</script>" },
      { file: "src/components/Sorter.astro", text: "---\nconst { search } = Astro.url;\nAstro.url.search\n---" },
    ];
    expect(undeclaredQueryReads(files, { "/api/products": ["id"] })).toEqual([
      { file: "src/pages/shop/[slug].astro", line: 2 },
      { file: "src/components/Sorter.astro", line: 3 },
    ]);
    expect(undeclaredQueryReads(files, { "/api/products": ["id"], "/shop/*": ["sort"] })).toEqual([
      { file: "src/components/Sorter.astro", line: 3 },
    ]);
    expect(pageRouteOf("src/pages/index.astro")).toBe("/");
    expect(pageRouteOf("src/pages/blog/[...slug]/index.astro")).toBe("/blog/_");
    expect(pageRouteOf("src/components/A.astro")).toBeUndefined();
    expect(queryPathsInConfig('brim({ query: { "/api/products": ["sort"], \'/shop/*\': "all" } })')).toEqual({
      "/api/products": "all",
      "/shop/*": "all",
    });
  });

  it("brim check warns about code reading the query without saying so", () => {
    const root = mkdtempSync(join(tmpdir(), "brim-check-query-"));
    const write = (file: string, text: string) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    write("src/pages/shop.astro", "---\nconst sort = Astro.url.searchParams.get('sort');\n---\n<p>{sort}</p>");
    write("src/pages/api/products.ts", "export const GET = ({ url }) => new Response(url.searchParams.get('id'));");
    write("astro.config.mjs", 'brim({ query: { "/api/products": ["id"] } })');
    const findings = checkSite(root, { starter: [], git: false }).findings.filter(
      (finding) => finding.rule === "undeclared-query",
    );
    expect(findings).toEqual([expect.objectContaining({ file: "src/pages/shop.astro", line: 2, severity: "warning" })]);
  });
});
