// Settings of the "accordion" block, from BrimCMS. Only the questions: a heading or an intro above them is the
// site's own markup (a `Text`), so an accordion never brings words the site did not write.
import type { BlockDefinition } from "../types.ts";

export const accordion: BlockDefinition = {
  type: "accordion",
  label: "Accordion",
  description: "Collapsible content panels for FAQs and details",
  schema: {
    fieldsets: [
      {
        id: "content",
        title: "Content",
        fields: ["items"],
      },
      {
        id: "behavior",
        title: "Behavior",
        fields: ["allowMultiple", "icon"],
      },
    ],
    properties: {
      items: {
        title: "Accordion Items",
        type: "array",
        widget: "accordion-items",
      },
      allowMultiple: {
        title: "Allow Multiple Open",
        type: "boolean",
        widget: "checkbox",
        default: true,
      },
      icon: {
        title: "Indicator",
        type: "string",
        widget: "select",
        options: [
          { value: "chevron", label: "Chevron" },
          { value: "plus", label: "Plus" },
        ],
        default: "chevron",
      },
      gap: {
        title: "Gap",
        type: "number",
        widget: "range",
        min: 0,
        max: 48,
        step: 1,
        default: 10,
        description: "Spacing between accordion items in pixels",
      },
      radius: {
        title: "Radius",
        type: "number",
        widget: "range",
        min: 0,
        max: 48,
        step: 1,
        default: 14,
        description: "Corner radius for accordion items in pixels",
      },
      itemTitleTypographyStyle: {
        title: "Item Title Text Style",
        type: "string",
        default: "p1",
        description: "Semantic heading or paragraph style: h1, h2, h3, h4, p1, p2, p3, or custom:<substyle-id>",
      },
      customClassName: {
        title: "Custom Class",
        type: "string",
        widget: "text",
        placeholder: "my-accordion",
        default: "",
      },
    },
  },
  defaults: {
    "@type": "accordion",
    presetId: "default-theme",
    items: [
      {
        id: "item_1",
        title: "How long does setup take?",
        content:
          "<p>Most projects are live in a few hours. Advanced integrations can take a bit longer depending on complexity.</p>",
      },
      {
        id: "item_2",
        title: "Can I change the design later?",
        content:
          "<p>Yes. You can update content, layout, and colors at any time without rebuilding the page from scratch.</p>",
      },
      {
        id: "item_3",
        title: "Do you support custom integrations?",
        content: "<p>Yes. We can connect with CRMs, email platforms, analytics tools, and internal APIs.</p>",
      },
      {
        id: "item_4",
        title: "What happens after launch?",
        content:
          "<p>You keep full editing control, and your team can continue publishing without developer involvement.</p>",
      },
    ],
    allowMultiple: true,
    icon: "chevron",
    gap: 10,
    radius: 14,
    customClassName: "",
    partStyles: {
      root: {
        desktop: { verticalAlign: "top" },
      },
    },
  },
};
