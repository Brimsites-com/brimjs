import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.ts";
import { pageScope, siteScope, typeScope } from "../src/content/ids.ts";
import { connect } from "../src/runtime/connect.ts";

const exampleRoot = fileURLToPath(new URL("../../../examples/basic/", import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), "brim-build-"));
const outDir = join(workDir, "dist");
/** An upload of the example site's own folder (git ignores it), measured by the build. */
const oldUpload = join(exampleRoot, "public/uploads/pine.jpg");

/** The first bytes of a PNG, as far as its size: enough to measure it. */
function pngHeader(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 0);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function page(path: string): string {
  return readFileSync(join(outDir, path), "utf8");
}

beforeAll(async () => {
  const databaseUrl = `file:${join(workDir, "data.db")}`; // betterleaks:allow (a temporary test database)
  const { content: store, items } = await connect(databaseUrl);
  await store.saveNode(pageScope("/"), "hero-title", "text", { text: "Edited by the owner <3" });
  await store.saveNode(pageScope("/"), "hero-lead", "text", {
    text: "Fast & <safe>",
    as: "h2",
    rich: ["Fast & ", { tag: "strong", children: ["<safe>"] }],
  });
  await store.saveNode(pageScope("/"), "hero-image", "image", {
    url: "/owner.jpg",
    alt: "Owner's photo",
    shape: "circle",
    opacity: 80,
  });
  await store.saveNode(pageScope("/"), "team-photo", "image", { url: "/uploads/team.jpg", alt: "Owner's team" });
  await store.saveNode(pageScope("/"), "hero-cta", "link", { href: "/contact", label: "Get in touch" });
  await store.saveNode(siteScope(), "navbar", "navbar", {
    logoText: "Owner Co",
    items: [
      { label: "Contact", href: "/contact" },
      {
        label: "Products",
        href: "/products",
        children: [
          { label: "Chairs", href: "/products/chairs", image: { src: "/chairs.jpg", alt: "A chair" } },
          { label: "Tables", href: "/products/tables" },
        ],
      },
    ],
  });
  await store.saveNode(pageScope("/"), "hero-button", "button", {
    text: "Owner's button",
    size: "lg",
    showIcon: false,
  });
  await store.saveNode(siteScope(), "site-settings", "site-settings", { instagram: "https://instagram.com/acme" });
  await store.setPageVisibility("/about", "private");
  await store.setPageSeo("/", {
    title: "Owner's title",
    description: "Seen in search results",
    image: "/uploads/share.jpg",
    shareTitle: "Owner's shared title",
    noindex: true,
    nofollow: true,
  });
  const data = { summary: "A house by the lake" };
  const content = [
    { id: "b1", type: "richtext", value: { blocks: [{ tag: "p", children: ["Built on the shore in 2024."] }] } },
    { id: "b2", type: "image", value: { url: "/shore.jpg", alt: "The shore", shape: "circle" } },
  ];
  await items.create("project", {
    title: "Lake House",
    slug: "lake-house",
    visibility: "published",
    data: { ...data, content, author: "Ana Pop" },
  });
  await items.create("project", { title: "Secret Villa", slug: "secret-villa", visibility: "private", data });
  await items.create("project", {
    title: "Pine Cabin",
    slug: "pine-cabin",
    visibility: "published",
    data: {
      summary: "A cabin in the pines",
      cover: { src: "/uploads/pine.jpg", alt: "The cabin" },
      tags: ["Pines", "Wood"],
    },
  });
  // Lake House has no cover: its card takes the preview image its page's shared links show.
  await store.setPageSeo("/projects/lake-house", { image: "/uploads/lake-share.jpg" });
  await store.saveNode(typeScope("project"), "project-title", "text", { text: "", as: "h2" });
  await store.createPage("/services/lawn-care", "service", "Lawn care", "published");
  await store.saveNode(pageScope("/services/lawn-care"), "service-lead", "text", { text: "Mowing every week" });
  await store.createPage("/services/draft", "service", "Draft service", "private");
  await store.createPage("/services/orphan", "removed-template", "Orphan", "published");
  await store.createPage("/services/members", "service", "Members", "published");
  await store.saveNode(pageScope("/services/members"), "service-lead", "text", { text: "Only for members" });
  await store.setPagePassword("/services/members", await hashPassword("members-only"));
  await store.createPage("/services/copy", "service", "Copy", "published");
  await store.setPageSeo("/services/copy", { canonical: "/services/lawn-care" });

  // What the media library measured: the team photo is a portrait. The cabin was uploaded before sizes were kept:
  // the build measures its file in the uploads folder. An image whose file is nowhere must not stop the build.
  const { db } = await connect(databaseUrl);
  const media =
    "INSERT INTO brim_media (id, url, name, mime, size, created_at, width, height) VALUES (?, ?, ?, ?, 1, ?, ?, ?)";
  await db.query(media, ["team", "/uploads/team.jpg", "team.jpg", "image/jpeg", new Date().toISOString(), 1707, 2560]);
  await db.query(media, ["pine", "/uploads/pine.jpg", "pine.jpg", "image/jpeg", new Date().toISOString(), null, null]);
  // A fresh checkout has no uploads folder: git ignores it.
  mkdirSync(dirname(oldUpload), { recursive: true });
  writeFileSync(oldUpload, pngHeader(2560, 1707));
  await db.query(media, ["gone", "/uploads/gone.jpg", "gone.jpg", "image/jpeg", new Date().toISOString(), null, null]);

  process.env.BRIM_DATABASE_URL = databaseUrl; // betterleaks:allow
  process.env.BRIM_OUTPUT = "static";
  await build({ root: exampleRoot, outDir, logLevel: "silent", site: "https://acme.test" });
}, 120_000);

