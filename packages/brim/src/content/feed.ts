import { type LocaleConfig, itemPagePath, storedLocale } from "../server/locales.ts";
import { type ContentType, type FeedOptions, feedOptionsOf } from "./content-types.ts";
import { itemImage } from "./item-image.ts";
import type { Item, ItemStore } from "./items.ts";
import { type SiteRoutes, escapeXml, itemHasPage } from "./sitemap.ts";
import type { ContentStore } from "./store.ts";
import type { InlineNode, RichTextValue } from "./types.ts";

/** Where feeds live: `/rss/<slug>.xml`, and `/rss/<locale>/<slug>.xml` for a language other than the default. */
export const FEED_PREFIX = "/rss/";
const DEFAULT_LIMIT = 20;
const SUMMARY_LENGTH = 300;

/** One feed: a content type that has one, in one of the site's languages. */
export interface FeedAddress {
  type: ContentType;
  /** The language's code, or "" for the default one (and on a site with one language). */
  locale: string;
  /** `/rss/blog.xml`, `/rss/ro/blog.xml`. */
  path: string;
}

export interface FeedItem {
  title: string;
  /** The item's page, from the site's root: `/blog/spring`. */
  path: string;
  /** Stays the same when the item's address changes, so readers do not show it again. */
  id: string;
  published: Date;
  updated: Date;
  summary?: string;
  /** The item's own picture, as stored: an address on the site or a full one. */
  image?: string;
}

export interface Feed {
  title: string;
  description?: string;
  /** The page the feed is about: the type's listing page when the code has one at `/<slug>`, else the home page. */
  homePath: string;
  /** The feed's own address, from the site's root. */
  path: string;
  /** The feed's language code, on a site with languages. */
  language?: string;
  items: FeedItem[];
}

/** The path of a type's feed in a language ("" or the default code for the default one). */
export function feedPath(type: ContentType, locale: string, locales: LocaleConfig | undefined): string {
  const stored = storedLocale(locale, locales) ?? "";
  return `${FEED_PREFIX}${stored ? `${stored}/` : ""}${type.slug}.xml`;
}

/** The feed's title: the one its options give, else the type's label after the site's name. */
export function feedTitle(type: ContentType, siteName: string | undefined): string {
  const chosen = feedOptionsOf(type)?.title;
  return chosen ?? (siteName ? `${siteName} · ${type.label}` : type.label);
}

/** Every feed the site has: each type with `feed` set, in each of the site's languages. */
export function feedAddresses(contentTypes: ContentType[], locales: LocaleConfig | undefined): FeedAddress[] {
  const languages = locales ? ["", ...locales.locales.filter((code) => code !== locales.defaultLocale)] : [""];
  return contentTypes
    .filter((type) => feedOptionsOf(type))
    .flatMap((type) => languages.map((locale) => ({ type, locale, path: feedPath(type, locale, locales) })));
}

/** The feed at a path under `/rss/`, written without the prefix (`blog.xml`, `ro/blog.xml`); `undefined` if none. */
export function feedAt(
  rest: string,
  contentTypes: ContentType[],
  locales: LocaleConfig | undefined,
): FeedAddress | undefined {
  const path = `${FEED_PREFIX}${rest.replace(/^\/+/, "")}`;
  return feedAddresses(contentTypes, locales).find((address) => address.path === path);
}

interface Sources {
  content: ContentStore;
  items: ItemStore;
  routes: SiteRoutes;
  locales?: LocaleConfig | undefined;
  /** The site's name, put before the type's label in the feed's title. */
  siteName?: string | undefined;
}

/**
 * A feed's newest published items, those with a page a visitor can open: an item that is private, has no page, or
 * whose page is behind a password is left out. Read when asked, so an item just published is in the next feed.
 */
