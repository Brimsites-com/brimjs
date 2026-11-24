import { type ContentField, type ContentType, type FieldType, optionLabel } from "./content-types.ts";
import { type Item, type ItemDraft, parseItem } from "./items.ts";
import type { InlineNode } from "./types.ts";
import { ValidationError } from "./validation-error.ts";

/**
 * An element on an item's page that shows one of the item's fields (`title` or a field the type declares).
 * Editing the element in place writes the field, so the form and the page always agree.
 */
export interface ItemBinding {
  item: Pick<Item, "id" | "type" | "title" | "data">;
  field: string;
}

/** What the bound element shows: the item's title, or the value of one of its fields. */
export function boundValue({ item, field }: ItemBinding): unknown {
  return field === "title" ? item.title : item.data[field];
}

/**
 * The fields `<Field>` shows: values the owner picks rather than writes (a date, a number, a choice, yes or no, a
 * link, an email). On the page they are set in the side panel with the same widget as in the item form.
 */
export const METADATA_FIELDS: readonly FieldType[] = ["date", "number", "select", "boolean", "url", "email"];

/** The node kind of an element that shows one of the `METADATA_FIELDS`. */
export const FIELD_KIND = "field";

/**
 * How `<Field>` writes a value when the site's code does not: a date and a number in the item's language, a yes as
 * the field's label (a "Featured" field reads "Featured" when set), a choice as its label, the rest as it is.
 * Empty is "".
 */
export function fieldText(
  field: Pick<ContentField, "type" | "label" | "options">,
  value: unknown,
  locale?: string,
): string {
  if (value === undefined || value === null || value === "") return "";
  const locales = locale ? [locale] : undefined;
  try {
    if (field.type === "date" && typeof value === "string") {
      // Kept as YYYY-MM-DD with no time of day: read and written in UTC, so no time zone moves it by a day.
      const date = new Date(`${value}T00:00:00Z`);
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat(locales, { dateStyle: "long", timeZone: "UTC" }).format(date);
      }
    }
    // Grouped from five digits on: a price reads 12,500, a year stays 2024.
    if (field.type === "number" && typeof value === "number") {
      return new Intl.NumberFormat(locales, { useGrouping: "min2" }).format(value);
    }
  } catch (error) {
    // A language code Intl does not know is written in the default language rather than breaking the page.
    if (!(error instanceof RangeError)) throw error;
    return fieldText(field, value);
  }
  if (field.type === "boolean") return value === true ? field.label : "";
  if (field.type === "select") return optionLabel(field, String(value), locale);
  return String(value);
}

/**
 * Turns what the editor saved for a bound element into the item's new values, checked exactly like the item form:
 * text and rich text become the field, an image block gives its address and description, a gallery or carousel
 * its images' addresses and descriptions, in order. Everything else in the value is how the element looks, which
 * belongs to the page's template and is saved there on its own. A `field` element sends `{ value }`: the field's
 * new value, checked like the item form ("" or none empties it).
 */
export function applyToItem(
  type: ContentType,
  item: Item,
  field: string,
  kind: string,
  value: Record<string, unknown>,
): ItemDraft {
  const declared = field === "title" ? undefined : type.fields.find((candidate) => candidate.name === field);
  if (field !== "title" && !declared) throw new ValidationError(`"${type.label}" has no field "${field}".`);
  const fieldType = declared?.type ?? "text";

  let fieldValue: unknown;
  if (kind === "text" && (fieldType === "text" || fieldType === "textarea")) {
    // Line breaks typed on the page are the field's new lines; other formatting has no place in a text field.
    fieldValue = Array.isArray(value.rich) ? plainText(value.rich as InlineNode[]) : String(value.text ?? "");
  } else if (kind === "richtext" && fieldType === "richtext") {
    fieldValue = value;
  } else if (kind === "image" && fieldType === "image") {
    fieldValue = value.url ? { src: value.url, alt: value.alt ?? "" } : undefined;
  } else if ((kind === "image-gallery" || kind === "carousel") && fieldType === "gallery") {
    // The images, in their order: a gallery field keeps each one's address and description.
    fieldValue = (Array.isArray(value.images) ? (value.images as Record<string, unknown>[]) : [])
      .filter((image) => typeof image.url === "string" && image.url !== "")
      .map((image) => ({ src: image.url, alt: typeof image.alt === "string" ? image.alt : "" }));
  } else if (kind === FIELD_KIND && METADATA_FIELDS.includes(fieldType)) {
    fieldValue = value.value;
  } else {
    throw new ValidationError(`A ${kind} element cannot show the ${fieldType} field "${field}".`);
  }

  const input =
    field === "title" ? { ...item, title: fieldValue } : { ...item, data: { ...item.data, [field]: fieldValue } };
  return parseItem(type, input);
}

function plainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => (typeof node === "string" ? node : node.tag === "br" ? "\n" : plainText(node.children)))
    .join("")
    .trim();
}
