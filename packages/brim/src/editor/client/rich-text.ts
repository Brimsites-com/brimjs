import { renderBlocks, renderInline } from "../../content/rich-text.ts";
import type { InlineMark, InlineNode, RichTextBlock, TextAlign } from "../../content/types.ts";

export type { InlineNode, RichTextBlock, TextAlign };

type BlockTag = Exclude<RichTextBlock["tag"], "ul" | "ol">;

const MARKS: Record<string, InlineMark> = {
  B: "strong",
  STRONG: "strong",
  I: "em",
  EM: "em",
  U: "u",
  S: "s",
  STRIKE: "s",
  DEL: "s",
  SUB: "sub",
  SUP: "sup",
};
const BLOCK_TAGS = ["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"];
const ALIGNMENTS: readonly string[] = ["left", "center", "right", "justify"];

// The edited content lives in the page frame's realm, so `instanceof` checks from here always fail.
function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * Spaces, tabs and line breaks the browser shows as one space, as in the page's source (`<p>\n  Hello\n</p>`). A
 * space the owner typed twice is a non-breaking space, which is kept.
 */
const COLLAPSIBLE = /[ \t\n\r\f]+/g;

/** Whether the element shows its text's spaces and line breaks as written (`white-space: pre`, a code block). */
function keepsWhitespace(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  const whiteSpace = view ? view.getComputedStyle(element).whiteSpace : "normal";
  return whiteSpace.startsWith("pre") || whiteSpace === "break-spaces";
}

/** An element's words as the page shows them: the source's indentation and line breaks are not saved. */
export function readText(element: HTMLElement): string {
  const text = element.textContent ?? "";
  return keepsWhitespace(element) ? text : text.replace(COLLAPSIBLE, " ").trim();
}

/** An element's formatted words, collapsed like `readText`: what is saved is what the page shows. */
export function readInlineText(element: HTMLElement): InlineNode[] {
  const nodes = readInline(element);
  return keepsWhitespace(element) ? nodes : tidy(nodes);
}

/** Collapses spaces inside the words, and drops those at the very start and end, also inside a link or a mark. */
function tidy(nodes: InlineNode[]): InlineNode[] {
  const collapse = (node: InlineNode): InlineNode =>
    typeof node === "string"
      ? node.replace(COLLAPSIBLE, " ")
      : "children" in node
        ? { ...node, children: node.children.map(collapse) }
        : node;
  return trimEdge(trimEdge(nodes.map(collapse), "start"), "end");
}

/** Trims the first (or last) words, going into the formatting that holds them; what is left empty is dropped. */
function trimEdge(nodes: InlineNode[], edge: "start" | "end"): InlineNode[] {
  const list = [...nodes];
  const index = edge === "start" ? 0 : list.length - 1;
  const node = list[index];
  if (node === undefined) return list;
  if (typeof node === "string") {
    const trimmed = edge === "start" ? node.trimStart() : node.trimEnd();
    if (trimmed === "") return trimEdge(edge === "start" ? list.slice(1) : list.slice(0, -1), edge);
    list[index] = trimmed;
  } else if ("children" in node && node.tag !== "br") {
    list[index] = { ...node, children: trimEdge(node.children, edge) };
  }
  return list;
}

/** Reads inline formatting. Anything the server would not accept is unwrapped to its text. */
export function readInline(parent: Node): InlineNode[] {
  return [...parent.childNodes].flatMap((node): InlineNode[] => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [node.textContent] : [];
    return isElement(node) ? readElement(node) : [];
  });
}

function readElement(element: HTMLElement): InlineNode[] {
  if (element.tagName === "BR") return [{ tag: "br", children: [] }];
  const children = readInline(element);
  const href = element.getAttribute("href");
  if (element.tagName === "A" && href) return [{ tag: "a", href, children }];
  const mark = MARKS[element.tagName];
  if (mark) return [{ tag: mark, children }];

  const color = hexColor(element.getAttribute("color") ?? element.style.color);
  const background = hexColor(element.style.backgroundColor);
  if (!color && !background) return children;
  return [{ tag: "span", ...(color && { color }), ...(background && { background }), children }];
}

