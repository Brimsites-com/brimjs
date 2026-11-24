/**
 * An Astro component that draws a whole page. It gets the page as the `page` prop and builds it from the
 * site's sections; every node in it is saved per page, so each page made from it is edited on its own.
 * Brim only stores it and hands it back to its route, so any callable Astro component fits.
 */
export type PageComponent = (...args: never[]) => unknown;

/**
 * The starting point of pages the owner adds: a layout and its sections, declared in code.
 * A page made from it is content (an address, a title, private or published), not a file.
 */
export interface PageTemplate {
  /** Identifies the template in code and in saved pages, e.g. `service`. */
  key: string;
  /** Name shown when choosing a template, e.g. `Service page`. */
  label: string;
  /** What the template is for and what it holds, shown under its name. */
  description?: string;
  /** Where new pages go: `services` puts a page titled "Lawn care" at `/services/lawn-care`. */
  folder?: string;
  component: PageComponent;
}

/** A page made from a template, as the template's component receives it. */
export interface TemplatePageProps {
  path: string;
  title: string;
  template: string;
}

/** What the editor and the MCP see of a template: everything but the component. */
export type PageTemplateInfo = Omit<PageTemplate, "component">;

const KEY = /^[a-z][a-z0-9_]*$/;
const FOLDER = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** Declares a page template. Mistakes in the declaration fail here, at startup, not when a page is added. */
export function definePageTemplate(template: PageTemplate): PageTemplate {
  if (!KEY.test(template.key))
    throw new Error(`Page template key "${template.key}" must be lowercase letters, digits or underscores.`);
  if (template.folder !== undefined && !FOLDER.test(template.folder))
    throw new Error(
      `Folder "${template.folder}" of page template "${template.key}" must be lowercase words joined by dashes.`,
    );
  if (typeof template.component !== "function")
    throw new Error(`Page template "${template.key}" needs an Astro component.`);
  return template;
}

export function templateInfo({ component: _component, ...info }: PageTemplate): PageTemplateInfo {
  return info;
}
