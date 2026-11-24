import type { ContentType } from "./content-types.ts";
import type { ItemStore } from "./items.ts";
import { referenceFields, referencesTo } from "./references.ts";
import { routeDrawsItems } from "./sitemap.ts";
import type { StoredNode } from "./types.ts";

/**
 * `brim check --content`: what the site's content still gets wrong, read from the database rather than the code.
 * Values left from testing or a template (lorem ipsum, example.com, +40 000 000 000), terms of a vocabulary that
 * nothing uses (a category page with no products), and dynamic pages the sitemap cannot list. Warnings only: the
 * owner decides, and some of them are on purpose.
 */
export interface ContentFinding {
  rule: "placeholder" | "empty-term" | "unlisted-pages";
  /** Where, in words a person finds it by: `product/marazzi-art → summary`, `site settings → whatsapp`, `/despre`. */
  where: string;
  message: string;
}

interface Sources {
  contentTypes: ContentType[];
  items: ItemStore;
  /** Every saved node: texts, links and images of the pages, the site's shared content. */
  nodes: StoredNode[];
  /** The site's own settings as the site shows them (saved values over the code's defaults), per language. */
  settings: { locale: string; values: Record<string, unknown> }[];
  /** Patterns of the dynamic routes written in src/pages, e.g. `/produse/[category]`. */
  patterns: string[];
}

/** Text that is still a stand-in, with what to say about it. Each is meant to be rare in real content. */
const PLACEHOLDERS: { pattern: RegExp; what: string }[] = [
  { pattern: /\blorem ipsum\b|\bdolor sit amet\b/i, what: "lorem ipsum" },
  {
    pattern:
      /\b(?:[\w.+-]+@)?(?:[\w-]+\.)*(?:example\.(?:com|org|net)|test\.com|domain\.com|yourdomain\.\w+|yoursite\.\w+)\b/i,
    what: "an example address",
  },
  {
    pattern: /\b[\w.+-]+@[\w-]+\.(?:demo|test|invalid|example|local)\b|\bhttps?:\/\/[\w.-]+\.(?:demo|test|invalid)\b/i,
    what: "a test address",
  },
  // A phone number of one digit repeated (+40 000 000 000, 0700 000 000) or counting up (123456789).
  { pattern: /(?:\+?\d[\s.-]?)?(\d)(?:[\s.-]?\1){6,}|123[\s.-]?456[\s.-]?789/, what: "a stand-in number" },
  { pattern: /\b(?:TODO|FIXME|TBD)\b|\bXXX\b/, what: "a note left to fill in" },
  { pattern: /\bplaceholder\b|\bsample text\b|\byour (?:company|business) name\b/i, what: "a stand-in" },
];

/** What in a text looks like a stand-in, if anything. */
export function placeholderIn(text: string): string | undefined {
  for (const { pattern, what } of PLACEHOLDERS) {
    const match = pattern.exec(text);
    if (match) return `${what} ("${match[0].trim().slice(0, 60)}")`;
  }
  return undefined;
}

/** Every text in a value with where it is: `summary`, `gallery[2].alt`, `specs[0].value`. */
function texts(value: unknown, path: string, found: { path: string; text: string }[] = []) {
  if (typeof value === "string") found.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((entry, index) => texts(entry, `${path}[${index}]`, found));
  else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) texts(entry, path ? `${path}.${key}` : key, found);
  }
  return found;
}

export async function checkContent({
  contentTypes,
  items,
  nodes,
  settings,
  patterns,
}: Sources): Promise<ContentFinding[]> {
  const findings: ContentFinding[] = [];
  const flag = (where: string, text: string) => {
    const what = placeholderIn(text);
    if (what) findings.push({ rule: "placeholder", where, message: `${what}: replace it with the real value` });
  };

  for (const type of contentTypes) {
    for (const item of await items.list(type.key)) {
      const name = `${type.key}/${item.slug}${item.locale ? ` (${item.locale})` : ""}`;
      flag(`${name} → title`, item.title);
      for (const { path, text } of texts(item.data, "")) flag(`${name} → ${path}`, text);
    }
  }
  for (const { locale, values } of settings) {
    for (const { path, text } of texts(values, "")) {
      flag(`site settings${locale ? ` (${locale})` : ""} → ${path}`, text);
    }
  }
  for (const node of nodes) {
    // The site settings were read above, with their defaults; the rest are the pages' own texts and links.
    if (node.nodeId === "site-settings") continue;
    for (const { path, text } of texts(node.value, "")) {
      flag(`${node.scope} → ${node.nodeId}${path ? `.${path}` : ""}`, text);
    }
  }

  // Terms of a vocabulary something points at, which nothing uses yet.
  const used = new Set(contentTypes.flatMap((type) => referenceFields(type).map((field) => field.to)));
  for (const vocabulary of contentTypes.filter((type) => type.vocabulary && used.has(type.key))) {
    for (const term of await items.list(vocabulary.key, { locale: "" })) {
      if ((await referencesTo(contentTypes, items, term)).length > 0) continue;
      findings.push({
        rule: "empty-term",
        where: `${vocabulary.key}/${term.slug}`,
        message:
          `"${term.title}" is used by nothing yet` +
          (vocabulary.component ? ": its page lists nothing. Add items to it, or hide or delete it" : ""),
      });
    }
  }

  // Dynamic routes the content types do not draw: only the route knows their addresses.
  for (const pattern of patterns) {
    // Catch-all routes, the editor, and the framework's own routes (`/_server-islands/…`, `/_image`) are not pages.
    if (/\[\.\.\.|^\/(?:admin|_)/.test(pattern) || routeDrawsItems(contentTypes, pattern)) continue;
    findings.push({
      rule: "unlisted-pages",
      where: pattern,
      message:
        "these pages are not in the sitemap: Brim cannot know their addresses. Make what they show items of a " +
        "content type with this path (or a vocabulary with pages), whose pages Brim lists",
    });
  }
  return findings;
}
