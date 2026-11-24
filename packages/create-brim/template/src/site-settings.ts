import { defineSiteSettings } from "brimjs";

/**
 * The site's own settings: facts about the whole site its owner changes in Site Settings (or an agent through the
 * MCP), read by every page with `getSiteSettings()` or shown with `<Setting name="…" />`. Add what the site needs:
 * WhatsApp, an address, opening hours, links to legal pages… Never write these into pages or constants.
 */
export const siteSettings = defineSiteSettings({
  fields: [
    { name: "email", label: "Email", type: "email", group: "Contact", default: "hello@example.com" },
    { name: "phone", label: "Phone", type: "text", group: "Contact", help: "As visitors should read it, e.g. +1 555 0100." },
    { name: "address", label: "Address", type: "textarea", group: "Contact" },
  ],
});
