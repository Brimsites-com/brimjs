import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { isUnchanged, type StarterFile, starterManifest } from "./starter.ts";
import { queryPathsInConfig, undeclaredQueryReads } from "./server/query-params.ts";

/**
 * `brim check`: reads a site's source and reports what would make the owner's edits go wrong, without
 * building or running it. Owner edits are stored under (scope, nodeId), so two elements with one id on a page
 * share one edit, and an id that names a position stops fitting once the markup moves. It reads the source with
 * a small tokenizer instead of Astro's compiler: it only needs elements, their attributes and imports.
 */

export type Severity = "error" | "warning";

export interface Finding {
  /** Relative to the site's folder, with forward slashes. */
  file: string;
  line?: number;
  severity: Severity;
  rule:
    | "duplicate"
    | "site-duplicate"
    | "positional"
    | "format"
    | "starter"
    | "uploads-in-code"
    | "contact-in-code"
    | "saved-password"
    | "no-git"
    | "vocabulary-page"
    | "hand-drawn-image"
    | "fixed-image-size"
    | "large-public-image"
    | "image-sizes"
    | "no-sharp"
    | "order-field"
    | "text-only-body"
    | "undeclared-query";
  nodeId?: string;
  message: string;
}

export interface CheckReport {
  files: number;
  /** Elements with a nodeId written as a literal. */
  literalIds: number;
  /** Elements whose nodeId is built at run time (``nodeId={`${id}-title`}``). */
  dynamicIds: number;
  /** Of those, how many were checked anyway because every use passes the prefix as a literal (`id="home-hero"`). */
  resolvedDynamicIds: number;
  findings: Finding[];
  /**
   * Starter files still unchanged that hold the site's structure rather than its content (the layout, styles,
   * content types): expected to stay, so they are listed here instead of as warnings.
   */
  starterStructure: string[];
  errors: number;
  warnings: number;
}

export interface CheckOptions {
  /** Defaults to what create-brim's template contains. */
  starter?: StarterFile[];
  /** Whether to warn when the site is not in git; on unless a caller checks a folder that is never a site. */
  git?: boolean;
}

/** Files in which Astro and MDX let primitives appear as elements. Plain .ts/.js files cannot draw them. */
const SOURCE_EXTENSIONS = [".astro", ".tsx", ".jsx", ".mdx"];
// The order Vite tries when an import leaves the extension out.
const RESOLVE_EXTENSIONS = [".astro", ".tsx", ".ts", ".jsx", ".js", ".mdx"];
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", ".astro", "dist"]);
/** Every file of the code that can hold an address: data modules and JSON too, not only markup. */
const CODE_EXTENSIONS = [...RESOLVE_EXTENSIONS, ".mjs", ".cjs", ".json"];
/**
 * Contact details written into the code: an email or phone link, WhatsApp, or a social profile. They are the owner's
 * to change, so they belong in the site's own settings (src/site-settings.ts), which that file itself may declare.
 */
const CONTACT_ADDRESS =
  /(?:mailto:|tel:|wa\.me\/|api\.whatsapp\.com|(?:instagram|facebook|tiktok|linkedin|youtube|pinterest|x|twitter)\.com\/)[^"'`\s]*/g;
const SETTINGS_MODULE = /(?:^|\/)src\/site-settings\.[cm]?[jt]s$/;

/** A media library address written as a string: `"/uploads/…"`, `'/uploads/…'` or in a template literal. */
const UPLOAD_ADDRESS = /["'`](?:https?:\/\/[^"'`\s/]+)?\/uploads\/[^"'`\s]+/g;

/** Components whose content is always saved for the whole site, whatever their `scope`. */
const ALWAYS_SITE = new Set(["Navbar", "Footer"]);
/** Components saved for the whole site unless `scope` says otherwise. */
const SITE_BY_DEFAULT = new Set(["Newsletter", "SocialMedia"]);

const TAGS = (
  "div span p a img h1 h2 h3 h4 h5 h6 li ul ol section article header footer nav main aside button " +
  "figure figcaption picture svg strong em b i small label input form table tr td th blockquote"
).split(" ");
// prettier-ignore
const GENERIC_WORDS = (
  "text item block element el elem node component child entry " +
  "row col column cell box wrapper wrap container group"
).split(" ");
// `text-3`, `hero-p-2`, `div4`, `item-2-title`: a tag or a generic word followed by a number names a position.
const POSITIONAL = new RegExp(`(?:^|-)(?:${[...TAGS, ...GENERIC_WORDS].join("|")})-?\\d+(?:-|$)`);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_HEX = /(?:^|-)(?=[0-9a-f]*\d)[0-9a-f]{12,}(?:-|$)/;
/** The rule in the brim-convert skill: lowercase letters, digits and dashes, starting with a letter, at most 64. */
const VALID_ID = /^[a-z][a-z0-9-]{0,63}$/;

export function checkSite(siteFolder: string, options: CheckOptions = {}): CheckReport {
  const root = resolve(siteFolder);
  const sourceFolder = join(root, "src");
  if (!existsSync(sourceFolder)) {
    throw new Error(`There is no src folder in ${siteFolder}. Run brim check from the site's folder.`);
  }
  const files = listSources(sourceFolder).map((path) => relative(root, path).split(sep).join("/"));
  const sources = new Map(files.map((file) => [file, parseSource(file, readFileSync(join(root, file), "utf8"))]));
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);

  let literalIds = 0;
  let dynamicIds = 0;
  for (const [file, source] of sources) {
    for (const element of source.elements) {
      const id = element.nodeId;
      if (!id) continue;
      if (id.kind !== "literal") {
        dynamicIds++;
        continue;
      }
      literalIds++;
      checkName(file, element.line, id.value, add);
    }
  }

  const resolved = new Set<string>();
  const closures = files.map((file) => ({ file, occurrences: collect(file, sources, resolved) }));
  findDuplicates(closures, add);
  findSiteDuplicates(closures, add);
  const starterStructure = findStarterLeftovers(root, options.starter ?? starterManifest(), add);
  findUploadsInCode(root, sourceFolder, add);
  findContactsInCode(root, sourceFolder, add);
  findSavedPasswords(root, add);
  findVocabularyPages(root, sourceFolder, add);
  findHandDrawnImages(root, sourceFolder, add);
  findFixedImageSizes(root, sourceFolder, add);
  findLargePublicImages(root, add);
  findImagesWithoutSizes(root, sourceFolder, add);
  findMissingSharp(root, add);
  findOrderFields(root, sourceFolder, add);
  findTextOnlyBodies(root, sourceFolder, add);
  findUndeclaredQueryReads(root, sourceFolder, add);
  if (options.git !== false && !insideGit(root)) {
    add({
      file: ".",
      severity: "warning",
      rule: "no-git",
      message:
        "the site is not in git: run `git init` and commit, so every change can be seen, reviewed and taken back " +
        "(the local database and uploads stay out, as .gitignore says)",
    });
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return {
    files: files.length,
    literalIds,
    dynamicIds,
    resolvedDynamicIds: resolved.size,
    findings,
    starterStructure,
    errors,
    warnings: findings.length - errors,
  };
}

