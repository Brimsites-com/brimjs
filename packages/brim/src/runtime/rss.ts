import type { APIRoute } from "astro";
import config from "virtual:brim/config";
import routes from "virtual:brim/routes";
import { buildFeed, feedAt, rssXml } from "../content/feed.ts";
import { connect } from "./connect.ts";

/**
 * `/rss/<slug>.xml` and `/rss/<locale>/<slug>.xml`, added by Brim: the RSS feed of every content type that has
 * `feed` set. The server and dev make them on every request; a static build writes them through `rss-static.ts`.
 */
export const prerender = false;

export const GET: APIRoute = async ({ params, site, url }) => {
  const address = feedAt(params.feed ?? "", config.contentTypes, config.locales);
  if (!address) return new Response(null, { status: 404 });
  const { content, items } = await connect(config.databaseUrl, config.authToken);
  const feed = await buildFeed(address, {
    types: config.contentTypes,
    content,
    items,
    routes,
    locales: config.locales,
    siteName: config.identity?.name,
  });
  // Brim only adds this route to a build when the site's address is set; dev falls back to its own.
  return new Response(rssXml(feed, site ?? url.origin), {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
};
