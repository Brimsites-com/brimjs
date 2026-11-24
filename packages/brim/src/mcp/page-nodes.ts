import type { InlineMark, InlineNode } from "../content/types.ts";

/** One editable element of a page, as its rendered HTML marks it while editing. */
export interface PageNode {
  nodeId: string;
  kind: string;
  scope: string;
  /** The text shown, for elements that hold text, with a line break as `\n`. */
  text?: string;
  /** For a text element with formatting (line breaks, bold, links…): the same text as Brim stores it. */
  rich?: InlineNode[];
  /** What the element carries: block settings, navigation, or the owner's text options. */
  value?: unknown;
  /** Set when the element shows a field of a content item: saving it changes that item. */
  item?: string;
  field?: string;
}

const OPENING_TAG = /<([a-zA-Z][\w-]*)\b([^>]*\bdata-brim-node="[^"]*"[^>]*)>/g;
const VOID_TAGS = new Set(["img", "input", "br", "hr", "meta", "link", "source", "area", "col", "embed", "wbr"]);
const TEXT_KINDS = new Set(["text", "richtext", "link", "field"]);

/**
 * Lists the elements carrying `data-brim-*` markers in a page rendered by the dev server.
 * Markers only exist while editing, never in the public build.
 */
export function pageNodes(html: string): PageNode[] {
  const nodes = new Map<string, PageNode>();
  for (const match of html.matchAll(OPENING_TAG)) {
    const [whole, tag = "", attributes = ""] = match;
    const nodeId = attribute(attributes, "data-brim-node");
    const kind = attribute(attributes, "data-brim-kind");
    const scope = attribute(attributes, "data-brim-scope") ?? "page";
    if (!nodeId || !kind || nodes.has(`${scope}:${nodeId}`)) continue;

    const node: PageNode = { nodeId, kind, scope };
    const value = attribute(attributes, "data-brim-value");
    if (value !== undefined) node.value = parseJson(value);
    const item = attribute(attributes, "data-brim-item");
    const field = attribute(attributes, "data-brim-field");
    if (item && field) Object.assign(node, { item, field });
    if (TEXT_KINDS.has(kind) && !VOID_TAGS.has(tag.toLowerCase())) {
      const inner = innerHtml(html, tag, (match.index ?? 0) + whole.length);
      node.text = plainText(inner);
      const rich = kind === "text" ? inlineNodes(inner) : undefined;
      if (rich) node.rich = rich;
    }
    nodes.set(`${scope}:${nodeId}`, node);
  }
  return [...nodes.values()];
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match?.[1] === undefined ? undefined : decodeEntities(match[1]);
}

/** The markup between an opening tag and its matching closing tag. */
function innerHtml(html: string, tag: string, start: number): string {
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  let depth = 1;
  for (const match of html.slice(start).matchAll(tags)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, start + (match.index ?? 0));
  }
  return html.slice(start);
}

function plainText(markup: string): string {
  return decodeEntities(
    markup
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[lower] ?? entity;
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const MARKS: Record<string, InlineMark> = {
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  u: "u",
  s: "s",
  strike: "s",
  del: "s",
  sub: "sub",
  sup: "sup",
};
const HEX_OR_RGB = /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;

/**
 * The formatting of a text element's markup as Brim stores it (`rich`): line breaks, bold, italic, underline,
 * strikethrough, sub- and superscript, links and colors. Any other element gives only its words. Nothing when the
 * markup is plain text, so an agent sees `rich` only where there is formatting to keep.
 */
export function inlineNodes(markup: string): InlineNode[] | undefined {
  const root: InlineNode[] = [];
  const stack: { tag: string; children: InlineNode[] }[] = [];
  const children = () => stack.at(-1)?.children ?? root;
  let formatted = false;
  const tokens = markup.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").split(/(<[^>]*>)/);
  for (const token of tokens) {
    if (token === "") continue;
    const tag = /^<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>$/.exec(token);
    if (!tag) {
      if (!token.startsWith("<")) pushText(children(), decodeEntities(token).replace(/\s+/g, " "));
      continue;
    }
    const [, closing, rawName = "", attributes = ""] = tag;
    const name = rawName.toLowerCase();
    if (name === "br") {
      children().push({ tag: "br", children: [] });
      formatted = true;
      continue;
    }
    if (closing) {
      const index = stack.map((entry) => entry.tag).lastIndexOf(name);
      if (index >= 0) stack.length = index;
      continue;
    }
    if (VOID_TAGS.has(name)) continue;
    const node = inlineElement(name, attributes);
    if (node) {
      children().push(node);
      formatted = true;
      stack.push({ tag: name, children: node.children });
    } else {
      // Not formatting Brim keeps: its words join the element around it.
      stack.push({ tag: name, children: children() });
    }
  }
  return formatted ? trimEnds(root) : undefined;
}

function inlineElement(name: string, attributes: string): Exclude<InlineNode, string> | undefined {
  const mark = MARKS[name];
  if (mark) return { tag: mark, children: [] };
  if (name === "a") {
    const href = attribute(attributes, "href");
    return href ? { tag: "a", href, children: [] } : undefined;
  }
  if (name === "span") {
    const style = attribute(attributes, "style") ?? "";
    const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim();
    const background = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim();
    const span = {
      tag: "span" as const,
      ...(color && HEX_OR_RGB.test(color) && { color }),
      ...(background && HEX_OR_RGB.test(background) && { background }),
      children: [],
    };
    return span.color || span.background ? span : undefined;
  }
  return undefined;
}

function pushText(list: InlineNode[], text: string): void {
  if (text === "") return;
  const last = list.at(-1);
  if (typeof last === "string") list[list.length - 1] = last + text;
  else list.push(text);
}

/** Whitespace at the very start and end of the element is the code's indentation, not the owner's words. */
function trimEnds(nodes: InlineNode[]): InlineNode[] {
  const first = nodes[0];
  if (typeof first === "string") nodes[0] = first.replace(/^\s+/, "");
  const last = nodes.at(-1);
  if (typeof last === "string") nodes[nodes.length - 1] = last.replace(/\s+$/, "");
  return nodes.filter((node) => node !== "");
}

/** Plain text with line breaks as Brim stores it: `Un spațiu.\nDe la primul pas` gives two lines. */
export function textWithBreaks(text: string): InlineNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines
    .flatMap((line, index) => (index === 0 ? [line] : [{ tag: "br" as const, children: [] }, line]))
    .filter((node) => node !== "");
}

/** What a formatted text reads as, with a line break for each `br`: the `text` saved beside `rich`. */
export function readingOf(nodes: InlineNode[]): string {
  return nodes
    .map((node) => (typeof node === "string" ? node : node.tag === "br" ? "\n" : readingOf(node.children)))
    .join("");
}
