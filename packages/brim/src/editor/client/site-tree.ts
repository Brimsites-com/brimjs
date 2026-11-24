import { itemPathSegments } from "../../content/item-path.ts";
import { type LocaleConfig, itemPagePath } from "../../server/locales.ts";
import type { ContentType, Item, SitePage } from "./api.ts";

/**
 * The site map as one tree, by address: a content type's items hang under the page their address starts with
 * (`/produse/[category]/[slug]` under `/produse`), split by the field that comes first in the address, so products
 * sit under their category. Types without pages, and the vocabularies, are kept apart for the site map to list
 * after the pages.
 */

/** One item, with the address of its page. */
export interface TreeItem {
  item: Item;
  path: string;
}

/** How many items a branch or group lists before "Show all"; a group with more is split again when it can be. */
export const ITEMS_SHOWN = 10;

/** A field items are split by, with the type of its values when it is a reference. */
export interface GroupField {
  name: string;
  label: string;
  to?: string;
}

/** The items sharing a value of the field the address is split by, e.g. the products of one category. */
export interface TreeGroup {
  /** Unique in the tree: the type, then the values of the group and of the groups it is in. */
  key: string;
  value: string;
  label: string;
  /** The address the group's items share, e.g. `/produse/ceramica`. */
  path: string;
  /** The page of the group's term, when its vocabulary gives its terms pages (often the same address as `path`). */
  page?: string;
  /** The term itself, when the group is one of a vocabulary's. */
  term?: Item;
  /** What a new item added in the group starts with: the values of this group and of the groups it is in. */
  data: Record<string, string>;
  /**
   * A group with more items than are listed is split again, by the first other vocabulary of the type most of its
   * items use (the ceramics by their style); `groups` are those, `rest` the items that use none.
   */
  subgroupBy?: GroupField;
  groups: TreeGroup[];
  rest: TreeItem[];
  /** Every item of the group, subgroups included. */
  items: TreeItem[];
}

/** A content type whose items have pages, placed in the tree. */
export interface TreeBranch {
  type: ContentType;
  /**
   * The page the items hang under: one of the site's pages or the page of a group's term (the catalogs of the
   * ceramics under Ceramică), or `null` when no page starts their address.
   */
  parent: string | null;
  /** The address the items share before their own part, e.g. `/produse`. */
  prefix: string;
  /** The field the address is split by after the prefix, with the type of its values when it is a reference. */
  groupBy?: GroupField;
  /** The groups, in the owner's order when the field's vocabulary is ordered, else by title; empty when not split. */
  groups: TreeGroup[];
  /** Every item, in the owner's order when the type is ordered, else by title. */
  items: TreeItem[];
}

export interface SiteTree {
  branches: TreeBranch[];
  /**
   * Types whose items have no page, vocabularies among them. A vocabulary whose terms have pages is a branch of its
   * own, unless the terms are already groups of a type's branch, where their pages open from.
   */
  unplaced: ContentType[];
}

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/** The items of an ordered type come from the API in the owner's order; the others are put in order of title. */
const ordered = <T>(list: T[], keep: boolean | undefined, title: (entry: T) => string): T[] =>
  keep ? list : [...list].sort((a, b) => compare(title(a), title(b)));

type Field = ContentType["fields"][number];

