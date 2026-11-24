// Settings of the "icon" block: which icon. Its size, colour and any shape behind it are the site's CSS.
import type { BlockDefinition } from "../types.ts";

export const icon: BlockDefinition = {
  type: "icon",
  label: "Icon",
  description: "One icon from the site's set",
  schema: {
    fieldsets: [{ id: "default", title: "Icon Settings", fields: ["icon"] }],
    properties: {
      icon: {
        title: "Icon",
        type: "string",
        widget: "icon-picker",
        default: "star",
      },
    },
  },
  defaults: {
    "@type": "icon",
    presetId: "default-theme",
    icon: "star",
  },
};
