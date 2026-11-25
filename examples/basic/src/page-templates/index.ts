import { definePageTemplate } from "@brimsites/brimjs";
import ServicePage from "./ServicePage.astro";

const service = definePageTemplate({
  key: "service",
  label: "Service page",
  description: "A title, a short text and a button.",
  folder: "services",
  component: ServicePage,
});

/** Pages the owner adds from the editor start from one of these. */
export const pageTemplates = [service];