afterAll(() => {
  rmSync(oldUpload, { force: true });
  delete process.env.BRIM_DATABASE_URL;
  delete process.env.BRIM_OUTPUT;
  rmSync(workDir, { recursive: true, force: true });
});

describe("static build", () => {
  it("draws a form asked in steps: a tab and a fieldset per step, half-width fields, help under a question", () => {
    const html = page("quote/index.html");
    expect(html).toContain("data-stepped");
    expect(html.match(/class="brim-form__tab"/g)).toHaveLength(2);
    expect(html.match(/<fieldset class="brim-form__step" data-step="\d"/g)).toHaveLength(2);
    expect(html).toContain('<p class="brim-form__step-intro">Start with the place.</p>');
    expect(html).toMatch(/data-type="number" data-width="half" data-name="size"/);
    expect(html).toMatch(/aria-describedby="quote-form-wish-help"/);
    expect(html).toContain('<p class="brim-form__help" id="quote-form-wish-help">A sentence is enough.</p>');
    expect(html).toMatch(/data-back-step[^>]*>\s*Back/);
    expect(html).toMatch(/data-next-step[^>]*>\s*Continue/);
    // The server is told the questions only, not the steps or how they are laid out.
    const spec = JSON.parse(Buffer.from(/data-spec="([^"]+)"/.exec(html)?.[1] ?? "", "base64url").toString());
    expect(spec.fields.map((field: { name: string }) => field.name)).toEqual(["size", "city", "wish", "name", "email"]);
    expect(JSON.stringify(spec)).not.toMatch(/half|help|step/);
    // A static copy has no server to take a visitor's file: the form's file field is left out.
    expect(html).not.toContain('type="file"');
  });

  it("draws the search box alone on a static copy, which has no address to read words from", () => {
    const html = page("quote/index.html");
    expect(html).toContain('<form class="brim-search__box" role="search" method="get">');
    expect(html).toContain("Search projects");
    expect(html).not.toContain("brim-search__results");
  });

  it("draws an icon from a pack the site added, with the pack's own size and look", () => {
    const project = page("projects/lake-house/index.html");
    const icon = project.slice(project.indexOf('class="brim-icon"'));
    const svg = icon.slice(icon.indexOf("<svg"), icon.indexOf("</svg>"));

    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('d="M16 2l3.5 10.5L30 16l-10.5 3.5L16 30l-3.5-10.5L2 16l10.5-3.5z"');
    // Only Brim's own outlines are stroked by the block.
    expect(svg).not.toContain("stroke-width");
  });

  it("renders the owner's content instead of the source defaults", () => {
    const html = page("index.html");

    expect(html).toContain("Edited by the owner &lt;3");
    expect(html).not.toContain("Websites your clients can edit");
    expect(html).toContain('src="/owner.jpg"');
    expect(html).toContain('alt="Owner\'s photo"');
    // The shape and opacity saved by BrimCMS are the site's CSS now: they are read without them.
    expect(html).not.toContain("--brim-image-opacity");
    expect(html).toContain('<a href="/contact">Get in touch</a>');
  });

  it("renders formatted text as escaped markup in the element the owner chose", () => {
    expect(page("index.html")).toContain("<h2>Fast &amp; <strong>&lt;safe&gt;</strong></h2>");
  });

  it("renders a block from its defaults, the page's code and the owner's settings, in that order", () => {
    const html = page("index.html");

    // size comes from the owner, variant and url from the page's code, the icon was switched off by the owner.
    expect(html).toContain('<a href="/about" class="brim-btn brim-btn--accent brim-btn--lg">');
    expect(html).toContain("Owner&#39;s button");
    expect(html).not.toContain("<svg");
  });

  it("loads the picture marked priority at once and ahead of the others, which wait", () => {
    const html = page("index.html");
    const hero = html.match(/<figure class="brim-image"[^>]*>\s*<span class="brim-image__frame">\s*<img[^>]*>/)?.[0];
    expect(hero).toContain('loading="eager" fetchpriority="high"');
    expect(html.match(/fetchpriority="high"/g)).toHaveLength(1);
    expect(html).toContain('loading="lazy"');
  });

  it("draws a bare image as the site's own <img>, with the owner's picture and no frame", () => {
    const html = page("index.html");
    expect(html).toMatch(
      /<img class="team-photo" loading="eager" src="\/uploads\/team.jpg" alt="Owner's team" width="1707" height="2560">/,
    );
    expect(html).not.toMatch(/<figure[^>]*>\s*<span class="brim-image__frame">\s*<img[^>]*team\.jpg/);
  });

  it("keeps the code's srcset with its starting picture only, never with the owner's", () => {
    const html = page("index.html");
    const team = html.match(/<img class="team-photo"[^>]*>/)?.[0] ?? "";
    expect(team).toContain('src="/uploads/team.jpg"');
    expect(team).not.toContain("srcset");
    const studio = html.match(/<img class="studio-photo"[^>]*>/)?.[0] ?? "";
    expect(studio).toContain('srcset="/hero.svg 640w, /hero.svg 1280w"');
    expect(studio.match(/sizes=/g)).toHaveLength(1);
  });

  it("keeps source defaults where the owner changed nothing", () => {
    expect(page("index.html")).toContain("<footer><div><strong>Acme Studio</strong>");
  });

  it("feeds site-wide data to the navbar markup", () => {
    const html = page("index.html");

    expect(html).toContain('<a href="/">Owner Co</a>');
    expect(html).toContain('<a href="/contact">Contact</a>');
  });

  it("hands the navbar markup each item's sub-links and pictures", () => {
    const html = page("index.html");

    expect(html).toContain('<a href="/products">Products</a>');
    expect(html).toContain('<a href="/products/chairs"><img src="/chairs.jpg" alt="A chair">Chairs</a>');
    expect(html).toContain('<a href="/products/tables">Tables</a>');
  });

  it("leaves no trace of the editor on the public site", () => {
    const html = page("index.html");

    // Statistics are off without BRIM_GOOGLE_ANALYTICS_ID: no banner and no script.
    expect(html).not.toContain("brim-analytics");
    // Search engines' structured data and Astro's prefetch are the only scripts; nothing of the editor's.
    const prefetch = html.match(/<script type="module" src="(\/_astro\/page\.[^"]+\.js)"><\/script>/);
    expect(readFileSync(join(outDir, prefetch?.[1] ?? "missing"), "utf8")).toContain("prefetch");
    const scripts = html
      .replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, "")
      .replace(prefetch?.[0] ?? "", "");
    expect(scripts).not.toContain("<script");
    expect(html).not.toContain("data-brim");
    expect(existsSync(join(outDir, "admin"))).toBe(false);
  });

  it("uses the owner's SEO settings in the page head", () => {
    const html = page("index.html");

    expect(html).toContain("<title>Owner&#39;s title</title>");
    expect(html).toContain('<meta name="description" content="Seen in search results">');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<link rel="canonical" href="https://acme.test/">');
  });

  it("describes the site to search engines on the home page", () => {
    const html = page("index.html");

    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain(
      '"@type":"WebSite","name":"Acme Studio","alternateName":["AcmeStudio"],"url":"https://acme.test/"',
    );
    // The profile is the owner's, from Site Settings.
    expect(html).toContain('"sameAs":["https://instagram.com/acme"]');
    expect(page("services/lawn-care/index.html")).not.toContain("application/ld+json");
  });

  it("points a page at its canonical address and leaves it out of the sitemap", () => {
    expect(page("services/copy/index.html")).toContain(
      '<link rel="canonical" href="https://acme.test/services/lawn-care">',
    );
    expect(page("sitemap.xml")).not.toContain("/services/copy<");
  });

  it("leaves a password-protected page out of a static build, which has no server to ask for it", () => {
    const html = page("services/members/index.html");

    expect(html).toContain("This page is protected");
    expect(html).not.toContain("Only for members");
    expect(page("sitemap.xml")).not.toContain("/services/members");
  });

  it("gives link previews the owner's title, description and preview image", () => {
    const html = page("index.html");

    expect(html).toContain(`<meta property="og:title" content="Owner's shared title">`);
    expect(html).toContain('<meta property="og:description" content="Seen in search results">');
    expect(html).toContain('<meta property="og:image" content="https://acme.test/uploads/share.jpg">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`<meta name="twitter:title" content="Owner's shared title">`);
    expect(html).toContain('<meta name="twitter:image" content="https://acme.test/uploads/share.jpg">');
    // The editor's own copy of the settings never reaches the public site.
    expect(html).not.toContain("brim-seo");
  });

  it("lists published items and builds a page for each", () => {
    const html = page("index.html");

    expect(html).toContain('href="/projects/lake-house"');
    expect(html).toContain("Lake House");
    expect(page("projects/lake-house/index.html")).toContain("A house by the lake");
    // The type's template, as the owner changed it.
    expect(page("projects/lake-house/index.html")).toContain("<h2>Lake House</h2>");
  });

  it("draws the blocks the owner stacked in an item's field, in their order", () => {
    const html = page("projects/lake-house/index.html");
    const text = html.indexOf("<p>Built on the shore in 2024.</p>");

    expect(text).toBeGreaterThan(-1);
    expect(html.indexOf('src="/shore.jpg"')).toBeGreaterThan(text);
    expect(html).toContain('alt="The shore"');
    // Each block sits in the field as the owner placed it, its picture downloaded at that width.
    expect(html).toMatch(
      /<div class="brim-block" data-width="content" data-align="center">\s*<figure class="brim-image">/,
    );
  });

  it("gives an item's shared links its own picture, unless its page has a preview image", () => {
    expect(page("projects/pine-cabin/index.html")).toContain(
      '<meta property="og:image" content="https://acme.test/uploads/pine.jpg">',
    );
    expect(page("projects/lake-house/index.html")).toContain(
      '<meta property="og:image" content="https://acme.test/uploads/lake-share.jpg">',
    );
  });

  it("names an item's author for search engines, and no one when it has none", () => {
    expect(page("projects/lake-house/index.html")).toContain('<meta name="author" content="Ana Pop">');
    expect(page("projects/pine-cabin/index.html")).not.toContain('name="author"');
    expect(page("index.html")).not.toContain('name="author"');
  });

  it("shows an item's tags as labels on its card, and none on a card without tags", () => {
    const html = page("index.html");
    const pine = html.slice(html.indexOf("Pine Cabin"), html.indexOf("</a>", html.indexOf("Pine Cabin")));
    const lake = html.slice(html.indexOf("Lake House"), html.indexOf("</a>", html.indexOf("Lake House")));

    expect(pine).toContain('<span class="brim-listing__tag">Pines</span><span class="brim-listing__tag">Wood</span>');
    expect(lake).not.toContain("brim-listing__tag");
  });

  it("shows a card without a picture of its own with its page's preview image", () => {
    const html = page("index.html");

    expect(html).toContain('src="/uploads/pine.jpg" width="2560" height="1707" alt="The cabin"');
    expect(html).toContain('src="/uploads/lake-share.jpg" alt="Lake House"');
  });

  it("keeps private items out of listings and gives them no page", () => {
    expect(page("index.html")).not.toContain("Secret Villa");
    expect(existsSync(join(outDir, "projects", "secret-villa"))).toBe(false);
  });

  it("builds published pages added from a template, with their own title and content", () => {
    const html = page("services/lawn-care/index.html");

    expect(html).toContain("<title>Lawn care — Acme Studio</title>");
    expect(html).toContain("<h1>Lawn care</h1>");
    expect(html).toContain("Mowing every week");
    expect(html).not.toContain("data-brim");
  });

  it("leaves private template pages, and pages whose template is gone, out of the build", () => {
    expect(existsSync(join(outDir, "services", "draft"))).toBe(false);
    expect(existsSync(join(outDir, "services", "orphan"))).toBe(false);
  });

  it("writes a sitemap of the published pages search engines may list", () => {
    const sitemap = page("sitemap.xml");

    expect(sitemap).toContain("<loc>https://acme.test/services/lawn-care</loc>");
    expect(sitemap).toMatch(
      /<loc>https:\/\/acme\.test\/projects\/lake-house<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/,
    );
    // The home page asks search engines not to list it; the others are private or have no template.
    for (const hidden of ["/about", "/services/draft", "/services/orphan", "/projects/secret-villa"]) {
      expect(sitemap).not.toContain(hidden);
    }
    expect(sitemap).not.toContain("<loc>https://acme.test/</loc>");
  });

  it("writes the RSS feed of a type that has one, with its published items only", () => {
    const feed = page("rss/projects.xml");

    expect(feed).toContain('<rss version="2.0"');
    expect(feed).toContain('<atom:link href="https://acme.test/rss/projects.xml" rel="self"');
    expect(feed).toContain("<link>https://acme.test/projects/lake-house</link>");
    expect(feed).toContain("<description>A cabin in the pines</description>");
    expect(feed).toContain('<media:content url="https://acme.test/uploads/pine.jpg" medium="image" />');
    expect(feed).not.toContain("Secret Villa");
  });

  it("points browsers and feed readers at the feed from every page", () => {
    const link =
      '<link rel="alternate" type="application/rss+xml" title="Acme Studio · Projects" href="https://acme.test/rss/projects.xml">';
    expect(page("index.html")).toContain(link);
    expect(page("projects/lake-house/index.html")).toContain(link);
  });

  it("points crawlers at the sitemap and away from the editor", () => {
    expect(page("robots.txt")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: https://acme.test/sitemap.xml\n",
    );
  });

  it("leaves private pages out of the public site", () => {
    expect(existsSync(join(outDir, "about", "index.html"))).toBe(false);
    expect(existsSync(join(outDir, "about.html"))).toBe(false);
  });
});
