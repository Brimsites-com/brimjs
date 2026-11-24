// Settings of the "image" block: the picture, its description, caption and link, and the part that stays in
// sight when the site crops it. Its size, shape, rotation, tint and fades are the site's CSS.
import type { BlockDefinition } from "../types.ts";

export const image: BlockDefinition = {
  type: "image",
  label: "Image",
  description: "A picture the owner replaces; the site sizes and shapes it",
  schema: {
    fieldsets: [
      { id: "default", title: "Default", fields: ["url", "alt", "showCaption", "caption", "link"] },
      { id: "image_layout", title: "Crop", fields: ["imageFocus"] },
    ],
    properties: {
      url: {
        title: "Image",
        type: "string",
        widget: "image",
        description: "Upload or select an image",
      },
      imageFocus: {
        title: "Crop Position",
        type: "string",
        widget: "image-focus",
        default: "",
        description: "The part of the image that stays in sight when the site crops it.",
        editContext: "grid",
        imageField: "url",
        xField: "focalPointX",
        yField: "focalPointY",
      },
      focalPointX: {
        title: "Focal Point X",
        type: "number",
        widget: "hidden",
        default: 50,
      },
      focalPointY: {
        title: "Focal Point Y",
        type: "number",
        widget: "hidden",
        default: 50,
      },
      link: {
        title: "Link",
        type: "string",
        widget: "url",
        placeholder: "https://example.com",
        default: "",
        newTabField: "openInNewTab",
      },
      showCaption: {
        title: "Caption",
        type: "boolean",
        widget: "checkbox",
        default: false,
      },
      caption: {
        title: "Caption Text",
        type: "string",
        widget: "text",
        default: "Type caption here",
        showWhen: { showCaption: true },
      },
      alt: {
        title: "Alt Text (SEO)",
        type: "string",
        widget: "text",
        placeholder: "Describe the image",
        description:
          "Important for SEO and accessibility. Helps search engines understand the image content and improves page ranking.",
      },
    },
  },
  defaults: {
    "@type": "image",
    presetId: "default-theme",
    url: "",
    alt: "",
    showCaption: false,
    caption: "",
    focalPointX: 50,
    focalPointY: 50,
    link: "",
    openInNewTab: false,
  },
};
