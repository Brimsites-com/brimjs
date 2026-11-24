import { AsyncLocalStorage } from "node:async_hooks";
import config from "virtual:brim/config";

/** What one request may see. Set by the middleware, read by helpers that have no request at hand. */
const requests = new AsyncLocalStorage<{
  editing: boolean;
  locale?: string | undefined;
  preview?: boolean;
  /** What helpers already read for this request (see `perRequest`). */
  memo: Map<string, Promise<unknown>>;
}>();

/**
 * `locale`: the language of the page being drawn (Astro's `currentLocale`), when the site has languages.
 * `preview`: the page is drawn inside the editor, with the changes nobody has saved yet.
 */
export function withEditing<T>(editing: boolean, run: () => T, locale?: string, preview = false): T {
  return requests.run({ editing, locale, preview, memo: new Map() }, run);
}

/**
 * Reads once per request what several parts of a page ask for (the site's settings in the header, the footer and a
 * button; the same list in a menu and a listing): each read is a round trip to a remote database. Outside a request
 * it just reads.
 */
export function perRequest<T>(key: string, read: () => Promise<T>): Promise<T> {
  const memo = requests.getStore()?.memo;
  if (!memo) return read();
  let found = memo.get(key) as Promise<T> | undefined;
  if (!found) {
    found = read();
    memo.set(key, found);
  }
  return found;
}

/** True while the page is drawn in the editor's preview, which shows the unsaved drafts (see `DraftStore`). */
export function isPreviewing(): boolean {
  return requests.getStore()?.preview ?? false;
}

/** The language of the page being drawn; `undefined` outside a request (a static build's `getStaticPaths`). */
export function currentLocale(): string | undefined {
  return requests.getStore()?.locale;
}

/**
 * True when the request comes from someone who may edit: everyone in dev, a signed-in user on the server,
 * nobody in a static build. Private pages and items are shown only then.
 */
export function isEditing(): boolean {
  return requests.getStore()?.editing ?? config.mode === "dev";
}

/** The elements being drawn inside `<Shared>`: their content is saved once for the whole site. */
const shared = new AsyncLocalStorage<true>();

/** Draws `run` (a `<Shared>` section's content) with "site" as the scope its elements take unless they name one. */
export function withSharedScope<T>(run: () => T): T {
  return shared.run(true, run);
}

/**
 * The scope an element takes when its code names none: "site" inside `<Shared>`, else "page". Every primitive and
 * block uses it as the default of its `scope` prop.
 */
export function defaultScope(): "page" | "site" {
  return shared.getStore() ? "site" : "page";
}
