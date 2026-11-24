import { normalizePagePath } from "./ids.ts";
import { ValidationError } from "./validation-error.ts";

/** An old address of the site that sends visitors, and search engines, to another one. */
export interface Redirect {
  /** A path of this site, e.g. `/old-pricing`. */
  from: string;
  /** A path of this site or a full address. */
  to: string;
  /** A temporary redirect (302): search engines keep the old address. By default it is permanent (301). */
  temporary?: boolean;
}

export const MAX_REDIRECTS = 1_000;
const MAX_ADDRESS = 2_000;
/** Brim's own routes answer themselves; a redirect there would lock the owner out of the editor. */
const OWN_ROUTES = /^\/(admin|_brim|uploads)(\/|$)/;

/** Checks a list of redirects as the owner sent it: addresses, no duplicates, no redirect to itself or in a loop. */
export function parseRedirects(input: unknown): Redirect[] {
  if (!Array.isArray(input)) throw new ValidationError('"redirects" must be a list.');
  if (input.length > MAX_REDIRECTS) throw new ValidationError(`A site can have up to ${MAX_REDIRECTS} redirects.`);
  const redirects = input.map(parseRedirect);
  const seen = new Set<string>();
  for (const redirect of redirects) {
    if (seen.has(redirect.from)) throw new ValidationError(`${redirect.from} is redirected twice.`);
    seen.add(redirect.from);
  }
  const targets = new Map(redirects.map((redirect) => [redirect.from, redirect.to]));
  for (const redirect of redirects) {
    let next: string | undefined = redirect.to;
    for (let step = 0; next !== undefined && step <= redirects.length; step++) {
      if (next === redirect.from) throw new ValidationError(`The redirect from ${redirect.from} leads back to itself.`);
      next = targets.get(pathOf(next) ?? "");
    }
  }
  return redirects;
}

function parseRedirect(input: unknown): Redirect {
  if (typeof input !== "object" || input === null) throw new ValidationError("A redirect must be an object.");
  const { from, to, temporary } = input as Record<string, unknown>;
  if (typeof from !== "string" || !from.trim().startsWith("/") || from.trim().startsWith("//")) {
    throw new ValidationError('A redirect\'s "from" must be a path of the site, starting with /.');
  }
  if (typeof to !== "string" || to.trim() === "") throw new ValidationError('A redirect needs a "to" address.');
  if (from.length > MAX_ADDRESS || to.length > MAX_ADDRESS) throw new ValidationError("That address is too long.");
  const source = normalizePagePath(from.trim().split(/[?#]/)[0] ?? "/");
  if (OWN_ROUTES.test(source)) throw new ValidationError(`${source} belongs to Brim and cannot be redirected.`);
  const target = to.trim();
  const local = target.startsWith("/") && !target.startsWith("//");
  if (!local && !/^https?:\/\/[^\s]+$/.test(target)) {
    throw new ValidationError(`"${target}" must be a path of the site (/new) or a full address (https://…).`);
  }
  const destination = local ? normalizeTarget(target) : target;
  if (local && pathOf(destination) === source) throw new ValidationError(`${source} cannot redirect to itself.`);
  if (temporary !== undefined && typeof temporary !== "boolean") {
    throw new ValidationError('"temporary" must be true or false.');
  }
  return { from: source, to: destination, ...(temporary === true && { temporary: true }) };
}

/** `/new/?a=1` → `/new?a=1`: the path part normalized, a query or anchor kept. */
function normalizeTarget(target: string): string {
  const index = target.search(/[?#]/);
  const path = index === -1 ? target : target.slice(0, index);
  return normalizePagePath(path) + (index === -1 ? "" : target.slice(index));
}

/** The path of a local address, without query or anchor; `undefined` for a full address. */
function pathOf(address: string): string | undefined {
  if (!address.startsWith("/") || address.startsWith("//")) return undefined;
  return normalizePagePath(address.split(/[?#]/)[0] ?? "/");
}

/**
 * The redirects after a page moved from `from` to `to`: the old address leads to the new one, redirects that led to
 * the old address lead straight to the new one, and the new address, a page now, is no longer redirected.
 */
export function redirectsAfterMove(redirects: Redirect[], from: string, to: string): Redirect[] {
  const kept = redirects
    .filter((redirect) => redirect.from !== to && redirect.from !== from)
    .map((redirect) => (pathOf(redirect.to) === from ? { ...redirect, to: retarget(redirect.to, to) } : redirect));
  return [...kept, { from, to }];
}

/** The new path with the old address's query or anchor, if it had one. */
function retarget(address: string, to: string): string {
  const index = address.search(/[?#]/);
  return to + (index === -1 ? "" : address.slice(index));
}

/** Where a request for `pathname` goes, with the visitor's query kept when the target has none of its own. */
export function redirectFor(redirects: Redirect[], pathname: string, search: string): Response | undefined {
  const path = normalizePagePath(pathname);
  // The visitor's address arrives percent-encoded (/cafea/%C8%99) while the owner writes it as read (/cafea/ș):
  // both spellings are compared.
  const decoded = decodedPath(path);
  const redirect = redirects.find((candidate) => candidate.from === path || decodedPath(candidate.from) === decoded);
  if (!redirect) return undefined;
  const location =
    search && !redirect.to.includes("?") && !redirect.to.includes("#") ? redirect.to + search : redirect.to;
  return new Response(null, { status: redirect.temporary ? 302 : 301, headers: { location } });
}

function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path).normalize("NFC");
  } catch {
    return path;
  }
}
