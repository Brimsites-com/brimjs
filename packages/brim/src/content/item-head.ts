import { type LocaleConfig, itemPagePath } from "../server/locales.ts";
import { type ContentType, optionLabel, standardField } from "./content-types.ts";
import { itemImage } from "./item-image.ts";
import type { Item } from "./items.ts";
import { referencedSlugs, termsBySlug } from "./references.ts";

/** Who wrote an item: a name as readers see it, with the page about them when there is one. */
export interface ItemAuthor {
  name: string;
  /** A path of the site, or a full address. */
  url?: string;
}

/**
 * What an item's page says about itself in its head when neither the owner (Page Settings) nor the page's code does:
 * read from the item's standard fields, whatever their labels.
 */
export interface ItemHead {
  title: string;
  description?: string;
  /** As stored: a file of the site or a full address. */
  image?: string;
  authors: ItemAuthor[];
  /** On an item of an `article` type; its dates as `YYYY-MM-DD`, when it has them. */
  article?: { published?: string; modified?: string };
}

interface Sources {
  types: ContentType[];
  /** The published items of a type, in every language. */
  publishedItems: (type: string) => Promise<Item[]>;
  locales?: LocaleConfig | undefined;
  now?: Date;
}

export async function itemHead(
  type: ContentType,
  item: Pick<Item, "title" | "data" | "locale">,
  sources: Sources,
): Promise<ItemHead> {
  const description = itemDescription(type, item);
  const image = itemImage(type, item);
  return {
    title: item.title,
    ...(description && { description }),
    ...(image && { image }),
    authors: await itemAuthors(type, item, sources),
    ...(type.article && { article: articleDates(type, item, sources.now) }),
  };
}

/** The item's `description`, when it has one filled in. */
export function itemDescription(type: ContentType, item: Pick<Item, "data">): string | undefined {
  return standardField(type, "description") ? words(item.data.description) : undefined;
}

/**
 * Who wrote the item: the `author` field's text, its chosen label, or the published items it points at (an author
 * nobody can see is not named). Each comes with a link when the term has a page, or a link of its own in a `url`
 * field.
 */
export async function itemAuthors(
  type: ContentType,
  item: Pick<Item, "data" | "locale">,
  { types, publishedItems, locales }: Pick<Sources, "types" | "publishedItems" | "locales">,
): Promise<ItemAuthor[]> {
  const field = standardField(type, "author");
  if (!field) return [];
  const value = item.data.author;
  if (field.type === "reference") {
    const slugs = referencedSlugs(item, "author");
    const target = types.find((candidate) => candidate.key === field.to);
    if (slugs.length === 0 || !target) return [];
    const all = await publishedItems(target.key);
    const terms = termsBySlug(
      all.filter((term) => term.locale === item.locale),
      all,
    );
    return slugs.flatMap((slug) => {
      const term = terms.get(slug);
      if (!term) return [];
      const url = target.component ? itemPagePath(target, term, locales) : linkOf(target, term);
      return [{ name: term.title, ...(url && { url }) }];
    });
  }
  const names = Array.isArray(value) ? value.map(words) : [words(value)];
  return names
    .filter((name) => name !== undefined)
    .map((name) => ({ name: field.type === "select" ? optionLabel(field, name, item.locale || undefined) : name }));
}

/**
 * An article's dates for search engines: those the item says, which are the ones its page can show. When it was
 * created or last saved is not one of them (an import, a corrected comma), nor is a date still to come.
 */
function articleDates(
  type: ContentType,
  item: Pick<Item, "data">,
  now = new Date(),
): { published?: string; modified?: string } {
  // The latest date it is anywhere in the world.
  const latest = new Date(now.getTime() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateOf = (name: "published" | "modified"): string | undefined => {
    const value = standardField(type, name) ? item.data[name] : undefined;
    return typeof value === "string" && value !== "" && value <= latest ? value : undefined;
  };
  const published = dateOf("published");
  const modified = dateOf("modified");
  return {
    ...(published && { published }),
    ...(modified && (!published || modified >= published) && { modified }),
  };
}

/** A term's own link: the first `url` field it has filled in with a full address. */
function linkOf(type: ContentType, term: Pick<Item, "data">): string | undefined {
  for (const field of type.fields) {
    const value = field.type === "url" ? term.data[field.name] : undefined;
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

function words(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}
