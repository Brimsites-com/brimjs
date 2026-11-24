// Settings of the "divider" block: which way it runs. Its line (style, thickness, colour) is the site's CSS on
// `.brim-divider`; in a \`blocks\` field, its width is the block's.
import type { BlockDefinition } from "../types.ts";

export const divider: BlockDefinition = {
  type: "divider",
  label: "Divider",
  description: "A line between two parts of a page",
  schema: {
    fieldsets: [{ id: "default", title: "Divider Settings", fields: ["orientation"] }],
    properties: {
      orientation: {
        title: "Orientation",
        type: "string",
        widget: "select",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
        default: "horizontal",
      },
    },
  },
  defaults: {
    "@type": "divider",
    presetId: "default-theme",
    orientation: "horizontal",
  },
};
