import { ValidationError } from "./validation-error.ts";

/** How many tags an item's field or a page holds at most. */
export const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 60;

/**
 * Turns untrusted input into tags: short words or phrases, trimmed, each once whatever its case, in the order
 * given. `options` limits them to a fixed list, spelled as it spells them; `label` names the field in what the
 * owner reads when one is refused.
 */
export function parseTags(value: unknown, label: string, options?: readonly string[]): string[] {
  const fail = (problem: string): never => {
    throw new ValidationError(`"${label}" ${problem}.`);
  };
  if (!Array.isArray(value)) return fail("must be a list of tags");
  if (value.length > MAX_TAGS) return fail(`can hold at most ${MAX_TAGS} tags`);
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return fail("must be a list of tags");
    const typed = cleanTag(entry);
    if (typed === "") continue;
    if (typed.length > MAX_TAG_LENGTH) return fail(`has a tag longer than ${MAX_TAG_LENGTH} characters`);
    // A field with a list of its own keeps each tag as the list spells it.
    const tag = options ? options.find((option) => sameTag(option, typed)) : typed;
    if (tag === undefined) return fail(`does not offer the tag "${typed}"`);
    if (!hasTag(tags, tag)) tags.push(tag);
  }
  return tags;
}

/** A tag as it is kept: trimmed, with one space between its words. */
export function cleanTag(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Whether two tags are the same, whatever their case. */
export function sameTag(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** The tags in a stored value, whatever it holds: a list of text, or nothing. */
export function tagsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

/**
 * The tags used across several lists, most used first, then alphabetically, each once with the spelling it was
 * first given: what the editor offers while a tag is typed, and the tags it filters content by.
 */
export function rankTags(lists: unknown[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const list of lists) {
    for (const tag of new Set(tagsOf(list))) {
      const key = tag.toLocaleLowerCase();
      const known = counts.get(key);
      if (known) known.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Whether a list of tags has this one, whatever its case. */
export function hasTag(tags: readonly string[], wanted: string): boolean {
  return tags.some((tag) => sameTag(tag, wanted));
}
