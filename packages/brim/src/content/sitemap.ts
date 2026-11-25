import { type LocaleConfig, itemPagePath } from "../server/locales.ts";
import { fillItemPath, itemPathSegments } from "./item-path.ts";
import type { ContentType } from "./content-types.ts";
import { normalizePagePath } from "./ids.ts";
import type { Item, ItemStore } from "./items.ts";
import type { PageTemplate } from "./page-templates.ts";
import type { ContentStore } from "./store.ts";

/** The site's routes as Astro resolved them, which is all the sitemap needs to know about the code. */
export interface SiteRoutes {
  /** Pages with a fixed address, written in `src/pages`. */
  pages: string[];
  /** Patterns of dynamic pages, e.g. `/projects/[slug]`: the pages of items a type without a template has. */
  patterns: string[];
}

export interface SitemapEntry {
  path: string;
  /** `YYYY-MM-DD`, when Brim knows when the page last changed. */
  lastModified?: string;
}

interface Sources {
  content: ContentStore;
  items: ItemStore;
  contentTypes: ContentType[];
  pageTemplates: PageTemplate[];
  routes: SiteRoutes;
  /** The site's languages: an item in another language has its page under that language's prefix. */
  locales?: LocaleConfig | undefined;
}

/**
 * Every page the public build contains and search engines may list: pages written in code, pages added
 * from templates and the pages of content items, published and not hidden from search engines.
 * It reads the content when asked, so a page or item the owner just added is in the next sitemap.
 */
export async function sitemapEntries({
  content,
  items,
  contentTypes,
  pageTemplates,
  routes,
  locales,
}: Sources): Promise<SitemapEntry[]> {
  const listed = new Map<string, SitemapEntry>();
  const templateKeys = new Set(pageTemplates.map((template) => template.key));

  const pages = [
    ...(await Promise.all([...new Set(routes.pages.map(normalizePagePath))].map((path) => content.page(path)))),
    // A page whose template left the code is not built, so it is not listed either.
    ...(await content.templatePages({ publishedOnly: true })).filter((page) => templateKeys.has(page.template ?? "")),
  ];
  for (const page of pages) {
    if (page.visibility === "published" && !page.seo.noindex && pointsHere(page.path, page.seo.canonical)) {
      listed.set(page.path, { path: page.path });
    }
  }

  // An item's page takes the same settings by address as any page: "hide from search engines" and a canonical
  // address elsewhere keep it out, as they do for pages.
  const seoByPath = await content.pageSeoSettings();
  for (const type of contentTypes) {
    for (const item of await items.list(type.key, { publishedOnly: true, sort: "oldest" })) {
      const path = itemPagePath(type, item, locales);
      if (!itemHasPage(type, item, path, routes)) continue;
      const seo = seoByPath.get(normalizePagePath(path));
      if (seo?.noindex || !pointsHere(normalizePagePath(path), seo?.canonical)) continue;
      listed.set(path, { path, lastModified: item.updatedAt.slice(0, 10) });
    }
  }
  return [...listed.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Whether the item at `path` (from `itemPagePath`) has a page. A type with a template has a page per item, in every
 * language. Without one, an item has a page only where the code draws one: `/projects/[slug]`, `/ro/projects/[slug]`
 * or `/[locale]/…`.
 */
export function itemHasPage(
  type: ContentType,
  item: Pick<Item, "slug" | "data">,
  path: string,
  routes: SiteRoutes,
): boolean {
  if (type.component) return true;
  const own = fillItemPath(type, item);
  const prefix = path.slice(0, path.length - own.length);
  const hasPages = (start: string) => routes.patterns.some((pattern) => drawsItems(type, pattern, start));
  return hasPages(prefix) || (prefix !== "" && (hasPages("/[locale]") || hasPages("/[lang]")));
}

/**
 * Whether a route of the code draws a type's items: `/projects/[slug]` for `/projects/<item>`, and for a `path`
 * like `/produse/[category]/[slug]` a route with the same fixed segments and a parameter at each of its own.
 */
function drawsItems(type: ContentType, pattern: string, prefix: string): boolean {
  if (!pattern.startsWith(`${prefix}/`)) return false;
  const segments = itemPathSegments(type);
  if (type.path === undefined) return pattern.startsWith(`${prefix}/${type.slug}/[`);
  const parts = pattern.slice(prefix.length).split("/").slice(1);
  return (
    parts.length === segments.length &&
    segments.every((segment, index) => {
      const part = parts[index] ?? "";
      return "fixed" in segment ? part === segment.fixed : part.startsWith("[") && !part.startsWith("[...");
    })
  );
}

/**
 * Whether a dynamic route of the code draws the items of one of the types, with or without a language in front: a
 * route that draws none is a set of pages the sitemap cannot list, since only the route knows its addresses.
 */
export function routeDrawsItems(types: ContentType[], pattern: string): boolean {
  return types.some((type) => ["", "/[locale]", "/[lang]"].some((prefix) => drawsItems(type, pattern, prefix)));
}

/** A page whose canonical address is another page's is that page's duplicate: search engines list the other. */
function pointsHere(path: string, canonical: string | undefined): boolean {
  if (!canonical) return true;
  if (!canonical.startsWith("/")) return false;
  return normalizePagePath(new URL(canonical, "https://site.invalid").pathname) === path;
}

/** The sitemap protocol's XML (sitemaps.org). `site` is the public address, e.g. `https://example.com`. */
export function sitemapXml(entries: SitemapEntry[], site: string | URL): string {
  const urls = entries.map(({ path, lastModified }) => {
    const location = escapeXml(new URL(path, site).href);
    return `  <url><loc>${location}</loc>${lastModified ? `<lastmod>${lastModified}</lastmod>` : ""}</url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
