import { type ContentField, standardField } from "./content-types.ts";
import type { ImageValue } from "./types.ts";

interface WithFields {
  fields: ContentField[];
}

/** The field with a type's main picture: `image`, or on a type without one, the first image field it declares. */
export function imageField(type: WithFields): string | undefined {
  return (standardField(type, "image") ?? type.fields.find((field) => field.type === "image"))?.name;
}

/** The item's own picture, when it has one. */
export function itemPicture(type: WithFields, item: { data: Record<string, unknown> }): ImageValue | undefined {
  const name = imageField(type);
  const value = name ? (item.data[name] as Partial<ImageValue> | undefined) : undefined;
  return typeof value?.src === "string" && value.src ? { ...value, src: value.src, alt: value.alt ?? "" } : undefined;
}

/**
 * The address of the item's own picture. It stands in for the page's preview image when the owner set none, so a
 * shared link shows the item, not the site's default image.
 */
export function itemImage(type: WithFields, item: { data: Record<string, unknown> }): string | undefined {
  return itemPicture(type, item)?.src;
}
