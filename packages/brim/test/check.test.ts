import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSite, formatReport, parseSource } from "../src/check.ts";
import { isUnchanged, readStarter, starterManifest } from "../src/starter.ts";

function site(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "brim-check-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), content);
  }
  return directory;
}

// Most tests leave the starter comparison out; it has its own tests below.
const check = (files: Record<string, string>) => checkSite(site(files), { starter: [], git: false });
const rules = (report: ReturnType<typeof checkSite>) =>
  report.findings.map(({ file, line, rule, nodeId }) => ({ file, line, rule, nodeId }));

describe("brim check: reading the source", () => {
  it("reads nodeIds written each way, with their scope and line", () => {
    const { elements } = parseSource(
      "src/pages/index.astro",
      [
        "---",
        'import { Text } from "@brimsites/brimjs/components";',
        'const title = `<Text nodeId="in-frontmatter" />`;',
        "---",
        '<Text nodeId="double" as="h1">A</Text>',
        "<Text nodeId='single'>B</Text>",
        '<Text nodeId={"braced"} scope="site">C</Text>',
        "<Text nodeId={`backtick`}>D</Text>",
        "<Text nodeId={`${id}-title`}>E</Text>",
        "<Text nodeId={ids[index]} class={`x ${y > 2 ? 'a' : 'b'}`}>F</Text>",
        '<!-- <Text nodeId="commented" /> -->',
        '{/* <Text nodeId="commented-too" /> */}',
        '<script>if (a <b) console.log("<Text nodeId=\\"in-script\\" />");</script>',
        '<Navbar nodeId="nav" items={[]} />',
        '<SocialMedia nodeId="share" scope="page" />',
      ].join("\n"),
    );
    const ids = elements
      .filter((element) => element.nodeId)
      .map(({ nodeId, scope, line }) => ({ nodeId, scope, line }));
    expect(ids).toEqual([
      { nodeId: { kind: "literal", value: "double" }, scope: "page", line: 5 },
      { nodeId: { kind: "literal", value: "single" }, scope: "page", line: 6 },
      { nodeId: { kind: "literal", value: "braced" }, scope: "site", line: 7 },
      { nodeId: { kind: "literal", value: "backtick" }, scope: "page", line: 8 },
      { nodeId: { kind: "prefixed", prop: "id", suffix: "-title" }, scope: "page", line: 9 },
      { nodeId: { kind: "dynamic" }, scope: "page", line: 10 },
      { nodeId: { kind: "literal", value: "nav" }, scope: "site", line: 14 },
      { nodeId: { kind: "literal", value: "share" }, scope: "page", line: 15 },
    ]);
  });

  it("reads JSX in .tsx files, skipping comments", () => {
    const { elements, imports } = parseSource(
      "src/components/Card.tsx",
      [
        'import Inner, { Other as Renamed } from "./Inner.tsx";',
        '// <Text nodeId="commented" />',
        "export function Card() {",
        '  return items.length < 3 ? <Text nodeId="card-title" /> : <Inner id="x" />;',
        "}",
      ].join("\n"),
    );
    expect(elements.filter((element) => element.nodeId).map((element) => element.line)).toEqual([4]);
    expect([...imports]).toEqual([
      ["Inner", "./Inner.tsx"],
      ["Renamed", "./Inner.tsx"],
    ]);
  });
});

