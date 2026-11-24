import type { APIRoute } from "astro";
import config from "virtual:brim/config";
import routes from "virtual:brim/routes";
import { sitemapEntries, sitemapXml } from "../content/sitemap.ts";
import { requestOrigin } from "../server/http.ts";
import { connect } from "./connect.ts";

/**
 * `/sitemap.xml`, added by Brim. The build writes it from the content as it is then; in dev it is made on
 * every request, so a page or item just published shows up at once.
 */
export const prerender = true;

export const GET: APIRoute = async ({ site, request }) => {
  const { content, items } = await connect(config.databaseUrl, config.authToken);
  const entries = await sitemapEntries({
    content,
    items,
    contentTypes: config.contentTypes,
    pageTemplates: config.pageTemplates,
    routes,
    locales: config.locales,
  });
  // A static build adds this route only when the site's address is set; a server answers with its own.
  return new Response(
    sitemapXml(entries, site ?? (config.mode === "server" ? requestOrigin(request) : new URL(request.url).origin)),
    {
      headers: { "content-type": "application/xml; charset=utf-8" },
    },
  );
};