/** Reads flowing content. Loose text between blocks becomes a paragraph. */
export function readBlocks(container: HTMLElement): RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  let loose: InlineNode[] = [];
  const flushLoose = (): void => {
    if (loose.some((node) => typeof node !== "string" || node.trim() !== ""))
      blocks.push({ tag: "p", children: keepsWhitespace(container) ? loose : tidy(loose) });
    loose = [];
  };

  for (const node of container.childNodes) {
    if (!isElement(node)) {
      if (node.textContent) loose.push(node.textContent);
    } else if (node.tagName === "UL" || node.tagName === "OL") {
      flushLoose();
      const items = [...node.children]
        .filter((item): item is HTMLElement => item.tagName === "LI")
        .map((item) => readInlineText(item));
      blocks.push({ tag: node.tagName === "UL" ? "ul" : "ol", items });
    } else if (BLOCK_TAGS.includes(node.tagName) || node.tagName === "DIV") {
      flushLoose();
      const align = alignOf(node);
      blocks.push({
        tag: node.tagName === "DIV" ? "p" : (node.tagName.toLowerCase() as BlockTag),
        ...(align && { align }),
        children: readInlineText(node),
      });
    } else {
      loose.push(...readElement(node));
    }
  }
  flushLoose();
  return blocks;
}

export function alignOf(element: HTMLElement): TextAlign | undefined {
  const align = element.style.textAlign;
  return ALIGNMENTS.includes(align) ? (align as TextAlign) : undefined;
}

export function hasFormatting(nodes: InlineNode[]): boolean {
  return nodes.some((node) => typeof node !== "string");
}

