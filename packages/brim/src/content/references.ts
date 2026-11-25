import type { ContentField, ContentType } from "./content-types.ts";
import type { Item, ItemDraft, ItemStore } from "./items.ts";
import { ValidationError } from "./validation-error.ts";

/**
 * References between items: a product's `category` points at a term of the `category` vocabulary by its slug. The
 * item form checks the shape (`parseItem`); here the server, which sees every item, keeps references true: a term
 * must exist to be pointed at, a term that changes its address takes its references along, and a term in use cannot
 * be deleted.
 */

/** The reference fields of a type, with the type they point at. */
export function referenceFields(type: ContentType): (ContentField & { to: string })[] {
  return type.fields.filter(
    (field): field is ContentField & { to: string } => field.type === "reference" && !!field.to,
  );
}

/** Whether items of some type point at items of this one: its items are terms, found by their slug. */
export function isReferenced(types: ContentType[], key: string): boolean {
  return types.some((type) => referenceFields(type).some((field) => field.to === key));
}

/**
 * A term's translations share its slug: a product in English points at `faianta` and finds the English `faianta`,
 * and its address (`/en/produse/faianta/…`) uses it. A translation given a slug of its own would lose every item
 * pointing at it in that language, so a term's slug changes only on the term as written first.
 */
export function assertTermSlug(
  types: ContentType[],
  existing: Pick<Item, "type" | "slug" | "translationOf">,
  slug: string,
): void {
  if (existing.translationOf !== null && slug !== existing.slug && isReferenced(types, existing.type)) {
    throw new ValidationError(
      "A term's translations keep its address, so items pointing at it find it in every language: change it on the original.",
    );
  }
}

/**
 * The terms of a vocabulary by slug, for a page in one language: its own terms, and for a slug it has not translated
 * yet, the term as it was written first (or else another translation of it), never nothing.
 */
export function termsBySlug<T extends Pick<Item, "slug" | "translationOf">>(own: T[], all: T[]): Map<string, T> {
  const terms = new Map(own.map((term) => [term.slug, term]));
  const others = all.filter((term) => !terms.has(term.slug));
  others.sort((a, b) => Number(a.translationOf !== null) - Number(b.translationOf !== null));
  for (const term of others) if (!terms.has(term.slug)) terms.set(term.slug, term);
  return terms;
}

/** The slugs a reference field of an item holds: one, several, or none. */
export function referencedSlugs(item: { data: Record<string, unknown> }, field: string): string[] {
  const value = item.data[field];
  return (Array.isArray(value) ? value : [value]).filter(
    (slug): slug is string => typeof slug === "string" && slug !== "",
  );
}

/** Declared types that point at a type which is not declared: a mistake in the code, told when the site starts. */
export function checkReferenceTargets(types: ContentType[]): void {
  for (const type of types) {
    for (const field of referenceFields(type)) {
      const target = types.find((candidate) => candidate.key === field.to);
      if (!target) {
        throw new Error(
          `Field "${field.name}" in "${type.key}" points at "${field.to}", which is not a declared content type.`,
        );
      }
      if (field.vocabulary !== undefined && !target.vocabulary) {
        throw new Error(
          `Field "${field.name}" in "${type.key}" uses "${field.to}" as a vocabulary: declare it with defineVocabulary.`,
        );
      }
    }
  }
}

/** Refuses an item whose references name items that do not exist (in any language: a translation keeps its slug). */
export async function checkReferences(
  types: ContentType[],
  items: ItemStore,
  type: ContentType,
  draft: ItemDraft,
): Promise<void> {
  checkReferenceTargets(types);
  for (const field of referenceFields(type)) {
    const wanted = referencedSlugs(draft, field.name);
    if (wanted.length === 0) continue;
    const target = types.find((candidate) => candidate.key === field.to);
    const known = new Set((await items.list(field.to)).map((item) => item.slug));
    const missing = wanted.filter((slug) => !known.has(slug));
    if (missing.length > 0) {
      const what = target ? target.singular.toLowerCase() : field.to;
      throw new ValidationError(
        `"${field.label}" names ${missing.map((slug) => `"${slug}"`).join(", ")}: there is no such ${what}.`,
      );
    }
  }
}

/** The items that point at a term, with the field each one uses: what deleting or renaming the term touches. */
export async function referencesTo(
  types: ContentType[],
  items: ItemStore,
  term: Pick<Item, "type" | "slug">,
): Promise<{ type: ContentType; field: string; item: Item }[]> {
  const found: { type: ContentType; field: string; item: Item }[] = [];
  for (const type of types) {
    for (const field of referenceFields(type).filter((candidate) => candidate.to === term.type)) {
      for (const item of await items.list(type.key)) {
        if (referencedSlugs(item, field.name).includes(term.slug)) found.push({ type, field: field.name, item });
      }
    }
  }
  return found;
}

/**
 * A term moved to a new slug: the items that pointed at it point at the new one. Answers the items it changed, as they
 * were and as they are, so the caller can tell what moved (a product whose address holds its category moves too, and
 * its old address redirects).
 */
export async function renameReferences(
  types: ContentType[],
  items: ItemStore,
  term: Pick<Item, "type" | "slug">,
  slug: string,
): Promise<{ type: ContentType; before: Item; item: Item }[]> {
  const changed = new Map<string, { type: ContentType; before: Item; item: Item }>();
  for (const { type, field, item: before } of await referencesTo(types, items, term)) {
    // An item that names the term in two fields was changed once already: the second change is made to that.
    const item = changed.get(before.id)?.item ?? before;
    const declared = type.fields.find((candidate) => candidate.name === field);
    const value = item.data[field];
    const next = Array.isArray(value) ? value.map((entry) => (entry === term.slug ? slug : entry)) : slug;
    const draft: ItemDraft = {
      title: item.title,
      slug: item.slug,
      visibility: item.visibility,
      data: { ...item.data, [field]: declared?.multiple ? [...new Set(next as string[])] : next },
    };
    changed.set(item.id, { type, before, item: await items.update(item, draft) });
  }
  return [...changed.values()];
}

/** Refuses to delete a term that items still point at, naming a few of them so the owner knows where to look. */
export async function assertUnused(
  types: ContentType[],
  items: ItemStore,
  term: Pick<Item, "type" | "slug" | "title">,
): Promise<void> {
  const users = await referencesTo(types, items, term);
  if (users.length === 0) return;
  const names = users
    .slice(0, 3)
    .map(({ item }) => `"${item.title}"`)
    .join(", ");
  const more = users.length > 3 ? ` and ${users.length - 3} more` : "";
  throw new ValidationError(
    `"${term.title}" is used by ${names}${more}. Point them at another one first, or remove it from them.`,
  );
}
