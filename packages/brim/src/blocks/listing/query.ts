import { type ContentField, optionLabel, optionValues } from "../../content/content-types.ts";
import type { Item } from "../../content/items.ts";
import { textOf } from "../../content/search.ts";
import { noteQueryReads } from "../../runtime/query-reads.ts";

/** A field's value, or several: an item matches when its field has the value, or one of them. */
export type FilterValue = string | number | boolean | (string | number | boolean)[];

/** Which items a listing shows, and in what order. The site's code says it; the owner edits the items. */
export interface ListingQuery {
  /**
   * Only items whose fields have these values, text whatever its case: `{ section: "Guides" }`, `{ featured: true }`.
   */
  filter?: Record<string, FilterValue> | undefined;
  /**
   * A field of the type, or `title`, `created`, `updated`, `position` (the order the owner gives the items of an
   * `ordered` type). By default the newest first.
   */
  sort?: string | undefined;
  /** By default descending for `created` and `updated`, ascending for anything else. */
  order?: "ascending" | "descending" | undefined;
  limit?: number | undefined;
  /** Items left out, by id: the item whose page this is, for a list of related items. */
  exclude?: string | string[] | undefined;
}

/** The items a listing shows, from all the items of its type. */
export function queryItems<T extends Item>(items: T[], query: ListingQuery): T[] {
  const excluded = new Set([query.exclude ?? []].flat());
  const filters = Object.entries(query.filter ?? {});
  const matching = items.filter(
    (item) =>
      !excluded.has(item.id) && filters.every(([field, wanted]) => matches(valueOf(item, field), [wanted].flat())),
  );
  const sort = query.sort ?? "created";
  const order = query.order ?? (sort === "created" || sort === "updated" ? "descending" : "ascending");
  const direction = order === "descending" ? -1 : 1;
  const sorted = [...matching].sort((a, b) => compare(valueOf(a, sort), valueOf(b, sort), direction));
  return query.limit && query.limit > 0 ? sorted.slice(0, query.limit) : sorted;
}

/**
 * What a new item added from the listing starts with, so it lands in the list it was added from: the fields the
 * filter asks one value of. A filter with several values says nothing about which one. A field of several values
 * (`tags`) starts with the one asked for.
 */
export function prefillOf(
  filter: ListingQuery["filter"],
  fields: readonly Pick<ContentField, "name" | "type" | "options">[] = [],
): Record<string, string | number | boolean | (string | number | boolean)[]> {
  return Object.fromEntries(
    Object.entries(filter ?? {})
      .filter((entry): entry is [string, string | number | boolean] => !Array.isArray(entry[1]))
      .map(([field, value]) => {
        const definition = fields.find((candidate) => candidate.name === field);
        // Filtering ignores case, but select validation requires the declared spelling.
        // Keep the editor's initial value valid for both selects and constrained tags.
        const canonical =
          (definition?.type === "select" || definition?.type === "tags") && typeof value === "string"
            ? (optionValues(definition).find((option) => same(option, value)) ?? value)
            : value;
        return [field, definition?.type === "tags" ? [canonical] : canonical];
      }),
  );
}

function valueOf(item: Item, field: string): unknown {
  if (field === "title") return item.title;
  if (field === "created") return item.createdAt;
  if (field === "updated") return item.updatedAt;
  if (field === "position") return item.position;
  return item.data[field];
}

function matches(value: unknown, wanted: (string | number | boolean)[]): boolean {
  // A field holding several values (tags) matches when any of them is wanted; an empty one is false, like an
  // unchecked box.
  const values = Array.isArray(value) ? value : [value];
  return values.some((one) => wanted.some((candidate) => same(one ?? false, candidate)));
}

/** Text is the same whatever its case: `{ tags: "garden" }` finds the items tagged "Garden". */
function same(value: unknown, wanted: string | number | boolean): boolean {
  return typeof value === "string" && typeof wanted === "string"
    ? value.toLocaleLowerCase() === wanted.toLocaleLowerCase()
    : value === wanted;
}

/** Empty values go last whatever the order; numbers compare as numbers, the rest as text in the reader's way. */
function compare(a: unknown, b: unknown, direction: number): number {
  const emptyA = a === undefined || a === null || a === "";
  const emptyB = b === undefined || b === null || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
  return String(a).localeCompare(String(b), undefined, { numeric: true }) * direction;
}

