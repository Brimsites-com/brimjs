import type { ContentType } from "./content-types.ts";
import type { Item, ItemDraft, ItemStore } from "./items.ts";
import { parseItem } from "./items.ts";
import { referenceFields, referencedSlugs } from "./references.ts";
import { ValidationError } from "./validation-error.ts";

/**
 * A site's starting content, kept in git next to its code: `seed/<type>.json` files that `brim seed` adds to the
 * database. Content lives in the database, which is not in git, so without it a fresh clone, another developer's
 * machine or a new preview starts empty.
 *
 * Seeding only ever adds: an item that already exists (same type, slug and language) is left exactly as it is,
 * whatever the seed says, so running it again, or against a site whose owner has changed things, never undoes their
 * work. The whole seed is checked before anything is written; one mistake and nothing is added.
 */
export interface SeedEntry {
  type: string;
  title: string;
  /** From the title when left out. */
  slug?: string;
  /** "published" unless the seed says otherwise: starting content is meant to be seen. */
  visibility?: "published" | "private";
  /** A language of the site other than the default one: a translation of the entry with the same slug. */
  locale?: string;
  /**
   * For a translation: the slug of the item it translates, in the default language, when its own slug differs
   * (`primavara` translating `spring`). Left out, it translates the item with its own slug.
   */
  translates?: string;
  data?: Record<string, unknown>;
}

export interface SeedPlan {
  /** What would be added, in the order it is added: a vocabulary's terms before what points at them. */
  create: { index: number; type: ContentType; draft: ItemDraft; locale: string; translates: string }[];
  /** What is already there, and stays as it is. */
  existing: { type: string; slug: string; locale: string }[];
}

const keyOf = (type: string, slug: string, locale: string) => `${type}\u0000${locale}\u0000${slug}`;

/**
 * Reads and checks a seed against the site's types and what its database holds. Throws one `ValidationError`
 * listing every mistake, so a seed is fixed in one go; nothing is written here.
 */
export async function planSeed(
  types: ContentType[],
  items: ItemStore,
  input: unknown,
  localeOf: (value: unknown) => string,
): Promise<SeedPlan> {
  if (!Array.isArray(input)) throw new ValidationError('The seed must be a list of items: [{ "type", "title", … }].');
  const errors: string[] = [];
  const parsed: SeedPlan["create"] = [];
  input.forEach((raw: unknown, index) => {
    const where = `Item ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where}: must be an object.`);
      return;
    }
    const entry = raw as Record<string, unknown>;
    const type = types.find((candidate) => candidate.key === entry.type);
    if (!type) {
      errors.push(`${where}: "${String(entry.type)}" is not one of the site's content types.`);
      return;
    }
    try {
      const locale = localeOf(entry.locale);
      const draft = parseItem(type, { ...entry, visibility: entry.visibility ?? "published" });
      if (entry.translates !== undefined && (typeof entry.translates !== "string" || entry.translates === "")) {
        throw new ValidationError('"translates" is the slug of the item it translates.');
      }
      if (entry.translates !== undefined && locale === "") {
        throw new ValidationError('"translates" is for a translation: give its "locale" too.');
      }
      const translates = typeof entry.translates === "string" ? entry.translates : draft.slug;
      parsed.push({ index, type, draft, locale, translates });
    } catch (error) {
      errors.push(`${where} (${type.singular} "${String(entry.title ?? "")}"): ${messageOf(error)}`);
    }
  });

  // What the database holds, per type: its slugs in each language.
  const stored = new Map<string, Item[]>();
  const storedOf = async (type: string) => {
    let list = stored.get(type);
    if (!list) stored.set(type, (list = await items.list(type)));
    return list;
  };
  const known = new Set<string>();
  for (const type of new Set(parsed.map((entry) => entry.type.key)).add("")) {
    if (!type) continue;
    for (const item of await storedOf(type)) known.add(keyOf(type, item.slug, item.locale));
  }

  const plan: SeedPlan = { create: [], existing: [] };
  const seen = new Set<string>();
  for (const entry of parsed) {
    const key = keyOf(entry.type.key, entry.draft.slug, entry.locale);
    if (seen.has(key)) {
      errors.push(`Item ${entry.index + 1}: the seed has "${entry.draft.slug}" twice in ${entry.type.label}.`);
      continue;
    }
    seen.add(key);
    if (known.has(key)) plan.existing.push({ type: entry.type.key, slug: entry.draft.slug, locale: entry.locale });
    else plan.create.push(entry);
  }

  // References may name terms the database holds or the seed adds; translations need their original.
  const creating = new Set(plan.create.map((entry) => keyOf(entry.type.key, entry.draft.slug, entry.locale)));
  const exists = async (type: string, slug: string, locale: string) =>
    creating.has(keyOf(type, slug, locale)) ||
    (await storedOf(type)).some((item) => item.slug === slug && item.locale === locale);
  for (const entry of plan.create) {
    for (const field of referenceFields(entry.type)) {
      for (const slug of referencedSlugs(entry.draft, field.name)) {
        // A translation keeps the slugs its terms have in the default language.
        if (!(await exists(field.to, slug, "")) && !(await exists(field.to, slug, entry.locale))) {
          const target = types.find((candidate) => candidate.key === field.to);
          errors.push(
            `${entry.type.singular} "${entry.draft.title}": "${field.label}" names "${slug}", which is neither in the ` +
              `site nor in the seed (${target?.label ?? field.to}).`,
          );
        }
      }
    }
    if (entry.locale !== "" && !(await exists(entry.type.key, entry.translates, ""))) {
      errors.push(
        `${entry.type.singular} "${entry.draft.title}" (${entry.locale}) translates "${entry.translates}", which is ` +
          "neither in the site nor in the seed in the default language.",
      );
    }
  }
  if (errors.length > 0)
    throw new ValidationError(`The seed has ${errors.length} mistake(s):\n- ${errors.join("\n- ")}`);

  plan.create = orderForCreation(types, plan.create);
  return plan;
}