export function buildSiteTree(
  pages: SitePage[],
  types: ContentType[],
  itemsByType: Record<string, Item[]>,
  locales: LocaleConfig | undefined,
): SiteTree {
  const pagePaths = new Set(pages.map((page) => trim(page.path)));
  const branches: TreeBranch[] = [];
  const unplaced: ContentType[] = [];
  const typeOf = (key: string | undefined) => (key ? types.find((candidate) => candidate.key === key) : undefined);
  const termsOf = (key: string | undefined) => (itemsByType[key ?? ""] ?? []).filter((term) => term.locale === "");

  const groupField = (type: ContentType) => {
    const segments = itemPathSegments(type);
    const fixed = segments.findIndex((segment) => "field" in segment);
    const leading = fixed === -1 ? segments.length : fixed;
    const next = segments[leading];
    const field =
      next && "field" in next && next.field !== "slug"
        ? type.fields.find((candidate) => candidate.name === next.field)
        : undefined;
    return { segments, leading, field };
  };
  const placed = types.filter((type) => type.hasPage);
  const grouping = new Set(placed.flatMap((type) => (groupField(type).field?.to ? [groupField(type).field!.to!] : [])));
  /** The pages of the terms that group a type's items: other types whose address starts with one hang under it. */
  const termPages = new Set(
    [...grouping].flatMap((key) => {
      const vocabulary = typeOf(key);
      return vocabulary?.hasPage ? termsOf(key).map((term) => trim(itemPagePath(vocabulary, term, locales))) : [];
    }),
  );
  /** The terms each vocabulary has as subgroups somewhere, to tell whether it still needs a branch of its own. */
  const subgrouped = new Map<string, Set<string>>();

  /** The groups `entries` make by the values of `field`: every term or option first, then values nothing declares. */
  function groupsBy(
    type: ContentType,
    field: Field,
    entries: TreeItem[],
    within: { key: string; path: string; data: Record<string, string> },
    split: boolean,
  ): TreeGroup[] {
    const vocabulary = typeOf(field.to);
    const declared = new Map<string, { label: string; term?: Item }>();
    for (const term of field.to ? termsOf(field.to) : []) declared.set(term.slug, { label: term.title, term });
    for (const option of field.options ?? []) {
      if (typeof option === "string") declared.set(option, { label: option });
      else declared.set(option.value, { label: option.label });
    }
    const byValue = new Map<string, TreeItem[]>();
    for (const entry of entries) {
      const value = String(entry.item.data[field.name] ?? "");
      byValue.set(value, [...(byValue.get(value) ?? []), entry]);
    }
    const make = (value: string, label: string, term?: Item): TreeGroup => {
      const items = byValue.get(value) ?? [];
      const data = { ...within.data, ...(value && { [field.name]: value }) };
      const group: TreeGroup = {
        key: `${within.key}/${value}`,
        value,
        label,
        path: split ? within.path : `${within.path}/${value || "-"}`,
        ...(term && { term }),
        ...(term && vocabulary?.hasPage && { page: itemPagePath(vocabulary, term, locales) }),
        data,
        groups: [],
        rest: items,
        items,
      };
      if (!split) subgroup(type, field, group);
      return group;
    };
    // At the first level every term shows, even one no item uses yet, so an item can be added to it; a split
    // shows the terms its items use.
    const known = [...declared].filter(([value]) => !split || byValue.has(value));
    const terms = known.map(([value, { label, term }]) => make(value, label, term));
    // Options keep the order they are declared in; terms the vocabulary's order, or that of their titles.
    const sorted = field.options || vocabulary?.ordered ? terms : ordered(terms, false, (group) => group.label);
    const unknown = [...byValue.keys()]
      .filter((value) => !declared.has(value) && (!split || value !== ""))
      .map((value) => make(value, value || "—"));
    if (split && field.to) {
      const seen = subgrouped.get(field.to) ?? new Set<string>();
      for (const group of terms) seen.add(group.value);
      subgrouped.set(field.to, seen);
    }
    return [...sorted, ...unknown];
  }

  /** Splits a group too long to list by the first other vocabulary most of its items use. */
  function subgroup(type: ContentType, groupedBy: Field, group: TreeGroup): void {
    if (group.items.length <= ITEMS_SHOWN) return;
    const field = type.fields.find(
      (candidate) =>
        candidate.name !== groupedBy.name &&
        candidate.to &&
        !candidate.multiple &&
        typeOf(candidate.to)?.vocabulary &&
        group.items.filter((entry) => String(entry.item.data[candidate.name] ?? "") !== "").length * 2 >=
          group.items.length,
    );
    if (!field) return;
    group.subgroupBy = { name: field.name, label: field.label, ...(field.to && { to: field.to }) };
    group.groups = groupsBy(type, field, group.items, group, true);
    group.rest = group.items.filter((entry) => String(entry.item.data[field.name] ?? "") === "");
  }

  for (const type of types) {
    if (!type.hasPage) {
      unplaced.push(type);
      continue;
    }
    if (type.vocabulary && grouping.has(type.key)) continue;
    const { segments, leading, field } = groupField(type);
    // The address of an item with no values tells how many segments the language adds in front.
    const sample = itemPagePath(type, { slug: "x", locale: "", data: {} }, locales).split("/").slice(1);
    const offset = sample.length - segments.length;
    const prefix = `/${sample.slice(0, offset + leading).join("/")}`;

    let parent: string | null = null;
    // Not under the home page: a type with no page of its own sits at the top of the tree instead.
    for (let cut = offset + leading; cut > offset; cut--) {
      const candidate = trim(`/${sample.slice(0, cut).join("/")}`);
      if (pagePaths.has(candidate) || termPages.has(candidate)) {
        parent = candidate;
        break;
      }
    }

    const groupBy = field && { name: field.name, label: field.label, ...(field.to && { to: field.to }) };

    const items = ordered(
      termsOf(type.key).map((item) => ({ item, path: itemPagePath(type, item, locales) })),
      type.ordered,
      (entry) => entry.item.title,
    );

    const groups = field ? groupsBy(type, field, items, { key: type.key, path: prefix, data: {} }, false) : [];

    branches.push({ type, parent, prefix, ...(groupBy && { groupBy }), groups, items });
  }

  // A vocabulary whose terms are all subgroups somewhere opens from there, like one that groups the addresses.
  const shown = branches.filter((branch) => {
    const used = subgrouped.get(branch.type.key);
    return !(branch.type.vocabulary && used && branch.items.every((entry) => used.has(entry.item.slug)));
  });
  return { branches: shown, unplaced };
}
