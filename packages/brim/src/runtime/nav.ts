import { type ItemLinks, itemLink } from "../content/menus.ts";
import { type ContentItem, getContentType, getItems } from "./content.ts";

/**
 * A type's items as menu links, for `from` in `Navbar` and `Footer`: in the owner's order for an `ordered` type,
 * else newest first, in the page's language; visitors see published items only.
 */
export const itemLinks: ItemLinks = async (key) => {
  const type = getContentType(key);
  const images = type.fields.filter((field) => field.type === "image").map((field) => field.name);
  return ((await getItems(key)) as ContentItem[]).map((item) => itemLink(item, images));
};
