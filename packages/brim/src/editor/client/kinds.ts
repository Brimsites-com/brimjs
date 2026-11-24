import { blockDefinitions } from "../../blocks/schemas/index.ts";
import { text as textBlock } from "../../blocks/schemas/text.ts";
import type { BlockDefinition } from "../../blocks/types.ts";
import { alignOf, readText } from "./rich-text.ts";

/** Describes an editable value; the inspector's widgets are generated from it. */
export type Schema =
  | { type: "text"; label: string; multiline?: boolean }
  | { type: "url"; label: string }
  | { type: "image"; label: string }
  | { type: "select"; label: string; options: { value: string; label: string }[] }
  | { type: "group"; label?: string; fields: Record<string, Schema> }
  | { type: "list"; label: string; addLabel: string; item: Schema };

export type FormValue = Record<string, unknown>;

/** How one kind of node is presented and edited in the inspector. */
export interface NodeKind {
  title: string;
  schema(element: HTMLElement): Schema;
  /** The value currently shown on the page. */
  read(element: HTMLElement): FormValue;
  /** Turns what the inspector holds into the value to save. */
  toValue(form: FormValue): unknown;
  /** Updates the page without a reload. Left out when the markup is written by the site author. */
  apply?(element: HTMLElement, form: FormValue): void;
  /** Set for blocks: the inspector then shows the sections of the block's own settings schema. */
  block?: BlockDefinition;
  /** Extra sections kept under the value's `options`, for a primitive that also has a block schema. */
  options?: BlockDefinition;
}

const text = (label: string): Schema => ({ type: "text", label });
const navLink: Schema = { type: "group", fields: { label: text("Label"), href: { type: "url", label: "Link" } } };
const navLinks: Schema = { type: "list", label: "Links", addLabel: "Add link", item: navLink };

/** As deep as the server accepts sub-links (`MAX_NAV_DEPTH` in content/validate.ts). */
const NAV_DEPTH = 2;

/**
 * The navbar's links: each with an optional picture and its own list of sub-links, down to `NAV_DEPTH`. Built from
 * the same link, image and list widgets as everything else, so a sub-link is edited like any link.
 */
function navItems(depth: number, sources: Source[]): Schema {
  return {
    type: "list",
    label: depth === 0 ? "Links" : "Sub-links",
    addLabel: depth === 0 ? "Add link" : "Add sub-link",
    item: {
      type: "group",
      fields: {
        label: text("Label"),
        href: { type: "url", label: "Link" },
        image: { type: "image", label: "Picture (optional)" },
        ...(depth < NAV_DEPTH && sources.length > 0 && { from: fromChoice("Sub-links come from", sources) }),
        ...(depth < NAV_DEPTH && { children: navItems(depth + 1, sources) }),
      },
    },
  };
}

/** A content type a menu can list, as the Navbar and Footer components offer them (`data-brim-nav-sources`). */
interface Source {
  value: string;
  label: string;
}

function sourcesOf(element: HTMLElement): Source[] {
  try {
    const parsed = JSON.parse(element.dataset.brimNavSources ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as Source[]) : [];
  } catch {
    return [];
  }
}

/** Written links, or a content type's items listed by themselves (a category added shows in the menu at once). */
function fromChoice(label: string, sources: Source[]): Schema {
  return {
    type: "select",
    label,
    options: [
      { value: "", label: "The links written below" },
      ...sources.map((source) => ({ value: source.value, label: `${source.label}, listed by themselves` })),
    ],
  };
}

interface NavForm {
  label?: unknown;
  href?: unknown;
  image?: Image;
  children?: NavForm[];
  from?: unknown;
}

/**
 * A link without a picture or sub-links is saved as a plain `{ label, href }`, as before groups existed. A link just
 * added, with nothing typed yet, waits in the form: saved empty it would be refused for its missing address.
 */
function navValue(items: NavForm[]): unknown[] {
  const typed = (value: unknown) => typeof value === "string" && value.trim() !== "";
  return items
    .filter((item) => typed(item.label) || typed(item.href) || (item.children ?? []).length > 0)
    .map(({ label, href, image, children, from }) => {
      const nested = navValue(children ?? []);
      return {
        label: label ?? "",
        href: href ?? "",
        ...(image?.src ? { image } : {}),
        ...(nested.length > 0 ? { children: nested } : {}),
        ...(typed(from) ? { from } : {}),
      };
    });
}
const brandFields: Record<string, Schema> = {
  logoText: text("Logo text"),
  logo: { type: "image", label: "Logo image" },
};

const TEXT_ELEMENTS = [
  { value: "p", label: "Paragraph" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "h5", label: "Heading 5" },
  { value: "h6", label: "Heading 6" },
  { value: "blockquote", label: "Quote" },
  { value: "span", label: "Inline text" },
  { value: "small", label: "Small print" },
];