/** One line per finding, grouped by file, then a summary. */
export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  let file: string | undefined;
  for (const finding of report.findings) {
    if (finding.file !== file) {
      if (file !== undefined) lines.push("");
      file = finding.file;
      lines.push(file);
    }
    const line = finding.line === undefined ? "" : String(finding.line);
    lines.push(`  ${line.padStart(4)}  ${finding.severity.padEnd(7)}  ${finding.message}`);
  }
  if (lines.length > 0) lines.push("");

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push(
    `${plural(report.errors, "error")}, ${plural(report.warnings, "warning")} in ${plural(report.files, "file")} ` +
      `(${plural(report.literalIds, "literal nodeId")}).`,
  );
  if (report.dynamicIds > 0) {
    const unchecked = report.dynamicIds - report.resolvedDynamicIds;
    lines.push(
      `${plural(report.dynamicIds, "nodeId")} built at run time (\`\${id}-title\`): ` +
        `${report.resolvedDynamicIds} checked through the literal props passed to them, ${unchecked} not checked.`,
    );
  }
  if (report.starterStructure.length > 0) {
    lines.push(
      `${plural(report.starterStructure.length, "structural starter file")} (layout, styles, content types) ` +
        "unchanged; that is expected.",
    );
  }
  return lines.join("\n");
}

function checkName(file: string, line: number, id: string, add: (finding: Finding) => void): void {
  if (!VALID_ID.test(id)) {
    add({
      file,
      line,
      severity: "warning",
      rule: "format",
      nodeId: id,
      message: `nodeId "${id}" should be lowercase letters, digits and dashes, start with a letter, at most 64 characters`,
    });
  }
  if (UUID.test(id) || LONG_HEX.test(id)) {
    add({
      file,
      line,
      severity: "warning",
      rule: "positional",
      nodeId: id,
      message: `nodeId "${id}" contains a generated id; name it for what the element is (hero-title)`,
    });
  } else if (POSITIONAL.test(id.toLowerCase())) {
    add({
      file,
      line,
      severity: "warning",
      rule: "positional",
      nodeId: id,
      message: `nodeId "${id}" names a position, not what the element is (hero-title rather than text-3)`,
    });
  }
}

/** Text files a password could have been written into; `.env` files hold secrets by design and are not read. */
const NOTE_FILE = /\.(txt|md|json|ya?ml|csv|ini|cfg|conf)$|^[^.]+$/i;
const SKIPPED_NOTES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "package.json", "tsconfig.json"]);
// A word for a password (`password`, `parola`, `pwd`…), a colon or equals sign, and a value on the same line. // betterleaks:allow
const PASSWORD_LINE =
  /(?<!\p{L})(?:pass(?:word)?|parol[aă]|pwd|passwd|mot de passe|contraseña)(?!\p{L})["']?\s*[:=]\s*["']?[^\s"',{}]{4,}/iu;

/**
 * Warns about passwords written into files of the project (a note left after creating a user, a login file): the
 * folder travels (a zip, a deploy, a repository) and the password with it. Sign-in links replace them.
 */
function findSavedPasswords(root: string, add: (finding: Finding) => void): void {
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name) && entry.name !== "uploads" && entry.name !== "src") walk(path);
        continue;
      }
      if (!NOTE_FILE.test(entry.name) || SKIPPED_NOTES.has(entry.name) || entry.name.startsWith(".env")) continue;
      if (statSync(path).size > 200_000) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      const line = lines.findIndex((text) => PASSWORD_LINE.test(text));
      if (line === -1) continue;
      add({
        file: relative(root, path).split(sep).join("/"),
        line: line + 1,
        severity: "error",
        rule: "saved-password",
        message:
          "a password written in a file: whoever gets the folder (a zip, a deploy, a repository) gets it too. Delete " +
          "it, change that password, and sign in with a one-time link instead: npx brim user link <email>",
      });
    }
  };
  walk(root);
}

/** Whether the folder is in a git repository: its own `.git`, or one of a folder above it. */
/** Whether a folder is inside a git repository (its own or a parent's). */
export function insideGit(root: string): boolean {
  let folder = root;
  for (;;) {
    if (existsSync(join(folder, ".git"))) return true;
    const parent = dirname(folder);
    if (parent === folder) return false;
    folder = parent;
  }
}

