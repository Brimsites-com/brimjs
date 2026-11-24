import type { Database } from "../db/database.ts";

/**
 * The query parameters each page or route reads, for a host that keeps pages in a CDN (`query` in
 * /admin/api/info, capability `query-params`): a path, or a pattern where `*` stands for any run of characters,
 * → the names it reads, or "all". The host keeps exactly those parameters in its cache key (and drops the others
 * from the request), so `?utm_source=…` or `?ref=…` on a page that reads none is the same cached copy. A path that
 * is not declared keeps every parameter, as before. The most specific pattern that matches wins: the longest.
 */
export type QueryRules = Record<string, readonly string[] | "all">;

/** What a host takes of a path and a name (the platform drops the rest, so Brim never sends one it would drop). */
export const QUERY_PATH = /^\/[\w\-./~%*[\]@+,:]{0,300}$/;
export const QUERY_NAME = /^[\w.\-[\]]{1,64}$/;
/** A host takes at most this many names per path; a path that reads more keeps all of them. */
const MAX_NAMES = 100;
/** At most this many paths are declared, within this size: what is left out keeps every parameter. */
const MAX_RULES = 450;
const MAX_JSON = 90_000;
/** At most this many pages are remembered per build (the pages of items each count as one). */
const MAX_LEARNED = 1000;

/**
 * Every page of a Brim.js site reads `?edit` (it opens the page in the editor), so every declared path keeps it.
 */
export const ALWAYS_READ = ["edit"] as const;

/** `brim({ query })` as written in the config: checked when the config loads, so a mistake stops the build. */
export function parseQueryRules(input: unknown): QueryRules {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error('brim({ query }) must be an object: { "/api/products": ["sort", "id"], "/shop/*": "all" }.');
  }
  const rules: QueryRules = {};
  for (const [path, names] of Object.entries(input as Record<string, unknown>)) {
    if (!QUERY_PATH.test(path)) {
      throw new Error(`brim({ query }): "${path}" is not a path (it starts with "/"; "*" stands for any characters).`);
    }
    if (names === "all") {
      rules[path] = "all";
      continue;
    }
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || !QUERY_NAME.test(name))) {
      throw new Error(
        `brim({ query }): "${path}" must list parameter names (letters, digits, "_", "-", ".", "[]"), or be "all".`,
      );
    }
    rules[path] = [...new Set(names as string[])];
  }
  return rules;
}

