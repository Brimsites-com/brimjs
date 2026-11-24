import { AsyncLocalStorage } from "node:async_hooks";
import { ALWAYS_READ } from "../server/query-params.ts";

/** What one page read of its address's query while it was drawn. */
export class QueryCollector {
  readonly names = new Set<string>(ALWAYS_READ);
  all = false;
  /** The site's own code said what it reads (`readsQuery`), not only Brim's blocks. */
  bySite = false;

  get read(): string[] | "all" {
    return this.all ? "all" : [...this.names];
  }
}

const collectors = new AsyncLocalStorage<QueryCollector>();

/** Draws a page (`run`) noting the query parameters its parts read. */
export function collectingQueryReads<T>(collector: QueryCollector, run: () => T): T {
  return collectors.run(collector, run);
}

/** Brim's own blocks note what they read here (the Listing's search, facets and pages; the Search's words). */
export function noteQueryReads(names: readonly string[] | "all", bySite = false): void {
  const collector = collectors.getStore();
  if (!collector) return;
  if (bySite) collector.bySite = true;
  if (names === "all") collector.all = true;
  else for (const name of names) collector.names.add(name);
}

/**
 * Says which query parameters of the address the page or endpoint being drawn reads, so a host that keeps pages in
 * a CDN (Brimsites) keeps those, and only those, in its cache key: `?ref=newsletter` on a page that reads none is
 * the same cached page, and a page reading `?sort=` gets one copy per sort. `"all"` keeps every parameter.
 *
 *   ---
 *   import { readsQuery } from "brimjs/server";
 *   readsQuery(["sort", "color"]);
 *   const sort = Astro.url.searchParams.get("sort");
 *   ---
 *
 * Call it each time the page is drawn, wherever it reads them (a component of the page may call it too). Brim's
 * own blocks (Listing, Search) declare what they read by themselves. A route whose address is known ahead can be
 * declared in the config instead: `brim({ query: { "/api/products": ["sort", "id"] } })`.
 */
export function readsQuery(names: readonly string[] | "all"): void {
  noteQueryReads(names, true);
}
