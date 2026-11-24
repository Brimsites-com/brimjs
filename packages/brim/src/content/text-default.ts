/**
 * Checks the default content a site author wrote inside `<Text>`, before the owner edits it.
 *
 * The editor starts from what the page shows and saves it as the inline formatting `TextValue.rich` can hold. What
 * that cannot hold would be dropped without a word on the owner's first edit: a nested Brim element (and every
 * later edit to it), a paragraph or a list, a picture, an element's class. So it is named here instead, while
 * the author can still change the code.
 */

/** Elements `rich` keeps, and the attributes each may carry. `b`, `i`, `strike` and `del` are saved under their usual names. */
const KEPT_ELEMENTS: Record<string, readonly string[]> = {
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  strike: [],
  del: [],
  sub: [],
  sup: [],
  a: ["href"],
  span: ["style"],
};

/** Elements that make a block of their own: a `Text` is one element of words, so they belong in a `RichText`. */
const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

/** Colors the editor reads back from a `span`: the ones it would write itself. */
const KEPT_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,/%]+\))$/i;

// Opening tags only: a closing tag carries nothing that could be lost. Comments are skipped whole.
const TAG =
  /<!--[\s\S]*?-->|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * What in a `Text`'s default HTML its saved value could not keep, said for the site author, or `undefined` when an
 * edit keeps it all. Spaces and Astro's own `data-astro-*` attributes (scoped styles, the dev toolbar) do not count.
 */
export function unkeptTextMarkup(html: string): string | undefined {
  for (const match of html.matchAll(TAG)) {
    const [whole, name, attributeText = ""] = match;
    if (name === undefined) continue;
    const tag = name.toLowerCase();
    const attributes = parseAttributes(attributeText);
    const shown = openingTag(whole);

    const nested = attributes.get("data-brim-node");
    if (nested !== undefined) return `another Brim element, "${nested}" (${shown})`;
    if (BLOCK_ELEMENTS.has(tag)) return `a block element, ${shown}`;

    const allowed = KEPT_ELEMENTS[tag];
    if (!allowed) return shown;
    for (const [attribute, value] of attributes) {
      if (attribute.startsWith("data-astro-")) continue;
      if (!allowed.includes(attribute)) return `${shown}, with its "${attribute}" attribute`;
      if (attribute === "style" && !keepsStyle(value)) return `${shown}, with a style other than a color`;
    }
    if (tag === "a" && !attributes.get("href")) return `${shown}, a link without an address`;
  }
  return undefined;
}

/** The error for a `Text` whose default content an edit would not keep, naming the node and the way out. */
export function textDefaultError(nodeId: string, html: string): string | undefined {
  const unkept = unkeptTextMarkup(html);
  if (!unkept) return undefined;
  return (
    `Brim: the content of <Text nodeId="${nodeId}"> in the code holds ${unkept}, ` +
    "which the owner's first edit would lose. " +
    "A Text keeps words, line breaks, bold, italic, underline, strikethrough, sub- and superscript, colors and links " +
    '(<br>, <strong>, <em>, <u>, <s>, <sub>, <sup>, <span style="color">, <a href>), with no other attributes. ' +
    "Use <RichText> for paragraphs and lists, move other elements out of the Text, or split it into several Text " +
    "elements, each with its own nodeId, and style the Text element itself."
  );
}

function parseAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name = "", double, single, bare] of text.matchAll(ATTRIBUTE)) {
    attributes.set(name.toLowerCase(), double ?? single ?? bare ?? "");
  }
  return attributes;
}

/** Only `color` and `background-color`, as the editor writes them, survive being read back. */
function keepsStyle(style: string): boolean {
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .every((declaration) => {
      const [property = "", ...rest] = declaration.split(":");
      const value = rest.join(":").trim();
      return ["color", "background-color"].includes(property.trim().toLowerCase()) && KEPT_COLOR.test(value);
    });
}

/** The tag as the author would recognise it: without Astro's attributes or the editor's, but its nodeId, and short. */
function openingTag(tag: string): string {
  const cleaned = tag.replace(/\s+data-(?:astro-[\w-]+|brim-(?!node\b)[\w-]+)(?:="[^"]*"|='[^']*')?/g, "");
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}
