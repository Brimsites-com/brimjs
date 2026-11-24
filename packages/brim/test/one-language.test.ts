import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect } from "../src/runtime/connect.ts";

// A new site declares its one language from the start: it builds and reads like a site without languages, with no
// prefix, and what the owner saved for the whole site before is still shown (kept as that language's).
const exampleRoot = fileURLToPath(new URL("../../../examples/basic/", import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), "brim-one-language-"));
const outDir = join(workDir, "dist");

beforeAll(async () => {
  const databaseUrl = `file:${join(workDir, "data.db")}`; // betterleaks:allow (a temporary test database)
  const { content, items } = await connect(databaseUrl);
  await items.create("project", {
    title: "Lake House",
    slug: "lake-house",
    visibility: "published",
    data: { summary: "By the lake" },
  });
  // Saved before the site declared a language: shared content without one.
  await content.saveNode("site", "navbar", "navbar", { logoText: "Saved Studio", items: [] });
  process.env.BRIM_DATABASE_URL = databaseUrl; // betterleaks:allow
  process.env.BRIM_OUTPUT = "static";
  await build({
    root: exampleRoot,
    outDir,
    logLevel: "silent",
    site: "https://acme.test",
    i18n: { defaultLocale: "en", locales: ["en"] },
  });
}, 120_000);

afterAll(() => {
  delete process.env.BRIM_DATABASE_URL;
  delete process.env.BRIM_OUTPUT;
  rmSync(workDir, { recursive: true, force: true });
});

it("builds a site with one declared language like one without, keeping what was saved before", () => {
  expect(existsSync(join(outDir, "projects", "lake-house", "index.html"))).toBe(true);
  expect(existsSync(join(outDir, "en"))).toBe(false);
  const home = readFileSync(join(outDir, "index.html"), "utf8");
  expect(home).toContain("Saved Studio");
  expect(home).not.toContain("hreflang");
});
