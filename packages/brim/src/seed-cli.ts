import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { SeedEntry } from "./content/seed.ts";

/**
 * `brim seed`: the site's starting content, kept in git as `seed/<type>.json` with its pictures in `seed/images/`,
 * added to a running site through its admin API, which checks it exactly as the editor would and stores the
 * pictures where the site keeps its media (public/uploads, or the CDN it is set up with).
 *
 * It never changes what is there: the site adds only the items it does not have (same type, slug and language).
 * It talks to the dev server on this computer unless told otherwise, signed in with an access token it creates in
 * the local database and deletes when done; a site elsewhere needs its address and a token, given on purpose.
 */

export interface SeedTarget {
  /** The site's address, without a trailing slash. */
  url: string;
  token: string;
}

interface Planned {
  index: number;
  type: string;
  slug: string;
  title: string;
  locale: string;
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"]);

/** A site on this computer: the only one `brim seed` signs in to by itself. */
export function isLocalSite(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** Reads `seed/*.json`: each file a list of items, of the type its name says unless an item names its own. */
export async function readSeed(folder: string): Promise<SeedEntry[]> {
  if (!existsSync(folder)) throw new Error(`There is no ${folder} folder. Write the seed as ${folder}/<type>.json.`);
  const files = (await readdir(folder)).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`${folder} has no .json files: write the seed as ${folder}/<type>.json.`);
  const entries: SeedEntry[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(folder, file), "utf8"));
    } catch (error) {
      throw new Error(`${folder}/${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${folder}/${file} must be a list of items.`);
    const type = basename(file, ".json");
    for (const entry of parsed) {
      entries.push(
        typeof entry === "object" && entry !== null && !("type" in entry) ? { type, ...entry } : (entry as SeedEntry),
      );
    }
  }
  return entries;
}

/** A picture's address in the seed that names a file next to it (`images/arc.webp`), not one on the web. */
function isLocalFile(src: string): boolean {
  return !/^(\/|[a-z][a-z0-9+.-]*:)/i.test(src) && IMAGE_EXTENSIONS.has(extname(src).toLowerCase());
}

/** Calls `change` on every `src` in a value (image fields, galleries, blocks, rich text) and keeps what it answers. */
function mapSources(value: unknown, change: (src: string) => string): unknown {
  if (Array.isArray(value)) return value.map((entry) => mapSources(entry, change));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "src" && typeof entry === "string" ? change(entry) : mapSources(entry, change),
    ]),
  );
}

async function call<T>(target: SeedTarget, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${target.url}/admin/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${target.token}`,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }).catch((error: unknown) => {
    throw new Error(
      `Could not reach ${target.url} (${error instanceof Error ? error.message : error}). Start the site first ` +
        "(npm run dev), or give its address with --url.",
    );
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `${method} ${path} answered ${response.status}.`);
  return data;
}

export interface SeedResult {
  create: Planned[];
  existing: { type: string; slug: string; locale: string }[];
  /** Missing on a dry run. */
  added?: { id: string; type: string; slug: string }[];
  uploaded: number;
}

/**
 * Adds the seed in `folder` to the site: checks it whole first (pictures stand in by name), then uploads the
 * pictures of the items that will be added, and only then adds them.
 */
export async function runSeed(folder: string, target: SeedTarget, dryRun: boolean): Promise<SeedResult> {
  const root = resolve(folder);
  const entries = await readSeed(root);
  for (const entry of entries) {
    mapSources(entry.data, (src) => {
      if (isLocalFile(src) && !existsSync(join(root, src))) throw new Error(`${folder}/${src} does not exist.`);
      return src;
    });
  }
  const standIns = entries.map((entry) => ({
    ...entry,
    data: mapSources(entry.data, (src) => (isLocalFile(src) ? `/uploads/seed/${basename(src)}` : src)),
  }));
  const plan = await call<{ create: Planned[]; existing: SeedResult["existing"] }>(target, "POST", "/seed", {
    items: standIns,
    dryRun: true,
  });
  if (dryRun || plan.create.length === 0) return { ...plan, uploaded: 0 };

  const uploaded = new Map<string, string>();
  const ready: SeedEntry[] = [];
  for (const { index } of plan.create) {
    const entry = entries[index] as SeedEntry;
    const files = new Set<string>();
    mapSources(entry.data, (src) => (isLocalFile(src) && files.add(src), src));
    for (const src of files) {
      if (uploaded.has(src)) continue;
      const response = await fetch(`${target.url}/admin/api/media`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${target.token}`,
          "content-type": "application/octet-stream",
          "x-file-name": encodeURIComponent(basename(src)),
        },
        body: await readFile(join(root, src)),
      });
      const data = (await response.json().catch(() => ({}))) as { file?: { url: string }; error?: string };
      if (!response.ok || !data.file) throw new Error(`${folder}/${src}: ${data.error ?? response.status}`);
      uploaded.set(src, data.file.url);
    }
    ready.push({
      ...entry,
      data: mapSources(entry.data, (src) => uploaded.get(src) ?? src) as Record<string, unknown>,
    });
  }
  // Only what the plan adds is sent again: the site adds it, and would leave the rest as it is anyway.
  const result = await call<{ added: SeedResult["added"]; existing: SeedResult["existing"] }>(target, "POST", "/seed", {
    items: ready,
  });
  return {
    create: plan.create,
    existing: plan.existing,
    ...(result.added && { added: result.added }),
    uploaded: uploaded.size,
  };
}

