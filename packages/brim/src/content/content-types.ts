import { type LocaleConfig, readItemPath } from "../server/locales.ts";
import { checkItemPath, isSlug } from "./item-path.ts";
import type { BlockLayout } from "./block-layout.ts";
import type { FieldsData, Typed } from "./field-types.ts";
import type { PageComponent } from "./page-templates.ts";

export type FieldType =
  | "text"
  | "textarea"
  | "richtext"
  | "number"
  | "boolean"
  | "date"
  | "url"
  | "email"
  | "select"
  | "image"
  | "gallery"
  | "blocks"
  | "tags"
  | "keyvalue"
  | "reference";

/** What the owner can stack in a `blocks` field: rich text, and Brim's blocks that need nothing from the page's code. */
export const BLOCK_TYPES = [
  "richtext",
  "image",
  "image-gallery",
  "carousel",
  "video",
  "button",
  "accordion",
  "divider",
  "map",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * One block of a `blocks` field: an id of its own, its kind, its value (rich text, or the block's settings) and how it
 * sits in the field (its width and side, see block-layout.ts).
 */
export interface BlockEntry {
  id: string;
  type: BlockType;
  value: Record<string, unknown>;
  layout?: BlockLayout;
}

/**
 * A choice of a `select` field: a plain string is both what is saved and what is shown; `{ value, label }` saves
 * the value (`ceramica`, fit for an address) and shows the label (`Ceramică`).
 */
/**
 * One choice of a `select` (or `tags`) field: a word, or `{ value, label }` when what is saved differs from what is
 * shown. `labels` gives the label in the site's other languages: `{ value: "lucios", label: "Lucios",
 * labels: { en: "Glossy" } }`.
 */
export type SelectOption = string | { value: string; label: string; labels?: Record<string, string> };

/** One row of a `keyvalue` field: technical details, opening hours, a spec sheet. */
export interface KeyValueEntry {
  label: string;
  value: string;
}

export interface ContentField {
  /** Key of the value in an item's data, e.g. `location`. */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /**
   * Choices of a `select` field (plain strings or `{ value, label }`); for a `tags` field, the only tags it takes
   * (plain strings, any tag when left out).
   */
  options?: SelectOption[];
  /** Shown under the field in the editor. */
  help?: string;
  /** The blocks a `blocks` field offers, in the order the editor lists them; all of `BLOCK_TYPES` when left out. */
  blocks?: BlockType[];
  /**
   * For a `reference` field: the key of the content type (often a vocabulary) whose items it points at, e.g.
   * `"category"`. The item keeps the slug of the item it points at (`"ceramica"`), or a list of slugs with `multiple`.
   */
  to?: string;
  /** For a `reference` field: several items, kept as a list of slugs. */
  multiple?: boolean;
  /**
   * The vocabulary a field takes its terms from: `{ name: "category", label: "Category", vocabulary: "category" }`
   * says so in the declaration, and is a `reference` field to that vocabulary (`type` may be left out). The editor
   * and the MCP show which vocabulary a field uses.
   */
  vocabulary?: string;
}

/** A field of the site's own settings (src/site-settings.ts): a field with its Site Settings section and default. */
export type SiteSettingField = ContentField & { group?: string; default?: unknown };

/** A field as a content type declares it: `type` may be left out when `vocabulary` names the field's vocabulary. */
export type ContentFieldInput =
  ContentField | (Omit<ContentField, "type"> & { type?: "reference"; vocabulary: string });

/** A content type as declared: its fields may name their vocabulary instead of a type. */
export type ContentTypeInput = Omit<ContentType, "fields"> & { fields: ContentFieldInput[] };

/** A field naming its vocabulary is a reference to it; any other field is as declared. */
function normalizeField(field: ContentFieldInput): ContentField {
  if (field.vocabulary === undefined) return field as ContentField;
  if (field.type !== undefined && field.type !== "reference")
    throw new Error(
      `Field "${field.name}" takes its terms from the vocabulary "${field.vocabulary}": leave its type out, or make it "reference".`,
    );
  if (field.to !== undefined && field.to !== field.vocabulary)
    throw new Error(`Field "${field.name}" names the vocabulary "${field.vocabulary}" but points at "${field.to}".`);
  return { ...field, type: "reference", to: field.vocabulary };
}

/**
 * A kind of repeatable content: projects, articles, team members.
 * Every item also has a title, an address (slug) and is private or published.
 */
export interface ContentType {
  /** Identifies the type in code, e.g. `project`. */
  key: string;
  /** Plural name shown in the editor, e.g. `Projects`. */
  label: string;
  /** Name of one item, e.g. `Project`. */
  singular: string;
  /** First part of an item's address: `/projects/<item>`. Also names the type's feed, `/rss/<slug>.xml`. */
  slug: string;
  /**
   * The address of an item's page when it is not `/<slug>/<item>`: fixed segments, `[slug]` for the item's own slug,
   * and `[field]` for the value of a required `select` or `text` field, e.g. `/produse/[category]/[slug]`. It starts
   * with a fixed segment. The template, the sitemap, feeds, links and the editor all use it; when an item's value
   * changes, its former address sends visitors on to the new one.
   */
  path?: string;
  fields: ContentField[];
  /**
   * An item with a page (`component`) has a description by default: a `textarea` field `description`, first in the
   * form, that the page gives search engines and shared links when Page Settings say nothing else. `false` leaves
   * it out. A field named `description` in `fields` takes its place: a label of its own ("Summary"), `required`.
   */
  description?: boolean;
  /**
   * An item with a page has a main picture by default: an `image` field `image`, shown when the page is shared.
   * `false` leaves it out. A field named `image` in `fields` takes its place.
   */
  image?: boolean;
  /**
   * The items are articles (news, blog posts): pages search engines are told were written by someone, on a date.
   * Adds a `date` field `published`, filled in when an item is first published, and `<Seo>` writes schema.org
   * `Article` data on the item's page from its title, description, image, author and dates. A `date` field named
   * `modified`, when declared, says when the article was last revised.
   */
  article?: boolean;
  /**
   * Every item has an author by default: a text field `author`, added after the declared fields, that the item's
   * page gives as `<meta name="author">` and in an article's data. `false` leaves it out, for items nobody signs
   * (team members, products). A field named `author` in `fields` takes its place: a `select` of the site's writers,
   * or a vocabulary of them.
   */
  author?: boolean;
  /** Set by `defineVocabulary`: a list of terms other types point at, which the editor lists as such. */
  vocabulary?: boolean;
  /**
   * Every item has tags by default: a `tags` field `tags`, added after the author, that listings filter on
   * (`filter={{ tags: "garden" }}`) and the editor's content browser too. `false` leaves it out. A field named
   * `tags` in `fields` takes its place, e.g. one with `options`, so only the site's own tags can be chosen.
   */
  tags?: boolean;
  /**
   * The template of the type: an Astro component that draws the page of every item, at `/<slug>/<item>`, and
   * receives the item as the `item` prop. What the owner changes on it, besides the item's own fields, is saved
   * once for the type and shows on every item's page.
   */
  component?: PageComponent;
  /**
   * An RSS feed of the type's published items, at `/rss/<slug>.xml` (`/rss/<locale>/<slug>.xml` in another
   * language), for a blog, news or anything else readers follow. Off unless set; `true` uses the defaults.
   * Items need a page of their own to be in it: a template, or a page in the site's code.
   */
  feed?: boolean | FeedOptions;
  /**
   * The owner puts the items in order by dragging them in the editor: categories of a menu, the steps of a
   * process, a team. `Listing`, `getItems` and menus built from the type (`from` in `Navbar` and `Footer`) then
   * show them in that order unless the code sorts them otherwise (`sort="title"`). Without it, items come newest
   * first. Their order is also `sort="position"` / `sort: "position"`, for a type that is not `ordered`.
   */
  ordered?: boolean;
}

/** How a content type's feed reads its items. Every field is optional. */
export interface FeedOptions {
  /** The feed's title; by default the type's `label`, after the site's name when it has one. */
  title?: string;
  /** What the feed is about, shown by feed readers. */
  description?: string;
  /** A `date` field that says when an item was published; by default `published`, else the first one, else its creation. */
  date?: string;
  /**
   * A `text`, `textarea` or `richtext` field that sums an item up; by default `description` (or the first `textarea`
   * of a type without it), then the description set for the item's page, then the first `richtext` field's opening.
   */
  summary?: string;
  /** How many of the newest items the feed holds; 20 by default. */
  limit?: number;
}

const KEY = /^[a-z][a-z0-9_]*$/;

/** The field an item with a page has unless its type says `description: false`. */
export const DESCRIPTION_FIELD: ContentField = {
  name: "description",
  label: "Description",
  type: "textarea",
  help: "A sentence or two. Shown in search results and on shared links.",
};
/** The field an item with a page has unless its type says `image: false`. */
export const IMAGE_FIELD: ContentField = {
  name: "image",
  label: "Image",
  type: "image",
  help: "The main picture. Shown when the page is shared.",
};
/** The field an item of an `article` type has. */
export const PUBLISHED_FIELD: ContentField = {
  name: "published",
  label: "Published",
  type: "date",
  help: "Filled in when it is first published.",
};
/** The field every item has unless its type says `author: false`; its value is a name, as readers see it. */
export const AUTHOR_FIELD: ContentField = { name: "author", label: "Author", type: "text" }; // betterleaks:allow (a field definition, not a secret)
/** The field every item has unless its type says `tags: false`: a list of short words to find and filter it by. */
export const TAGS_FIELD: ContentField = { name: "tags", label: "Tags", type: "tags" };

/**
 * What a field of a standard name must be for Brim to read it. One of another type is the site's own: it works as
 * declared, and search engines are not given it.
 */
const STANDARD_TYPES: Record<string, readonly FieldType[]> = {
  description: ["textarea", "text"],
  image: ["image"],
  published: ["date"],
  modified: ["date"],
  author: ["text", "select", "reference", "tags"],
};

/** The type's field of a standard name, when it is of a type Brim can read; `undefined` otherwise. */
export function standardField(
  type: Pick<ContentType, "fields">,
  name: "description" | "image" | "published" | "modified" | "author",
): ContentField | undefined {
  return type.fields.find((field) => field.name === name && STANDARD_TYPES[name]?.includes(field.type));
}

/**
 * Declares a content type. Mistakes in the declaration fail here, at startup, not when content is saved.
 * The type it returns has the fields Brim adds among its own: `description` and `image` (with a page), `published`
 * (an `article`), `author` and `tags`, unless it said `false` to one or declared a field of that name itself.
 */
export function defineContentType<const Fields extends readonly ContentFieldInput[]>(
  input: Omit<ContentTypeInput, "fields"> & { fields: Fields },
): ContentType & Typed<FieldsData<Fields>> {
  const type: ContentType = { ...input, fields: input.fields.map(normalizeField) };
  if (!KEY.test(type.key))
    throw new Error(`Content type key "${type.key}" must be lowercase letters, digits or underscores.`);
  if (!isSlug(type.slug)) throw new Error(`Content type slug "${type.slug}" must be lowercase words joined by dashes.`);

  const names = new Set<string>();
  for (const field of type.fields) {
    if (!KEY.test(field.name))
      throw new Error(`Field name "${field.name}" in "${type.key}" must be lowercase letters, digits or underscores.`);
    if (names.has(field.name)) throw new Error(`Field "${field.name}" is declared twice in "${type.key}".`);
    if (field.type === "select" && !field.options?.length)
      throw new Error(`Select field "${field.name}" in "${type.key}" needs options.`);
    if (field.type === "reference" && !(field.to && KEY.test(field.to)))
      throw new Error(`Reference field "${field.name}" in "${type.key}" needs "to": the key of the type it points at.`);
    if (field.type !== "reference" && (field.to !== undefined || field.multiple !== undefined))
      throw new Error(
        `Field "${field.name}" in "${type.key}" has "to" or "multiple", which only a reference field takes.`,
      );
    if (field.options) checkOptions(type, field);
    if (field.type === "blocks" && !type.component)
      throw new Error(
        `Blocks field "${field.name}" in "${type.key}" is arranged on the item's page: give the type a component.`,
      );
    const unknown = field.blocks?.find((block) => !BLOCK_TYPES.includes(block));
    if (unknown)
      throw new Error(`Field "${field.name}" in "${type.key}" offers "${unknown}", which is not a block it can hold.`);
    names.add(field.name);
  }
  if (type.article && !type.component)
    throw new Error(`Content type "${type.key}" is made of articles, which have a page each: give it a component.`);
  if (type.component !== undefined && typeof type.component !== "function")
    throw new Error(`The component of content type "${type.key}" must be an Astro component.`);
  const missing = (field: ContentField, wanted: boolean): ContentField[] =>
    wanted && !names.has(field.name) ? [field] : [];
  const hasPage = type.component !== undefined;
  type.fields = [
    ...missing(DESCRIPTION_FIELD, hasPage && type.description !== false),
    ...missing(IMAGE_FIELD, hasPage && type.image !== false),
    ...type.fields,
    ...missing(PUBLISHED_FIELD, type.article === true),
    ...missing(AUTHOR_FIELD, type.author !== false),
    ...missing(TAGS_FIELD, type.tags !== false),
  ];
  checkItemPath(type);
  if (typeof type.feed === "object") checkFeed(type, type.feed);
  return type;
}

function checkOptions(type: ContentType, field: ContentField): void {
  if (field.type === "tags" && field.options?.some((option) => typeof option !== "string"))
    throw new Error(`Tags field "${field.name}" in "${type.key}" takes its choices as plain words.`);
  const values = new Set<string>();
  for (const option of optionsOf(field)) {
    if (option.value.trim() === "" || option.label.trim() === "")
      throw new Error(`Field "${field.name}" in "${type.key}" has a choice without a value or a label.`);
    if (option.labels && Object.values(option.labels).some((label) => typeof label !== "string" || label.trim() === ""))
      throw new Error(`Field "${field.name}" in "${type.key}" has the choice "${option.value}" with an empty label.`);
    if (values.has(option.value))
      throw new Error(`Field "${field.name}" in "${type.key}" has the choice "${option.value}" twice.`);
    values.add(option.value);
  }
}

/** The choices of a field as `{ value, label }`, whichever way the type wrote them. */
export function optionsOf(
  field: Pick<ContentField, "options">,
): { value: string; label: string; labels?: Record<string, string> }[] {
  return (field.options ?? []).map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
}

/** What a field's choices save: `["ceramica", "mozaic"]`. */
export function optionValues(field: Pick<ContentField, "options">): string[] {
  return optionsOf(field).map((option) => option.value);
}

/**
 * What a site shows for a saved choice: its label (`Ceramică` for `ceramica`), or the value itself when it is not
 * one of the field's choices (any more).
 */
export function optionLabel(field: Pick<ContentField, "options">, value: string, locale?: string): string {
  const option = optionsOf(field).find((candidate) => candidate.value === value);
  if (!option) return value;
  return (locale !== undefined && option.labels?.[locale]) || option.label;
}

/**
 * A vocabulary: a list of terms the owner keeps (categories, brands, rooms, materials), which other types point at
 * with `reference` fields. It is a content type like any other, so its terms are items: added, renamed and given
 * pictures in the editor's Content, through the MCP and the API, in every language. By default a term has no author
 * and no tags, and no page of its own unless the vocabulary gives a `component`.
 *
 *   export const category = defineVocabulary({ key: "category", label: "Categories", singular: "Category",
 *     slug: "categories", fields: [{ name: "image", label: "Image", type: "image" }] });
 *   // in product: { name: "category", label: "Category", type: "reference", to: "category", required: true }
 */
export function defineVocabulary<const Fields extends readonly ContentFieldInput[]>(
  type: Omit<ContentTypeInput, "vocabulary" | "fields"> & { fields: Fields },
): ContentType & Typed<FieldsData<Fields>> {
  return defineContentType({ author: false, tags: false, ...type, vocabulary: true });
}

function checkFeed(type: ContentType, feed: FeedOptions): void {
  const field = (name: string | undefined, kinds: FieldType[], role: string) => {
    if (name === undefined) return;
    const found = type.fields.find((candidate) => candidate.name === name);
    if (!found || !kinds.includes(found.type))
      throw new Error(
        `The feed of "${type.key}" reads ${role} from "${name}", which is not a ${kinds.join(" or ")} field.`,
      );
  };
  field(feed.date, ["date"], "the date");
  field(feed.summary, ["text", "textarea", "richtext"], "the summary");
  if (feed.limit !== undefined && !(Number.isInteger(feed.limit) && feed.limit > 0))
    throw new Error(`The feed of "${type.key}" needs a whole number above 0 as its limit.`);
}

/** The feed options of a type that has a feed, with `true` read as the defaults. */
export function feedOptionsOf(type: ContentType): FeedOptions | undefined {
  if (!type.feed) return undefined;
  return type.feed === true ? {} : type.feed;
}

/**
 * The type whose template draws the page at this address, the item's slug and its language as stored ("" for the
 * default one): `/projects/lake-house`, or `/ro/projects/casa-de-la-lac` on a site with languages. With a `path`
 * like `/produse/[category]/[slug]` only the shape is read here; the item's category is checked once it is loaded.
 */
export function itemPageOf(
  types: ContentType[],
  path: string,
  locales?: LocaleConfig,
): { type: ContentType; slug: string; locale: string } | undefined {
  return readItemPath(
    types.filter((type) => type.component),
    path,
    locales,
  );
}

export { isSlug, slugify } from "./item-path.ts";
