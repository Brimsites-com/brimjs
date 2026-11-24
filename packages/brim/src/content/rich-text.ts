import type { InlineNode, RichTextBlock, TextAlign, TextTag } from "./types.ts";

export const TEXT_TAGS: readonly TextTag[] = [
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "label",
  "strong",
  "em",
  "small",
];

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character);
}

/** Turns validated formatting into HTML. Every string is escaped, so the result is safe to inline. */
export function renderInline(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (typeof node === "string") return escapeHtml(node);
      if (node.tag === "br") return "<br>";
      const children = renderInline(node.children);
      if (node.tag === "a") return `<a href="${escapeHtml(node.href)}">${children}</a>`;
      if (node.tag === "span") return `<span${styleAttribute(spanStyle(node))}>${children}</span>`;
      return `<${node.tag}>${children}</${node.tag}>`;
    })
    .join("");
}

export function renderBlocks(blocks: RichTextBlock[]): string {
  return blocks
    .map((block) => {
      if ("items" in block) {
        const items = block.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
        return `<${block.tag}>${items}</${block.tag}>`;
      }
      return `<${block.tag}${styleAttribute(alignStyle(block.align))}>${renderInline(block.children)}</${block.tag}>`;
    })
    .join("");
}

export function alignStyle(align: TextAlign | undefined): string {
  return align ? `text-align:${align}` : "";
}

function spanStyle(node: { color?: string; background?: string }): string {
  return [node.color && `color:${node.color}`, node.background && `background-color:${node.background}`]
    .filter(Boolean)
    .join(";");
}

function styleAttribute(style: string): string {
  return style ? ` style="${escapeHtml(style)}"` : "";
}
