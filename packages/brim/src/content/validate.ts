import { text as textBlock } from "../blocks/schemas/text.ts";
import { parseSettings } from "../blocks/settings.ts";
import { ValidationError } from "./validation-error.ts";
import { TEXT_TAGS } from "./rich-text.ts";
import type {
  FooterGroup,
  FooterValue,
  ImageValue,
  InlineNode,
  LinkValue,
  NavItem,
  NavLink,
  NavbarValue,
  NodeKind,
  NodeValues,
  RichTextBlock,
  RichTextValue,
  SeoSettings,
  TextAlign,
  TextValue,
} from "./types.ts";

export { ValidationError };

const MAX_TEXT = 20_000;
const MAX_LABEL = 200;
const MAX_URL = 2_000;
const MAX_NAV_ITEMS = 50;
/** How many levels of sub-links a navbar link can have: a megamenu's columns, and the links of each column. */
const MAX_NAV_DEPTH = 2;
const MAX_NAV_LINKS = 300;
const MAX_FOOTER_GROUPS = 12;
const MAX_INLINE_NODES = 2_000;
const MAX_INLINE_DEPTH = 8;
const MAX_BLOCKS = 500;

const INLINE_MARKS = ["strong", "em", "u", "s", "sub", "sup", "br"] as const;
const BLOCK_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"] as const;
const ALIGNMENTS: readonly TextAlign[] = ["left", "center", "right", "justify"];
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const LINK_SCHEMES = ["http:", "https:", "mailto:", "tel:"];
const IMAGE_SCHEMES = ["http:", "https:"];
const WEB_SCHEMES = ["http:", "https:"];
const MAX_SEO_DESCRIPTION = 500;

/** Turns untrusted input into a node value, keeping only known fields. Throws `ValidationError`. */
export function parseNodeValue<K extends NodeKind>(kind: K, input: unknown): NodeValues[K] {
  const parsers: { [Kind in NodeKind]: (value: Record<string, unknown>) => NodeValues[Kind] } = {
    text: parseText,
    richtext: parseRichText,
    link: parseLink,
    navbar: parseNavbar,
    footer: parseFooter,
  };
  if (!Object.hasOwn(parsers, kind)) throw new ValidationError(`Unknown node kind "${kind}".`);
  return parsers[kind](record(input, "value"));
}

/** Empty fields are dropped, so the page falls back to what its code says. */
export function parseSeo(input: unknown): SeoSettings {
  const value = record(input, "seo");
  const text = (name: string, max: number): string =>
    value[name] === undefined ? "" : string(value[name], name, max).trim();
  const flag = (name: string): boolean => {
    if (value[name] !== undefined && typeof value[name] !== "boolean") {
      throw new ValidationError(`"${name}" must be true or false.`);
    }
    return value[name] === true;
  };
  const title = text("title", MAX_LABEL);
  const description = text("description", MAX_SEO_DESCRIPTION);
  const image = text("image", MAX_URL);
  const shareTitle = text("shareTitle", MAX_LABEL);
  const shareDescription = text("shareDescription", MAX_SEO_DESCRIPTION);
  const canonical = text("canonical", MAX_URL);
  if (canonical.startsWith("#")) throw new ValidationError('"canonical" must be a path of the site or a full address.');
  return {
    ...(title && { title }),
    ...(description && { description }),
    ...(image && { image: url(image, "image", IMAGE_SCHEMES) }),
    ...(shareTitle && { shareTitle }),
    ...(shareDescription && { shareDescription }),
    ...(canonical && { canonical: url(canonical, "canonical", WEB_SCHEMES) }),
    ...(flag("noindex") && { noindex: true }),
    ...(flag("nofollow") && { nofollow: true }),
  };
}

function parseText(value: Record<string, unknown>): TextValue {
  const budget = { nodes: MAX_INLINE_NODES };
  return {
    text: string(value.text, "text", MAX_TEXT),
    ...(value.rich !== undefined && { rich: inlineNodes(value.rich, 0, budget) }),
    ...(value.as !== undefined && { as: oneOf(value.as, TEXT_TAGS, "as") }),
    ...(value.align !== undefined && { align: oneOf(value.align, ALIGNMENTS, "align") }),
    ...(value.options !== undefined && { options: parseSettings(textBlock, value.options) }),
  };
}

export function parseRichText(value: Record<string, unknown>): RichTextValue {
  const budget = { nodes: MAX_INLINE_NODES };
  const blocks = list(value.blocks, "blocks", MAX_BLOCKS).map((entry): RichTextBlock => {
    const block = record(entry, "blocks");
    if (block.tag === "ul" || block.tag === "ol") {
      const items = list(block.items, "items", MAX_BLOCKS).map((item) => inlineNodes(item, 0, budget));
      return { tag: block.tag, items };
    }
    return {
      tag: oneOf(block.tag, BLOCK_TAGS, "tag"),
      ...(block.align !== undefined && { align: oneOf(block.align, ALIGNMENTS, "align") }),
      children: inlineNodes(block.children ?? [], 0, budget),
    };
  });
  return { blocks };
}

function inlineNodes(input: unknown, depth: number, budget: { nodes: number }): InlineNode[] {
  if (depth > MAX_INLINE_DEPTH) throw new ValidationError("The text formatting is nested too deeply.");
  return list(input, "rich", MAX_INLINE_NODES).map((entry): InlineNode => {
    if (--budget.nodes < 0) throw new ValidationError("The text has too much formatting.");
    if (typeof entry === "string") return string(entry, "rich", MAX_TEXT);

    const node = record(entry, "rich");
    const children = inlineNodes(node.children ?? [], depth + 1, budget);
    if (node.tag === "a") return { tag: "a", href: url(node.href, "href", LINK_SCHEMES), children };
    if (node.tag === "span") {
      return {
        tag: "span",
        ...(node.color !== undefined && { color: color(node.color, "color") }),
        ...(node.background !== undefined && { background: color(node.background, "background") }),
        children,
      };
    }
    return { tag: oneOf(node.tag, INLINE_MARKS, "tag"), children };
  });
}

