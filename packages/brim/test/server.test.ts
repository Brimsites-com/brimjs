import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pageScope } from "../src/content/ids.ts";
import { SCHEMA_VERSION } from "../src/db/schema.ts";
import { connect } from "../src/runtime/connect.ts";

const exampleRoot = fileURLToPath(new URL("../../../examples/basic/", import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), "brim-server-"));
const outDir = join(workDir, "dist");
const databaseUrl = `file:${join(workDir, "data.db")}`; // betterleaks:allow (a temporary test database)
const EMAIL = "owner@example.test";
const PASSWORD = "a long enough password"; // betterleaks:allow (a test account in a temporary database)

let server: ChildProcess;
// A storage the built server keeps uploads in (media.storage, set through the environment like a host does).
let storage: Server;
const stored: { url: string; authorization: string | undefined; type: string | undefined; size: number }[] = [];
let origin: string;
let cookie: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    redirect: "manual",
    headers: { origin, ...(body !== undefined && { "content-type": "application/json" }), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  const brim = await connect(databaseUrl);
  await brim.accounts.createUser(EMAIL, PASSWORD, "owner");
  await brim.content.setPageVisibility("/about", "private");
  const data = { summary: "A house by the lake" };
  await brim.items.create("project", { title: "Lake House", slug: "lake-house", visibility: "published", data });
  await brim.items.create("project", { title: "Secret Villa", slug: "secret-villa", visibility: "private", data });
  await brim.items.create("product", {
    title: "Arc Lamp",
    slug: "arc-lamp",
    visibility: "published",
    data: { category: "lamps" },
  });
  await brim.items.create("product", {
    title: "Bent Chair",
    slug: "bent-chair",
    visibility: "published",
    data: { category: "chairs", summary: "Steam-bent ash" },
  });
  await brim.content.createPage("/services/lawn-care", "service", "Lawn care", "published");
  await brim.content.createPage("/services/draft", "service", "Draft service", "private");

  // Built without a database in the environment: the server must take it from where it runs.
  await build({ root: exampleRoot, outDir, logLevel: "silent", site: "https://acme.test" });

  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  storage = createHttpServer((request, response) => {
    let size = 0;
    request.on("data", (chunk: Buffer) => (size += chunk.length));
    request.on("end", () => {
      if (request.method === "PUT") {
        const { authorization, "content-type": type } = request.headers;
        stored.push({ url: request.url ?? "", authorization, type, size });
      }
      response.writeHead(request.method === "PUT" ? 201 : 405).end();
    });
  });
  const storagePort = await freePort();
  await new Promise<void>((resolve) => storage.listen(storagePort, "127.0.0.1", resolve));
  server = spawn(process.execPath, [join(outDir, "server", "entry.mjs")], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      BRIM_DATABASE_URL: databaseUrl, // betterleaks:allow
      BRIM_MEDIA_STORAGE_URL: `http://127.0.0.1:${storagePort}/media/site-1`,
      BRIM_MEDIA_STORAGE_TOKEN: "storage-token", // betterleaks:allow (a test value)
      BRIM_MEDIA_PUBLIC_URL: "https://media.example/site-1",
      BRIM_MEDIA_RESIZE: "{url}?width={width}",
      BRIM_GOOGLE_ANALYTICS_ID: "G-TEST123456",
      BRIM_MEDIA_SHARP: "1",
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const up = await fetch(`${origin}/admin/api/info`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const session = await send("POST", "/admin/api/session", { email: EMAIL, password: PASSWORD }); // betterleaks:allow
  cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}, 120_000);

afterAll(() => {
  server?.kill();
  storage?.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("built server", () => {
  it("says what runs, without signing in", async () => {
    const info = (await (await send("GET", "/admin/api/info")).json()) as Record<string, unknown>;

    expect(info).toMatchObject({ name: "brimjs", schemaVersion: SCHEMA_VERSION });
    expect(typeof info.version).toBe("string");
  });

  it("tells a host which query parameters each page read once it was drawn", async () => {
    const declared = async () =>
      ((await (await send("GET", "/admin/api/info")).json()) as { capabilities: string[]; query: Record<string, unknown> });
    expect((await declared()).capabilities).toEqual(expect.arrayContaining(["live-change-header", "query-params"]));
    expect((await send("GET", "/shop?category=lamps&utm_source=x")).status).toBe(200);
    expect((await send("GET", "/quote")).status).toBe(200);
    let query: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 50 && !query["/quote"]; attempt++) {
      query = (await declared()).query;
      if (!query["/shop"] || !query["/quote"]) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Both listings of the page: the search, the pages and the facet of each, and `?edit`.
    expect(query["/shop"]).toEqual(["category", "edit", "own-category", "own-page", "page", "q"]);
    // Its site search: the words and the pages.
    expect(query["/quote"]).toEqual(["edit", "q", "qpage"]);
    // A page drawn for the signed-in editor is never kept by a host, so it teaches nothing.
    expect((await send("GET", "/about", undefined, { cookie })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await declared()).query["/about"]).toBeUndefined();
    // Remembered in the site's database for this build.
    const { db } = await connect(databaseUrl);
    expect(await db.query("SELECT path FROM brim_query_reads WHERE path = ?", ["/shop"])).toEqual([{ path: "/shop" }]);
  });

  it("answers a change visitors see with X-Brim-Changed: live", async () => {
    const draft = await send(
      "PUT",
      "/admin/api/nodes",
      { path: "/quote", nodeId: "cache-note", kind: "text", scope: "page", value: { text: "Drafted" }, draft: true },
      { cookie },
    );
    expect(draft.status).toBe(200);
    expect(draft.headers.get("x-brim-changed")).toBeNull();
    const saved = await send("POST", "/admin/api/drafts/save", {}, { cookie });
    expect(saved.headers.get("x-brim-changed")).toBe("live");
  });

  it("runs the site's own endpoints, with the site's database and the editor's sign-in", async () => {
    const like = { page: "/about" };
    expect(await (await send("POST", "/api/likes", like)).json()).toEqual({ page: "/about", likes: 1 });
    expect(await (await send("POST", "/api/likes", like)).json()).toEqual({ page: "/about", likes: 2 });
    expect((await send("POST", "/api/likes", {})).status).toBe(422);
    // Kept in the site's database, next to Brim's own tables.
    expect(await (await send("GET", "/api/likes")).json()).toEqual({ likes: { "/about": 2 } });
    const { db } = await connect(databaseUrl);
    expect(await db.query("SELECT count FROM site_likes WHERE page = ?", ["/about"])).toEqual([{ count: 2 }]);

    // A visitor may not clear them; the signed-in editor may.
    expect((await send("DELETE", "/api/likes", {})).status).toBe(401);
    expect((await send("DELETE", "/api/likes", {}, { cookie })).status).toBe(200);
    expect(await (await send("GET", "/api/likes")).json()).toEqual({ likes: {} });
  });

  it("plays an .m3u8 address as HLS, with its script only on the page that has such a video", async () => {
    const stream = "https://cdn.example.test/vid_1/playlist.m3u8";
    const about = async (): Promise<string> => (await send("GET", "/about", undefined, { cookie })).text();
    // A YouTube link in the code: an embedded player, and no script of Brim's for it.
    expect(await about()).not.toContain("data-brim-hls");

    const saved = await send(
      "PUT",
      "/admin/api/nodes",
      {
        path: "/about",
        scope: "page",
        nodeId: "about-video",
        kind: "video",
        value: { url: stream, isYouTube: false, posterUrl: "/poster.jpg", autoplay: true, loop: true },
      },
      { cookie },
    );
    expect(saved.status).toBe(200);

    const html = await about();
    const video = html.match(/<video[^>]*>/)?.[0] ?? "";
    expect(video).toContain(`data-brim-hls="${stream}"`);
    // Safari plays the address by itself; the settings stay the element's own.
    expect(video).toContain(`src="${stream}"`);
    expect(video).toContain('poster="/poster.jpg"');
    for (const attribute of ["autoplay", "loop", "muted", "controls", "playsinline"])
      expect(video).toContain(attribute);
    // The page's scripts (Astro's prefetch among them): the video's is the one that knows `data-brim-hls`.
    const scripts = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((match) => match[1] ?? "");
    const codes = await Promise.all(scripts.map(async (src) => (await send("GET", src)).text()));
    // hls.js is its own file, fetched only by a browser that needs it.
    const code = codes.find((text) => text.includes("data-brim-hls")) ?? "";
    expect(code).toContain("data-brim-hls");
    expect(code).toMatch(/import\(/);
    expect(code.length).toBeLessThan(20_000);

    await send("DELETE", "/admin/api/nodes", { path: "/about", scope: "page", nodeId: "about-video" }, { cookie });
  });

  it("shows visitors the page without a trace of the editor", async () => {
    const response = await send("GET", "/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Websites your clients can edit");
    expect(html).not.toContain("data-brim");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("shows a signed-in editor the same page with its markers, never to be cached", async () => {
    const response = await send("GET", "/", undefined, { cookie });

    expect(await response.text()).toContain('data-brim-node="hero-title"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("asks visitors before counting them, asks nothing of Google in the page and never counts an editor", async () => {
    const html = await (await send("GET", "/")).text();
    expect(html).toContain('<brim-analytics data-id="G-TEST123456">');
    expect(html).toMatch(/<section class="brim-consent" aria-label="Cookies" hidden/);
    expect(html).not.toMatch(/<script[^>]+src="https:\/\/www\.googletagmanager/);
    expect(await (await send("GET", "/", undefined, { cookie })).text()).not.toContain("brim-analytics");
  });

  it("serves the editor, its script and the API", async () => {
    expect((await send("GET", "/admin/edit")).headers.get("content-type")).toContain("text/html");
    expect((await send("GET", "/admin/assets/editor.js")).status).toBe(200);
    expect((await send("GET", "/admin/api/pages")).status).toBe(401);
    expect((await send("GET", "/admin/api/pages", undefined, { cookie })).status).toBe(200);
  });

  it("shows an edit to visitors as soon as it is saved, with nothing rebuilt", async () => {
    const saved = await send(
      "PUT",
      "/admin/api/nodes",
      { path: "/", nodeId: "hero-title", kind: "text", scope: "page", value: { text: "Saved a second ago" } },
      { cookie },
    );
    expect(saved.status).toBe(200);

    expect(await (await send("GET", "/")).text()).toContain("Saved a second ago");
    await (await connect(databaseUrl)).content.resetNode(pageScope("/"), "hero-title");
  });

  it("refuses a change sent from another site", async () => {
    const response = await send(
      "PUT",
      "/admin/api/nodes",
      { path: "/", nodeId: "hero-title", kind: "text", scope: "page", value: { text: "x" } },
      { cookie, origin: "https://elsewhere.test" },
    );

    expect(response.status).toBe(403);
  });

  it("keeps private pages and items from visitors and shows them to the editor", async () => {
    expect((await send("GET", "/about")).status).toBe(404);
    expect((await send("GET", "/about", undefined, { cookie })).status).toBe(200);
    expect((await send("GET", "/projects/secret-villa")).status).toBe(404);
    expect((await send("GET", "/projects/secret-villa", undefined, { cookie })).status).toBe(200);
    expect(await (await send("GET", "/")).text()).not.toContain("Secret Villa");
  });

  it("draws the pages of items and the pages added from templates on request", async () => {
    expect(await (await send("GET", "/projects/lake-house")).text()).toContain("A house by the lake");
    expect((await send("GET", "/services/lawn-care")).status).toBe(200);
    expect((await send("GET", "/services/draft")).status).toBe(404);
    expect((await send("GET", "/services/draft", undefined, { cookie })).status).toBe(200);
    expect((await send("GET", "/no-such-page")).status).toBe(404);
  });

  it("shows what the owner changed on a type's template on the page of every item", async () => {
    const title = { path: "/projects/lake-house", scope: "template", nodeId: "project-title", kind: "text" };
    await send("PUT", "/admin/api/nodes", { ...title, value: { text: "", as: "h2" } }, { cookie });

    expect(await (await send("GET", "/projects/lake-house")).text()).toContain("<h2>Lake House</h2>");
    const editing = await (await send("GET", "/projects/secret-villa", undefined, { cookie })).text();
    expect(editing).toMatch(/<h2 [^>]*data-brim-scope="template"[^>]*data-brim-field="title"[^>]*>Secret Villa<\/h2>/);
  });

  it("draws an item at the address its type's path gives, and leads every other one there", async () => {
    expect(await (await send("GET", "/shop/lamps/arc-lamp")).text()).toContain("Arc Lamp");
    const moved = await send("GET", "/shop/chairs/arc-lamp?ref=old");
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/shop/lamps/arc-lamp?ref=old");
    expect((await send("GET", "/products/arc-lamp")).status).toBe(404);
    expect((await send("GET", "/shop/lamps/no-such-lamp")).status).toBe(404);
  });

  it("keeps a template edit on the item's own address", async () => {
    const note = { path: "/shop/lamps/arc-lamp", scope: "template", nodeId: "product-note", kind: "text" };
    expect((await send("PUT", "/admin/api/nodes", { ...note, value: { text: "Made by hand." } }, { cookie })).ok).toBe(
      true,
    );

    expect(await (await send("GET", "/shop/lamps/arc-lamp")).text()).toContain("Made by hand.");
  });

  it("lets visitors narrow a listing by facet and search, and turn its pages, through the address", async () => {
    // The page has a second listing further down, drawn by the site's own controls; these look at the first.
    const shop = async (query: string) =>
      (await (await send("GET", `/shop${query}`)).text()).split('id="listing-shop-own"')[0];
    const first = await shop("");
    expect(first).toContain("2 results");
    expect(first).toContain(">Arc Lamp<");
    expect(first).not.toContain(">Bent Chair<");
    expect(first).toMatch(/href="\?page=2#listing-shop-products"/);

    const second = await shop("?page=2");
    expect(second).toContain(">Bent Chair<");
    expect(second).toContain('aria-current="page"');

    const chairs = await shop("?category=chairs");
    expect(chairs).toContain("1 results");
    expect(chairs).toMatch(/value="chairs" checked/);
    expect(chairs).toContain(">Bent Chair<");

    const searched = await shop("?q=ASH");
    expect(searched).toContain(">Bent Chair<");
    expect(searched).not.toContain(">Arc Lamp<");
    expect(await shop("?q=nothing-like-it")).toContain("Nothing matches");

    const own = await (await send("GET", "/shop?own-category=lamps")).text();
    expect(own).toContain('<p class="own-controls">1 products: Lamps (1), Chairs (1)</p>');
    expect(own).toContain('<span class="own-item">Arc Lamp</span>');
    expect(own).not.toContain('<span class="own-item">Bent Chair</span>');
  });

  it("keeps an upload in the storage, and draws it from the public address with smaller copies", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const upload = await fetch(`${origin}/admin/api/media`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "image/png", "x-file-name": "team.png" },
      body: png,
    });
    expect(upload.status).toBe(201);
    const { file } = (await upload.json()) as { file: { url: string } };
    expect(file.url).toMatch(/^\/uploads\/[\w-]+\.png$/);
    expect(stored).toEqual([
      {
        url: `/media/site-1${file.url}`,
        authorization: "Bearer storage-token",
        type: "image/png",
        size: png.byteLength,
      },
    ]);

    const redirect = await send("GET", file.url);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe(`https://media.example/site-1${file.url}`);

    const photo = { path: "/", scope: "page", nodeId: "team-photo", kind: "image" };
    expect(
      (await send("PUT", "/admin/api/nodes", { ...photo, value: { url: file.url, alt: "The team" } }, { cookie })).ok,
    ).toBe(true);
    const home = await (await send("GET", "/")).text();
    const cdn = `https://media.example/site-1${file.url}`;
    expect(home).toContain(`src="${cdn}"`);
    expect(home).toContain(`srcset="${cdn}?width=320 320w, ${cdn}?width=640 640w`);
    expect(home).toContain(`${cdn}?width=2560 2560w" sizes="100vw"`);

    // The editor's picker shows a small copy from the CDN, not the upload at its full size.
    const listed = await (await send("GET", "/admin/api/media", undefined, { cookie })).json();
    const picked = listed.files.find((entry: { url: string }) => entry.url === file.url);
    expect(picked.thumbnail).toBe(`${cdn}?width=320`);
  });

  it("never sends a photo wider than the widest copy as it was uploaded, in the page or a shared link", async () => {
    // A PNG's header alone, saying 4000 by 3000: a photo straight from a camera.
    const png = Buffer.alloc(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(4000, 16);
    png.writeUInt32BE(3000, 20);
    const upload = await fetch(`${origin}/admin/api/media`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "image/png", "x-file-name": "camera.png" },
      body: png,
    });
    expect(upload.status).toBe(201);
    const { file } = (await upload.json()) as { file: { url: string } };
    const cdn = `https://media.example/site-1${file.url}`;

    const photo = { path: "/", scope: "page", nodeId: "team-photo", kind: "image" };
    await send("PUT", "/admin/api/nodes", { ...photo, value: { url: file.url, alt: "The team" } }, { cookie });
    await send("PUT", "/admin/api/pages", { path: "/", seo: { image: file.url } }, { cookie });
    const home = await (await send("GET", "/")).text();
    const img = home.match(/<img class="team-photo"[^>]*>/)?.[0] ?? "";
    expect(img).toContain(`src="${cdn}?width=2560"`);
    expect(img).toContain(`${cdn}?width=1920 1920w, ${cdn}?width=2560 2560w" sizes="100vw"`);
    expect(img).toContain('width="4000" height="3000"');
    expect(img).not.toContain(`${cdn} 4000w`);
    expect(home).toContain(`<meta property="og:image" content="${cdn}?width=1200">`);
    expect(home).toContain(`<meta name="twitter:image" content="${cdn}?width=1200">`);

    await send("DELETE", "/admin/api/nodes", { path: "/", scope: "page", nodeId: "team-photo" }, { cookie });
    await send("PUT", "/admin/api/pages", { path: "/", seo: {} }, { cookie });
  });

  it("gives a picture of the site's own code smaller copies from Astro's image endpoint", async () => {
    const photo = { path: "/", scope: "page", nodeId: "team-photo", kind: "image" };
    const value = { url: "/photos/team.jpg", alt: "The team" };
    expect((await send("PUT", "/admin/api/nodes", { ...photo, value }, { cookie })).ok).toBe(true);
    const home = await (await send("GET", "/")).text();
    const copy = (width: number) => `/_image?href=%2Fphotos%2Fteam.jpg&amp;w=${width}&amp;f=webp&amp;q=75 ${width}w`;
    expect(home).toContain(`src="/photos/team.jpg" srcset="${copy(320)}, ${copy(640)}`);
    expect(home).toContain(`${copy(2560)}" sizes="100vw"`);
    // Another site's picture and a drawing are sent as they are.
    for (const url of ["https://other.example/team.jpg", "/team.svg"]) {
      await send("PUT", "/admin/api/nodes", { ...photo, value: { url, alt: "The team" } }, { cookie });
      const img = (await (await send("GET", "/")).text()).match(/<img class="team-photo"[^>]*>/)?.[0];
      expect(img).not.toContain("srcset");
    }
    await send("DELETE", "/admin/api/nodes", { path: "/", scope: "page", nodeId: "team-photo" }, { cookie });
  });

  it("shows the site's own settings on every page, and the owner's change at once", async () => {
    const home = await (await send("GET", "/")).text();
    expect(home).toContain('<a class="footer-phone" href="tel:+15550100"><span>+1 555 0100</span></a>');

    const fields = await (await send("GET", "/admin/api/site-settings", undefined, { cookie })).json();
    expect(fields.fields.map((field: { name: string }) => field.name)).toEqual(["phone", "email", "instagram"]);

    const saved = await send("PUT", "/admin/api/site-settings", { values: { phone: "+40 721 000 000" } }, { cookie });
    expect(saved.ok).toBe(true);
    expect(await (await send("GET", "/about", undefined, { cookie })).text()).toContain(
      'href="tel:+40721000000"><span data-brim-setting="phone" data-brim-setting-label="Phone">+40 721 000 000</span>',
    );
    expect(await (await send("GET", "/")).text()).not.toContain("data-brim-setting");

    await send("PUT", "/admin/api/site-settings", { values: { phone: null } }, { cookie });
    expect(await (await send("GET", "/")).text()).not.toContain("footer-phone");
    expect(
      (await send("PUT", "/admin/api/site-settings", { values: { email: "not an email" } }, { cookie })).status,
    ).toBe(422);
  });

  it("saves what is inside <Shared> once for the whole site", async () => {
    const editing = await (await send("GET", "/", undefined, { cookie })).text();
    expect(editing).toMatch(/<strong[^>]*data-brim-node="promo-title"[^>]*data-brim-scope="site"/);
    // Elements outside it keep their page.
    expect(editing).toMatch(/data-brim-node="hero-title"[^>]*data-brim-scope="page"/);

    const title = { path: "/", scope: "site", nodeId: "promo-title", kind: "text" };
    expect(
      (await send("PUT", "/admin/api/nodes", { ...title, value: { text: "Talk to us, free" } }, { cookie })).ok,
    ).toBe(true);
    expect(await (await send("GET", "/about", undefined, { cookie })).text()).toContain(">Talk to us, free</strong>");
  });

  it("opens the editor from ?edit, /edit and /admin, with an edit button for signed-in editors only", async () => {
    const page = await send("GET", "/about?edit");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/admin/edit/about");
    expect((await send("GET", "/edit")).headers.get("location")).toBe("/admin/edit");
    expect((await send("GET", "/admin")).headers.get("location")).toBe("/admin/edit");
    expect(await (await send("GET", "/")).text()).not.toContain("data-brim-edit-button");
    // A signed-in editor opening a page gets the button; the same page in the editor's frame does not.
    const signedIn = await (await send("GET", "/about", undefined, { cookie, "sec-fetch-dest": "document" })).text();
    expect(signedIn).toContain('<a href="/admin/edit/about" data-brim-edit-button');
    const framed = await (await send("GET", "/about", undefined, { cookie, "sec-fetch-dest": "iframe" })).text();
    expect(framed).not.toContain("data-brim-edit-button");
  });

  it("signs in with a one-time link and opens the editor on the page it names, only inside the editor", async () => {
    const brim = await connect(databaseUrl);
    const { token } = await brim.accounts.createSignInToken(EMAIL);
    const opened = await send(
      "GET",
      `/admin/api/session/link?token=${token}&to=${encodeURIComponent("/admin/edit/about")}`,
    );
    expect(opened.status).toBe(303);
    expect(opened.headers.get("location")).toBe("/admin/edit/about");
    expect(opened.headers.get("set-cookie")).toContain("brim_session=");

    const other = await brim.accounts.createSignInToken(EMAIL);
    const away = await send(
      "GET",
      `/admin/api/session/link?token=${other.token}&to=${encodeURIComponent("https://evil.test/")}`,
    );
    expect(away.headers.get("location")).toBe("/admin/edit");
  });

  it("shows an item's picked value with <Field> and saves it into the item from the page", async () => {
    const brim = await connect(databaseUrl);
    const lake = (await brim.items.list("project")).find((item) => item.slug === "lake-house")!;
    const year = { path: "/projects/lake-house", nodeId: "project-year", item: lake.id, field: "year" };
    try {
      const setYear = (value: unknown) =>
        send("PUT", "/admin/api/nodes", { ...year, kind: "field", value: { value } }, { cookie });
      const saved = await setYear(2024);
      expect(saved.status).toBe(200);

      const page = await (await send("GET", "/projects/lake-house")).text();
      expect(page).toMatch(/<span>2024<\/span>/);
      expect(page).not.toContain("data-brim");
      const editing = await (await send("GET", "/projects/lake-house", undefined, { cookie })).text();
      expect(editing).toMatch(
        /<span [^>]*data-brim-kind="field"[^>]*data-brim-field="year"[^>]*data-brim-label="Year"[^>]*>2024<\/span>/,
      );

      const wrong = await setYear("soon");
      expect(wrong.status).toBe(422);
      const unbound = { path: "/projects/lake-house", nodeId: "project-year", kind: "field", value: { value: 1 } };
      expect((await send("PUT", "/admin/api/nodes", unbound, { cookie })).status).toBe(422);
    } finally {
      await brim.items.update(lake, { ...lake, data: { summary: "A house by the lake" } });
    }
  });

  it("writes the class a page gives a block once, beside the block's own", async () => {
    const about = await (await send("GET", "/about", undefined, { cookie })).text();
    expect(about).toContain('class="brim-gallery about-gallery"');
    expect(about).toContain('class="brim-carousel about-carousel"');
    const project = await (await send("GET", "/projects/lake-house")).text();
    expect(project).toContain('class="brim-blocks project-content"');
    expect(`${about}${project}`).not.toMatch(
      /class="[^"]*\b(about-gallery|about-carousel|project-content)\b[^"]*\b\1\b/,
    );
  });

  it("makes the sitemap from the content as it is now", async () => {
    const xml = await (await send("GET", "/sitemap.xml")).text();

    expect(xml).toContain("https://acme.test/projects/lake-house");
    expect(xml).toContain("https://acme.test/shop/lamps/arc-lamp");
    expect(xml).not.toContain("secret-villa");
  });

  it("makes the RSS feed from the content as it is now, and nothing else under /rss", async () => {
    const response = await send("GET", "/rss/projects.xml");
    const xml = await response.text();

    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(xml).toContain("<link>https://acme.test/projects/lake-house</link>");
    expect(xml).not.toContain("secret-villa");
    expect((await send("GET", "/rss/services.xml")).status).toBe(404);
  });

  it("leaves file fields out of forms: this host keeps uploads in a storage and named no private one", async () => {
    const html = await (await send("GET", "/quote")).text();
    expect(html).toContain('name="wish"');
    expect(html).not.toContain('type="file"');
    const info = (await (await send("GET", "/admin/api/info")).json()) as { capabilities: string[] };
    expect(info.capabilities).not.toContain("form-files");
  });

  it("hands out form tokens", async () => {
    const body = (await (await send("GET", "/_brim/forms/token")).json()) as { token?: string; work?: number };

    expect(body.token).toMatch(/^\d+\./);
    expect(body.work).toBeGreaterThan(0);
  });

  it("answers 404 for an upload that reaches outside the folder, and leads any other to the public address", async () => {
    // Images are served from elsewhere here (BRIM_MEDIA_PUBLIC_URL): one this server does not have is there, or nowhere.
    const missing = await send("GET", "/uploads/missing.png");
    expect(missing.status).toBe(301);
    expect(missing.headers.get("location")).toBe("https://media.example/site-1/uploads/missing.png");
    expect((await send("GET", "/uploads/..%2f..%2fpackage.json")).status).toBe(404);
  });
});

describe("built server: redirects and passwords", () => {
  it("sends an old address to the new one, with the visitor's query", async () => {
    const redirects = [{ from: "/old-lawn", to: "/services/lawn-care" }];
    expect((await send("PUT", "/admin/api/redirects", { redirects }, { cookie })).status).toBe(200);

    const response = await send("GET", "/old-lawn?ref=mail");

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/services/lawn-care?ref=mail");
    await send("PUT", "/admin/api/redirects", { redirects: [] }, { cookie });
  });

  it("asks visitors for a page's password and opens it once they give it, while editors open it as it is", async () => {
    const path = "/services/lawn-care";
    await send("PUT", "/admin/api/pages", { path, password: "lawn-members" }, { cookie }); // betterleaks:allow
    try {
      const locked = await send("GET", path);
      const lockedHtml = await locked.text();
      expect(locked.status).toBe(401);
      expect(lockedHtml).toContain("This page is protected");
      expect(lockedHtml).not.toContain("Lawn care");

      const form = (password: string) => // betterleaks:allow
        fetch(`${origin}${path}`, {
          method: "POST",
          redirect: "manual",
          // What a browser sends with a form posted on the same site.
          headers: { "content-type": "application/x-www-form-urlencoded", origin, "sec-fetch-site": "same-origin" },
          body: new URLSearchParams({ brim_page_password: password }), // betterleaks:allow
        });
      expect((await form("wrong guess")).status).toBe(401);
      const opened = await form("lawn-members");
      expect(opened.status).toBe(303);
      const access = (opened.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      const visitor = await send("GET", path, undefined, { cookie: access });
      expect(visitor.status).toBe(200);
      expect(visitor.headers.get("cache-control")).toContain("no-store");
      expect((await send("GET", path, undefined, { cookie })).status).toBe(200);
      expect(await (await send("GET", "/sitemap.xml")).text()).not.toContain(path);
    } finally {
      await send("PUT", "/admin/api/pages", { path, password: null }, { cookie }); // betterleaks:allow
    }
  });
});
