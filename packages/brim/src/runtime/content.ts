import config from "virtual:brim/config";
import type { DataOf, Typed } from "../content/field-types.ts";
import { type ContentType, optionLabel } from "../content/content-types.ts";
import { referencedSlugs, termsBySlug } from "../content/references.ts";
import { siteScope } from "../content/ids.ts";
import { SITE_SETTINGS_NODE, settingsValues } from "../content/site-settings.ts";
import type { Item, ItemSort } from "../content/items.ts";
import { connect } from "./connect.ts";
import { itemPagePath, storedLocale } from "../server/locales.ts";
import { currentLocale, isEditing, isPreviewing, perRequest } from "./request-state.ts";

/**
 * An item as pages use it: its fields, plus the address of its own page. `Data` is the type of its fields, inferred
 * from its content type (`ItemOf<typeof product>`), or an open record.
 */
export type ContentItem<Data = Record<string, unknown>> = Omit<Item, "data"> & {
  data: Data;
  /** `/projects/lake-house`, or `/ro/projects/casa-de-la-lac` for an item in another language. */
  url: string;
};

/** An item of a content type declared with `defineContentType`, with its fields typed: `ItemOf<typeof product>`. */
export type ItemOf<T> = ContentItem<DataOf<T>>;

/**
 * What a content type's template receives: the item whose page it draws. `ItemPageProps<typeof product>` types its
 * fields: `const { item } = Astro.props as ItemPageProps<typeof product>`.
 */
export interface ItemPageProps<T = unknown> {
  item: ItemOf<T>;
}

/** The values `getSiteSettings` answers: typed by the declaration passed, by an explicit type, or an open record. */
type SettingsValuesOf<T> = T extends Typed<infer Data> ? Data : unknown extends T ? Record<string, unknown> : T;

/** A content type as code names it: by its key (`"product"`), or the declaration itself, which types its items. */
type TypeRef = string | (ContentType & Typed<unknown>);
type ItemsOf<T> = T extends string ? ContentItem : ItemOf<T>;
const keyOf = (type: TypeRef): string => (typeof type === "string" ? type : type.key);

export interface ItemQuery {
  sort?: ItemSort;
  limit?: number;
  /**
   * Which language: a code the site declares in Astro's `i18n`, or `"*"` for all of them (for `getStaticPaths`
   * of a page under `[locale]`). By default the language of the page being drawn, else the default one.
   * On a site without languages every item is in "the" language and this is ignored.
   */
  locale?: string;
}

/** How the database stores the language asked for (by default the page's, else the default one). */
function localeOf(wanted: string | undefined): string {
  const locales = config.locales;
  if (!locales) return "";
  const code = wanted ?? currentLocale() ?? locales.defaultLocale;
  const locale = storedLocale(code, locales);
  if (locale === undefined) throw new Error(`"${code}" is not one of the site's languages (Astro's i18n.locales).`);
  return locale;
}

export function getContentType(key: string): ContentType {
  const type = config.contentTypes.find((candidate) => candidate.key === key);
  if (!type) throw new Error(`Content type "${key}" is not declared. Export it from src/content-types/index.ts.`);
  return type;
}

/**
 * What a page shows for a saved choice of a `select` field: `choiceLabel("product", "category", "ceramica")` is
 * `Ceramică` when the field declares `{ value: "ceramica", label: "Ceramică" }`, else the value itself.
 */
export function choiceLabel(key: string, field: string, value: unknown): string {
  const declared = getContentType(key).fields.find((candidate) => candidate.name === field);
  const text = value === undefined || value === null ? "" : String(value);
  return declared ? optionLabel(declared, text, currentLocale()) : text;
}

/** The address of an item's page (its type's `path`, else `/<slug>/<item>`), under its language unless that is the default. */
export function itemPath(type: ContentType, item: Pick<Item, "slug" | "locale" | "data">): string {
  return itemPagePath(type, item, config.locales);
}

/**
 * Items of a content type, for listings and for `getStaticPaths`.
 * Visitors get published items only; while editing, private ones are included too.
 * On a site with languages, the items of the page's language (see `ItemQuery.locale`).
 */