export async function buildFeed(
  { type, locale, path }: FeedAddress,
  { content, items, routes, locales, siteName }: Sources,
): Promise<Feed> {
  const options: FeedOptions = feedOptionsOf(type) ?? {};
  const passwords = await content.pagePasswords(); // betterleaks:allow
  const listed = await items.list(type.key, {
    publishedOnly: true,
    sort: "newest",
    ...(locales && { locale }),
  });
  const dateField = options.date ?? type.fields.find((field) => field.type === "date")?.name;
  const candidates = listed
    .map((item) => ({ item, path: itemPagePath(type, item, locales) }))
    .filter(({ item, path }) => !passwords[path] && itemHasPage(type, item, path, routes))
    .map((entry) => ({ ...entry, published: publishedAt(entry.item, dateField) }))
    .sort((a, b) => b.published.getTime() - a.published.getTime())
    .slice(0, options.limit ?? DEFAULT_LIMIT);

  const feedItems = await Promise.all(
    candidates.map(async ({ item, path, published }): Promise<FeedItem> => {
      const summary = await summaryOf(type, item, options.summary, () => content.page(path));
      const image = itemImage(type, item);
      return {
        title: item.title,
        path,
        id: item.id,
        published,
        updated: new Date(item.updatedAt),
        ...(summary && { summary }),
        ...(image && { image }),
      };
    }),
  );

  const language = locales ? locale || locales.defaultLocale : undefined;
  const prefix = locales && (locale || locales.prefixDefaultLocale) ? `/${language}` : "";
  const listing = `${prefix}/${type.slug}`;
  return {
    title: feedTitle(type, siteName),
    ...(options.description && { description: options.description }),
    homePath: routes.pages.includes(listing) ? listing : `${prefix}/`,
    path,
    ...(language && { language }),
    items: feedItems,
  };
}

/** The item's date field when it holds a date, else when it was created. */
function publishedAt(item: Item, field: string | undefined): Date {
  const value = field ? item.data[field] : undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(item.createdAt);
}

async function summaryOf(
  type: ContentType,
  item: Item,
  chosen: string | undefined,
  page: () => Promise<{ seo: { description?: string } }>,
): Promise<string | undefined> {
  const read = (name: string | undefined): string | undefined => {
    const value = name ? item.data[name] : undefined;
    if (typeof value === "string") return value.trim() || undefined;
    if (value && typeof value === "object" && Array.isArray((value as RichTextValue).blocks)) {
      return shorten(plainText(value as RichTextValue));
    }
    return undefined;
  };
  if (chosen) return read(chosen);
  return (
    read(type.fields.find((field) => field.type === "textarea")?.name) ??
    ((await page()).seo.description?.trim() || undefined) ??
    read(type.fields.find((field) => field.type === "richtext")?.name)
  );
}

/** The words of rich text, a block per line. */
export function plainText(value: RichTextValue): string {
  const inline = (nodes: InlineNode[]): string =>
    nodes.map((node) => (typeof node === "string" ? node : node.tag === "br" ? " " : inline(node.children))).join("");
  return value.blocks
    .map((block) => ("items" in block ? block.items.map(inline).join(" ") : inline(block.children)))
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
}

function shorten(text: string): string | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  if (flat.length <= SUMMARY_LENGTH) return flat;
  const cut = flat.slice(0, SUMMARY_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : SUMMARY_LENGTH).trimEnd()}…`;
}

/** RSS 2.0 (rssboard.org), with the feed's own address as `atom:link` and pictures as `media:content`. */
export function rssXml(feed: Feed, site: string | URL): string {
  const absolute = (address: string) => escapeXml(new URL(address, site).href);
  const tag = (name: string, value: string) => `<${name}>${escapeXml(value)}</${name}>`;
  const newest = feed.items.reduce<Date | undefined>(
    (latest, item) => (!latest || item.updated > latest ? item.updated : latest),
    undefined,
  );
  const items = feed.items.map((item) =>
    [
      "    <item>",
      `      ${tag("title", item.title)}`,
      `      <link>${absolute(item.path)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(item.id)}</guid>`,
      `      <pubDate>${item.published.toUTCString()}</pubDate>`,
      ...(item.summary ? [`      ${tag("description", item.summary)}`] : []),
      ...(item.image ? [`      <media:content url="${absolute(item.image)}" medium="image" />`] : []),
      "    </item>",
    ].join("\n"),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
    "  <channel>",
    `    ${tag("title", feed.title)}`,
    `    <link>${absolute(feed.homePath)}</link>`,
    // RSS needs a description; a feed without its own says what it is.
    `    ${tag("description", feed.description ?? feed.title)}`,
    `    <atom:link href="${absolute(feed.path)}" rel="self" type="application/rss+xml" />`,
    ...(feed.language ? [`    ${tag("language", feed.language)}`] : []),
    ...(newest ? [`    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>`] : []),
    "    <generator>Brim.js</generator>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
