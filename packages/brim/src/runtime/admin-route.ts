import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { APIRoute } from "astro";
import config from "virtual:brim/config";
import routes from "virtual:brim/routes";
import { resolveHostSignIn, resolveMail, resolveMedia, resolveVideoUploads } from "../config.ts";
import { upgradeFieldValues } from "../content/block-values.ts";
import { adoptLanguageScopes } from "../content/language-scopes.ts";
import { storageFiles } from "../content/media.ts";
import { Mailer } from "../mail/mailer.ts";
import { type AdminHandler, createAdminHandler } from "../server/handler.ts";
import { clientAddress as visitorAddress } from "../server/http.ts";
import { connect } from "./connect.ts";
import { siteFormFiles } from "./form-files.ts";
import { icons } from "./icons.ts";
import { siteQueryRules } from "./query-store.ts";

/**
 * `/admin` on the built server: the editor, its API and the site's MCP, the same handler the dev server uses.
 * Pages are drawn from the database on each request, so nothing has to be rebuilt after a change.
 */
export const prerender = false;

let handler: Promise<AdminHandler> | undefined;

async function create(): Promise<AdminHandler> {
  const brim = await connect(config.databaseUrl, config.authToken);
  await upgradeFieldValues(brim.db, config.contentTypes);
  if (config.locales) await adoptLanguageScopes(brim.db, config.locales.defaultLocale);
  return createAdminHandler({
    brim,
    // Astro gives the site's `site` (from its config, or BRIM_SITE_URL through the integration) here.
    // Written exactly so: Vite replaces the literal `import.meta.env.SITE` when it builds the server.
    // @ts-expect-error Astro's types for import.meta.env are not part of this package's own check.
    siteUrl: import.meta.env.SITE as string | undefined,
    locales: config.locales,
    assetsDirectory: editorAssets(),
    contentTypes: () => config.contentTypes,
    pageTemplates: () => config.pageTemplates,
    siteSettings: () => config.siteSettings,
    emails: () => config.emails,
    mediaDirectory: pathToFileURL(`${config.mediaDirectory}/`),
    mediaFiles: storageFiles(resolveMedia(config.media).storage),
    formFiles: siteFormFiles(),
    thumbnail: mediaThumbnail,
    videoUploads: resolveVideoUploads(config.videoUploads),
    hostSignIn: resolveHostSignIn(),
    mailer: new Mailer(resolveMail(config.mail)),
    icons,
    brandColors: config.brandColors ?? [],
    identity: config.identity ?? {},
    pages: () => routes.pages,
    patterns: () => routes.patterns,
    // The query parameters each page and route reads, for a host that caches pages (Brimsites).
    queryParams: () => siteQueryRules(brim.db),
  });
}

/** A 320 px copy of an upload from the site's CDN (`media.resize`), for the editor's picker. */
function mediaThumbnail(url: string): string | undefined {
  const { publicUrl, resize } = resolveMedia(config.media);
  if (!resize || !/\.(?:jpe?g|png|webp|avif)$/i.test(url)) return undefined;
  const src = publicUrl && url.startsWith("/uploads/") ? `${publicUrl}${url}` : url;
  return resize.replaceAll("{url}", src).replaceAll("{width}", "320");
}

/** Where brimjs was installed when the site was built, or where it is installed next to the running server. */
function editorAssets(): URL {
  const installed = join(process.cwd(), "node_modules", "brimjs", "editor-dist");
  return pathToFileURL(`${existsSync(config.editorAssets) ? config.editorAssets : installed}/`);
}

export const ALL: APIRoute = async ({ request, clientAddress }) => {
  handler ??= create();
  return (
    (await (await handler)(request, { clientAddress: visitorAddress(request, clientAddress) })) ??
    new Response("Not found", { status: 404 })
  );
};
