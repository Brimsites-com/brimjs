import { defineSiteSettings } from "brimjs";

/** Facts about the whole site its owner changes in Site Settings: read with getSiteSettings(), shown with <Setting>. */
export const siteSettings = defineSiteSettings({
  fields: [
    { name: "phone", label: "Phone", type: "text", group: "Contact", default: "+1 555 0100" },
    { name: "email", label: "Email", type: "email", group: "Contact" },
    { name: "instagram", label: "Instagram", type: "url", group: "Social" },
  ],
});
