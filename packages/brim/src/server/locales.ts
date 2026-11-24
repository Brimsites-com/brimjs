import { normalizePagePath } from "../content/ids.ts";
import { type ItemPathType, fillItemPath, matchItemPath } from "../content/item-path.ts";

/** The part of Astro's `i18n` config Brim needs to tell which language a page is in. */
export interface LocaleConfig {
  defaultLocale: string;
  /** URL path segment of every language, e.g. `["en", "ro"]`. */
  locales: string[];
  /** Astro's `routing.prefixDefaultLocale`: the default language's pages are under `/en/` too. */
  prefixDefaultLocale?: boolean;
}

/** Mirrors Astro's routing: `/ro/despre` is Romanian, anything without a language prefix is the default. */
export function localeOfPath(pathname: string, config: LocaleConfig | undefined): string | undefined {
  if (!config) return undefined;
  const firstSegment = normalizePagePath(pathname).split("/")[1] ?? "";
  return config.locales.includes(firstSegment) ? firstSegment : config.defaultLocale;
}

/** The same page in another language: `/about` → `/ro/about`, `/ro/about` → `/about` (or `/en/about`). */
export function pathInLocale(pathname: string, locale: string, config: LocaleConfig): string {
  const path = normalizePagePath(pathname);
  const segments = path.split("/").slice(1).filter(Boolean);
  if (config.locales.includes(segments[0] ?? "")) segments.shift();
  const prefixed = locale !== config.defaultLocale || config.prefixDefaultLocale === true;
  return normalizePagePath(`/${[...(prefixed ? [locale] : []), ...segments].join("/")}`);
}

/**
 * How an item's language is stored: "" for the default language, the language's code for the others.
 * `undefined` for a code the site does not have.
 */
export function storedLocale(locale: string | undefined, config: LocaleConfig | undefined): string | undefined {
  if (!locale || !config || locale === config.defaultLocale) return "";
  return config.locales.includes(locale) ? locale : undefined;
}

/** The address of an item's page: `/projects/lake-house` (or its type's `path`), under its language unless that is the default one. */
export function itemPagePath(
  type: Pick<ItemPathType, "slug" | "path">,
  item: { slug: string; locale?: string; data?: Record<string, unknown> },
  config: LocaleConfig | undefined,
): string {
  const locale = item.locale ?? "";
  const code = locale || config?.defaultLocale;
  const prefixed = config && code && (locale !== "" || config.prefixDefaultLocale === true);
  return `${prefixed ? `/${code}` : ""}${fillItemPath(type, item)}`;
}

/**
 * Which of `types` an address is an item's page of, the item's slug and its language as stored ("" for the default
 * one). The address must have the shape `itemPagePath` gives: `/en/projects/lake` is not an item's when the default
 * language has no prefix, nor `/projects/lake` when it has one. Whether the item's own values (its category in
 * `/produse/[category]/[slug]`) agree is for the caller to check, with `itemPagePath`, once it has the item.
 */
export function readItemPath<T extends Pick<ItemPathType, "slug" | "path">>(
  types: T[],
  pathname: string,
  config: LocaleConfig | undefined,
): { type: T; slug: string; locale: string } | undefined {
  const path = normalizePagePath(pathname);
  const segments = path.split("/").slice(1);
  const code = config?.locales.includes(segments[0] ?? "") ? segments.shift() : undefined;
  const locale = storedLocale(code, config);
  if (locale === undefined) return undefined;
  const prefixed = config && (locale !== "" || config.prefixDefaultLocale === true);
  if (Boolean(code) !== Boolean(prefixed)) return undefined;
  for (const type of types) {
    const slug = matchItemPath(type, segments);
    if (slug !== undefined) return { type, slug, locale };
  }
  return undefined;
}
