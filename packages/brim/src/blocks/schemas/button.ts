// Settings of the "button" block: its words, its link, which of the site's button styles and sizes, and an icon.
// Where it sits on the page is the site's layout.
import type { BlockDefinition } from "../types.ts";

export const button: BlockDefinition = {
  type: "button",
  label: "Button",
  description: "Interactive button",
  schema: {
    fieldsets: [
      { id: "default", title: "Default", fields: ["text", "url"] },
      { id: "block_layout", title: "Style", fields: ["variant", "size", "showIcon", "icon"] },
    ],
    properties: {
      text: {
        title: "Button Text",
        type: "string",
        widget: "text",
        placeholder: "Click me",
        default: "Click me",
      },
      url: {
        title: "URL",
        type: "string",
        widget: "url",
        placeholder: "https://example.com",
        default: "",
        newTabField: "openInNewTab",
        allowFormTarget: true,
      },
      variant: {
        title: "Style",
        type: "string",
        widget: "button-variant",
        default: "block",
        description:
          "Visual variants: light-1, light-2, light-3, accent, block (Default), dark-1, dark-2, ghost (Outline). Legacy primary and secondary remain supported for existing content. Prefer block for a new default button.",
      },
      size: {
        title: "Size",
        type: "string",
        widget: "size",
        options: [
          { value: "sm", label: "Small (compact)" },
          { value: "md", label: "Medium (default)" },
          { value: "lg", label: "Large (prominent)" },
        ],
        default: "md",
        description: "Button scale for inline layout",
        editContext: "inline",
      },
      showIcon: {
        title: "Show Icon",
        type: "boolean",
        widget: "checkbox",
        default: false,
      },
      icon: {
        title: "Icon",
        type: "string",
        widget: "icon-picker",
        default: "none",
        showWhen: { showIcon: true },
      },
    },
  },
  defaults: {
    "@type": "button",
    variant: "block",
    text: "Click me",
    url: "",
    openInNewTab: false,
    size: "md",
    showIcon: false,
    icon: "none",
    presetId: "default-theme",
  },
};
