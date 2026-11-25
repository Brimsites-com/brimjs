import type { APIRoute } from "astro";
import config from "virtual:brim/config";
import { givenOrigin, requestOrigin } from "../server/http.ts";

/**
 * `/robots.txt`, added by Brim: everything may be crawled except the editor. It names the sitemap at the site's
 * address, or at the address the server was asked at; a static build without `site` has neither, and no sitemap.
 */
export const prerender = true;

export const GET: APIRoute = ({ site, request }) => {
  // Behind the CDN the server is asked at its own internal address: the visitor's is in `X-Forwarded-Host`.
  const given = site ?? givenOrigin();
  const origin =
    given ??
    (config.mode === "server"
      ? requestOrigin(request)
      : config.mode === "dev"
        ? new URL(request.url).origin
        : undefined);
  const sitemap = origin ? `\nSitemap: ${new URL("/sitemap.xml", origin).href}\n` : "";
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\n${sitemap}`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // The address asked at is the asker's to write: a cache must not hand this answer to anyone else.
      ...(!given && config.mode === "server" && { "cache-control": "no-store" }),
    },
  });
};
