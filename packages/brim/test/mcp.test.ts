import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { defineContentType } from "../src/content/content-types.ts";
import { ItemStore } from "../src/content/items.ts";
import { definePageTemplate } from "../src/content/page-templates.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { FormStore } from "../src/forms/store.ts";
import { pageNodes, inlineNodes } from "../src/mcp/page-nodes.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";
import { VERSION } from "../src/version.ts";

const ORIGIN = "http://localhost:4321";
const EMAIL = "owner@example.test";
const visitor = { clientAddress: "203.0.113.7" };

const project = defineContentType({
  key: "project",
  label: "Projects",
  singular: "Project",
  slug: "projects",
  component: () => "",
  fields: [
    { name: "summary", label: "Summary", type: "textarea", required: true },
    { name: "year", label: "Year", type: "number" },
  ],
});

// The smallest valid PNG header is enough for the format check.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

// What the dev server renders for "/": a heading, a button with saved settings and the site navigation.
const HOME = `<html><body>
  <header data-brim-node="navbar" data-brim-kind="navbar" data-brim-scope="site"
    data-brim-value="{&quot;logoText&quot;:&quot;Acme&quot;,&quot;items&quot;:[]}"><a href="/">Acme</a></header>
  <h1 class="hero" data-brim-node="hero-title" data-brim-kind="text" data-brim-scope="page">Gardens that <em>grow</em> &amp; last</h1>
  <div data-brim-node="hero-cta" data-brim-kind="button" data-brim-scope="page"
    data-brim-value="{&quot;text&quot;:&quot;Book&quot;,&quot;variant&quot;:&quot;accent&quot;}"><a>Book</a></div>
</body></html>`;

let brim: Brim;
let admin: AdminHandler;
let token: string;
let changes: (string | undefined)[];

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
  await brim.accounts.createUser(EMAIL, "correct horse battery", "owner");
  token = await brim.accounts.createToken(EMAIL, "claude");
  changes = [];
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    pages: () => ["/"],
    contentTypes: () => [project],
    pageTemplates: () => [
      definePageTemplate({ key: "service", label: "Service page", folder: "services", component: () => "" }),
    ],
    renderPage: async (url) => (url.pathname === "/" ? HOME : "<html></html>"),
    onChange: (path) => void changes.push(path),
    mediaDirectory: pathToFileURL(`${mkdtempSync(join(tmpdir(), "brim-mcp-media-"))}/`),
    // The web, as brim_upload_image fetches it: one picture at a public address, and a page that is not one.
    fetch: (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/lamp.png")) return new Response(PNG, { headers: { "content-type": "image/png" } });
      // A chat app's link to a file the person attached: served as plain bytes.
      if (url.includes("/chat-files/")) return new Response(PNG, { headers: { "content-type": "application/octet-stream" } });
      return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    }) as typeof fetch,
  });
});

async function post(body: unknown, authorization: string | null = `Bearer ${token}`): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization) headers.set("authorization", authorization);
  const response = await admin(
    new Request(`${ORIGIN}/admin/mcp`, { method: "POST", headers, body: JSON.stringify(body) }),
    visitor,
  );
  if (!response) throw new Error("/admin/mcp was not handled");
  return response;
}