describe("brim check: duplicates", () => {
  it("finds a nodeId used twice in one file, and exits with errors", () => {
    const report = check({
      "src/pages/index.astro": '<Text nodeId="hero-title">A</Text>\n<p>x</p>\n<Text nodeId="hero-title">B</Text>\n',
    });
    expect(rules(report)).toEqual([
      { file: "src/pages/index.astro", line: 3, rule: "duplicate", nodeId: "hero-title" },
    ]);
    expect(report.errors).toBe(1);
    expect(formatReport(report)).toContain('nodeId "hero-title" is used 2 times on this page: line 1, line 3');
  });

  it("takes one item field shown in the two branches of a condition for one value", () => {
    const report = check({
      "src/content-types/CategoryPage.astro": [
        "{wide ? (",
        '  <Text nodeId="category-title" item={item} field="title" as="h1" class="wide" />',
        ") : (",
        '  <Text nodeId="category-title" item={item} field="title" as="h1" />',
        ")}",
        '<Text nodeId="other" item={item} field="title" />',
        '<Text nodeId="other" item={item} field="intro" />',
      ].join("\n"),
    });
    // The same nodeId on two different fields is still two values.
    expect(rules(report)).toEqual([
      { file: "src/content-types/CategoryPage.astro", line: 7, rule: "duplicate", nodeId: "other" },
    ]);
  });

  it("does not mix page and site scopes, or count dynamic ids", () => {
    const report = check({
      "src/pages/index.astro": [
        '<Text nodeId="phone">A</Text>',
        '<Text nodeId="phone" scope="site">B</Text>',
        "<Text nodeId={`${id}-a`}>C</Text>",
        "<Text nodeId={`${id}-a`}>D</Text>",
      ].join("\n"),
    });
    expect(report.findings).toEqual([]);
    expect(report.dynamicIds).toBe(2);
    expect(report.resolvedDynamicIds).toBe(0);
    expect(formatReport(report)).toContain("2 nodeIds built at run time");
  });

  it("follows local components into the pages that use them, reporting once", () => {
    const report = check({
      "src/layouts/Site.astro": '---\nimport Header from "../components/Header.astro";\n---\n<Header /><slot />',
      "src/components/Header.astro": '<Text nodeId="intro">Hi</Text>',
      "src/pages/index.astro":
        '---\nimport Site from "../layouts/Site.astro";\n---\n<Site>\n  <Text nodeId="intro">Again</Text>\n</Site>',
      "src/pages/about.astro":
        '---\nimport Site from "../layouts/Site.astro";\n---\n<Site><Text nodeId="intro" /></Site>',
    });
    expect(rules(report)).toEqual([
      { file: "src/pages/about.astro", line: 4, rule: "duplicate", nodeId: "intro" },
      { file: "src/pages/index.astro", line: 5, rule: "duplicate", nodeId: "intro" },
    ]);
    expect(report.findings[1]?.message).toBe(
      'nodeId "intro" is used 2 times on this page: src/components/Header.astro:1 (through <Site> at line 4), line 5',
    );
  });

  it("resolves ids prefixed with a prop passed as a literal", () => {
    const hero = '---\nconst { id } = Astro.props;\n---\n<Text nodeId={`${id}-title`} as="h1" />';
    const report = check({
      "src/components/Hero.astro": hero,
      "src/pages/index.astro":
        '---\nimport Hero from "../components/Hero.astro";\n---\n<Hero id="home" />\n<Hero id="home" />\n<Text nodeId="home-title" />',
      "src/pages/about.astro":
        '---\nimport Hero from "../components/Hero.astro";\n---\n<Hero id="about" />\n<Hero id="team" />',
    });
    expect(rules(report)).toEqual([
      { file: "src/pages/index.astro", line: 6, rule: "duplicate", nodeId: "home-title" },
    ]);
    expect(report.findings[0]?.message).toContain("used 3 times");
    expect(report.resolvedDynamicIds).toBe(1);
  });

  it("finds two different site-wide elements with one id anywhere in the site", () => {
    const report = check({
      "src/components/Header.astro": '<Text nodeId="phone" scope="site">1</Text><Navbar nodeId="menu" items={[]} />',
      "src/components/Footer.astro": '<Text nodeId="phone" scope="site">2</Text>',
      // One site-wide element drawn on many pages is the same element, not a duplicate.
      "src/pages/a.astro": '---\nimport Header from "../components/Header.astro";\n---\n<Header />',
      "src/pages/b.astro": '---\nimport Header from "../components/Header.astro";\n---\n<Header />',
    });
    expect(rules(report)).toEqual([
      { file: "src/components/Footer.astro", line: 1, rule: "site-duplicate", nodeId: "phone" },
    ]);
    expect(report.findings[0]?.message).toContain("src/components/Header.astro:1");
  });
});

describe("brim check: names", () => {
  it("warns about ids that name a position or carry a generated id", () => {
    const report = check({
      "src/pages/index.astro": [
        '<Text nodeId="text-3" />',
        '<Text nodeId="hero-p-2" />',
        '<Text nodeId="div4" />',
        '<Text nodeId="features-item-2-title" />',
        '<Text nodeId="block-3f2a9c1e-7b4d-4e5f-9a8b-1c2d3e4f5a6b" />',
        '<Text nodeId="Hero_Title" />',
        '<Text nodeId="hero-title" />',
        '<Text nodeId="step-1-title" />',
        '<Text nodeId="section-h2" />',
        '<Text nodeId="b2b-offer" />',
      ].join("\n"),
    });
    expect(rules(report).map(({ line, rule }) => `${line} ${rule}`)).toEqual([
      "1 positional",
      "2 positional",
      "3 positional",
      "4 positional",
      "5 positional",
      "6 format",
    ]);
    expect(report.errors).toBe(0);
  });
});

