import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typeScope } from "../src/content/ids.ts";
import { connect } from "../src/runtime/connect.ts";

// The example site, built with two languages: the pages of its projects come from their type's template.
const exampleRoot = fileURLToPath(new URL("../../../examples/basic/", import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), "brim-languages-"));
const outDir = join(workDir, "dist");

function page(path: string): string {
  return readFileSync(join(outDir, path), "utf8");
}

beforeAll(async () => {
  const databaseUrl = `file:${join(workDir, "data.db")}`; // betterleaks:allow (a temporary test database)
  const { content, items } = await connect(databaseUrl);
  const english = await items.create("project", {
    title: "Lake House",
    slug: "lake-house",
    visibility: "published",
    data: { summary: "A house by the lake" },
  });
  await items.create(
    "project",
    { title: "Casa de la lac", slug: "casa-de-la-lac", visibility: "published", data: { summary: "O casă la lac" } },
    { locale: "ro", translationOf: english.id },
  );
  await content.saveNode(typeScope("project", "en"), "project-title", "text", { text: "", as: "h2" });
  await content.saveNode(typeScope("project", "ro"), "project-title", "text", { text: "", as: "h3" });
  await content.createPage("/services/lawn-care", "service", "Lawn care", "published");
  await content.createPage("/ro/services/lawn-care", "service", "Tuns gazonul", "published");

  process.env.BRIM_DATABASE_URL = databaseUrl; // betterleaks:allow
  process.env.BRIM_OUTPUT = "static";
  await build({
    root: exampleRoot,
    outDir,
    logLevel: "silent",
    site: "https://acme.test",
    i18n: { defaultLocale: "en", locales: ["en", "ro"] },
  });
}, 120_000);

afterAll(() => {
  delete process.env.BRIM_DATABASE_URL;
  delete process.env.BRIM_OUTPUT;
  rmSync(workDir, { recursive: true, force: true });
});

describe("a site with languages", () => {
  it("draws each item's page under its language, with the template as the owner changed it there", () => {
    expect(page("projects/lake-house/index.html")).toContain("<h2>Lake House</h2>");
    expect(page("ro/projects/casa-de-la-lac/index.html")).toContain("<h3>Casa de la lac</h3>");
    expect(existsSync(join(outDir, "ro", "projects", "lake-house"))).toBe(false);
    expect(existsSync(join(outDir, "projects", "casa-de-la-lac"))).toBe(false);
  });

  it("lists the items' pages in every language in the sitemap", () => {
    const sitemap = page("sitemap.xml");

    expect(sitemap).toContain("<loc>https://acme.test/projects/lake-house</loc>");
    expect(sitemap).toContain("<loc>https://acme.test/ro/projects/casa-de-la-lac</loc>");
  });

  it("links each page to its versions in the other languages, where it has them", () => {
    const english = page("services/lawn-care/index.html");
    const romanian = page("ro/services/lawn-care/index.html");
    const links = [
      '<link rel="alternate" hreflang="en" href="https://acme.test/services/lawn-care">',
      '<link rel="alternate" hreflang="ro" href="https://acme.test/ro/services/lawn-care">',
      '<link rel="alternate" hreflang="x-default" href="https://acme.test/services/lawn-care">',
    ];
    for (const link of links) {
      expect(english).toContain(link);
      expect(romanian).toContain(link);
    }
    // The home page has no Romanian version in this site.
    expect(page("index.html")).not.toContain("hreflang");
  });
});