let nextId = 1;
async function rpc(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await post({ jsonrpc: "2.0", id: nextId++, method, params });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** Calls a tool and returns its parsed output, or its error text when it refused. */
async function tool(name: string, args: Record<string, unknown> = {}): Promise<{ output: any; error?: string }> {
  const { result } = (await rpc("tools/call", { name, arguments: args })) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  const text = result.content[0]?.text ?? "";
  return result.isError ? { output: undefined, error: text } : { output: JSON.parse(text) };
}

describe("access", () => {
  it("needs a valid access token", async () => {
    const missing = await post({ jsonrpc: "2.0", id: 1, method: "ping" }, null);
    expect(missing.status).toBe(401);
    // It says where to sign in (OAuth): the site's protected-resource metadata.
    expect(missing.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/admin/mcp"`,
    );
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, "Bearer brim_forged")).status).toBe(401);
  });

  it("stops working once the token is revoked", async () => {
    expect(await brim.accounts.revokeToken(EMAIL, "claude")).toBe(true);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
  });

  it("does not accept the editor's session cookie", async () => {
    const session = await brim.accounts.startSession((await brim.accounts.tokenUser(token))!.id);
    const response = await admin(
      new Request(`${ORIGIN}/admin/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `brim_session=${session.token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      visitor,
    );
    expect(response?.status).toBe(401);
  });

  it("lets a token use the editor's API without the browser origin check", async () => {
    const response = await admin(
      new Request(`${ORIGIN}/admin/api/items`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "project",
          title: "Via API",
          visibility: "private",
          data: { summary: "Made with a token." },
        }),
      }),
      visitor,
    );
    expect(response?.status).toBe(201);
  });

  it("records when a token was last used, and lists tokens without their value", async () => {
    await rpc("ping");
    const [listed] = await brim.accounts.listTokens(EMAIL);
    expect(listed?.name).toBe("claude");
    expect(listed?.lastUsedAt).not.toBeNull();
    expect(JSON.stringify(listed)).not.toContain(token);
  });
});

describe("protocol", () => {
  it("introduces itself and lists its tools", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {} })) as any;
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.capabilities.tools).toBeDefined();
    expect(init.result.serverInfo.version).toBe(VERSION);
    expect(init.result.instructions).toContain("nodeId");

    const list = (await rpc("tools/list")) as any;
    const names = list.result.tools.map((entry: { name: string }) => entry.name);
    expect(names).toEqual(expect.arrayContaining(["brim_site", "brim_read_page", "brim_set_text", "brim_create_item"]));
  });

  it("answers notifications with nothing and unknown methods with an error", async () => {
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const unknown = (await rpc("resources/list")) as any;
    expect(unknown.error.code).toBe(-32601);
  });
});

