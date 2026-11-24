/**
 * The address of an item's page, from its type's `path`: `/produse/[category]/[slug]` puts every product under its
 * category. Shared by the server and the editor, so it imports nothing that needs Node.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PARAMETER = /^\[([a-z][a-z0-9_]*)\]$/;

/** What an address segment holds where an item has no value for it (an item saved before the field was in `path`). */
const MISSING = "-";

/** The part of a content type its items' addresses are made from. */
export interface ItemPathType {
  slug: string;
  path?: string;
  fields: { name: string; type: string; required?: boolean; label?: string; multiple?: boolean }[];
}

export type ItemPathSegment = { fixed: string } | { field: string };

export function isSlug(value: string): boolean {
  return SLUG.test(value);
}

/** `Vila Nouă, etapa 2` → `vila-noua-etapa-2`. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The segments of a type's address: its `path`, or `/<slug>/[slug]`. */
export function itemPathSegments(type: Pick<ItemPathType, "slug" | "path">): ItemPathSegment[] {
  return (type.path ?? `/${type.slug}/[slug]`)
    .split("/")
    .slice(1)
    .map((segment) => {
      const parameter = PARAMETER.exec(segment);
      return parameter ? { field: parameter[1] as string } : { fixed: segment };
    });
}

/**
 * Checks a type's `path` when the type is declared. It starts with a fixed segment (so it cannot take over the
 * site's other pages), holds `[slug]` once, and its other parameters are required `select` or `text` fields.
 */
export function checkItemPath(type: ItemPathType & { key: string }): void {
  if (type.path === undefined) return;
  const fail = (why: string) => {
    throw new Error(`The path "${type.path}" of content type "${type.key}" ${why}`);
  };
  if (!type.path.startsWith("/") || type.path.endsWith("/")) fail('must start with "/" and not end with one.');
  const raw = type.path.split("/").slice(1);
  const segments = itemPathSegments(type);
  segments.forEach((segment, index) => {
    if ("fixed" in segment && !isSlug(segment.fixed))
      fail(`has "${raw[index]}": a segment is lowercase words joined by dashes, or a [field].`);
  });
  if (!(segments[0] && "fixed" in segments[0])) fail("must start with a fixed segment, e.g. /products/[slug].");
  const fields = segments.flatMap((segment) => ("field" in segment ? [segment.field] : []));
  if (fields.filter((name) => name === "slug").length !== 1) fail("must hold [slug] once.");
  const seen = new Set<string>();
  for (const name of fields) {
    if (seen.has(name)) fail(`holds [${name}] twice.`);
    seen.add(name);
    if (name === "slug") continue;
    const field = type.fields.find((candidate) => candidate.name === name);
    if (!field) fail(`holds [${name}], which is not one of its fields.`);
    const single =
      field && (field.type === "select" || field.type === "text" || (field.type === "reference" && !field.multiple));
    if (field && !single)
      fail(
        `holds [${name}], which is a ${field.multiple ? "multiple " : ""}${field.type} field: only select, text and single reference fields can be part of it.`,
      );
    if (field && !field.required) fail(`holds [${name}]: make that field required, so every item has an address.`);
  }
}

/** The fields of a type's `path` besides the slug, which an item needs a value for to have its address. */
export function itemPathFields(type: Pick<ItemPathType, "slug" | "path">): string[] {
  return itemPathSegments(type).flatMap((segment) =>
    "field" in segment && segment.field !== "slug" ? [segment.field] : [],
  );
}

/** An item's address without its language: `/produse/ceramica/marazzi-art`. */
export function fillItemPath(
  type: Pick<ItemPathType, "slug" | "path">,
  item: { slug: string; data?: Record<string, unknown> },
): string {
  const parts = itemPathSegments(type).map((segment) => {
    if ("fixed" in segment) return segment.fixed;
    if (segment.field === "slug") return item.slug;
    const value = item.data?.[segment.field];
    return (value === undefined || value === null ? "" : slugify(String(value))) || MISSING;
  });
  return `/${parts.join("/")}`;
}

/**
 * The item's slug, when `segments` (an address without its language) has the shape of the type's addresses.
 * Only the shape is checked: the item's own values decide whether the address is really its, see `fillItemPath`.
 */
export function matchItemPath(type: Pick<ItemPathType, "slug" | "path">, segments: string[]): string | undefined {
  const pattern = itemPathSegments(type);
  if (segments.length !== pattern.length) return undefined;
  let slug: string | undefined;
  for (const [index, segment] of pattern.entries()) {
    const given = segments[index] ?? "";
    if ("fixed" in segment) {
      if (given !== segment.fixed) return undefined;
    } else if (given === "") {
      return undefined;
    } else if (segment.field === "slug") {
      slug = given;
    }
  }
  return slug;
}
