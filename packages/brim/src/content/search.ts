import type { Item } from "./items.ts";

/**
 * Search across the items of several content types, for a site's search page: the words of every text a visitor
 * reads on an item's page (its title, its texts, its rich text and the blocks of its body), whatever their case and
 * accents. Each result carries the sentence the words were found in.
 */

/** Fields whose words are searched: what a visitor reads, not addresses, numbers or pictures. */
const SEARCHED_FIELDS = new Set(["text", "textarea", "richtext", "blocks", "select", "tags", "keyvalue"]);
/** Keys of a block's value that hold no words a visitor reads. */
const SKIPPED_KEYS = new Set([
  "@type",
  "id",
  "presetId",
  "type",
  "url",
  "src",
  "href",
  "link",
  "layout",
  "variant",
  "variation",
  "icon",
  "posterUrl",
  "imageFocus",
  "tag",
]);
const MAX_QUERY = 200;
const EXCERPT = 180;

export interface SearchedType {
  key: string;
  /** The type's fields; their `type` says which hold words. */
  fields: readonly { name: string; type: string }[];
}

export interface SearchHit<T extends Item = Item> {
  item: T;
  /** Key of the item's content type. */
  type: string;
  /** The sentence the words were found in, or the start of the item's text; plain text. */
  excerpt: string;
  /** Higher first: words in the title count most. */
  score: number;
}

/** The words of a query as compared: lowercase, without accents, at most 200 characters. */
export function searchWords(query: string): string[] {
  return fold(query.trim().slice(0, MAX_QUERY))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/**
 * The items, of all the types given, that hold every word of the query, best first. An empty query finds nothing:
 * a search page shows its results only once something is asked.
 */
export function searchItems<T extends Item>(
  groups: { type: SearchedType; items: readonly T[] }[],
  query: string,
): SearchHit<T>[] {
  const words = searchWords(query);
  if (words.length === 0) return [];
  const hits: SearchHit<T>[] = [];
  for (const { type, items } of groups) {
    const fields = type.fields.filter((field) => SEARCHED_FIELDS.has(field.type) && !/^seo_/.test(field.name));
    for (const item of items) {
      const title = fold(item.title);
      const texts = fields.map((field) => textOf(item.data[field.name])).filter(Boolean);
      const body = fold(texts.join(" \n "));
      if (!words.every((word) => title.includes(word) || body.includes(word))) continue;
      const score = words.reduce(
        (total, word) => total + (title.includes(word) ? 10 : 0) + Math.min(5, count(body, word)),
        0,
      );
      hits.push({ item, type: type.key, excerpt: excerptOf(texts, words), score });
    }
  }
  return hits.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt));
}

/** The words a value holds as plain text: rich text without its tags, a block's texts without its settings. */
export function textOf(value: unknown): string {
  if (value === undefined || value === null || typeof value === "boolean" || typeof value === "number") return "";
  if (typeof value === "string") {
    if (/^(https?:|mailto:|tel:|\/|#)\S*$/i.test(value.trim())) return "";
    return decode(value.replace(/<\/(p|div|h[1-6]|li|blockquote)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
      .replace(/[ \t\r\f]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SKIPPED_KEYS.has(key))
      .map(([, one]) => textOf(one))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** The sentence around the first word found, cut to a line; else the start of the first text. */
function excerptOf(texts: string[], words: string[]): string {
  for (const text of texts) {
    const { folded, at } = foldWithPlaces(text);
    const found = words.map((word) => folded.indexOf(word)).filter((index) => index !== -1);
    if (found.length === 0) continue;
    const start = at[Math.min(...found)] ?? 0;
    // From the start of its sentence or line, unless that is too far back.
    const before = text.slice(0, start);
    const sentence = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("? "));
    const atSentence = sentence !== -1 && start - sentence < EXCERPT * 0.6;
    const from = atSentence ? sentence + 1 : Math.max(0, start - 60);
    // "…" where the excerpt starts within a sentence.
    // To the end of the paragraph or block it is in, not into the next one.
    const lineEnd = text.indexOf("\n", start);
    const passage = text.slice(from, lineEnd === -1 ? undefined : lineEnd);
    return clip(passage.replace(/\s+/g, " ").trim(), from > 0 && !atSentence);
  }
  return clip((texts[0] ?? "").split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "", false);
}

function clip(text: string, cut: boolean): string {
  const head = cut ? "…" : "";
  if (text.length <= EXCERPT) return head + text;
  const end = text.lastIndexOf(" ", EXCERPT);
  return `${head}${text.slice(0, end > EXCERPT / 2 ? end : EXCERPT)}…`;
}

function count(text: string, word: string): number {
  let total = 0;
  for (let index = text.indexOf(word); index !== -1; index = text.indexOf(word, index + word.length)) total++;
  return total;
}

/** Text as compared: lowercase, without accents, so "ceramica" finds "Ceramică". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

/** The folded text, and for each of its characters the place in the original it comes from. */
function foldWithPlaces(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let index = 0; index < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(index) ?? 0);
    const one = fold(character);
    folded += one;
    for (let n = 0; n < one.length; n++) at.push(index);
    index += character.length;
  }
  return { folded, at };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}
