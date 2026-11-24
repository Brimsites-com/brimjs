// Settings of the "image-gallery" block: its images, and for the look Brim draws when the site draws none, how many
// columns and how far apart. Masonry, ratios, captions styles and the rest are the site's own CSS.
import type { BlockDefinition } from "../types.ts";
import { imagesProperty } from "./carousel.ts";

export const imageGallery: BlockDefinition = {
  type: "image-gallery",
  label: "Gallery",
  description: "Images the owner adds and orders; the site lays them out",
  schema: {
    fieldsets: [
      { id: "content", title: "Content", fields: ["images", "lightbox"] },
      { id: "image_gallery_layout", title: "Layout", fields: ["columns", "gap"] },
    ],
    properties: {
      images: imagesProperty("Images"),
      lightbox: {
        title: "Open full screen",
        type: "boolean",
        widget: "checkbox",
        default: true,
        description: "A click on an image opens it over the whole screen, as a slideshow. Images with a link keep it.",
      },
      columns: {
        title: "Columns",
        type: "number",
        widget: "range",
        min: 1,
        max: 6,
        step: 1,
        default: 3,
        description: "On a phone, the images stack as they need to.",
      },
      gap: {
        title: "Gap",
        type: "number",
        widget: "range",
        min: 0,
        max: 64,
        step: 2,
        default: 16,
        description: "Space between the images (px)",
      },
    },
  },
  defaults: {
    "@type": "image-gallery",
    presetId: "default-theme",
    images: [],
    lightbox: true,
    columns: 3,
    gap: 16,
  },
};