export async function getItems<T extends TypeRef>(of: T, query: ItemQuery = {}): Promise<ItemsOf<T>[]> {
  const type = getContentType(keyOf(of));
  const { items } = await connect(config.databaseUrl, config.authToken);
  const { locale: wanted, ...rest } = query;
  const locale = config.locales && wanted !== "*" ? localeOf(wanted) : undefined;
  const { drafts } = await connect(config.databaseUrl, config.authToken);
  const options = {
    ...(type.ordered && { sort: "position" as const }),
    ...rest,
    publishedOnly: !isEditing(),
    ...(locale !== undefined && { locale }),
  };
  const preview = isPreviewing();
  const listed = await perRequest(`items|${type.key}|${JSON.stringify(options)}|${preview}`, async () => {
    const saved = await items.listCached(type.key, options);
    return preview ? await drafts.overlayItems(saved) : saved;
  });
  return listed.map((item) => ({ ...item, url: itemPath(type, item) }) as ItemsOf<T>);
}

/**
 * One item by the slug in its address, for the page of an item: `getItem("project", Astro.params.slug)`.
 * In the page's language on a site with languages; `undefined` when there is none, or when it is private and
 * the visitor is not editing.
 */
export async function getItem<T extends TypeRef>(
  of: T,
  slug: string | undefined,
  query: Pick<ItemQuery, "locale"> = {},
): Promise<ItemsOf<T> | undefined> {
  if (!slug) return undefined;
  // The preview shows unsaved drafts, whose address may differ from the saved one: it looks among them all.
  if (isPreviewing()) return (await getItems(of, query)).find((item) => item.slug === slug);
  const type = getContentType(keyOf(of));
  const { items } = await connect(config.databaseUrl, config.authToken);
  const item = await items.bySlug(type.key, slug, {
    publishedOnly: !isEditing(),
    ...(config.locales && query.locale !== "*" && { locale: localeOf(query.locale) }),
  });
  return item ? ({ ...item, url: itemPath(type, item) } as ItemsOf<T>) : undefined;
}

/**
 * The items a reference field of an item points at, in the order it names them, in the page's language: a product's
 * category (`(await getReferences("product", product, "category"))[0]`) or its brands. Visitors get published ones.
 */
export async function getReferences(of: TypeRef, item: { data: object }, field: string): Promise<ContentItem[]> {
  const key = keyOf(of);
  const declared = getContentType(key).fields.find((candidate) => candidate.name === field);
  if (declared?.type !== "reference" || !declared.to) {
    throw new Error(`"${field}" is not a reference field of the content type "${key}".`);
  }
  const terms = await getTerms(declared.to);
  return referencedSlugs(item as { data: Record<string, unknown> }, field).flatMap((slug) => {
    const term = terms.get(slug);
    return term ? [term] : [];
  });
}

/**
 * The terms of a vocabulary by slug, as the page's language shows them. A term's translations share its slug, so a
 * product in English that points at `faianta` finds the English `faianta`; a term not translated yet is the one in
 * its original language, rather than missing from the page (or shown as its bare slug in a listing's filters).
 */
export async function getTerms(of: TypeRef): Promise<Map<string, ContentItem>> {
  const key = keyOf(of);
  const own = await getItems(key);
  return config.locales ? termsBySlug(own, await getItems(key, { locale: "*" })) : termsBySlug(own, []);
}

/** The item in every language it is written in, for a language switcher on the item's page. */
export async function getTranslations(key: string, item: Item): Promise<ContentItem[]> {
  const type = getContentType(key);
  const { items, drafts } = await connect(config.databaseUrl, config.authToken);
  const translations = await items.translations(item);
  const all = isPreviewing() ? await drafts.overlayItems(translations) : translations;
  return all
    .filter((candidate) => isEditing() || candidate.visibility === "published")
    .map((candidate) => ({ ...candidate, url: itemPath(type, candidate) }));
}

export { type ImageSources, imageSources, mediaUrl } from "./media.ts";

/**
 * The site's own settings (`src/site-settings.ts`) as the page should show them: what the owner saved in Site
 * Settings, over the code's defaults, in the page's language. A field the owner emptied is `null`.
 *
 *   const { phone, email, instagram } = await getSiteSettings();
 */
export async function getSiteSettings<T = Record<string, unknown>>(
  /** The declaration (`siteSettings` from src/site-settings.ts), which types the values it answers. */
  _declared?: T,
): Promise<SettingsValuesOf<T>> {
  type Values = SettingsValuesOf<T>;
  if (!config.siteSettings) return {} as Values;
  const { content } = await connect(config.databaseUrl, config.authToken);
  const scope = siteScope(currentLocale() ?? config.locales?.defaultLocale);
  const nodes = await perRequest(`nodes|${scope}`, () => content.loadNodes([scope]));
  const saved = nodes.find((node) => node.nodeId === SITE_SETTINGS_NODE);
  return settingsValues(config.siteSettings, saved?.value) as Values;
}