describe("tools", () => {
  it("reads a page from the server itself, whatever host the request's headers name", async () => {
    const asked: string[] = [];
    const site = createAdminHandler({
      brim,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      pages: () => ["/"],
      renderPage: async (url) => (asked.push(url.href), HOME),
    });
    const read = (info: { clientAddress: string; serverOrigin?: string }) =>
      site(
        new Request(`${ORIGIN}/admin/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            host: "169.254.169.254",
            "x-forwarded-host": "internal.example:8080",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "brim_read_page", arguments: { path: "/about" } },
          }),
        }),
        info,
      );

    await read(visitor);
    await read({ ...visitor, serverOrigin: "http://127.0.0.1:4321" });

    expect(asked).toEqual([`${ORIGIN}/about`, "http://127.0.0.1:4321/about"]);
  });

  it("lists a page's editable elements with their text and settings", async () => {
    const { output } = await tool("brim_read_page", { path: "/" });
    expect(output.page.path).toBe("/");
    expect(output.elements).toEqual([
      { nodeId: "navbar", kind: "navbar", scope: "site", value: { logoText: "Acme", items: [] } },
      {
        nodeId: "hero-title",
        kind: "text",
        scope: "page",
        text: "Gardens that grow & last",
        rich: ["Gardens that ", { tag: "em", children: ["grow"] }, " & last"],
      },
      { nodeId: "hero-cta", kind: "button", scope: "page", value: { text: "Book", variant: "accent" } },
    ]);
  });

  it("changes a text and keeps the owner's element choice", async () => {
    await brim.content.saveNode("page:/", "hero-title", "text", { text: "Old", as: "h2" });
    const { output } = await tool("brim_set_text", {
      path: "/",
      nodeId: "hero-title",
      text: "Gardens for every season",
    });
    expect(output.value).toEqual({ text: "Gardens for every season", as: "h2" });
    expect(changes).toEqual(["/"]);
  });

  it("keeps a line typed as \\n as a line break, and formatting passed as rich", async () => {
    await brim.content.saveNode("page:/", "hero-title", "text", { text: "Old", as: "h2" });
    const lines = await tool("brim_set_text", {
      path: "/",
      nodeId: "hero-title",
      text: "Un spațiu al tău.\nDe la primul pas",
    });
    expect(lines.output.value).toEqual({
      text: "Un spațiu al tău.\nDe la primul pas",
      rich: ["Un spațiu al tău.", { tag: "br", children: [] }, "De la primul pas"],
      as: "h2",
    });

    const rich = ["Call ", { tag: "a", href: "/contact", children: [{ tag: "strong", children: ["us"] }] }];
    const formatted = await tool("brim_set_text", { path: "/", nodeId: "hero-title", rich });
    expect(formatted.output.value).toEqual({ text: "Call us", rich, as: "h2" });

    const plain = await tool("brim_set_text", { path: "/", nodeId: "hero-title", text: "Plain again" });
    expect(plain.output.value).toEqual({ text: "Plain again", as: "h2" });

    const refused = await tool("brim_set_text", {
      path: "/",
      nodeId: "hero-title",
      rich: [{ tag: "a", href: "javascript:alert(1)", children: ["x"] }],
    });
    expect(refused.error).toBeDefined();
  });

  it("merges block settings into what was saved, and checks them", async () => {
    await brim.content.saveNode("page:/", "hero-cta", "button", { text: "Book", variant: "accent" });
    const { output } = await tool("brim_set_element", {
      path: "/",
      nodeId: "hero-cta",
      kind: "button",
      value: { text: "Get a quote" },
    });
    expect(output.value).toMatchObject({ text: "Get a quote", variant: "accent" });

    const refused = await tool("brim_set_element", {
      path: "/",
      nodeId: "hero-cta",
      kind: "button",
      value: { url: "javascript:alert(1)" },
    });
    expect(refused.error).toBeDefined();
  });

  it("refuses an invalid nodeId the way the editor does", async () => {
    const { error } = await tool("brim_set_text", { path: "/", nodeId: "Not An Id", text: "x" });
    expect(error).toContain("nodeId");
  });

  it("translates an item into another language, keeping its slug, and lists one language", async () => {
    // The same site, with Romanian beside English.
    admin = createAdminHandler({
      brim,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      pages: () => ["/"],
      contentTypes: () => [project],
      locales: { defaultLocale: "en", locales: ["en", "ro"] },
    });
    const created = await tool("brim_create_item", {
      type: "project",
      title: "Lake House",
      data: { summary: "A house by the lake.", year: 2024 },
    });

    const translated = await tool("brim_translate_item", {
      id: created.output.item.id,
      locale: "ro",
      title: "Casa de la lac",
      data: { summary: "O casă la lac." },
    });

    expect(translated.output.item).toMatchObject({
      locale: "ro",
      translationOf: created.output.item.id,
      slug: "lake-house",
      title: "Casa de la lac",
      visibility: "private",
      data: { summary: "O casă la lac.", year: 2024 },
    });
    const romanian = (await tool("brim_list_items", { type: "project", locale: "ro" })).output.items;
    expect(romanian.map((item: { title: string }) => item.title)).toEqual(["Casa de la lac"]);
    expect((await tool("brim_translate_item", { id: created.output.item.id, locale: "ro" })).error).toMatch(
      /already has a translation/,
    );
  });

  it("creates, updates and deletes items", async () => {
    const created = await tool("brim_create_item", {
      type: "project",
      title: "Lake House",
      data: { summary: "A house by the lake.", year: 2024 },
    });
    expect(created.output.item).toMatchObject({ slug: "lake-house", visibility: "private" });

    const id = created.output.item.id;
    const updated = await tool("brim_update_item", { id, visibility: "published", data: { year: 2025 } });
    expect(updated.output.item).toMatchObject({
      visibility: "published",
      data: { summary: "A house by the lake.", year: 2025 },
    });

    const missingField = await tool("brim_create_item", { type: "project", title: "No summary", data: {} });
    expect(missingField.error).toContain("Summary");

    await tool("brim_delete_item", { id });
    expect((await tool("brim_list_items", { type: "project" })).output.items).toEqual([]);
  });

  it("lists only the items that have a tag, whatever its case", async () => {
    await tool("brim_create_item", {
      type: "project",
      title: "Lake house",
      data: { summary: "By the lake.", tags: ["Lake"] },
    });
    await tool("brim_create_item", { type: "project", title: "Pine cabin", data: { summary: "In the pines." } });
    const tagged = await tool("brim_list_items", { type: "project", tag: "lake" });
    expect(tagged.output.items.map((item: { title: string }) => item.title)).toEqual(["Lake house"]);
    expect((await tool("brim_list_items", { type: "project" })).output.items).toHaveLength(2);
  });

  it("publishes a page and sets its SEO", async () => {
    const { output } = await tool("brim_update_page", {
      path: "/",
      visibility: "private",
      seo: { title: "Home", description: "The front page." },
    });
    expect(output).toMatchObject({ path: "/", visibility: "private", seo: { title: "Home" } });
  });

  it("gives an overview and block schemas", async () => {
    const { output } = await tool("brim_site");
    expect(output.types.map((type: { key: string }) => type.key)).toEqual(["project"]);
    // The field with an item's picture on cards and shared links, which the MCP is told to fill: the standard `image`.
    expect(output.types[0].previewImage).toBe("image");
    expect(output.pages.map((page: { path: string }) => page.path)).toEqual(["/"]);
    expect((await tool("brim_block_schema", { kind: "button" })).output.type).toBe("button");
    expect((await tool("brim_block_schema", { kind: "nope" })).error).toContain("no block");
  });
});

describe("page reading", () => {
  it("finds nested elements and skips duplicates", () => {
    const nodes = pageNodes(
      `<div data-brim-node="a" data-brim-kind="text" data-brim-scope="page">One <div>inner</div> two</div>
       <div data-brim-node="a" data-brim-kind="text" data-brim-scope="page">Copy</div>`,
    );
    expect(nodes).toEqual([{ nodeId: "a", kind: "text", scope: "page", text: "One inner\ntwo" }]);
  });
});

describe("pages from templates", () => {
  it("lists the templates, creates a private page from one, publishes it and deletes it", async () => {
    expect((await tool("brim_list_page_templates")).output).toEqual({
      templates: [{ key: "service", label: "Service page", folder: "services" }],
    });

    const created = await tool("brim_create_page", { template: "service", title: "Lawn care" });
    expect(created.output).toEqual({
      page: { path: "/services/lawn-care", visibility: "private", seo: {}, template: "service", title: "Lawn care" },
      // Where the person opens it in the editor.
      editUrl: `${ORIGIN}/admin/edit/services/lawn-care`,
    });

    const site = (await tool("brim_site")).output;
    expect(site.pages).toContainEqual(expect.objectContaining({ path: "/services/lawn-care", template: "service" }));
    expect(site.templates).toHaveLength(1);

    const published = await tool("brim_update_page", { path: "/services/lawn-care", visibility: "published" });
    expect(published.output).toMatchObject({ visibility: "published" });

    // The new page's elements are saved under its own scope, like any page's.
    await tool("brim_set_text", { path: "/services/lawn-care", nodeId: "page-title", text: "Lawns" });
    expect(await brim.content.loadNodes(["page:/services/lawn-care"])).toHaveLength(1);

    expect((await tool("brim_delete_page", { path: "/services/lawn-care" })).output).toEqual({ deleted: true });
    expect(await brim.content.templatePages()).toEqual([]);
  });

  it("passes on why a page cannot be created or deleted", async () => {
    expect((await tool("brim_create_page", { template: "service", title: "Home", path: "/" })).error).toBe(
      "The address can only have lowercase letters, digits and dashes, e.g. /services/lawn-care.",
    );
    expect((await tool("brim_create_page", { template: "nope", title: "X" })).error).toBe(
      "This page template does not exist.",
    );
    expect((await tool("brim_delete_page", { path: "/" })).error).toBe(
      "Only pages added from a template can be changed this way.",
    );
  });
});

describe("item fields", () => {
  it("lists bound elements with their item and changes the item through them", async () => {
    const created = await tool("brim_create_item", {
      type: "project",
      title: "Lake House",
      slug: "lake-house",
      data: { summary: "By the lake." },
    });
    const id = created.output.item.id as string;
    expect(
      pageNodes(
        `<p data-brim-node="project-summary" data-brim-kind="text" data-brim-scope="page" data-brim-item="${id}" data-brim-field="summary">By the lake.</p>`,
      ),
    ).toEqual([
      { nodeId: "project-summary", kind: "text", scope: "page", item: id, field: "summary", text: "By the lake." },
    ]);

    const saved = await tool("brim_set_text", {
      path: "/projects/lake-house",
      nodeId: "project-summary",
      item: id,
      field: "summary",
      text: "A house by the lake.",
    });
    expect(saved.error).toBeUndefined();
    expect((await brim.items.get(id))?.data.summary).toBe("A house by the lake.");
  });

  it("changes the template of the item's type, shared by every item's page", async () => {
    await tool("brim_create_item", { type: "project", title: "Lake House", data: { summary: "By the lake." } });
    const saved = await tool("brim_set_text", {
      path: "/projects/lake-house",
      nodeId: "project-back",
      scope: "template",
      text: "All projects",
    });

    expect(saved.error).toBeUndefined();
    expect(await brim.content.loadNodes(["type:project"])).toMatchObject([
      { nodeId: "project-back", value: { text: "All projects" } },
    ]);
  });
});

describe("history tools", () => {
  it("list the changes and take one back", async () => {
    await tool("brim_set_text", { path: "/", nodeId: "hero-title", text: "First" });
    const { output } = await tool("brim_list_history", { path: "/" });
    expect(output.history).toHaveLength(1);
    expect(output.history[0]).toMatchObject({ target: "node", action: "changed", title: "hero-title", page: "/" });

    const restored = await tool("brim_restore_history", { id: output.history[0].id });
    expect(restored.output.restored).toMatchObject({ target: "node", title: "hero-title" });
    expect(await brim.content.loadNodes(["page:/"])).toEqual([]);
    expect((await tool("brim_restore_history", { id: "missing" })).error).toMatch(/no longer in the site's history/);
  });
});

describe("brim_upload_image", () => {
  it("puts an image from base64 or a public address into the media library", async () => {
    const fromData = await tool("brim_upload_image", { data: Buffer.from(PNG).toString("base64"), name: "lamp.png" });
    expect(fromData.output.file).toMatchObject({ name: "lamp.png", mime: "image/png", folder: "" });
    expect(fromData.output.file.url).toMatch(/^\/uploads\/.+\.png$/);

    const fromWeb = await tool("brim_upload_image", { url: "https://93.184.215.14/photos/lamp.png" });
    expect(fromWeb.output.file).toMatchObject({ name: "lamp.png", mime: "image/png" });

    const { output } = await tool("brim_list_media");
    expect(output.files).toHaveLength(2);
  });

  it("takes a picture attached in the chat, which ChatGPT hands over as a link", async () => {
    const listed = (await rpc("tools/list")) as { result: { tools: { name: string; _meta?: object; inputSchema: any }[] } };
    const upload = listed.result.tools.find((candidate) => candidate.name === "brim_upload_image")!;
    expect(upload._meta).toEqual({ "openai/fileParams": ["file"] });
    expect(upload.inputSchema.$defs.ChatFile.required).toEqual(["download_url", "file_id"]);

    const attached = await tool("brim_upload_image", {
      file: {
        download_url: "https://93.184.215.14/chat-files/abc?sig=1",
        file_id: "file_abc",
        mime_type: "image/png",
        file_name: "kitchen.png",
      },
    });
    expect(attached.output.file).toMatchObject({ name: "kitchen.png", mime: "image/png" });

    // Sometimes ChatGPT sends the file's place in its sandbox: the answer asks it to try again.
    const path = await tool("brim_upload_image", { file: "/mnt/data/kitchen.png" });
    expect(path.error).toContain("Call brim_upload_image again");
    // Bytes served as a file, with no word that they are a picture, are still refused.
    const unsaid = await tool("brim_upload_image", { file: { download_url: "https://93.184.215.14/chat-files/x", file_id: "f" } });
    expect(unsaid.error).toContain("not an image");
  });

  it("refuses what is not an image, the server's own network, and a folder that does not exist", async () => {
    expect((await tool("brim_upload_image", { url: "https://93.184.215.14/page" })).error).toContain("not an image");
    expect((await tool("brim_upload_image", { url: "http://127.0.0.1/lamp.png" })).error).toContain(
      "not a public address",
    );
    expect((await tool("brim_upload_image", { url: "http://169.254.169.254/lamp.png" })).error).toContain(
      "not a public address",
    );
    const folder = await tool("brim_upload_image", {
      data: Buffer.from(PNG).toString("base64"),
      name: "a.png",
      type: "project",
      item: "nope",
    });
    expect(folder.error).toContain("folder does not exist");
  });
});

describe("the formatting of a text element, as brim_read_page reads it", () => {
  it("reads line breaks, marks, links and colors, and only the words of anything else", () => {
    expect(
      inlineNodes(`
        Un spațiu<br/>al <b>tău</b>, <a href="/pas" class="x">primul <i>pas</i></a>
        <span style="color:#c00">roșu</span> <span class="accent">simplu</span><code>cod</code>
      `),
    ).toEqual([
      "Un spațiu",
      { tag: "br", children: [] },
      "al ",
      { tag: "strong", children: ["tău"] },
      ", ",
      { tag: "a", href: "/pas", children: ["primul ", { tag: "em", children: ["pas"] }] },
      " ",
      { tag: "span", color: "#c00", children: ["roșu"] },
      " simplucod",
    ]);
  });

  it("gives nothing for plain text, so rich shows only where there is formatting", () => {
    expect(inlineNodes("Just words &amp; more")).toBeUndefined();
    expect(inlineNodes('<span class="x">Still plain</span>')).toBeUndefined();
  });
});

describe("guidance for writing items", () => {
  it("names the preview picture of a type that keeps its own image field", async () => {
    const story = defineContentType({
      key: "story",
      label: "Stories",
      singular: "Story",
      slug: "stories",
      component: () => "",
      image: false,
      fields: [
        { name: "cover", label: "Cover", type: "image" },
        { name: "content", label: "Text", type: "richtext" },
        { name: "body", label: "Blocks", type: "blocks" },
      ],
    });
    const types = createAdminHandler({
      brim,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      contentTypes: () => [story],
    });
    const response = await types(
      new Request(`${ORIGIN}/admin/api/types`, { headers: { authorization: `Bearer ${token}` } }),
      visitor,
    );
    const { types: listed } = (await response!.json()) as { types: { key: string; previewImage: string | null }[] };
    expect(listed[0]).toMatchObject({ key: "story", previewImage: "cover" });
  });

  it("tells the client that pictures between paragraphs go in a blocks field", async () => {
    const { result } = (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} })) as {
      result: { instructions: string };
    };
    expect(result.instructions).toContain('A "richtext" field holds text only');
    expect(result.instructions).toContain("previewImage");
  });
});