function oneOf<T extends string>(input: unknown, allowed: readonly T[], name: string): T {
  if (typeof input !== "string" || !allowed.includes(input as T)) {
    throw new ValidationError(`"${name}" is not an allowed value.`);
  }
  return input as T;
}

/** Colors are stored as hex, so a saved value can never smuggle other CSS in. */
function color(input: unknown, name: string): string {
  if (typeof input !== "string" || !HEX_COLOR.test(input)) throw new ValidationError(`"${name}" must be a hex color.`);
  return input.toLowerCase();
}

export function parseImage(value: Record<string, unknown>): ImageValue {
  return { src: url(value.src, "src", IMAGE_SCHEMES), alt: string(value.alt, "alt", MAX_LABEL * 2) };
}

function parseLink(value: Record<string, unknown>): LinkValue {
  const href = url(value.href, "href", LINK_SCHEMES);
  return value.label === undefined ? { href } : { href, label: string(value.label, "label", MAX_LABEL) };
}

function parseNavbar(value: Record<string, unknown>): NavbarValue {
  const budget = { links: MAX_NAV_LINKS };
  return { ...brand(value), items: navItems(value.items, "items", 0, budget) };
}

function parseFooter(value: Record<string, unknown>): FooterValue {
  const groups = list(value.groups, "groups", MAX_FOOTER_GROUPS).map((entry, index): FooterGroup => {
    const group = record(entry, `groups[${index}]`);
    const items = navLinks(group.items ?? [], `groups[${index}].items`);
    return {
      ...(group.title !== undefined && { title: string(group.title, "title", MAX_LABEL) }),
      items,
      ...(group.from !== undefined && { from: typeKey(group.from, `groups[${index}].from`) }),
    };
  });
  return { ...brand(value), groups };
}

function brand(value: Record<string, unknown>): { logo?: ImageValue; logoText?: string } {
  return {
    ...(value.logo !== undefined && { logo: parseImage(record(value.logo, "logo")) }),
    ...(value.logoText !== undefined && { logoText: string(value.logoText, "logoText", MAX_LABEL) }),
  };
}

function navLinks(input: unknown, name: string): NavLink[] {
  return list(input, name, MAX_NAV_ITEMS).map((entry, index) => navLink(record(entry, `${name}[${index}]`)));
}

function navLink(item: Record<string, unknown>): NavLink {
  return { label: string(item.label, "label", MAX_LABEL), href: url(item.href, "href", LINK_SCHEMES) };
}

/**
 * The navbar's links with their sub-links and pictures. `budget` counts every link of the navbar, at any depth, so
 * nesting cannot multiply the per-list limit into a value too large to draw. An empty `children` list is dropped,
 * so a link without sub-links is stored as it was before groups existed.
 */
function navItems(input: unknown, name: string, depth: number, budget: { links: number }): NavItem[] {
  const entries = list(input, name, MAX_NAV_ITEMS);
  if (depth > MAX_NAV_DEPTH && entries.length > 0) {
    throw new ValidationError(`"${name}" is nested too deeply: links can have sub-links ${MAX_NAV_DEPTH} levels deep.`);
  }
  return entries.map((entry, index): NavItem => {
    if (--budget.links < 0) throw new ValidationError(`The navigation can hold at most ${MAX_NAV_LINKS} links.`);
    const path = `${name}[${index}]`;
    const item = record(entry, path);
    const children = item.children === undefined ? [] : navItems(item.children, `${path}.children`, depth + 1, budget);
    return {
      ...navLink(item),
      ...(item.image !== undefined && { image: parseImage(record(item.image, `${path}.image`)) }),
      ...(children.length > 0 && { children }),
      ...(item.from !== undefined && depth < MAX_NAV_DEPTH && { from: typeKey(item.from, `${path}.from`) }),
    };
  });
}

/** A content type's key, as `from` names the type a menu lists. Whether the site declares it is checked when drawn. */
function typeKey(input: unknown, name: string): string {
  if (typeof input !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(input)) {
    throw new ValidationError(`"${name}" must be the key of a content type.`);
  }
  return input;
}

function record(input: unknown, name: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError(`"${name}" must be an object.`);
  }
  return input as Record<string, unknown>;
}

function list(input: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(input)) throw new ValidationError(`"${name}" must be a list.`);
  if (input.length > max) throw new ValidationError(`"${name}" can hold at most ${max} entries.`);
  return input;
}

function string(input: unknown, name: string, max: number): string {
  if (typeof input !== "string") throw new ValidationError(`"${name}" must be text.`);
  if (input.length > max) throw new ValidationError(`"${name}" is longer than ${max} characters.`);
  return input;
}

/** Accepts site-relative paths, in-page anchors and the listed schemes. Rejects `javascript:` and the like. */
function url(input: unknown, name: string, schemes: string[]): string {
  const value = string(input, name, MAX_URL).trim();
  const relative = (value.startsWith("/") && !value.startsWith("//")) || value.startsWith("#");
  if (relative) return value;
  const scheme = URL.canParse(value) ? new URL(value).protocol : "";
  if (!schemes.includes(scheme)) throw new ValidationError(`"${name}" is not an allowed address.`);
  return value;
}
