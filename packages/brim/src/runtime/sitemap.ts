import type { APIRoute } from "astro";
import config from "virtual:brim/config";
import routes from "virtual:brim/routes";
import { sitemapEntries, sitemapXml } from "../content/sitemap.ts";
import { givenOrigin, requestOrigin } from "../server/http.ts";
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
  // A static build adds this route only when the site's address is set; a server whose address is not set answers
  // with the one it was asked at, which is the asker's to write: a cache must not hand that answer to anyone else.
  const given = site ?? givenOrigin();
  const asked = config.mode === "server" ? requestOrigin(request) : new URL(request.url).origin;
  return new Response(sitemapXml(entries, given ?? asked), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // With the site's address it is everyone's, asked again each time (a CDN in front keeps it as its host says):
      // left unsaid, a CDN keeps it as long as it likes and new pages are missing from it.
      ...(config.mode === "server" && { "cache-control": given ? "public, max-age=0" : "no-store" }),
    },
  });
};
