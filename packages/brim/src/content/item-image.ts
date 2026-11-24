import type { ContentType } from "./content-types.ts";
import type { Item } from "./items.ts";

/**
 * An item's own picture: the first image field its type declares, when the item has one filled in. It stands in for
 * the page's preview image when the owner set none, so a shared link shows the item, not the site's default image.
 */
export function itemImage(type: ContentType, item: Pick<Item, "data">): string | undefined {
  for (const field of type.fields) {
    if (field.type !== "image") continue;
    const value = item.data[field.name] as { src?: unknown } | undefined;
    if (typeof value?.src === "string" && value.src) return value.src;
  }
  return undefined;
}