/**
 * `brim seed --export`: the site's items written to `folder/<type>.json`, with the pictures they use from the
 * media library copied into `folder/images/`, so the content can be kept in git as the site's starting content.
 * Refuses to write over seed files that exist unless `force`.
 */
export async function exportSeedFiles(
  folder: string,
  target: SeedTarget,
  force: boolean,
): Promise<{ files: string[]; items: number; images: number }> {
  const root = resolve(folder);
  const { items } = await call<{ items: (SeedEntry & { type: string })[] }>(target, "GET", "/seed");
  const byType = new Map<string, SeedEntry[]>();
  for (const { type, ...entry } of items) byType.set(type, [...(byType.get(type) ?? []), entry as SeedEntry]);
  const files = [...byType.keys()].map((type) => `${type}.json`);
  const taken = files.filter((file) => existsSync(join(root, file)));
  if (taken.length > 0 && !force) {
    throw new Error(`${folder} already has ${taken.join(", ")}: add --force to write over them.`);
  }

  await mkdir(join(root, "images"), { recursive: true });
  const saved = new Map<string, string>();
  const names = new Set<string>();
  /** Copies a picture into images/, named after the item that uses it first: `ceramica.webp`, `art-2.webp`. */
  const copy = async (src: string, name: string): Promise<void> => {
    if (!src.startsWith("/uploads/") || saved.has(src)) return;
    const response = await fetch(`${target.url}${src}`);
    if (!response.ok) return;
    const extension = extname(src).toLowerCase();
    let file = `${name}${extension}`;
    for (let count = 2; names.has(file) || (existsSync(join(root, "images", file)) && !force); count++) {
      file = `${name}-${count}${extension}`;
    }
    names.add(file);
    await writeFile(join(root, "images", file), new Uint8Array(await response.arrayBuffer()));
    saved.set(src, `images/${file}`);
  };

  for (const [type, entries] of byType) {
    const written: SeedEntry[] = [];
    for (const entry of entries) {
      const sources = new Set<string>();
      mapSources(entry.data, (src) => (sources.add(src), src));
      let count = 0;
      for (const src of sources)
        await copy(src, count++ === 0 ? (entry.slug ?? type) : `${entry.slug ?? type}-${count}`);
      written.push({
        ...entry,
        data: mapSources(entry.data, (src) => saved.get(src) ?? src) as Record<string, unknown>,
      });
    }
    await writeFile(join(root, `${type}.json`), `${JSON.stringify(written, null, 2)}\n`);
  }
  return { files, items: items.length, images: saved.size };
}

export interface ContentFindingView {
  rule: string;
  where: string;
  message: string;
}

/** What the running site's content still gets wrong, as `brim check --content` reports it. */
export async function contentFindings(target: SeedTarget): Promise<ContentFindingView[]> {
  return (await call<{ findings: ContentFindingView[] }>(target, "GET", "/check/content")).findings;
}

export function formatContentFindings(findings: ContentFindingView[]): string {
  if (findings.length === 0) return "Content: nothing left from testing, no unused terms, every page in the sitemap.";
  const titles: Record<string, string> = {
    placeholder: "Values left from testing or a template",
    "empty-term": "Terms nothing uses",
    "unlisted-pages": "Pages missing from the sitemap",
  };
  const lines = [`Content: ${findings.length} warning(s).`];
  for (const rule of Object.keys(titles)) {
    const group = findings.filter((finding) => finding.rule === rule);
    if (group.length === 0) continue;
    lines.push("", `${titles[rule]}:`);
    for (const finding of group) lines.push(`  ${finding.where}`, `      ${finding.message}`);
  }
  return lines.join("\n");
}
