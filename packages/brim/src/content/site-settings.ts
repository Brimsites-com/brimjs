import { type ContentFieldInput, type ContentType, type SiteSettingField, defineContentType } from "./content-types.ts";
import type { SettingsData, Typed } from "./field-types.ts";
import { parseItem } from "./items.ts";
import { ValidationError } from "./validation-error.ts";

/**
 * The site's own settings: what is true of the whole site and the owner changes now and then, such as the phone
 * number, the email address, WhatsApp, social profiles, the address and opening hours, the links to legal pages.
 * The site declares them in `src/site-settings.ts`, with the same fields as a content type; the owner edits them in
 * Site Settings (or an agent through the MCP), and every page reads them with `getSiteSettings()`, so a number
 * changes in one place instead of in every page that shows it.
 *
 *   export const siteSettings = defineSiteSettings({
 *     fields: [
 *       { name: "phone", label: "Telefon", type: "text", group: "Contact", default: "+40 700 000 000" },
 *       { name: "email", label: "E-mail", type: "email", group: "Contact" },
 *       { name: "instagram", label: "Instagram", type: "url", group: "Rețele sociale" },
 *     ],
 *   });
 */
export type SiteSettingFieldInput = ContentFieldInput & {
  /** The section of Site Settings the field is shown in, e.g. "Contact"; fields without one go under "Site". */
  group?: string;
  /** The value until the owner sets one: what the site shows on a fresh copy, before any content. */
  default?: unknown;
};

export type { SiteSettingField } from "./content-types.ts";

export interface SiteSettings {
  fields: SiteSettingField[];
  /** The fields' starting values, checked like saved ones. */
  defaults: Record<string, unknown>;
}

/** The node the owner's values are saved as, in the site's shared content (one per language). */
export const SITE_SETTINGS_NODE = "site-settings";

/** Declares the site's own settings. Mistakes fail here, when the site starts, like a content type's. */
export function defineSiteSettings<const Fields extends readonly SiteSettingFieldInput[]>(input: {
  fields: Fields;
}): SiteSettings & Typed<SettingsData<Fields>> {
  const declared = input.fields.map(({ group, default: _default, ...field }) => field as ContentFieldInput);
  const type = settingsType(declared);
  for (const field of type.fields) {
    if (field.type === "blocks")
      throw new Error(`Site setting "${field.name}" cannot be a blocks field: it has no page.`);
  }
  const fields: SiteSettingField[] = type.fields.map((field, index) => {
    const { group, default: value } = input.fields[index] ?? {};
    return { ...field, ...(group && { group }), ...(value !== undefined && { default: value }) };
  });
  const starting = Object.fromEntries(
    fields.flatMap((field) => (field.default === undefined ? [] : [[field.name, field.default]])),
  );
  let defaults: Record<string, unknown>;
  try {
    defaults = parseSettings(fields, starting, false);
  } catch (error) {
    throw new Error(
      `The defaults of the site settings are not valid: ${error instanceof Error ? error.message : error}`,
    );
  }
  return { fields, defaults };
}

/**
 * Turns untrusted values into the site settings to save, checked exactly like an item's fields. `strict` asks for
 * the required ones; the defaults of a declaration may leave them for the owner to fill in.
 */
export function parseSettings(fields: SiteSettingField[], input: unknown, strict = true): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError("The site settings must be an object of values.");
  }
  const type = settingsType(strict ? fields : fields.map((field) => ({ ...field, required: false })));
  const values = parseItem(type, { title: "Site settings", visibility: "published", data: input }).data;
  // A field the owner emptied stays empty (null) instead of falling back to the code's default.
  for (const field of fields) {
    const given = (input as Record<string, unknown>)[field.name];
    const empty = given === null || given === "" || (Array.isArray(given) && given.length === 0);
    if (empty && !(field.name in values)) values[field.name] = null;
  }
  return values;
}

/** What the site shows: the saved values over the defaults, a value cleared by the owner staying cleared. */
export function settingsValues(settings: SiteSettings | null | undefined, saved: unknown): Record<string, unknown> {
  const values = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : undefined;
  return { ...(settings?.defaults ?? {}), ...(values ?? {}) };
}

/** The declared settings as a content type, for what checks an item's fields (references to vocabularies). */
export function settingsAsType(settings: SiteSettings): ContentType {
  return settingsType(settings.fields.map(({ group: _group, default: _default, ...field }) => field));
}

/** The fields as a content type, so they are declared, checked and edited exactly like an item's. */
function settingsType(fields: ContentFieldInput[]): ContentType {
  return defineContentType({
    key: "site_settings",
    label: "Site settings",
    singular: "Site settings",
    slug: "site-settings",
    author: false,
    tags: false,
    fields: fields.map(
      ({ group: _group, default: _default, ...field }: ContentFieldInput & { group?: unknown; default?: unknown }) =>
        field as ContentFieldInput,
    ),
  });
}
