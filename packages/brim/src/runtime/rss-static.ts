import type { GetStaticPaths } from "astro";
import config from "virtual:brim/config";
import { FEED_PREFIX, feedAddresses } from "../content/feed.ts";

/**
 * The feeds of a static build: the same route as `rss.ts`, with the list of feeds the build writes. The server's
 * route has no list, so a server build does not warn that it ignores one.
 */
export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  feedAddresses(config.contentTypes, config.locales).map(({ path }) => ({
    params: { feed: path.slice(FEED_PREFIX.length) },
  }));

export { GET } from "./rss.ts";
