import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What `create-brim` copies into a new site, so `brim check` can tell which starter files a site still has
 * unchanged. create-brim is not installed in a site, so the bundled CLI carries this list (see
 * scripts/build-cli.mjs); inside the repository it is read from the template itself.
 */
export interface StarterFile {
  /** Relative to the site's folder, with forward slashes. */
  path: string;
  /** sha256 of the file with line endings normalized, for files create-brim copies as they are. */
  sha256?: string;
  /**
   * The template text of a file create-brim fills in (`{{siteName}}`); a site's copy matches it when
   * everything but the filled-in values is the same.
   */
  template?: string;
}

// Only the site's own code and files: README, package.json and the configs are expected to stay.
const CHECKED_FOLDERS = ["src", "public"];
// The placeholders create-brim fills in (see its index.js); other `{{…}}` text is left as it is.
const PLACEHOLDER = /\{\{(siteName|packageName|brimVersion)\}\}/;

declare const __BRIM_STARTER_MANIFEST__: StarterFile[] | undefined;

export function starterManifest(): StarterFile[] {
  if (typeof __BRIM_STARTER_MANIFEST__ !== "undefined") return __BRIM_STARTER_MANIFEST__;
  const template = fileURLToPath(new URL("../../create-brim/template/", import.meta.url));
  return existsSync(template) ? readStarter(template) : [];
}

export function readStarter(templateFolder: string): StarterFile[] {
  const files: StarterFile[] = [];
  for (const folder of CHECKED_FOLDERS) {
    const root = join(templateFolder, folder);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      const file = join(entry.parentPath, entry.name);
      const path = relative(templateFolder, file).split(sep).join("/");
      const text = normalize(readFileSync(file, "utf8"));
      files.push(PLACEHOLDER.test(text) ? { path, template: text } : { path, sha256: hash(text) });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** True when a site's file is still the one create-brim wrote. */
export function isUnchanged(starter: StarterFile, content: string): boolean {
  const text = normalize(content);
  if (starter.sha256) return hash(text) === starter.sha256;
  if (starter.template === undefined) return false;
  // A filled-in value is one line of text (create-brim escapes it like a JSON string).
  const literal = starter.template.split(PLACEHOLDER).filter((_, index) => index % 2 === 0);
  const pattern = literal.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\n]*");
  return new RegExp(`^${pattern}$`).test(text);
}

// Git may check files out with CRLF on Windows; that is not a change.
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
