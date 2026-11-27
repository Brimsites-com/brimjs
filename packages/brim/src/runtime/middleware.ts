import type { MiddlewareHandler } from "astro";
import config from "virtual:brim/config";
import { itemPageOf } from "../content/content-types.ts";
import { normalizePagePath, pageScope, requestedPage, siteScope, typeScope } from "../content/ids.ts";
import { itemHead } from "../content/item-head.ts";
import { redirectFor } from "../content/redirects.ts";
import { requestUser } from "../server/auth.ts";
import { BrimContext } from "./context.ts";
import { connect } from "./connect.ts";
import { withKeptReads } from "../db/cached.ts";
import { upgradeFieldValues } from "../content/block-values.ts";
import { adoptLanguageScopes } from "../content/language-scopes.ts";
import { prepareImageSizes } from "./media.ts";
import { withEditing } from "./request-state.ts";
import { QueryCollector, collectingQueryReads } from "./query-reads.ts";
import { queryReads } from "./query-store.ts";

/**
 * Brim's own routes (`/admin`, forms, uploads, and the OAuth metadata MCP clients look for under `/.well-known`) check
 * who is asking themselves and show no page content.
 */
const OWN_ROUTES = /^\/(admin|_brim|uploads|\.well-known\/oauth-[a-z-]+)(\/|$)/;
/** The route Brim adds for pages added from templates and the pages of items. */
const TEMPLATE_ROUTE = "/[...page]";

/**
 * Reads every content type's items once when the server starts, while the first visitor's page is drawn, so the
 * listings after it find them in memory (see `ItemStore.listCached`) instead of reading hundreds of items each.
 */
let warming: Promise<void> | undefined;
async function warmItems(brim: Awaited<ReturnType<typeof connect>>): Promise<void> {
  // Texts of fields that became `blocks` are written as blocks first, so the lists read them as they now are.
  await upgradeFieldValues(brim.db, config.contentTypes);
  for (const type of config.contentTypes) {
    await brim.items.listCached(type.key).catch(() => undefined);
  }
}

/**
 * Gives every page its content and decides who sees private pages and the editor's markers:
 * everyone in dev, signed-in users on the server, nobody in a static build.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const { pathname } = context.url;
  if (config.mode === "server" && OWN_ROUTES.test(pathname)) return next();

  // Ways into the editor nobody has to remember: `?edit` on any page opens that page in it, and `/edit` (unless the
  // site has a page of its own there) opens it on the home page. A static build has no editor to open.
  if (config.mode !== "static" && !context.isPrerendered && !OWN_ROUTES.test(pathname)) {
    if (context.url.searchParams.has("edit")) return editorRedirect(pathname);
    if (normalizePagePath(pathname) === "/edit" && context.routePattern !== "/edit") return editorRedirect("/");
  }

  return withKeptReads(() => drawPage(context, next), context.request);
};

/**
 * Draws a visitor's page. Each read below is a round trip on a remote database: they are asked together, and kept
 * between visits until the content changes (see `withKeptReads`), so a visit usually costs one small query.
 */