const TEXT_ALIGNMENTS = [
  { value: "", label: "As the page sets it" },
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

interface Image {
  src: string;
  alt: string;
}

/** An empty logo text or logo image means "none", not an empty value. */
function brand(form: FormValue): FormValue {
  const logo = (form.logo ?? { src: "", alt: "" }) as Image;
  return {
    ...(form.logoText ? { logoText: form.logoText } : {}),
    ...(logo.src ? { logo } : {}),
  };
}

function storedValue(element: HTMLElement): FormValue {
  return JSON.parse(element.dataset.brimValue ?? "{}") as FormValue;
}

/** A link's label is editable only when it is plain text; richer content belongs to the site's code. */
function hasPlainLabel(element: HTMLElement): boolean {
  return element.childElementCount === 0;
}

/** Blocks keep all their settings in one record, which the page hands to the editor as-is. */
function blockKind(definition: BlockDefinition): NodeKind {
  return {
    title: definition.label,
    block: definition,
    schema: () => ({ type: "group", fields: {} }),
    read: storedValue,
    toValue: (form) => form,
  };
}

const primitiveKinds: Record<string, NodeKind> = {
  text: {
    title: "Text",
    options: textBlock,
    schema: () => ({
      type: "group",
      fields: {
        as: { type: "select", label: "Element", options: TEXT_ELEMENTS },
        align: { type: "select", label: "Alignment", options: TEXT_ALIGNMENTS },
      },
    }),
    read: (element) => ({
      as: element.tagName.toLowerCase(),
      align: alignOf(element) ?? "",
      options: storedValue(element).options ?? {},
    }),
    // Text content is saved by the in-place editor; the inspector changes the element and its presentation.
    toValue: (form) => form,
  },

  richtext: {
    title: "Rich text",
    schema: () => ({ type: "group", fields: {} }),
    read: () => ({}),
    // Content is saved by the in-place editor; there is nothing else to set.
    toValue: (form) => form,
  },

  blocks: {
    title: "Blocks",
    schema: () => ({ type: "group", fields: {} }),
    read: () => ({}),
    // A stack of blocks has nothing of its own to set: the + under it adds blocks to it.
    toValue: (form) => form,
  },

  link: {
    title: "Link",
    schema: (element) => ({
      type: "group",
      fields: {
        ...(hasPlainLabel(element) && { label: text("Label") }),
        href: { type: "url", label: "Link" },
      },
    }),
    read: (element) => ({
      href: element.getAttribute("href") ?? "",
      ...(hasPlainLabel(element) && { label: readText(element) }),
    }),
    toValue: (form) => form,
    apply(element, form) {
      element.setAttribute("href", String(form.href));
      if (form.label !== undefined) element.textContent = String(form.label);
    },
  },

  navbar: {
    title: "Navigation",
    schema: (element) => ({ type: "group", fields: { ...brandFields, items: navItems(0, sourcesOf(element)) } }),
    read: storedValue,
    toValue: (form) => ({ ...brand(form), items: navValue((form.items ?? []) as NavForm[]) }),
  },

  footer: {
    title: "Footer",
    schema: (element) => {
      const sources = sourcesOf(element);
      return {
        type: "group",
        fields: {
          ...brandFields,
          groups: {
            type: "list",
            label: "Link groups",
            addLabel: "Add group",
            item: {
              type: "group",
              fields: {
                title: text("Title"),
                ...(sources.length > 0 && { from: fromChoice("Links come from", sources) }),
                items: navLinks,
              },
            },
          },
        },
      };
    },
    read: storedValue,
    toValue: (form) => ({
      ...brand(form),
      groups: ((form.groups ?? []) as { title?: string; items?: unknown; from?: string }[]).map((group) => ({
        ...(group.title ? { title: group.title } : {}),
        items: group.items ?? [],
        ...(group.from ? { from: group.from } : {}),
      })),
    }),
  },
};

/** The `text` primitive wins over the block of the same name, which BrimCMS also had. */
export const nodeKinds: Record<string, NodeKind> = {
  ...Object.fromEntries(Object.entries(blockDefinitions).map(([type, definition]) => [type, blockKind(definition)])),
  ...primitiveKinds,
};

/** The starting value of a new list entry. */
export function emptyValue(schema: Schema): unknown {
  if (schema.type === "group") {
    return Object.fromEntries(Object.entries(schema.fields).map(([name, field]) => [name, emptyValue(field)]));
  }
  if (schema.type === "list") return [];
  if (schema.type === "image") return { src: "", alt: "" };
  return "";
}