/** Warns about contact details written in the code (one finding per file): they belong in the site settings. */
function findContactsInCode(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  for (const path of listSources(sourceFolder, CODE_EXTENSIONS)) {
    const file = relative(root, path).split(sep).join("/");
    if (SETTINGS_MODULE.test(file)) continue;
    const found: number[] = [];
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const code = line.trimStart();
        if (code.startsWith("//") || code.startsWith("*")) return;
        // A template literal building the link from a setting (`tel:${phone}`) names no contact itself, and neither
        // does an example shown to visitors: a form field's placeholder, or an address that ends in "…".
        for (const match of line.matchAll(CONTACT_ADDRESS)) {
          const before = line.slice(0, match.index);
          const example = /placeholder\s*[:=]\s*\{?\s*["'`][^"'`]*$/.test(before) || /(\.\.\.|…)$/.test(match[0]);
          if (!/\$\{/.test(match[0]) && match[0].length > 7 && !example) found.push(index + 1);
        }
      });
    if (found.length === 0) continue;
    add({
      file,
      line: found[0] ?? 1,
      severity: "warning",
      rule: "contact-in-code",
      message:
        `${found.length === 1 ? "a contact detail" : `${found.length} contact details`} (email, phone, WhatsApp, social profile) ` +
        "written in the code: the owner cannot change them. Declare them in src/site-settings.ts and read them with " +
        'getSiteSettings(), or show them with <Setting name="…" />',
    });
  }
}

/**
 * Warns about media library addresses (`/uploads/…`) written in the code. Uploads live in `public/uploads` and the
 * database, neither of which is in git, so code that names them breaks on a fresh clone and on a deploy that has not
 * brought the content along, and keeps pointing at files the owner has replaced or deleted. One finding per file.
 */
function findUploadsInCode(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  for (const path of listSources(sourceFolder, CODE_EXTENSIONS)) {
    const lines = readFileSync(path, "utf8").split("\n");
    const found: number[] = [];
    lines.forEach((line, index) => {
      const code = line.trimStart();
      if (code.startsWith("//") || code.startsWith("*")) return;
      for (const _match of line.matchAll(UPLOAD_ADDRESS)) found.push(index + 1);
    });
    if (found.length === 0) continue;
    add({
      file: relative(root, path).split(sep).join("/"),
      line: found[0] ?? 1,
      severity: "warning",
      rule: "uploads-in-code",
      message:
        `${found.length === 1 ? "an address" : `${found.length} addresses`} of the media library (/uploads/…) in the code: ` +
        "uploads are not in git, so a fresh clone or a deploy without the content has none of them. Keep them in the " +
        "content (an item's field, an element's saved value) and give the code a starting picture of its own " +
        "(public/ or src/assets/)",
    });
  }
}

/** An `<img>` whose address the code reads through `mediaUrl(…)`: an image of the content, drawn by hand. */
const HAND_DRAWN_IMAGE = /<img\b[^>]*?\ssrc=\{\s*mediaUrl\(/g;

/**
 * Warns about `<img src={mediaUrl(…)}>`: an image of the content (an item's picture, an upload) drawn as a plain
 * `<img>`. It has no `srcset`, so every visitor downloads the full upload even where the CDN would serve a copy the
 * size of the layout, and the owner cannot replace it from the page. `<Image bare item={item} field="…" />` draws
 * the same `<img>` with both. One finding per file.
 */
function findHandDrawnImages(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  for (const path of listSources(sourceFolder)) {
    const text = readFileSync(path, "utf8");
    const lines = [...text.matchAll(HAND_DRAWN_IMAGE)].map((match) => text.slice(0, match.index).split("\n").length);
    if (lines.length === 0) continue;
    add({
      file: relative(root, path).split(sep).join("/"),
      line: lines[0] ?? 1,
      severity: "warning",
      rule: "hand-drawn-image",
      message:
        `${lines.length === 1 ? "an image" : `${lines.length} images`} of the content drawn as <img src={mediaUrl(…)}>: ` +
        "without a srcset every visitor downloads the full upload, and the owner cannot replace it from the page. " +
        'Use <Image bare nodeId="…" item={item} field="…" src="" alt="" /> (it takes class, loading and sizes as an ' +
        "<img> does), or {...imageSources(src, sizes)} from brimjs/content where it cannot be a component",
    });
  }
}

/** An `<img>` tag, to its closing `>` (an arrow function's `=>` inside it does not end it). */
const IMG_TAG = /<img\b(?:[^>]|(?<==)>)*>/g;
/** Its attributes come from Brim: `imageSources(…)`, or a Gallery's or Carousel's `image.img`. */
const BRIM_SOURCES = /imageSources\(|\.img\s*\}/;
const FIXED_SIZE = /\s(?:width|height)=(?:["']\d+["']|\{\s*\d+\s*\})/;

/**
 * Warns about an `<img>` that takes its address from Brim (`imageSources`, a gallery's `image.img`) and writes its
 * `width` or `height` as a number. Brim gives an upload its own measured size; a number written once is the same for
 * every picture, so portrait photos get a landscape place, the page jumps as each one arrives and a masonry gallery
 * reshuffles its columns. One finding per file.
 */
function findFixedImageSizes(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  for (const path of listSources(sourceFolder)) {
    const text = readFileSync(path, "utf8");
    const lines = [...text.matchAll(IMG_TAG)]
      .filter((match) => BRIM_SOURCES.test(match[0]) && FIXED_SIZE.test(match[0]))
      .map((match) => text.slice(0, match.index).split("\n").length);
    if (lines.length === 0) continue;
    add({
      file: relative(root, path).split(sep).join("/"),
      line: lines[0] ?? 1,
      severity: "warning",
      rule: "fixed-image-size",
      message:
        `${lines.length === 1 ? "an image" : `${lines.length} images`} of the content with a width or height written ` +
        "as a number: every picture gets that shape, so portrait photos jump as they load. Leave width and height " +
        "out: imageSources and image.img give each upload its own size (and set height: auto in the CSS)",
    });
  }
}

/** Brim's `Image`, imported under its own name: a site's or Astro's own `Image` component is not it. */
const BRIM_IMAGE_IMPORT = /import\s*\{[^}]*\bImage\b(?!\s+as\b)[^}]*\}\s*from\s*["']@brimsites\/brimjs\/components["']/;
/** An `<Image>` tag, to its closing `>` (an arrow function's `=>` inside it does not end it). */
const IMAGE_TAG = /<Image\b(?:[^>]|(?<==)>)*>/g;

/**
 * Warns about `<Image>` without `sizes`: the browser then takes the picture to be as wide as the page (`100vw`) and
 * downloads a copy that wide, twice the bytes for a picture drawn in half of it and nine times for a card in a row
 * of three. A picture that does span the page needs none. Tags that spread their attributes (`{...props}`) may
 * carry it, and are left alone. One finding per file.
 */
function findImagesWithoutSizes(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  for (const path of listSources(sourceFolder)) {
    const text = readFileSync(path, "utf8");
    if (!BRIM_IMAGE_IMPORT.test(text)) continue;
    const lines = [...text.matchAll(IMAGE_TAG)]
      .filter(([tag]) => !/\ssizes[=\s/>]/.test(tag) && !tag.includes("{..."))
      .map((match) => text.slice(0, match.index).split("\n").length);
    if (lines.length === 0) continue;
    add({
      file: relative(root, path).split(sep).join("/"),
      line: lines[0] ?? 1,
      severity: "warning",
      rule: "image-sizes",
      message:
        `${lines.length === 1 ? "an <Image>" : `${lines.length} <Image> elements`} without sizes: the browser takes ` +
        "the picture to be as wide as the page and downloads a copy that wide. Where it is drawn narrower, say how " +
        'wide, e.g. sizes="(max-width: 768px) 100vw, 50vw"; a picture that spans the page needs none',
    });
  }
}

/** `sharp: true` in the site's Astro config: `brim({ media: { sharp: true } })`. */
const ASKS_FOR_SHARP = /\bsharp\s*:\s*true\b/;

/**
 * Warns when the site asks its own server for the smaller copies of the pictures in public/ (`media.sharp`) and
 * `sharp` is not among its installed packages: the built server looks for it from the site's own folder, and without
 * it sends every picture as it was saved. With pnpm a package is found only when the site itself depends on it.
 * A site that does not ask (one behind a CDN that resizes) needs no sharp, and is left alone.
 */
function findMissingSharp(root: string, add: (finding: Finding) => void): void {
  const config = ["mjs", "ts", "js", "mts", "cjs"].map((extension) => join(root, `astro.config.${extension}`));
  const asked = config.some((path) => existsSync(path) && ASKS_FOR_SHARP.test(readFileSync(path, "utf8")));
  // The folder itself, not a lookup: run through a package manager, a lookup also finds what other packages brought.
  if (!asked || !existsSync(join(root, "node_modules")) || existsSync(join(root, "node_modules", "sharp"))) return;
  add({
    file: "package.json",
    severity: "warning",
    rule: "no-sharp",
    message:
      "media.sharp is on but sharp is not installed: the pictures in public/ are sent as they were saved, with no " +
      "smaller copies for a phone. Add it to the site's dependencies (npm install sharp)",
  });
}

/** Images in public/ larger than this are sent whole to every visitor, phones included. */
const LARGE_PUBLIC_IMAGE = 500 * 1024;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);

/**
 * Warns about large images in public/: they are served as they are, with no smaller copy for a phone and no
 * `srcset`. The uploads folder is the media library's, left out. One finding for all of them, largest first.
 */
function findLargePublicImages(root: string, add: (finding: Finding) => void): void {
  const folder = join(root, "public");
  if (!existsSync(folder)) return;
  const large: { file: string; size: number }[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (path !== join(folder, "uploads") && !SKIPPED_FOLDERS.has(entry.name)) walk(path);
      } else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const size = statSync(path).size;
        if (size > LARGE_PUBLIC_IMAGE) large.push({ file: relative(root, path).split(sep).join("/"), size });
      }
    }
  };
  walk(folder);
  if (large.length === 0) return;
  large.sort((a, b) => b.size - a.size);
  const listed = large
    .slice(0, 5)
    .map(({ file, size }) => `${file} (${(size / 1024 / 1024).toFixed(1)} MB)`)
    .join(", ");
  add({
    file: large[0]?.file ?? "public",
    severity: "warning",
    rule: "large-public-image",
    message:
      `${large.length === 1 ? "an image" : `${large.length} images`} in public/ larger than 500 KB: ${listed}` +
      `${large.length > 5 ? ", …" : ""}. A server sends visitors smaller copies, but each copy is made from this file, ` +
      "every clone and deploy carries it, and a static build sends it whole: save it once at most 2560 px wide " +
      "(about 2000 px is enough for a full-width photo). Pictures of items belong in the media library instead",
  });
}