/** What a visitor can narrow a listing by: fields to pick values of, words to search for, pages to turn. */
export interface BrowseOptions {
  /** Fields the visitor picks values of (`select`, `text`, `tags`, `number`, `boolean`), in the order shown. */
  facets?: readonly string[] | undefined;
  /** `true` searches the title and the type's text-like fields; a list names the fields (and `title`) to search. */
  search?: boolean | readonly string[] | undefined;
  /** How many items one page shows; every item on one page when left out. */
  pageSize?: number | undefined;
  /** Put before every parameter in the address, for a page with several listings that can be browsed. */
  paramPrefix?: string | undefined;
  /**
   * What a value of a field is called, for `reference` fields: the titles of the items they point at, by slug
   * (`{ category: { ceramica: "Ceramică" } }`). Facets show them and the search finds them.
   */
  labels?: Record<string, Record<string, string>> | undefined;
}

export interface FacetOption {
  value: string;
  /** What the visitor reads: a select choice's label, or the value itself. */
  label: string;
  /** How many items the visitor would see with this value picked, given the rest of what they picked. */
  count: number;
  selected: boolean;
}

export interface Facet {
  field: string;
  label: string;
  /** The address parameter this facet is sent as. */
  param: string;
  options: FacetOption[];
}

/** Everything a listing's markup needs to show one page of what the visitor asked for. */
export interface BrowseState<T> {
  /** The items of the current page. */
  items: T[];
  /** How many items match, over every page. */
  total: number;
  facets: Facet[];
  /** The words searched for, as typed. */
  query: string;
  /** Whether the listing can be searched, and the address parameter of the words. */
  searchable: boolean;
  searchParam: string;
  page: number;
  pageCount: number;
  pageParam: string;
  /** Whether the visitor narrowed the list at all, to offer a way back to everything. */
  narrowed: boolean;
  /** The address of a page of these results, keeping everything else the visitor picked: `?brand=Marazzi&page=2`. */
  pageHref(page: number): string;
  /** The address of the listing with nothing picked and nothing searched. */
  resetHref: string;
  /** Parameters of the address that are not this listing's, for a form to send along. */
  otherParams: [string, string][];
}

const FACET_TYPES = new Set(["select", "text", "tags", "number", "boolean", "reference"]);
const SEARCH_TYPES = new Set([
  "text",
  "textarea",
  "richtext",
  "blocks",
  "select",
  "tags",
  "keyvalue",
  "email",
  "url",
  "reference",
]);
const MAX_QUERY = 200;

/**
 * Narrows the items a listing shows (already filtered and sorted by the site's code) by what the visitor asked for
 * in the address: values picked for each facet (any of the values of one facet, all of the facets), words searched
 * for (each of them, whatever their case and accents), and the page.
 */
export function browseItems<T extends Item>(
  items: T[],
  fields: readonly Pick<ContentField, "name" | "label" | "type" | "options">[],
  options: BrowseOptions,
  params: URLSearchParams,
): BrowseState<T> {
  const prefix = options.paramPrefix ?? "";
  const facetFields = (options.facets ?? []).map((name) => {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field || !FACET_TYPES.has(field.type)) {
      throw new Error(
        `Listing facet "${name}" must be a select, text, tags, number, boolean or reference field of the type.`,
      );
    }
    return field;
  });
  const searchFields = searchFieldsOf(fields, options.search);
  const searchParam = `${prefix}q`;
  const pageParam = `${prefix}page`;
  // What the page reads of its address, for a host that caches pages by the parameters they read.
  noteQueryReads([
    ...(searchFields.length > 0 ? [searchParam] : []),
    pageParam,
    ...facetFields.map((field) => `${prefix}${field.name}`),
  ]);
  const query = searchFields.length > 0 ? (params.get(searchParam) ?? "").trim().slice(0, MAX_QUERY) : "";
  const words = fold(query).split(/\s+/).filter(Boolean);
  const picked = new Map(
    facetFields.map((field) => [
      field.name,
      params
        .getAll(`${prefix}${field.name}`)
        .map((v) => v.trim())
        .filter(Boolean),
    ]),
  );

  const labels = options.labels ?? {};
  const found = words.length === 0 ? items : items.filter((item) => matchesWords(item, searchFields, words, labels));
  // An item counts for a facet's value when it fits everything else picked: the other facets, and the words.
  const fitsFacets = (item: T, skip?: string) =>
    facetFields.every((field) => {
      const wanted = picked.get(field.name) ?? [];
      return (
        field.name === skip ||
        wanted.length === 0 ||
        facetValues(item, field.name).some((v) => wanted.some((w) => sameValue(v, w)))
      );
    });
  const matched = found.filter((item) => fitsFacets(item));

  const facets: Facet[] = facetFields.map((field) => {
    const wanted = picked.get(field.name) ?? [];
    const pool = found.filter((item) => fitsFacets(item, field.name));
    const values = new Map<string, string>();
    // Every value any item of the listing has, so a value does not vanish once another is picked.
    for (const item of items)
      for (const value of facetValues(item, field.name)) if (!values.has(fold(value))) values.set(fold(value), value);
    const choices = field.type === "select" && field.options ? optionValues(field) : undefined;
    const ordered = [...values.values()].sort((a, b) =>
      choices
        ? choices.indexOf(a) - choices.indexOf(b)
        : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }),
    );
    return {
      field: field.name,
      label: field.label,
      param: `${prefix}${field.name}`,
      options: ordered.map((value) => ({
        value,
        // The page gives labels in its language; without them a choice shows its label as declared.
        label: labels[field.name]?.[value] ?? (field.type === "select" ? optionLabel(field, value) : value),
        count: pool.filter((item) => facetValues(item, field.name).some((v) => sameValue(v, value))).length,
        selected: wanted.some((w) => sameValue(w, value)),
      })),
    };
  });

  const size = options.pageSize && options.pageSize > 0 ? Math.floor(options.pageSize) : matched.length || 1;
  const pageCount = Math.max(1, Math.ceil(matched.length / size));
  const asked = Number.parseInt(params.get(pageParam) ?? "1", 10);
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(asked) ? asked : 1));

  const ours = (key: string) =>
    key === searchParam || key === pageParam || facetFields.some((f) => key === `${prefix}${f.name}`);
  const others = [...params.entries()].filter(([key]) => !ours(key));
  const build = (entries: [string, string][]) => {
    const search = new URLSearchParams(entries).toString();
    return search ? `?${search}` : "?";
  };
  const kept: [string, string][] = [
    ...others,
    ...(query ? [[searchParam, query] as [string, string]] : []),
    ...facetFields.flatMap((field) =>
      (picked.get(field.name) ?? []).map((v) => [`${prefix}${field.name}`, v] as [string, string]),
    ),
  ];

  return {
    items: matched.slice((page - 1) * size, page * size),
    total: matched.length,
    facets,
    query,
    searchable: searchFields.length > 0,
    searchParam,
    page,
    pageCount,
    pageParam,
    narrowed: query !== "" || [...picked.values()].some((values) => values.length > 0),
    pageHref: (target) => build(target > 1 ? [...kept, [pageParam, String(target)]] : kept),
    resetHref: build(others),
    otherParams: others,
  };
}

