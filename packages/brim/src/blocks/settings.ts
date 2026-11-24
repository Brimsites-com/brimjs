import { ValidationError } from "../content/validation-error.ts";
import type { BlockDefinition, SchemaProperty } from "./types.ts";

const MAX_STRING = 20_000;
const MAX_JSON_NODES = 5_000;
const MAX_JSON_DEPTH = 10;
const LINK_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

/** The settings a block renders with: its defaults, then what the page's code passes, then what the owner saved. */
export function resolveSettings(
  definition: BlockDefinition,
  source: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const fromSource = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
  return { ...definition.defaults, ...fromSource, ...stored };
}

/**
 * Turns untrusted input into block settings. Only settings the block declares are kept,
 * each checked against its declared type. Throws `ValidationError`.
 */
export function parseSettings(definition: BlockDefinition, input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError('"value" must be an object.');
  }
  const budget = { nodes: MAX_JSON_NODES };
  const settings: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(input)) {
    const property = definition.schema.properties[name];
    if (property) settings[name] = checkProperty(name, property, value, budget);
    // Companion values a widget keeps next to its property, such as a link's "open in new tab".
    else if (Object.hasOwn(definition.defaults, name)) settings[name] = plainJson(name, value, 0, budget);
  }
  return settings;
}

function checkProperty(name: string, property: SchemaProperty, value: unknown, budget: { nodes: number }): unknown {
  if (property.type === "boolean") {
    if (typeof value !== "boolean") throw new ValidationError(`"${name}" must be true or false.`);
    return value;
  }
  if (property.type === "number" || property.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError(`"${name}" must be a number.`);
    const minimum = property.min ?? property.minimum;
    const maximum = property.max ?? property.maximum;
    if (minimum !== undefined && value < minimum) throw new ValidationError(`"${name}" is too small.`);
    if (maximum !== undefined && value > maximum) throw new ValidationError(`"${name}" is too large.`);
    return value;
  }
  if (property.type === "string") {
    if (typeof value !== "string") throw new ValidationError(`"${name}" must be text.`);
    if (value.length > MAX_STRING) throw new ValidationError(`"${name}" is too long.`);
    if (property.widget === "url") return linkAddress(name, value);
    return property.widget === "image" ? imageAddress(name, value) : value;
  }
  return plainJson(name, value, 0, budget);
}

/** Empty, a site path, an in-page anchor or a normal link. Rejects `javascript:` and the like. */
function linkAddress(name: string, value: string): string {
  const address = value.trim();
  if (address === "" || address.startsWith("#") || (address.startsWith("/") && !address.startsWith("//")))
    return address;
  const scheme = URL.canParse(address) ? new URL(address).protocol : "";
  if (!LINK_SCHEMES.includes(scheme)) throw new ValidationError(`"${name}" is not an allowed address.`);
  return address;
}

/** Empty, a path on the site, or a web address. */
function imageAddress(name: string, value: string): string {
  const address = value.trim();
  if (address === "" || (address.startsWith("/") && !address.startsWith("//"))) return address;
  const scheme = URL.canParse(address) ? new URL(address).protocol : "";
  if (scheme !== "http:" && scheme !== "https:")
    throw new ValidationError(`"${name}" is not an allowed image address.`);
  return address;
}

/** Accepts nested lists and objects of plain values, within a size budget. */
function plainJson(name: string, value: unknown, depth: number, budget: { nodes: number }): unknown {
  if (--budget.nodes < 0 || depth > MAX_JSON_DEPTH) throw new ValidationError(`"${name}" is too large.`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= MAX_STRING) return value;
  if (Array.isArray(value)) return value.map((entry) => plainJson(name, entry, depth + 1, budget));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, plainJson(name, entry, depth + 1, budget)]),
    );
  }
  throw new ValidationError(`"${name}" has a value that cannot be saved.`);
}
