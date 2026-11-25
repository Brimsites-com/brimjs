import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestedPage } from "../src/content/ids.ts";
import { connect } from "../src/runtime/connect.ts";

describe("the page an address asks for", () => {
  it("is the same with .html after it, unless the route itself ends so", () => {
    expect(requestedPage("/about", "/about")).toBe("/about");
    expect(requestedPage("/about.html", "/about")).toBe("/about");
    expect(requestedPage("/projects/lake-house.html", "/[...page]")).toBe("/projects/lake-house");
    expect(requestedPage("/notes/n1.html", "/notes/[slug]")).toBe("/notes/n1");
    expect(requestedPage("/about/index.html", "/about")).toBe("/about");
    expect(requestedPage("/.html", "/")).toBe("/");
    expect(requestedPage("/feed/latest.html", "/feed/[name].html")).toBe("/feed/latest.html");
  });
});

// Astro answers every page at its address with `.html` too in a site built with `build.format: "file"`.
describe("built server of a site whose pages are files", () => {
  const exampleRoot = fileURLToPath(new URL("../../../examples/basic/", import.meta.url));
  const folder = mkdtempSync(join(tmpdir(), "brim-page-address-"));
  const databaseUrl = `file:${join(folder, "data.db")}`; // betterleaks:allow (a temporary test database)
  let server: ChildProcess;
  let origin: string;

  beforeAll(async () => {
    const { content } = await connect(databaseUrl);
    await content.setPageVisibility("/about", "private");
    await content.setPageSeo("/shop", { title: "Owner's title", noindex: true });
    const outDir = join(folder, "dist");
    await build({ root: exampleRoot, outDir, logLevel: "silent", build: { format: "file" } });
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer().on("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => resolve(free));
      });
    });
    origin = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [join(outDir, "server", "entry.mjs")], {
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), BRIM_DATABASE_URL: databaseUrl }, // betterleaks:allow
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await fetch(`${origin}/admin/api/info`).then(
          ({ ok }) => ok,
          () => false,
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 120_000);

  afterAll(() => {
    server?.kill();
    rmSync(folder, { recursive: true, force: true });
  });

  it("keeps a private page from visitors however its address is written", async () => {
    for (const path of ["/about", "/about/", "/about.html", "/about%2ehtml", "/about.%68tml", "/about/index.html"]) {
      expect((await fetch(`${origin}${path}`, { redirect: "manual" })).status, path).not.toBe(200);
    }
    expect((await fetch(`${origin}/shop.html`)).status).toBe(200);
  });

  it("draws what the owner saved for the page at either address", async () => {
    for (const path of ["/shop", "/shop.html"]) {
      const html = await (await fetch(`${origin}${path}`)).text();
      expect(html, path).toContain("Owner&#39;s title");
      expect(html, path).toContain("noindex");
    }
  });

  it("has no cache hand on a sitemap or robots.txt that names the address it was asked at", async () => {
    for (const path of ["/sitemap.xml", "/robots.txt"]) {
      const answer = await fetch(`${origin}${path}`, { headers: { "x-forwarded-host": "evil.test" } });
      expect(answer.headers.get("cache-control"), path).toBe("no-store");
    }
  });
});