/** A `richtext` field declared in a content type, unless its line says `// text only`. */
const RICHTEXT_FIELD = /\{[^{}\n]*?\btype\s*:\s*["'`]richtext["'`][^\n]*/g;

/**
 * A content type with pages (`component`) whose fields are rich text but no `blocks`: on those pages the owner can
 * only write text, never put an image, a gallery, a button or a video between its paragraphs. A suggestion, not a
 * rule: a field that should hold text and nothing else says so with `// text only` on its line. Read from the code of
 * src/content-types.
 */
function findTextOnlyBodies(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  const folder = join(sourceFolder, "content-types");
  if (!existsSync(folder)) return;
  for (const path of listSources(folder, CODE_EXTENSIONS)) {
    const text = readFileSync(path, "utf8");
    if (!/\bcomponent\s*[:,}]/.test(text) || /\btype\s*:\s*["'`]blocks["'`]/.test(text)) continue;
    const match = [...text.matchAll(RICHTEXT_FIELD)].find((found) => !/\/\/\s*text only/i.test(found[0]));
    if (!match) continue;
    const name = /\bname\s*:\s*["'`]([^"'`]+)["'`]/.exec(match[0])?.[1] ?? "a field";
    add({
      file: relative(root, path).split(sep).join("/"),
      line: text.slice(0, match.index).split("\n").length,
      severity: "warning",
      rule: "text-only-body",
      message:
        `"${name}" is rich text and the type has no blocks field: on its pages the owner can only write text, never ` +
        'add an image, gallery, button or video between paragraphs. For a body, make it type: "blocks" (texts already ' +
        "saved become its first block when the site starts, and <Blocks> draws it); if text is all it should hold, " +
        "add // text only on its line",
    });
  }
}

/** A number field whose name says it orders items: `order`, `ordine`, `position`, `sort`, `rank`… */
const ORDER_FIELD =
  /\{[^{}]*?\bname\s*:\s*["'`](order|ordine|ordinea|position|pozitie|poziție|sort|sort_order|rank|weight)["'`][^{}]*?\btype\s*:\s*["'`]number["'`][^{}]*\}|\{[^{}]*?\btype\s*:\s*["'`]number["'`][^{}]*?\bname\s*:\s*["'`](order|ordine|ordinea|position|pozitie|poziție|sort|sort_order|rank|weight)["'`][^{}]*\}/g;

/**
 * A content type that keeps its items' order in a number field. The owner then types numbers into each item to
 * move one, and two items with the same number swap at random; `ordered: true` lets them drag the items into order
 * in the editor, and listings and `getItems` follow it. Read from the code of src/content-types.
 */
function findOrderFields(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  const folder = join(sourceFolder, "content-types");
  if (!existsSync(folder)) return;
  for (const path of listSources(folder, CODE_EXTENSIONS)) {
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(ORDER_FIELD)) {
      add({
        file: relative(root, path).split(sep).join("/"),
        line: text.slice(0, match.index).split("\n").length,
        severity: "warning",
        rule: "order-field",
        message:
          `the number field "${match[1] ?? match[2]}" keeps the order of the items: the owner has to type a number ` +
          "into each one to move it. Declare the type ordered: true and delete the field; the owner then drags the " +
          'items into order in the editor, and Listing and getItems list them that way (sort="position")',
      });
    }
  }
}

/**
 * Pages written by hand for a vocabulary's terms: `src/pages/produse/[category].astro` next to a `category`
 * vocabulary. Without `path` and `component` on the vocabulary such a page works, but the editor does not know it is
 * the term's (its fields, the site map), the sitemap leaves it out and its `getStaticPaths` is the site's to keep.
 * With them, a page left in src/pages takes the terms' addresses, since the site's own pages come first. Read from
 * the code's text, so a vocabulary declared in an unusual way is not seen.
 */
function findVocabularyPages(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  const vocabularies = new Map<string, { component: boolean; path?: string }>();
  for (const path of listSources(sourceFolder, CODE_EXTENSIONS)) {
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/defineVocabulary\s*\(/g)) {
      const call = balanced(text, (match.index ?? 0) + match[0].length - 1);
      const key = /\bkey\s*:\s*["'`]([a-z][a-z0-9_]*)["'`]/.exec(call)?.[1];
      if (!key) continue;
      const route = /\bpath\s*:\s*["'`]([^"'`]+)["'`]/.exec(call)?.[1];
      vocabularies.set(key, { component: /\bcomponent\s*[:,}]/.test(call), ...(route && { path: route }) });
    }
  }
  if (vocabularies.size === 0) return;
  const pagesFolder = join(sourceFolder, "pages");
  if (!existsSync(pagesFolder)) return;
  for (const path of listSources(pagesFolder, [".astro", ".ts", ".js", ".mdx"])) {
    const file = relative(root, path).split(sep).join("/");
    const name = /\[([a-z][a-z0-9_]*)\]\.[a-z]+$/.exec(file)?.[1];
    if (!name) continue;
    const vocabulary = vocabularies.get(name);
    if (!vocabulary) continue;
    const route = `/${relative(pagesFolder, path).split(sep).join("/")}`.replace(/\.[a-z]+$/, "");
    const address = route.replace(`[${name}]`, "[slug]");
    if (!vocabulary.component) {
      add({
        file,
        line: 1,
        severity: "warning",
        rule: "vocabulary-page",
        message:
          `this page draws the terms of the "${name}" vocabulary by hand. Give the vocabulary path: "${address}" and ` +
          "this page as its component (it gets the term as `item`, like an item's page), then delete this file: " +
          "the terms then have pages the editor knows (their fields, the site map), in the sitemap, without " +
          "getStaticPaths",
      });
    } else if (vocabulary.path === address) {
      add({
        file,
        line: 1,
        severity: "error",
        rule: "vocabulary-page",
        message:
          `this page takes the addresses of the "${name}" vocabulary's pages (${address}): the site's own pages come ` +
          "first, so its component is never used. Delete this file",
      });
    }
  }
}

/** The text of a call's arguments, from its opening parenthesis to the one that closes it. */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      index = skipString(text, index, char) - 1;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return text.slice(open, index + 1);
  }
  return text.slice(open);
}

// ---------------------------------------------------------------------------------------------------------------
// Duplicates

interface Occurrence {
  id: string;
  scope: "page" | "site";
  /** Where the element is written. */
  file: string;
  line: number;
  /** The line in the file being checked that draws it: the element itself, or the component that contains it. */
  entryLine: number;
  /** The component, used in the file being checked, that contains the element. */
  through?: string;
  /** `item|field` for an element that shows an item's field (see `Element.binding`). */
  binding?: string;
}

/**
 * Every element with a known id that a file draws: its own, and those of the local components it uses,
 * followed through their imports. A component used twice contributes its ids twice. An id built from a prop
 * (``nodeId={`${id}-title`}``) becomes known when the use passes that prop as a literal (`<Hero id="home-hero">`).
 */
function collect(file: string, sources: Map<string, Source>, resolved: Set<string>): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const visit = (
    current: string,
    props: Map<string, string> | undefined,
    stack: string[],
    entry: { line: number; through: string } | undefined,
  ) => {
    const source = sources.get(current);
    if (!source) return;
    for (const element of source.elements) {
      const component = source.imports.get(element.name);
      const target = component && resolveImport(current, component, sources);
      if (target) {
        // A nodeId given to a local component is a prop it passes on; the element it lands on is counted there.
        // A component that (through others) includes itself would never end; the build would not either.
        if (!stack.includes(target) && stack.length < 20) {
          visit(target, element.props, [...stack, target], entry ?? { line: element.line, through: element.name });
        }
        continue;
      }
      const id = element.nodeId && idValue(element.nodeId, props);
      if (!id || element.scope === "unknown") continue;
      if (element.nodeId?.kind === "prefixed") resolved.add(`${current}:${element.line}`);
      occurrences.push({
        id,
        scope: element.scope,
        file: current,
        line: element.line,
        entryLine: entry?.line ?? element.line,
        ...(entry && { through: entry.through }),
        ...(element.binding && { binding: `${current}|${element.binding}` }),
      });
    }
  };
  visit(file, undefined, [file], undefined);
  return occurrences;
}

function idValue(id: NodeIdValue, props: Map<string, string> | undefined): string | undefined {
  if (id.kind === "literal") return id.value;
  if (id.kind === "prefixed") {
    const prefix = props?.get(id.prop);
    return prefix === undefined ? undefined : `${prefix}${id.suffix}`;
  }
  return undefined;
}

/**
 * Page-scoped ids repeated within what one file draws. A duplicate shows up in the file where it starts and
 * in every page that includes that file; it is reported once, in the smallest file that contains it.
 */
function findDuplicates(closures: { file: string; occurrences: Occurrence[] }[], add: (finding: Finding) => void) {
  const reported = new Set<string>();
  const bySize = [...closures].sort((a, b) => a.occurrences.length - b.occurrences.length);
  for (const { file, occurrences } of bySize) {
    const byId = new Map<string, Occurrence[]>();
    for (const occurrence of occurrences) {
      if (occurrence.scope !== "page") continue;
      byId.set(occurrence.id, [...(byId.get(occurrence.id) ?? []), occurrence]);
    }
    for (const [id, same] of byId) {
      if (same.length < 2) continue;
      const binding = same[0]?.binding;
      if (binding !== undefined && same.every((occurrence) => occurrence.binding === binding)) continue;
      const key = `${id}|${same
        .map((occurrence) => `${occurrence.file}:${occurrence.line}`)
        .sort()
        .join(",")}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const places = same.map((occurrence) =>
        occurrence.file === file && !occurrence.through
          ? `line ${occurrence.line}`
          : `${occurrence.file}:${occurrence.line} (through <${occurrence.through}> at line ${occurrence.entryLine})`,
      );
      const where = file.startsWith("src/pages/") ? "on this page" : "in what this file draws";
      add({
        file,
        line: Math.max(...same.map((occurrence) => occurrence.entryLine)),
        severity: "error",
        rule: "duplicate",
        nodeId: id,
        message: `nodeId "${id}" is used ${same.length} times ${where}: ${places.join(", ")}`,
      });
    }
  }
}

/** Site-scoped ids share one namespace: two different elements anywhere in the site must not share one. */
function findSiteDuplicates(closures: { occurrences: Occurrence[] }[], add: (finding: Finding) => void) {
  const places = new Map<string, Map<string, Occurrence>>();
  for (const { occurrences } of closures) {
    for (const occurrence of occurrences) {
      if (occurrence.scope !== "site") continue;
      const byPlace = places.get(occurrence.id) ?? new Map<string, Occurrence>();
      byPlace.set(`${occurrence.file}:${occurrence.line}`, occurrence);
      places.set(occurrence.id, byPlace);
    }
  }
  for (const [id, byPlace] of places) {
    if (byPlace.size < 2) continue;
    const sorted = [...byPlace.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const [first, ...others] = sorted as [Occurrence, ...Occurrence[]];
    add({
      file: first.file,
      line: first.line,
      severity: "error",
      rule: "site-duplicate",
      nodeId: id,
      message: `site-wide nodeId "${id}" is also used by ${others
        .map((other) => `${other.file}:${other.line}`)
        .join(", ")}; they would share one edit`,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Starter leftovers

/** The starter's structure: what a site built from it keeps, unlike its pages, pictures and sections. */
const STARTER_STRUCTURE =
  /^src\/(layouts|styles|content-types)\/|^src\/page-templates\/index\.ts$|^src\/site-settings\.ts$/;

/** Warns about starter content still in the site; returns the unchanged structural files. */
function findStarterLeftovers(root: string, starter: StarterFile[], add: (finding: Finding) => void): string[] {
  const structure: string[] = [];
  for (const file of starter) {
    const path = join(root, file.path);
    if (!existsSync(path)) continue;
    const unchanged = isUnchanged(file, readFileSync(path, "utf8"));
    if (file.path === "src/pages/components.astro") {
      // A demo of every component, meant to be deleted: reported even when it was changed.
      add({
        file: file.path,
        severity: "warning",
        rule: "starter",
        message: `the starter's component showcase${unchanged ? "" : " (changed)"}: delete it, and its links in the navigation and the home page`,
      });
    } else if (unchanged && STARTER_STRUCTURE.test(file.path)) {
      structure.push(file.path);
    } else if (unchanged) {
      const content = file.path.startsWith("src/pages/") || file.path.startsWith("public/");
      add({
        file: file.path,
        severity: "warning",
        rule: "starter",
        message: content
          ? "unchanged from the create-brim starter: replace it with the site's own content or delete it"
          : "unchanged from the create-brim starter: keep it only if the site uses it as it is",
      });
    }
  }
  return structure;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the source

type NodeIdValue =
  | { kind: "literal"; value: string }
  /** ``nodeId={`${id}-title`}`` or `nodeId={nodeId}`: known once the use of the component passes that prop. */
  | { kind: "prefixed"; prop: string; suffix: string }
  | { kind: "dynamic" };

export interface Element {
  name: string;
  line: number;
  nodeId?: NodeIdValue;
  scope: "page" | "site" | "unknown";
  /** Attributes written as literal strings, passed down when the element is a local component. */
  props: Map<string, string>;
  /**
   * `item={item} field="title"`: the element shows that field of the item, which is where its value is kept. Two
   * elements with one nodeId bound to the same field (in the two branches of `a ? … : …`) are the same value.
   */
  binding?: string;
}

interface Source {
  elements: Element[];
  /** Local name → import specifier. */
  imports: Map<string, string>;
}

type Attribute = { kind: "string"; value: string } | { kind: "expression"; value: string } | { kind: "bare" };

export function parseSource(file: string, text: string): Source {
  const extension = extname(file);
  let start = 0;
  let code = text;
  if (extension === ".astro") {
    // The frontmatter is TypeScript with no elements in it; only its imports matter.
    const frontmatter = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    code = frontmatter?.[1] ?? "";
    start = frontmatter ? frontmatter[0].length : 0;
  }
  return { elements: parseElements(text, start, extension), imports: parseImports(code) };
}

function parseImports(code: string): Map<string, string> {
  const imports = new Map<string, string>();
  const statement = /\bimport\s+(?!type\s)([^;'"]*?)\s+from\s+["']([^"']+)["']/g;
  for (const [, clause = "", specifier = ""] of code.matchAll(statement)) {
    if (!specifier.startsWith(".")) continue;
    const defaultName = /^([\w$]+)/.exec(clause.trim())?.[1];
    if (defaultName) imports.set(defaultName, specifier);
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";
    for (const part of named.split(",")) {
      const name = part.trim().replace(/^type\s+/, "");
      if (!name || part.trim().startsWith("type ")) continue;
      imports.set(name.split(/\s+as\s+/).pop() ?? name, specifier);
    }
  }
  return imports;
}

function resolveImport(from: string, specifier: string, sources: Map<string, Source>): string | undefined {
  const base = join(dirname(from), specifier).split(sep).join("/");
  const bare = base.replace(/\.(m?js|jsx)$/, "");
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => bare + extension),
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => sources.has(candidate));
}

/**
 * A pragmatic tokenizer for Astro markup, JSX and MDX: finds `<Name attributes>` and reads the attributes,
 * skipping comments, `<script>`/`<style>` contents and the code inside `{…}` attribute values.
 */
function parseElements(text: string, start: number, extension: string): Element[] {
  const elements: Element[] = [];
  const lineStarts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === "\n") lineStarts.push(index + 1);
  const lineOf = (position: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((lineStarts[middle] ?? 0) <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  const isScript = extension === ".tsx" || extension === ".jsx";

  let index = start;
  while (index < text.length) {
    if (text.startsWith("<!--", index)) {
      index = after(text, "-->", index + 4);
    } else if (text.startsWith("/*", index)) {
      index = after(text, "*/", index + 2);
    } else if (isScript && text.startsWith("//", index)) {
      index = after(text, "\n", index + 2);
    } else if (text[index] === "<" && /[A-Za-z]/.test(text[index + 1] ?? "")) {
      const tag = parseTag(text, index + 1);
      elements.push(toElement(tag.name, tag.attributes, lineOf(index)));
      index = tag.end;
      // Their contents are CSS or JavaScript, where `<` means something else.
      if (!tag.selfClosing && (tag.name === "script" || tag.name === "style")) {
        index = after(text, `</${tag.name}`, index);
      }
    } else {
      index++;
    }
  }
  return elements;
}

function after(text: string, marker: string, from: number): number {
  const found = text.indexOf(marker, from);
  return found === -1 ? text.length : found + marker.length;
}

function parseTag(text: string, from: number) {
  const name = /^[A-Za-z][\w.:-]*/.exec(text.slice(from, from + 200))?.[0] ?? "";
  const attributes = new Map<string, Attribute>();
  let index = from + name.length;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === ">") return { name, attributes, end: index + 1, selfClosing: false };
    if (text.startsWith("/>", index)) return { name, attributes, end: index + 2, selfClosing: true };
    if (char === "{") {
      // A spread (`{...attributes}`) or a shorthand (`{title}`): no name to read.
      index = skipExpression(text, index);
      continue;
    }
    const attributeName = /^[\w:@$.-]+/.exec(text.slice(index, index + 100))?.[0];
    if (!attributeName) {
      index++;
      continue;
    }
    index += attributeName.length;
    while (/\s/.test(text[index] ?? "")) index++;
    if (text[index] !== "=") {
      attributes.set(attributeName, { kind: "bare" });
      continue;
    }
    index++;
    while (/\s/.test(text[index] ?? "")) index++;
    const quote = text[index];
    if (quote === '"' || quote === "'") {
      const end = text.indexOf(quote, index + 1);
      const close = end === -1 ? text.length : end;
      attributes.set(attributeName, { kind: "string", value: text.slice(index + 1, close) });
      index = close + 1;
    } else if (quote === "{") {
      const end = skipExpression(text, index);
      attributes.set(attributeName, { kind: "expression", value: text.slice(index + 1, end - 1).trim() });
      index = end;
    } else {
      const value = /^[^\s>]*/.exec(text.slice(index))?.[0] ?? "";
      attributes.set(attributeName, { kind: "string", value: value.replace(/\/$/, "") });
      index += value.length;
    }
  }
  return { name, attributes, end: text.length, selfClosing: false };
}

/** From a `{`, the position after its matching `}`, stepping over strings, template literals and comments. */
function skipExpression(text: string, from: number): number {
  let depth = 0;
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      index = skipString(text, index, char);
      continue;
    }
    if (char === "`") {
      index = skipTemplate(text, index);
      continue;
    }
    if (text.startsWith("//", index)) {
      index = after(text, "\n", index + 2);
      continue;
    }
    if (text.startsWith("/*", index)) {
      index = after(text, "*/", index + 2);
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return index + 1;
    }
    index++;
  }
  return text.length;
}

function skipString(text: string, from: number, quote: string): number {
  let index = from + 1;
  while (index < text.length && text[index] !== quote && text[index] !== "\n") {
    index += text[index] === "\\" ? 2 : 1;
  }
  return index + 1;
}

function skipTemplate(text: string, from: number): number {
  let index = from + 1;
  while (index < text.length && text[index] !== "`") {
    if (text[index] === "\\") index += 2;
    else if (text.startsWith("${", index)) index = skipExpression(text, index + 1);
    else index++;
  }
  return index + 1;
}

function toElement(name: string, attributes: Map<string, Attribute>, line: number): Element {
  const props = new Map<string, string>();
  for (const [key, attribute] of attributes) {
    const value = literalOf(attribute);
    if (value !== undefined) props.set(key, value);
  }
  const element: Element = { name, line, scope: scopeOf(name, attributes.get("scope")), props };
  const nodeId = attributes.get("nodeId");
  if (nodeId && nodeId.kind !== "bare") element.nodeId = nodeIdOf(nodeId);
  const item = attributes.get("item");
  const field = literalOf(attributes.get("field"));
  if (item?.kind === "expression" && field !== undefined) element.binding = `${item.value.trim()}|${field}`;
  return element;
}

/** `"x"`, `{"x"}`, `{'x'}` and ``{`x`}`` are all the literal x. */
function literalOf(attribute: Attribute | undefined): string | undefined {
  if (!attribute || attribute.kind === "bare") return undefined;
  if (attribute.kind === "string") return attribute.value;
  const quoted = /^"([^"\\]*)"$|^'([^'\\]*)'$|^`([^`$\\]*)`$/.exec(attribute.value);
  return quoted ? (quoted[1] ?? quoted[2] ?? quoted[3]) : undefined;
}

function nodeIdOf(attribute: Attribute): NodeIdValue {
  const literal = literalOf(attribute);
  if (literal !== undefined) return { kind: "literal", value: literal };
  if (attribute.kind !== "expression") return { kind: "dynamic" };
  const prefixed = /^`\$\{\s*([\w$]+)\s*\}([^`$\\]*)`$/.exec(attribute.value);
  if (prefixed) return { kind: "prefixed", prop: prefixed[1] ?? "", suffix: prefixed[2] ?? "" };
  if (/^[A-Za-z_$][\w$]*$/.test(attribute.value)) return { kind: "prefixed", prop: attribute.value, suffix: "" };
  return { kind: "dynamic" };
}

function scopeOf(name: string, attribute: Attribute | undefined): Element["scope"] {
  if (ALWAYS_SITE.has(name)) return "site";
  if (!attribute) return SITE_BY_DEFAULT.has(name) ? "site" : "page";
  const value = literalOf(attribute);
  if (value === "site") return "site";
  // `item:…` scopes and scopes chosen at run time are not pages; leave them out rather than guess.
  return value === "page" ? "page" : "unknown";
}

/**
 * Warns about code that reads the request's query (`Astro.url.searchParams`, `new URL(request.url).searchParams`)
 * without saying what it reads. A host that caches pages by the parameters they read (Brimsites) cannot tell what
 * such code needs, so while any is left the pages Brim sees drawn declare nothing and are cached less precisely.
 * Declared by `readsQuery()` in the file, or for a page of src/pages by `brim({ query })` in astro.config.
 */
function findUndeclaredQueryReads(root: string, sourceFolder: string, add: (finding: Finding) => void): void {
  const configFile = ["mjs", "ts", "js", "mts", "cjs"]
    .map((extension) => join(root, `astro.config.${extension}`))
    .find((file) => existsSync(file));
  const declared = configFile ? queryPathsInConfig(readFileSync(configFile, "utf8")) : {};
  const files = listSources(sourceFolder, CODE_EXTENSIONS.filter((extension) => extension !== ".json"))
    .filter((path) => !path.endsWith(".d.ts"))
    .map((path) => ({ file: relative(root, path).split(sep).join("/"), text: readFileSync(path, "utf8") }));
  for (const { file, line } of undeclaredQueryReads(files, declared)) {
    add({
      file,
      line,
      severity: "warning",
      rule: "undeclared-query",
      message:
        "reads the request's query without saying which parameters: call readsQuery([\"name\", …]) from " +
        '"@brimsites/brimjs/server" where it reads them (or declare its route in brim({ query })), so a host caching pages ' +
        "keeps exactly those. Until then pages are cached less precisely",
    });
  }
}

function listSources(folder: string, extensions: string[] = SOURCE_EXTENSIONS): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) found.push(...listSources(path, extensions));
    } else if (extensions.includes(extname(entry.name)) && statSync(path).isFile()) {
      found.push(path);
    }
  }
  return found.sort();
}