/** Whether a rule's path (or pattern) covers a path, as the host matches it. */
export function ruleMatches(pattern: string, pathname: string): boolean {
  if (pattern.includes("*")) {
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`).test(pathname);
  }
  return pattern === pathname || (pattern !== "/" && pattern === pathname.replace(/\/+$/, ""));
}

/** The rule that applies to a path: the longest pattern that matches, as the host decides. */
export function ruleFor(rules: QueryRules, pathname: string): readonly string[] | "all" | undefined {
  let best: string | undefined;
  for (const pattern of Object.keys(rules)) {
    if (best !== undefined && pattern.length <= best.length) continue;
    if (ruleMatches(pattern, pathname)) best = pattern;
  }
  return best === undefined ? undefined : rules[best];
}

/** A page's address as it is remembered and declared: without a trailing slash, except the home page. */
export function queryPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function union(...lists: (readonly string[] | "all" | undefined)[]): string[] | "all" {
  const names = new Set<string>();
  for (const list of lists) {
    if (list === "all") return "all";
    for (const name of list ?? []) names.add(name);
  }
  return [...names].sort();
}

/** A rule as a host takes it: a name it would drop, or too many names, and the path keeps every parameter. */
function sendable(names: string[] | "all"): string[] | "all" {
  if (names === "all") return "all";
  return names.length > MAX_NAMES || names.some((name) => !QUERY_NAME.test(name)) ? "all" : names;
}

/**
 * What /admin/api/info answers as `query`: the site's own declarations (`brim({ query })`) and the pages Brim saw
 * drawn and what they read. A page also keeps what every declaration covering it says, since its exact path is the
 * longest pattern and wins over them at the host. Every path keeps `edit`. Kept within what a host accepts; a path
 * left out keeps every parameter, so nothing is ever cut that a page reads.
 */
export function composeQueryRules(declared: QueryRules, learned: QueryRules): QueryRules {
  const rules: QueryRules = {};
  let size = 2;
  const add = (path: string, names: string[] | "all"): void => {
    if (!QUERY_PATH.test(path) || Object.keys(rules).length >= MAX_RULES) return;
    const entry = JSON.stringify(path).length + JSON.stringify(names).length + 2;
    if (size + entry > MAX_JSON) return;
    size += entry;
    rules[path] = names;
  };
  for (const [path, names] of Object.entries(declared)) add(path, sendable(union(names, ALWAYS_READ)));
  for (const [path, names] of Object.entries(learned)) {
    if (Object.hasOwn(rules, path)) continue;
    const covering = Object.entries(declared)
      .filter(([pattern]) => ruleMatches(pattern, path))
      .map(([, list]) => list);
    add(path, sendable(union(names, ALWAYS_READ, ...covering)));
  }
  return rules;
}

/**
 * The parameters each page read when it was drawn, remembered in the site's database for the build that drew them
 * (`brim_query_reads`), so a restarted server declares them at once. Another build may read others, so what an
 * earlier build learned is dropped. What a page reads only grows: a page that read `color` once keeps it.
 */
export class QueryReads {
  readonly #db: Database;
  readonly #build: string;
  #loaded: Promise<Map<string, string[] | "all">> | undefined;

  constructor(db: Database, build: string) {
    this.#db = db;
    this.#build = build;
  }

  #load(): Promise<Map<string, string[] | "all">> {
    this.#loaded ??= (async () => {
      await this.#db.query(
        "CREATE TABLE IF NOT EXISTS brim_query_reads (path TEXT PRIMARY KEY, build TEXT NOT NULL, names TEXT NOT NULL) WITHOUT ROWID",
      );
      await this.#db.query("DELETE FROM brim_query_reads WHERE build <> ?", [this.#build]);
      const rows = await this.#db.query("SELECT path, names FROM brim_query_reads WHERE build = ?", [this.#build]);
      const reads = new Map<string, string[] | "all">();
      for (const row of rows) {
        try {
          const names = JSON.parse(String(row.names)) as unknown;
          if (names === "all" || (Array.isArray(names) && names.every((name) => typeof name === "string"))) {
            reads.set(String(row.path), names as string[] | "all");
          }
        } catch {
          // A row that cannot be read is learned again.
        }
      }
      return reads;
    })();
    // A failure (the database not reachable a moment) is tried again on the next page.
    this.#loaded.catch(() => (this.#loaded = undefined));
    return this.#loaded;
  }

  /** Remembers what a page read; written only when it adds something. */
  async record(pathname: string, read: readonly string[] | "all"): Promise<void> {
    const path = queryPath(pathname);
    if (!QUERY_PATH.test(path)) return;
    const reads = await this.#load();
    const known = reads.get(path);
    if (!known && reads.size >= MAX_LEARNED) return;
    const next = union(known, read);
    if (known && (known === "all" || (next !== "all" && next.length === known.length))) return;
    reads.set(path, next);
    await this.#db.query(
      "INSERT INTO brim_query_reads (path, build, names) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET build = excluded.build, names = excluded.names",
      [path, this.#build, JSON.stringify(next)],
    );
  }

  async learned(): Promise<QueryRules> {
    return Object.fromEntries(await this.#load());
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the site's code: where it reads the query itself, and whether it said what it reads.

/** Code that reads a request's query: `Astro.url.searchParams`, `new URL(request.url).searchParams`, `url.search`. */
const READS_QUERY = /\bsearchParams\b|\bURLSearchParams\b|\burl\.search\b/;
/** The browser's own address (`location.search`) is not the request's: the host leaves it as it was. */
const BROWSER_ADDRESS = /\blocation\b/;
/** The site's code saying what it reads. */
const DECLARES = /\breadsQuery\s*\(/;

/** The lines of a file of the site's code that read the request's query (1-based). */
export function queryReadLines(text: string): number[] {
  const lines: number[] = [];
  text.split("\n").forEach((line, index) => {
    const code = line.trimStart();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
    if (READS_QUERY.test(line) && !BROWSER_ADDRESS.test(line)) lines.push(index + 1);
  });
  return lines;
}

/**
 * The address a file of `src/pages` answers at, with each `[param]` as a stand-in value, to see whether a declaration
 * covers it: `src/pages/shop/[slug].astro` → `/shop/_`. `undefined` for a file outside `src/pages`.
 */
export function pageRouteOf(file: string): string | undefined {
  const match = /(?:^|\/)src\/pages\/(.+)\.[a-z]+$/.exec(file.replaceAll("\\", "/"));
  if (!match?.[1]) return undefined;
  const segments = match[1].split("/").map((segment) => segment.replace(/\[[^\]]*\]/g, "_"));
  if (segments.at(-1) === "index") segments.pop();
  return `/${segments.join("/")}`;
}

export interface UndeclaredRead {
  /** As given. */
  file: string;
  line: number;
}

/**
 * Files of the site's code that read the request's query without saying what they read: neither calling
 * `readsQuery()` nor being a page of `src/pages` that a declaration in `brim({ query })` covers. While any is left,
 * Brim declares nothing for pages it saw drawn (it cannot know which page such code is part of): only the pages
 * that called `readsQuery()` and the config's own declarations.
 */
export function undeclaredQueryReads(files: { file: string; text: string }[], declared: QueryRules): UndeclaredRead[] {
  const found: UndeclaredRead[] = [];
  for (const { file, text } of files) {
    const lines = queryReadLines(text);
    if (lines.length === 0 || DECLARES.test(text)) continue;
    const route = pageRouteOf(file);
    if (route !== undefined && ruleFor(declared, route) !== undefined) continue;
    found.push({ file, line: lines[0] ?? 1 });
  }
  return found;
}

/** The paths an astro.config names in a `query` map, read from its text (for `brim check`, which does not run it). */
export function queryPathsInConfig(text: string): QueryRules {
  const start = text.search(/\bquery\s*:\s*\{/);
  if (start < 0) return {};
  const rules: QueryRules = {};
  for (const match of text.slice(start).matchAll(/["'`](\/[^"'`]*)["'`]\s*:/g)) {
    if (match[1]) rules[match[1]] = "all";
  }
  return rules;
}
