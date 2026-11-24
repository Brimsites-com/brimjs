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