/** Adds what the plan says, in its order, and answers the items added. */
export async function applySeed(items: ItemStore, plan: SeedPlan): Promise<Item[]> {
  const added: Item[] = [];
  // The originals of each type by slug, read once per type and kept up to date as items are added (reading the whole
  // type again for every translation made a large seed slow).
  const originals = new Map<string, Map<string, string>>();
  const originalsOf = async (type: string) => {
    let bySlug = originals.get(type);
    if (!bySlug) {
      bySlug = new Map(
        (await items.list(type)).filter((item) => item.locale === "").map((item) => [item.slug, item.id]),
      );
      originals.set(type, bySlug);
    }
    return bySlug;
  };
  for (const entry of plan.create) {
    const bySlug = await originalsOf(entry.type.key);
    const translationOf = entry.locale !== "" ? (bySlug.get(entry.translates) ?? null) : null;
    const item = await items.create(entry.type.key, entry.draft, { locale: entry.locale, translationOf });
    if (entry.locale === "") bySlug.set(item.slug, item.id);
    added.push(item);
  }
  return added;
}

/**
 * The order to add a seed in: a type after the types its references point at (categories before products), and an
 * item in the default language before its translations. Types that point at each other keep the seed's order.
 */
function orderForCreation<T extends { type: ContentType; locale: string }>(types: ContentType[], entries: T[]): T[] {
  const depth = new Map<string, number>();
  const depthOf = (key: string, path: Set<string> = new Set()): number => {
    const cached = depth.get(key);
    if (cached !== undefined) return cached;
    if (path.has(key)) return 0;
    path.add(key);
    const type = types.find((candidate) => candidate.key === key);
    const targets = type
      ? referenceFields(type)
          .map((field) => field.to)
          .filter((to) => to !== key)
      : [];
    const value = targets.length === 0 ? 0 : 1 + Math.max(...targets.map((to) => depthOf(to, path)));
    depth.set(key, value);
    return value;
  };
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        depthOf(a.entry.type.key) - depthOf(b.entry.type.key) ||
        Number(a.entry.locale !== "") - Number(b.entry.locale !== "") ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

/** Every item of the site as seed entries, the default language first: what `brim seed --export` writes. */
export function exportSeed(types: ContentType[], all: Item[]): SeedEntry[] {
  const order = new Map(types.map((type, index) => [type.key, index]));
  const byId = new Map(all.map((item) => [item.id, item]));
  return [...all]
    .filter((item) => order.has(item.type))
    .sort(
      (a, b) =>
        (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0) ||
        Number(a.locale !== "") - Number(b.locale !== "") ||
        // In the owner's order, which the seed keeps: items are added in the order the file lists them.
        a.position - b.position ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .map((item) => ({
      type: item.type,
      title: item.title,
      slug: item.slug,
      ...(item.visibility === "private" && { visibility: "private" as const }),
      ...(item.locale !== "" && { locale: item.locale }),
      // A translation names its original when their slugs differ, so the seed links them again.
      ...(item.translationOf &&
        byId.get(item.translationOf) &&
        byId.get(item.translationOf)!.slug !== item.slug && { translates: byId.get(item.translationOf)!.slug }),
      data: item.data,
    }));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
