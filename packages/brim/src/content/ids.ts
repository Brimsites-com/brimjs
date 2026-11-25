/**
 * Scope of nodes shared by every page (navbar, footer, anything marked `scope="site"`).
 * A multilingual site keeps one set per language.
 */
export function siteScope(locale?: string): string {
  return locale ? `site:${locale}` : "site";
}

const NODE_ID = /^[a-z][a-z0-9-]{0,63}$/;

export function isNodeId(value: string): boolean {
  return NODE_ID.test(value);
}

export function assertNodeId(value: string): void {
  if (!isNodeId(value)) {
    throw new Error(
      `Invalid nodeId "${value}": use lowercase letters, digits and dashes, starting with a letter (max 64 characters).`,
    );
  }
}

/** `/about/`, `/about` and `/about/index.html` are the same page. */
export function normalizePagePath(pathname: string): string {
  const withoutIndex = pathname.replace(/\/index\.html$/, "/");
  const trimmed = withoutIndex.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * The page a visitor's address asks for. Astro draws the page at `/about` for `/about.html` too (always where the
 * route has a parameter, everywhere with `build.format: "file"`), so what is kept by address, such as whether the
 * page is private, is asked by the page's own. A route with `.html` in its pattern is at the address it says.
 */
export function requestedPage(pathname: string, routePattern: string): string {
  const path = normalizePagePath(pathname);
  return routePattern.includes(".html") ? path : normalizePagePath(path.replace(/\.html$/, ""));
}

export function pageScope(pathname: string): string {
  return `page:${normalizePagePath(pathname)}`;
}

/**
 * Scope of what the owner changed on a content type's template, shared by the pages of all its items.
 * A multilingual site keeps one per language, like the site's own.
 */
export function typeScope(key: string, locale?: string): string {
  return locale ? `type:${key}:${locale}` : `type:${key}`;
}