/** Browsers report colors as `rgb(…)`; they are saved as hex. Fully transparent means no color. */
export function hexColor(value: string | null): string | undefined {
  if (!value) return undefined;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value.toLowerCase();
  const channels = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\s*\)$/);
  if (!channels || channels[4] === "0") return undefined;
  return `#${channels
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Markup that never shows as words: its text (CSS, scripts, Word's settings) must not land in the text. */
const HIDDEN_TAGS = "head, style, script, template, noscript, meta, link, title, xml, svg, img, picture, video, audio";
/** Wrappers that hold paragraphs of their own: their paragraphs are kept, the wrapper is not. */
const WRAPPER_TAGS = ["BODY", "MAIN", "ARTICLE", "SECTION", "HEADER", "FOOTER", "ASIDE", "NAV", "FORM", "CENTER"];
/** Tables and definition lists have no place in a text: each cell or entry becomes a paragraph of its own. */
const TABLE_TAGS = ["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "DL", "FIGURE"];
const CELL_TAGS = ["TD", "TH", "CAPTION", "DT", "DD", "FIGCAPTION", "LI", "PRE", "ADDRESS"];
const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, div, table, dl, li, pre";
/** As the server accepts links (`LINK_SCHEMES` in content/validate.ts); any other address would refuse the save. */
const LINK_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

function allowedLink(href: string): boolean {
  const value = href.trim();
  if ((value.startsWith("/") && !value.startsWith("//")) || value.startsWith("#")) return true;
  return URL.canParse(value) && LINK_SCHEMES.includes(new URL(value).protocol);
}

/** Puts an element's children in its place. */
function unwrap(element: HTMLElement): void {
  element.replaceWith(...element.childNodes);
}

/** Gives an element another tag, keeping what it holds; its attributes are dropped. */
function retag(element: HTMLElement, tag: string): void {
  const replacement = element.ownerDocument.createElement(tag);
  replacement.append(...element.childNodes);
  element.replaceWith(replacement);
}

/**
 * Cleans pasted or dropped HTML so the reading above sees only what the editor itself makes. Colors are dropped:
 * Word and other pages write their defaults inline (`color: windowtext`, `background: white`) in the same form as a
 * color the toolbar sets, so a pasted color cannot be told from a chosen one.
 */
function cleanForeign(body: HTMLElement): void {
  for (const element of body.querySelectorAll<HTMLElement>(HIDDEN_TAGS)) element.remove();
  // Word's list bullets and numbers are written as text in a span it marks to be ignored.
  for (const element of body.querySelectorAll<HTMLElement>("[style]")) {
    if (/mso-list:\s*ignore/i.test(element.getAttribute("style") ?? "")) element.remove();
  }
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);

  for (const element of body.querySelectorAll<HTMLElement>("*")) {
    element.removeAttribute("color");
    element.style.removeProperty("color");
    element.style.removeProperty("background");
    element.style.removeProperty("background-color");
    const href = element.getAttribute("href");
    if (href !== null && !allowedLink(href)) element.removeAttribute("href");
  }
  // Lists stay lists; a list item outside one, a cell or an entry is a paragraph.
  for (const element of [...body.querySelectorAll<HTMLElement>(CELL_TAGS.join(","))]) {
    const inList = element.tagName === "LI" && /^(UL|OL)$/.test(element.parentElement?.tagName ?? "");
    if (!inList) retag(element, "div");
  }
  for (const element of [...body.querySelectorAll<HTMLElement>(TABLE_TAGS.join(","))]) unwrap(element);
  // Deepest first, so a wrapper inside a wrapper is gone before its parent is looked at.
  for (const element of [...body.querySelectorAll<HTMLElement>(`${WRAPPER_TAGS.join(",")}, div`)].reverse()) {
    if (WRAPPER_TAGS.includes(element.tagName) || element.querySelector(BLOCK_SELECTOR)) unwrap(element);
  }
}

/** The words of blocks on one line, a space between blocks and in place of line breaks. */
function oneLine(text: string): string {
  return text
    .split(/\s*[\r\n\u2028\u2029]+\s*/)
    .filter((line) => line.trim() !== "")
    .join(" ")
    .trim();
}

function blocksText(blocks: RichTextBlock[]): string {
  const inlineText = (nodes: InlineNode[]): string =>
    nodes
      .map((node) =>
        typeof node === "string"
          ? node
          : node.tag === "br"
            ? "\n"
            : "children" in node
              ? inlineText(node.children)
              : "",
      )
      .join("");
  return blocks
    .flatMap((block) => ("items" in block ? block.items.map(inlineText) : [inlineText(block.children)]))
    .join("\n");
}

/** What a paste or a drop brings, read as the editor's own content; foreign markup never reaches the page. */
export type Transferred = { kind: "text"; text: string } | { kind: "html"; html: string } | { kind: "none" };

/**
 * Reads pasted or dropped content for a text: its words alone, on one line, for a one-line text; formatting the
 * editor knows (paragraphs, lists, bold, links…) for rich text. Files and images bring nothing: an image belongs in
 * an image block, and its file name would only end up as words in the text.
 */
export function readTransfer(data: DataTransfer | null, rich: boolean): Transferred {
  if (!data) return { kind: "none" };
  const html = data.getData("text/html");
  const plain = data.getData("text/plain");
  let blocks: RichTextBlock[] | undefined;
  if (html.trim() !== "") {
    const body = new DOMParser().parseFromString(html, "text/html").body;
    cleanForeign(body);
    blocks = readBlocks(body);
  }
  if (!rich) {
    const text = oneLine(plain !== "" ? plain : blocks ? blocksText(blocks) : "");
    return text === "" ? { kind: "none" } : { kind: "text", text };
  }
  if (!blocks) return plain.trim() === "" ? { kind: "none" } : { kind: "text", text: plain };
  if (blocks.length === 0) return { kind: "none" };
  const [first] = blocks;
  // One paragraph joins the paragraph it is put in, instead of splitting it in two.
  if (blocks.length === 1 && first && !("items" in first) && first.tag === "p") {
    return { kind: "html", html: renderInline(first.children) };
  }
  return { kind: "html", html: renderBlocks(blocks) };
}

/** Puts what was read into the text being typed, where the caret is, as typing would (it can be undone). */
export function insertTransferred(page: Document, transferred: Transferred): void {
  if (transferred.kind === "text") page.execCommand("insertText", false, transferred.text);
  else if (transferred.kind === "html") page.execCommand("insertHTML", false, transferred.html);
}

/** Where a drop lands: the caret at that point of the page, as a range. */
function rangeAtPoint(page: Document, x: number, y: number): Range | null {
  const position = page.caretPositionFromPoint?.(x, y);
  if (position) {
    const range = page.createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
  }
  // Safari before 18.4 only has the older WebKit call.
  const legacy = page as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  return legacy.caretRangeFromPoint?.(x, y) ?? null;
}

/**
 * Puts what was dropped into the text being typed, read as a paste is, where it was dropped. Words dragged from the
 * same text (`from`, the selection when the drag started) move; from anywhere else they are copied. The browser's
 * own drop is prevented by the caller: it would bring the markup in as it is, or open a dropped file.
 */
export function dropTransferred(element: HTMLElement, event: DragEvent, from: Range | null, rich: boolean): void {
  const page = element.ownerDocument;
  const target = event.target as Node | null;
  if (!target || !element.contains(target)) return;
  const transferred = readTransfer(event.dataTransfer, rich);
  const at = rangeAtPoint(page, event.clientX, event.clientY);
  if (transferred.kind === "none" || !at || !element.contains(at.startContainer)) return;
  const selection = page.getSelection();
  if (!selection) return;
  if (from && !from.collapsed && element.contains(from.commonAncestorContainer)) {
    // Dropped onto the words being dragged: nothing moves.
    if (from.isPointInRange(at.startContainer, at.startOffset)) return;
    // The words leave their place first; the drop point follows the text around it as it changes.
    selection.removeAllRanges();
    selection.addRange(from);
    page.execCommand("delete");
  }
  selection.removeAllRanges();
  selection.addRange(at);
  insertTransferred(page, transferred);
}
