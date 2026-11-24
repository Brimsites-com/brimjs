// Settings of the "carousel" block: its slides and how they move. Slide shapes, arrow styles and positions,
// caption styles and transition timing are the site's own CSS and markup.
import type { BlockDefinition, SchemaProperty } from "../types.ts";

/** The list of images the side panel edits, for a gallery and a carousel alike. */
export function imagesProperty(title: string): SchemaProperty {
  return {
    title,
    type: "array",
    widget: "carousel-images",
    description: "Upload several at once, drag them into order, open one to describe it.",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        url: { type: "string" },
        alt: { type: "string" },
        caption: { type: "string" },
        link: { type: "string" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
      },
    },
  };
}

export const carousel: BlockDefinition = {
  type: "carousel",
  label: "Carousel",
  description: "Slides the visitor swipes through, or a strip of logos that rolls by itself",
  schema: {
    fieldsets: [
      { id: "carousel_content", title: "Content", fields: ["images"] },
      { id: "carousel_layout", title: "Layout", fields: ["variant", "slidesPerView", "gap", "showArrows", "showDots"] },
      {
        id: "carousel_behavior",
        title: "Behavior",
        fields: ["start", "autoplay", "autoplaySpeed", "pauseOnHover", "loop", "continuousSpeed"],
      },
    ],
    properties: {
      images: imagesProperty("Slides"),
      variant: {
        title: "Variation",
        type: "string",
        widget: "select",
        default: "slider",
        options: [
          { value: "slider", label: "Slider" },
          { value: "center-peek", label: "Peek: the neighbours show on each side" },
          { value: "continuous", label: "Rolling strip (logos)" },
        ],
      },
      slidesPerView: {
        title: "Slides per view",
        type: "number",
        widget: "range",
        min: 1,
        max: 6,
        step: 1,
        default: 1,
        description: "On a phone, one.",
        showWhen: { variant: "slider" },
      },
      gap: {
        title: "Gap",
        type: "number",
        widget: "range",
        min: 0,
        max: 96,
        step: 2,
        default: 0,
      },
      showArrows: { title: "Arrows", type: "boolean", widget: "checkbox", default: true },
      showDots: { title: "Dots", type: "boolean", widget: "checkbox", default: false },
      start: {
        title: "Opens on slide",
        type: "number",
        widget: "range",
        min: 1,
        max: 20,
        step: 1,
        default: 1,
      },
      autoplay: { title: "Autoplay", type: "boolean", widget: "checkbox", default: false },
      autoplaySpeed: {
        title: "Time per slide (ms)",
        type: "number",
        widget: "range",
        min: 1000,
        max: 15000,
        step: 500,
        default: 4000,
        showWhen: { autoplay: true },
      },
      pauseOnHover: {
        title: "Pause under the pointer",
        type: "boolean",
        widget: "checkbox",
        default: true,
        showWhen: { autoplay: true },
      },
      loop: { title: "Loop", type: "boolean", widget: "checkbox", default: true },
      continuousSpeed: {
        title: "Rolling time (s)",
        type: "number",
        widget: "range",
        min: 5,
        max: 120,
        step: 1,
        default: 24,
        description: "How long the strip takes to roll once round.",
        showWhen: { variant: "continuous" },
      },
    },
  },
  defaults: {
    "@type": "carousel",
    presetId: "default-theme",
    images: [],
    variant: "slider",
    slidesPerView: 1,
    gap: 0,
    showArrows: true,
    showDots: false,
    start: 1,
    autoplay: false,
    autoplaySpeed: 4000,
    pauseOnHover: true,
    loop: true,
    continuousSpeed: 24,
  },
};
