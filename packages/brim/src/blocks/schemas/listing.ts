import type { BlockDefinition } from "../types.ts";

/**
 * The "listing" block. Which items it shows, in what order and how, is the site's code (`<Listing>`'s props): it has
 * no settings for the owner, who changes what is listed by editing the items. The editor offers to open them, or to
 * add one, from the listing.
 */
export const listing: BlockDefinition = {
  type: "listing",
  label: "Listing",
  description: "The items of a content type, as the site's code lists them.",
  schema: { fieldsets: [], properties: {} },
  defaults: {},
};
