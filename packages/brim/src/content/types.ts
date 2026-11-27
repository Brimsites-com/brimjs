export type TextTag =
  "p" | "span" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "label" | "strong" | "em" | "small";

export type InlineMark = "strong" | "em" | "u" | "s" | "sub" | "sup";
export type TextAlign = "left" | "center" | "right" | "justify";

/** Inline formatting the owner can apply to text. Stored as a tree, never as HTML. */
export type InlineNode =
  | string
  | { tag: InlineMark | "br"; children: InlineNode[] }
  | { tag: "a"; href: string; children: InlineNode[] }
  | { tag: "span"; color?: string; background?: string; children: InlineNode[] };

/** One element of text: a heading, a paragraph, a label. */
export interface TextValue {
  /** The plain text, always present. */
  text: string;
  /** Present when the owner formatted the text; `text` is then its plain reading. */
  rich?: InlineNode[];
  /** Present when the owner changed the element, e.g. from a paragraph to a heading. */
  as?: TextTag;
  align?: TextAlign;
  /** Presentation choices of the text block: drop cap, quote style and the like. */
  options?: Record<string, unknown>;
}

export type RichTextBlock =
  | { tag: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote"; align?: TextAlign; children: InlineNode[] }
  | { tag: "ul" | "ol"; items: InlineNode[][] };

/** Flowing content: several paragraphs, headings and lists the owner writes freely. */
export interface RichTextValue {
  blocks: RichTextBlock[];
}

export interface ImageValue {
  src: string;
  alt: string;
  /** The part that stays in sight where the site crops the picture; absent while it is the middle. */
  focus?: ImageFocus;
}

/**
 * Where a picture is anchored when the site crops it (`object-fit: cover`): percentages from its left and its top,
 * its `object-position`. `focusStyle(image.focus)` from brimjs/content gives the CSS.
 */
export interface ImageFocus {
  x: number;
  y: number;
}

export interface LinkValue {
  href: string;
  /** When absent, the label written in source is kept. */
  label?: string;
}

/** A plain link of a list, as the footer keeps them. */
export interface NavLink {
  label: string;
  href: string;
}

/**
 * A link of the navbar. `children` makes it a group, e.g. "Products" with a dropdown of categories, and `image`
 * gives any link a picture, so the site's markup can draw a megamenu. Both are optional: a value saved before they
 * existed is a flat list of links and stays valid. Children nest two levels at most (a column of a megamenu and
 * its links).
 */
export interface NavItem extends NavLink {
  image?: ImageValue;
  children?: NavItem[];
  /**
   * A content type's key: the link's sub-links are that type's items (title, page, first picture), in the owner's
   * order for an `ordered` type, so a category added in the editor shows in the menu. `children` is then ignored.
   */
  from?: string;
}

export interface NavbarValue {
  logo?: ImageValue;
  logoText?: string;
  items: NavItem[];
}

export interface FooterGroup {
  title?: string;
  items: NavLink[];
  /** A content type's key: the group lists that type's items, as `from` does for a navbar link. */
  from?: string;
}

export interface FooterValue {
  logo?: ImageValue;
  logoText?: string;
  groups: FooterGroup[];
}

/** Every primitive and the shape of the value the owner can edit. Blocks keep a settings record instead. */
export interface NodeValues {
  text: TextValue;
  richtext: RichTextValue;
  link: LinkValue;
  navbar: NavbarValue;
  footer: FooterValue;
}

export type NodeKind = keyof NodeValues;

/** A node as saved. `kind` is a primitive (`text`, `image`…) or a block type (`button`, `carousel`…). */
export interface StoredNode {
  scope: string;
  nodeId: string;
  kind: string;
  value: unknown;
}

/** Pages and content items are either visible on the public site or not. Media has no visibility. */
export type Visibility = "private" | "published";

/** What search engines and link previews show for a page. Anything left out falls back to the page's code. */
export interface SeoSettings {
  title?: string;
  description?: string;
  /** Image shown when the page is shared. */
  image?: string;
  /**
   * The part of `image` that stays in sight where the site crops it: a card of the page in a listing. Shared links
   * show the whole picture.
   */
  imageFocus?: ImageFocus;
  /** Title and description of the page's shared links (Open Graph, X); empty uses `title` and `description`. */
  shareTitle?: string;
  shareDescription?: string;
  /**
   * The page's preferred address, when the same content is at several: a path of this site (`/pricing`) or a full
   * address. Empty is the page's own address. A page pointing elsewhere is left out of the sitemap.
   */
  canonical?: string;
  /** Asks search engines not to list the page. */
  noindex?: boolean;
  /** Asks search engines not to follow the page's links. */
  nofollow?: boolean;
}

export interface PageRecord {
  path: string;
  visibility: Visibility;
  seo: SeoSettings;
  /** Set on pages the owner added from a template; pages written in code have none. */
  template?: string;
  title?: string;
}