describe("brim check: uploads named in the code", () => {
  it("warns once per file about media library addresses, in markup, data modules and JSON", () => {
    const report = check({
      "src/data/media.ts": [
        "// The photos are uploaded: /uploads/not-this-one.webp",
        "export const media = {",
        '  "hero-0": "/uploads/c5ec0de6-b7db-41a4-86a2-a107dd210394.webp",',
        '  "hero-1": `/uploads/${"x"}.webp`,',
        "};",
      ].join("\n"),
      "src/pages/index.astro": '<Image nodeId="hero" src="https://acme.test/uploads/a.jpg" alt="" />',
      "src/data/items.json": '[{ "cover": { "src": "/uploads/b.png" } }]',
      "src/pages/about.astro": '<img src="/images/team.jpg" alt="" /><p>Our /uploads/ policy</p>',
    });
    const found = report.findings.filter((finding) => finding.rule === "uploads-in-code");

    expect(found.map(({ file, line }) => ({ file, line }))).toEqual([
      { file: "src/data/items.json", line: 1 },
      { file: "src/data/media.ts", line: 3 },
      { file: "src/pages/index.astro", line: 1 },
    ]);
    expect(found[1]?.message).toMatch(/^2 addresses of the media library/);
    expect(found.every((finding) => finding.severity === "warning")).toBe(true);
    expect(report.errors).toBe(0);
  });
});

describe("brim check: images of the content drawn by hand", () => {
  it("warns once per file about <img src={mediaUrl(…)}>, and leaves Image and imageSources alone", () => {
    const report = check({
      "src/components/Card.astro": [
        "---",
        'import { mediaUrl } from "@brimsites/brimjs/content";',
        "---",
        '<a href={item.url} class="card">',
        '  {item.data.cover && <img src={mediaUrl(item.data.cover.src)} alt={item.data.cover.alt} loading="lazy" />}',
        '  <img class="thumb"',
        '    src={ mediaUrl(item.data.thumb.src) } alt="" />',
        "</a>",
      ].join("\n"),
      "src/pages/index.astro": [
        '<Image bare nodeId="cover" item={item} field="cover" src="" alt="" />',
        '<img {...imageSources(item.data.cover.src, "33vw")} alt="" />',
        '<img src="/images/logo.svg" alt="" />',
        "<a href={mediaUrl(file.src)}>Download</a>",
      ].join("\n"),
    });
    const found = report.findings.filter((finding) => finding.rule === "hand-drawn-image");
    expect(found.map(({ file, line, severity }) => ({ file, line, severity }))).toEqual([
      { file: "src/components/Card.astro", line: 5, severity: "warning" },
    ]);
    expect(found[0]?.message).toMatch(/^2 images of the content/);
    expect(found[0]?.message).toMatch(/<Image bare/);
  });
});

describe("brim check: images without sizes", () => {
  it("warns once per file about Brim's <Image> without sizes, and leaves the others alone", () => {
    const report = check({
      "src/pages/index.astro": [
        "---",
        'import { Image, Text } from "@brimsites/brimjs/components";',
        "---",
        '<Image nodeId="hero" src="/hero.jpg" alt="" sizes="100vw" priority />',
        '<Image nodeId="about" src="/about.jpg" alt="" />',
        "<Image",
        "  bare",
        '  nodeId="card"',
        "  item={item}",
        '  field="cover"',
        '  src=""',
        '  alt=""',
        "/>",
        '<Image nodeId="spread" src="/a.jpg" alt="" {...rest} />',
        '<Image nodeId="expression" src="/b.jpg" alt="" sizes={cardSizes} />',
      ].join("\n"),
      // Astro's own Image, and a site's: not Brim's.
      "src/pages/about.astro": [
        "---",
        'import { Image } from "astro:assets";',
        "---",
        '<Image src={photo} alt="" />',
      ].join("\n"),
    });
    const found = report.findings.filter((finding) => finding.rule === "image-sizes");
    expect(found.map(({ file, line, severity }) => ({ file, line, severity }))).toEqual([
      { file: "src/pages/index.astro", line: 5, severity: "warning" },
    ]);
    expect(found[0]?.message).toMatch(/^2 <Image> elements without sizes/);
  });
});