async function drawPage(context: Parameters<MiddlewareHandler>[0], next: Parameters<MiddlewareHandler>[1]) {
  const { pathname } = context.url;
  const address = requestedPage(pathname, context.routePattern);
  const brim = await connect(config.databaseUrl, config.authToken);
  // A site that just turned languages on reads what was saved before as its default language's.
  if (config.locales) await adoptLanguageScopes(brim.db, config.locales.defaultLocale);
  if (config.mode === "server" && !warming) warming = warmItems(brim);
  if (config.mode === "dev") await upgradeFieldValues(brim.db, config.contentTypes);
  // A page rendered at build time has no visitor, and so no headers to read; a static build has no server to answer
  // a redirect.
  const live = config.mode !== "static" && !context.isPrerendered;
  const signedIn = config.mode === "server" && !context.isPrerendered;

  // What the owner changes on an item's page belongs to its type's template, shared by every item. A page written
  // in code keeps its own, even at an address under the type's slug. The item's visibility decides who sees it.
  const itemPage =
    context.routePattern === TEMPLATE_ROUTE ? itemPageOf(config.contentTypes, address, config.locales) : undefined;
  const locale = context.currentLocale;
  const scope = itemPage ? typeScope(itemPage.type.key, locale) : pageScope(address);
  const scopes = [siteScope(locale), scope];

  const [redirects, user, page, saved, item] = await Promise.all([
    live ? brim.content.redirects() : undefined,
    signedIn ? requestUser(brim, context.request) : undefined,
    brim.content.page(address),
    brim.content.loadNodes(scopes),
    itemPage ? brim.items.bySlug(itemPage.type.key, itemPage.slug, { locale: itemPage.locale }) : undefined,
    // `imageSources` gives uploads their width and height from what the media library measured.
    prepareImageSizes(brim.db, config.mode === "static" || context.isPrerendered),
  ]);

  // An old address the owner redirected answers before any page.
  const redirect = redirects && redirectFor(redirects, pathname, context.url.search);
  if (redirect) return redirect;
  const editing = config.mode === "dev" || (signedIn && user !== undefined);

  // The editor draws the page in a frame, with the changes nobody has saved yet; on the server any other visit shows
  // what is saved. In dev a page has no headers to tell (it is prerendered), and only its developer visits it.
  const preview =
    config.mode === "dev" || (signedIn && editing && context.request.headers.get("sec-fetch-dest") === "iframe");
  if (!editing && !itemPage && page.visibility === "private") {
    return new Response(null, { status: 404 });
  }

  const nodes = preview ? await brim.drafts.overlayNodes(saved, scopes) : saved;
  const seo = preview ? await brim.drafts.overlaySeo(page.path, page.seo) : page.seo;
  // What search engines and shared links are told of an item, unless the owner or the page's code says otherwise.
  const shown = item && preview ? await brim.drafts.overlayItem(item) : item;
  const head =
    shown && itemPage
      ? await itemHead(itemPage.type, shown, {
          types: config.contentTypes,
          publishedItems: (type) => brim.items.listCached(type, { publishedOnly: true }),
          locales: config.locales,
        })
      : undefined;
  context.locals.brim = new BrimContext(scope, locale, nodes, editing, seo, head, preview);
  // What the page reads of its address's query, noted while it is drawn (its blocks, `readsQuery`), so the server
  // can tell a host which parameters each page reads (see `QueryReads`). Only for pages a visitor gets on the server.
  const reads = signedIn && context.request.method === "GET" ? new QueryCollector() : undefined;
  const draw = () => withEditing(editing, next, locale, preview);
  const drawn = reads ? await collectingQueryReads(reads, draw) : await draw();
  // Whoever may edit gets the button: everyone on the dev server, signed-in users on the live site (whose pages are
  // never cached for others, see below). Visitors and a static copy never have it.
  const response = editing && !context.isPrerendered ? await withEditButton(drawn, context.request, address) : drawn;
  // What an editor sees must never be stored and shown to visitors.
  if (signedIn && editing) response.headers.set("cache-control", "private, no-store");
  return reads ? learnWhenDrawn(response, pathname, reads, brim.db) : response;
}

/**
 * Remembers what a page read once it is drawn whole: Astro streams a page, and the blocks further down it run as it
 * is sent. Only a page a host would keep (200, not private) teaches anything, and only when no code of the site
 * reads the query without saying so, unless the page itself said what it reads (`readsQuery`).
 */
function learnWhenDrawn(
  response: Response,
  pathname: string,
  reads: QueryCollector,
  db: Parameters<typeof queryReads>[0],
): Response {
  if (response.status !== 200 || /private|no-store/i.test(response.headers.get("cache-control") ?? "")) return response;
  const learn = () => {
    if (!config.learnQuery && !reads.bySite) return;
    void queryReads(db)
      .record(pathname, reads.read)
      .catch(() => undefined);
  };
  if (!response.body) {
    learn();
    return response;
  }
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: learn }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** The editor, opened on a page of the site. */
function editorRedirect(pathname: string): Response {
  const page = normalizePagePath(pathname);
  return new Response(null, {
    status: 302,
    headers: { location: `/admin/edit${page === "/" ? "" : page}`, "cache-control": "no-store" },
  });
}

/**
 * A floating "Edit this page" button on every page someone who may edit opens in the browser (anyone on the dev
 * server, a signed-in user on the live site), so nobody has to know the editor's address. Not inside the editor's
 * own frame (the browser says it draws a frame), and never for visitors or in a static copy.
 */
async function withEditButton(response: Response, request: Request, pathname: string): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html") || response.status !== 200) return response;
  if (request.headers.get("sec-fetch-dest") === "iframe") return response;
  const html = await response.text();
  const page = normalizePagePath(pathname);
  const button =
    `<a href="/admin/edit${page === "/" ? "" : page}" data-brim-edit-button ` +
    `style="position:fixed;right:20px;bottom:20px;z-index:2147483647;display:inline-flex;align-items:center;gap:8px;` +
    `padding:10px 16px;border-radius:999px;background:#18181b;color:#fff;font:600 14px/1 system-ui,sans-serif;` +
    `text-decoration:none;box-shadow:0 6px 24px rgba(0,0,0,.25)" title="Only you see this: open this page in the editor">` +
    `<span aria-hidden="true">✎</span> Edit this page</a>`;
  const body = html.includes("</body>")
    ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${button}</body>`)
    : html + button;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
