import type { APIRoute } from "astro";
import config from "virtual:brim/config";
import { resolveMedia } from "../config.ts";
import { uploadResponse } from "../content/media.ts";

/**
 * `/uploads/...` on the built server, for images uploaded after the build: the build copied the ones that
 * existed then next to the pages, where the server finds them first.
 */
export const prerender = false;

export const GET: APIRoute = ({ params }) =>
  uploadResponse(config.mediaDirectory, params.file ?? "", resolveMedia(config.media).publicUrl);