describe("brim check: sharp asked for and not installed", () => {
  it("warns only for a site that asks its server for copies and has its packages installed without sharp", () => {
    const asks = { "astro.config.mjs": "export default { integrations: [brim({ media: { sharp: true } })] };" };
    const installed = { "node_modules/.keep": "", "package.json": "{}" };
    const page = { "src/pages/index.astro": "<p>Hello</p>" };
    const rule = (files: Record<string, string>) =>
      check({ ...page, ...files }).findings.filter((finding) => finding.rule === "no-sharp");
    expect(rule({ ...asks, ...installed }).map(({ file, severity }) => ({ file, severity }))).toEqual([
      { file: "package.json", severity: "warning" },
    ]);
    // Not asked for (a site behind a CDN that resizes), or nothing installed yet: nothing to say.
    expect(rule(installed)).toEqual([]);
    expect(rule(asks)).toEqual([]);
    expect(rule({ ...asks, ...installed, "node_modules/sharp/package.json": "{}" })).toEqual([]);
  });
});

describe("brim check: image sizes written as numbers", () => {
  it("warns about an image of the content given a fixed width or height, and leaves others alone", () => {
    const report = check({
      "src/components/Gallery.astro": [
        "---",
        'import { imageSources } from "@brimsites/brimjs/content";',
        "---",
        "{photos.map((photo) => (",
        "  <img",
        '    {...imageSources(photo.src, "50vw")}',
        "    alt={photo.alt}",
        '    loading="lazy"',
        '    width="1200"',
        '    height="800"',
        "  />",
        "))}",
        '<ImageGallery nodeId="g">{({ images }) => images.map((image) => <img {...image.img} width={900} />)}</ImageGallery>',
      ].join("\n"),
      "src/pages/index.astro": [
        '<img {...imageSources(cover.src, "33vw")} alt="" />',
        '<img src="/images/logo.webp" width="180" height="60" alt="" />',
        '<img {...imageSources(cover.src)} width={size.width} alt="" />',
      ].join("\n"),
    });
    const found = report.findings.filter((finding) => finding.rule === "fixed-image-size");
    expect(found.map(({ file, line, severity }) => ({ file, line, severity }))).toEqual([
      { file: "src/components/Gallery.astro", line: 5, severity: "warning" },
    ]);
    expect(found[0]?.message).toMatch(/^2 images of the content/);
  });
});

describe("brim check: large images in public/", () => {
  it("lists the images in public/ over 500 KB, largest first, and leaves the uploads alone", () => {
    const report = check({
      "src/pages/index.astro": "<h1>Home</h1>",
      "public/images/hero.webp": "x".repeat(1_500_000),
      "public/images/portrait.webp": "x".repeat(600_000),
      "public/images/logo.webp": "x".repeat(50_000),
      "public/uploads/big.webp": "x".repeat(3_000_000),
    });
    const found = report.findings.filter((finding) => finding.rule === "large-public-image");
    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe("public/images/hero.webp");
    expect(found[0]?.message).toMatch(
      /^2 images in public\/ larger than 500 KB: public\/images\/hero\.webp \(1\.4 MB\), public\/images\/portrait\.webp \(0\.6 MB\)\./,
    );
  });
});

describe("brim check: an order kept in a number field", () => {
  it("warns about a number field named for the order, and leaves other number fields alone", () => {
    const report = check({
      "src/content-types/project.ts": [
        "export const project = {",
        '  key: "project",',
        "  fields: [",
        '    { name: "intro", label: "Descriere", type: "textarea" },',
        '    { name: "order", label: "Ordine în portofoliu", type: "number" },',
        '    { name: "area", label: "Suprafață", type: "number" },',
        "  ],",
        "};",
      ].join("\n"),
      "src/content-types/categorie.ts": '{ type: "number", name: "ordine", label: "Ordine" }',
    });
    const found = report.findings.filter((finding) => finding.rule === "order-field");
    expect(found.map(({ file, line }) => ({ file, line }))).toEqual([
      { file: "src/content-types/categorie.ts", line: 1 },
      { file: "src/content-types/project.ts", line: 5 },
    ]);
    expect(found[1]?.message).toMatch(/"order".*ordered: true/);
  });
});

