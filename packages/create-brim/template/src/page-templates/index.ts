import { definePageTemplate } from "@brimsites/brimjs";
import LandingPage from "./LandingPage.astro";

/**
 * Templates of pages the owner adds in the editor (Site map → New page) or an AI agent adds through the
 * site's MCP. A page made from one is content: its address, title and texts live in the database.
 */
export const landing = definePageTemplate({
  key: "landing",
  label: "Landing page",
  description: "A hero with the page's title, three short points and a call to action.",
  component: LandingPage,
});

/** Every page template of the site. Add a file next to this one and list it here; Brim reads this list. */
export const pageTemplates = [landing];
