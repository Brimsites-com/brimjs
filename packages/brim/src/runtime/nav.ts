import { imageField } from "../content/item-image.ts";
import { type ItemLinks, itemLink } from "../content/menus.ts";
import { type ContentItem, getContentType, getItems } from "./content.ts";

/**
 * A type's items as menu links, for `from` in `Navbar` and `Footer`: in the owner's order for an `ordered` type,
 * else newest first, in the page's language; visitors see published items only.
 */
export const itemLinks: ItemLinks = async (key) => {
  const type = getContentType(key);
  const image = imageField(type);
  return ((await getItems(key)) as ContentItem[]).map((item) => itemLink(item, image ? [image] : []));
};