describe("brim check: starter leftovers", () => {
  const template = fileURLToPath(new URL("../../create-brim/template/", import.meta.url));

  it("reads create-brim's template, keeping filled-in files as patterns", () => {
    const manifest = readStarter(template);
    expect(manifest).toEqual(starterManifest());
    expect(manifest.map((file) => file.path)).toContain("src/pages/components.astro");
    expect(manifest.every((file) => file.path.startsWith("src/") || file.path.startsWith("public/"))).toBe(true);
    const navigation = manifest.find((file) => file.path === "src/components/navigation.ts");
    expect(navigation?.template).toContain("{{siteName}}");
    const filled = readFileSync(join(template, "src/components/navigation.ts"), "utf8").replace(
      "{{siteName}}",
      'Acme \\"Studio\\"',
    );
    expect(isUnchanged(navigation!, filled)).toBe(true);
    expect(isUnchanged(navigation!, filled.replace("Blog", "Journal"))).toBe(false);
    expect(isUnchanged(navigation!, filled.replace(/\n/g, "\r\n"))).toBe(true);
  });

  it("reports unchanged starter files, and the showcase page even when changed", () => {
    const files = readStarter(template);
    const copy = (path: string) => readFileSync(join(template, path), "utf8");
    const directory = site({
      "src/pages/about.astro": copy("src/pages/about.astro"),
      "src/pages/contact.astro": copy("src/pages/contact.astro").replace("Contact", "Write to us"),
      "src/pages/components.astro": `${copy("src/pages/components.astro")}\n<!-- edited -->\n`,
      "src/components/Hero.astro": copy("src/components/Hero.astro"),
      "src/layouts/Site.astro": copy("src/layouts/Site.astro"),
    });
    const report = checkSite(directory, { starter: files });
    expect(rules(report).filter((finding) => finding.rule === "starter")).toEqual([
      { file: "src/components/Hero.astro", line: undefined, rule: "starter", nodeId: undefined },
      { file: "src/pages/about.astro", line: undefined, rule: "starter", nodeId: undefined },
      { file: "src/pages/components.astro", line: undefined, rule: "starter", nodeId: undefined },
    ]);
    expect(report.starterStructure).toEqual(["src/layouts/Site.astro"]);
    expect(report.errors).toBe(0);
  });

  it("says when it is not run from a site", () => {
    expect(() => checkSite(mkdtempSync(join(tmpdir(), "brim-check-")))).toThrow("no src folder");
  });
});

describe("brim check: passwords in files and version control", () => {
  it("reports a password written in a note as an error, but not in .env files or code", () => {
    const root = site({
      "src/pages/index.astro": "<h1>Hi</h1>",
      ".brim/login-local.txt": "email: owner@acme.ro\npassword: Sup3r-secret!\n", // betterleaks:allow (a test fixture)
      ".env": "BRIM_DATABASE_TOKEN=abc123456", // betterleaks:allow (a test fixture)
      "README.md": "Sign in with `npx brim user link you@example.com`.",
      "notes/acces.md": "Editor: http://localhost:4321/admin\nParolă: Parola-test1! (doar local)", // betterleaks:allow (a test fixture)
    });
    const report = checkSite(root, { starter: [], git: false });
    const found = report.findings.filter((finding) => finding.rule === "saved-password");

    expect(found.map(({ file, line, severity }) => ({ file, line, severity }))).toEqual([
      { file: ".brim/login-local.txt", line: 2, severity: "error" },
      { file: "notes/acces.md", line: 2, severity: "error" },
    ]);
    expect(found[0]?.message).toContain("npx brim user link");
    expect(report.errors).toBe(2);
  });

  it("warns when the site is not in git", () => {
    const root = site({ "src/pages/index.astro": "<h1>Hi</h1>" });
    expect(checkSite(root, { starter: [] }).findings.map((finding) => finding.rule)).toContain("no-git");
    mkdirSync(join(root, ".git"));
    expect(checkSite(root, { starter: [] }).findings.map((finding) => finding.rule)).not.toContain("no-git");
  });
});