function searchFieldsOf(
  fields: readonly Pick<ContentField, "name" | "type" | "options">[],
  search: BrowseOptions["search"],
): { name: string; field?: Pick<ContentField, "name" | "type" | "options"> }[] {
  if (!search) return [];
  if (search === true) {
    return [
      { name: "title" },
      ...fields.filter((field) => SEARCH_TYPES.has(field.type)).map((field) => ({ name: field.name, field })),
    ];
  }
  return search.map((name) => {
    if (name === "title") return { name };
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) throw new Error(`Listing searches "${name}", which is not a field of the type.`);
    return { name, field };
  });
}

/** The values of a field as text, one per value: a tag list gives each tag, an empty field gives none. */
function facetValues(item: Item, field: string): string[] {
  const value = valueOf(item, field);
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((one) => one !== undefined && one !== null && one !== "")
    .map((one) => String(one).trim())
    .filter(Boolean);
}

function matchesWords(
  item: Item,
  fields: { name: string; field?: Pick<ContentField, "name" | "type" | "options"> }[],
  words: string[],
  labels: Record<string, Record<string, string>> = {},
): boolean {
  const text = fold(
    fields
      .map(({ name, field }) => {
        const value = valueOf(item, name);
        // A reference is found by the title of what it points at too: "Ceramică" finds the products in ceramica.
        const named = labels[name];
        const titles = named ? (Array.isArray(value) ? value : [value]).map((slug) => named[String(slug)] ?? "") : [];
        return `${searchableText(value, field)} ${titles.join(" ")}`;
      })
      .join(" "),
  );
  return words.every((word) => text.includes(word));
}

/** The words a value holds: a select gives its label too, key–value rows give both sides, rich text its words. */
function searchableText(value: unknown, field?: Pick<ContentField, "name" | "type" | "options">): string {
  if (value === undefined || value === null) return "";
  // Rich text and blocks by the words a visitor reads, not their tags and settings.
  if (field?.type === "richtext" || field?.type === "blocks") return textOf(value);
  if (field?.type === "select" && typeof value === "string") return `${value} ${optionLabel(field, value)}`;
  if (Array.isArray(value)) return value.map((one) => searchableText(one)).join(" ");
  if (typeof value === "object")
    return Object.values(value as Record<string, unknown>)
      .map((one) => searchableText(one))
      .join(" ");
  return String(value);
}

/** Text as compared when searching: lowercase, without accents, so "ceramica" finds "Ceramică". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

/** Two values are the same value of a facet whatever their case and accents. */
function sameValue(a: string, b: string): boolean {
  return fold(a) === fold(b);
}