describe("brim check: pages written by hand for a vocabulary's terms", () => {
  const types = (category: string) =>
    `import { defineVocabulary } from "@brimsites/brimjs";\nimport CategoryPage from "./CategoryPage.astro";\n` +
    `export const category = defineVocabulary(${category});\n`;
  const found = (report: ReturnType<typeof checkSite>) =>
    report.findings
      .filter((finding) => finding.rule === "vocabulary-page")
      .map(({ file, severity, message }) => ({ file, severity, message }));

  it("suggests giving the vocabulary pages when src/pages draws its terms", () => {
    const report = check({
      "src/content-types/index.ts": types(`{ key: "category", label: "Categorii", slug: "categorii", fields: [] }`),
      "src/pages/produse/[category].astro": "<h1>Category</h1>",
      "src/pages/blog/[slug].astro": "<h1>Post</h1>",
    });
    expect(found(report)).toEqual([
      expect.objectContaining({ file: "src/pages/produse/[category].astro", severity: "warning" }),
    ]);
    expect(found(report)[0]?.message).toContain('path: "/produse/[slug]"');
  });

  it("refuses a page left in src/pages that takes the vocabulary's own addresses", () => {
    const declared = `{ key: "category", label: "C (x)", slug: "c", path: "/produse/[slug]", component: CategoryPage, fields: [] }`;
    const report = check({
      "src/content-types/index.ts": types(declared),
      "src/pages/produse/[category].astro": "<h1>Category</h1>",
    });
    expect(found(report)).toEqual([expect.objectContaining({ severity: "error" })]);
    expect(
      check({ "src/content-types/index.ts": types(declared), "src/pages/index.astro": "<h1>Hi</h1>" }).findings,
    ).toEqual([]);
  });
});

describe("brim check: contact details in the code", () => {
  it("warns about real contacts, and leaves alone examples shown to visitors and links built from settings", () => {
    const report = check({
      "src/components/Footer.astro": [
        '<a href="tel:+40722518304">Sună</a>',
        '<a href="https://www.instagram.com/studionord/">Instagram</a>',
      ].join("\n"),
      "src/data/form.ts": [
        "export const fields = [",
        '  { name: "inspiratie", type: "url", placeholder: "https://pinterest.com/..." },',
        '  { name: "profil", type: "url", placeholder: "https://instagram.com/numele-tau" },',
        "];",
        "export const example = 'https://facebook.com/…';",
      ].join("\n"),
      "src/pages/index.astro": [
        '<input type="url" placeholder="https://www.linkedin.com/in/nume" />',
        "<a href={`tel:${phone}`}>Call</a>",
      ].join("\n"),
    });
    const found = report.findings.filter((finding) => finding.rule === "contact-in-code");
    expect(found.map(({ file, line }) => ({ file, line }))).toEqual([{ file: "src/components/Footer.astro", line: 1 }]);
    expect(found[0]?.message).toMatch(/^2 contact details/);
  });
});

describe("brim check: a body the owner can only write text in", () => {
  const type = (body: string, extra = "") =>
    [
      'import ArticolPage from "./ArticolPage.astro";',
      "export const articol = defineContentType({",
      '  key: "articol",',
      "  component: ArticolPage,",
      "  fields: [",
      '    { name: "descriere", label: "Descriere", type: "textarea" },',
      `    ${body}`,
      extra,
      "  ],",
      "});",
    ].join("\n");

  it("suggests blocks for the rich text of a type with pages", () => {
    const report = check({
      "src/content-types/articol.ts": type('{ name: "continut", label: "Conținut", type: "richtext" },'),
    });
    const found = report.findings.filter((finding) => finding.rule === "text-only-body");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: "src/content-types/articol.ts", line: 7, severity: "warning" });
    expect(found[0]?.message).toMatch(/^"continut" is rich text/);
  });

  it("says nothing when the type has blocks, when the field is text only on purpose, or without pages", () => {
    const quiet = check({
      "src/content-types/articol.ts": type(
        '{ name: "rezumat", label: "Rezumat", type: "richtext" },',
        '    { name: "continut", label: "Conținut", type: "blocks" },',
      ),
      "src/content-types/nota.ts": type('{ name: "text", label: "Text", type: "richtext" }, // text only'),
      "src/content-types/autor.ts":
        'export const autor = { key: "autor", fields: [{ name: "bio", type: "richtext" }] };',
    });
    expect(quiet.findings.filter((finding) => finding.rule === "text-only-body")).toEqual([]);
  });
});
