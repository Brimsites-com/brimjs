import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import config from "virtual:brim/config";
import { type MediaConfig, resolveMedia } from "../config.ts";
import {
  copyOf,
  knownImageSize,
  loadImageSizes,
  measureImageSizes,
  srcsetOf,
  widestOf,
} from "../content/image-sizes.ts";
import { MAX_UPLOAD_BYTES } from "../content/media.ts";
import type { Database } from "../db/database.ts";

/** The upload settings, read once per server: the environment does not change while it runs. */
let resolved: MediaConfig | undefined;
function media(): MediaConfig {
  resolved ??= resolveMedia(config.media);
  return resolved;
}

const UPLOADS = "/uploads/";

/**
 * Where visitors get an image: an upload (`/uploads/…`, as content stores it) at `media.publicUrl` when the site
 * serves its images from elsewhere, anything else as it is. Use it in the site's own markup for images it reads
 * from items: `<img src={mediaUrl(item.data.cover.src)} />`.
 */
export function mediaUrl(url: string): string {
  const { publicUrl } = media();
  return publicUrl && url.startsWith(UPLOADS) ? `${publicUrl}${url}` : url;
}

/** The attributes `imageSources` gives an `<img>`. */
export interface ImageSources {
  src: string;
  srcset?: string;
  sizes?: string;
  /** An upload's size in pixels, so the browser keeps the image's place before it arrives. */
  width?: number;
  height?: number;
}

/**
 * The attributes of an `<img>` for an image: its address, its `width` and `height` when it is an upload the media
 * library measured and, when `media.resize` says how the CDN makes smaller copies, a `srcset` of them with `sizes`,
 * so the browser downloads the copy the layout needs. Only uploads get a `srcset`: images from other sites are not
 * the CDN's to resize. Copies wider than the image are left out (the CDN does not enlarge it); the image itself is
 * the widest, unless it is wider than the widest copy: then the file as it was uploaded is never sent.
 *
 *   <img {...imageSources(item.data.cover.src, "(max-width: 768px) 100vw, 33vw")} alt={item.data.cover.alt} />
 *
 * With `width` and `height` given, the browser reserves the image's shape while it loads; a site whose CSS sets an
 * image's width (`width: 100%`) also sets `height: auto`, so the height follows the width rather than the attribute.
 */
export function imageSources(url: string, sizes = "100vw"): ImageSources {
  const src = mediaUrl(url);
  if (!url.startsWith(UPLOADS)) return siteImage(url, sizes) ?? { src };
  const size = knownImageSize(url);
  const { resize, widths } = media();
  if (!resize || /\.(svg|gif)$/i.test(url)) return { src, ...size };
  return {
    src: widestOf(src, resize, widths, size?.width),
    srcset: srcsetOf(src, resize, widths, size?.width),
    sizes,
    ...size,
  };
}

/** How wide the picture of a shared link is asked for: what chats and social networks draw a large card from. */
const SHARED_IMAGE_WIDTH = 1200;

/**
 * The address of an image for a shared link's card (`og:image`): a copy 1200 pixels wide where the CDN makes copies
 * (`media.resize`), so a network downloads a card's worth and not the photo as it was uploaded; an image narrower
 * than that, one the CDN does not resize (SVG, GIF, another site's) and any image without a CDN, as it is.
 */
export function sharedImageUrl(url: string): string {
  const { resize, siteUrl } = media();
  if (!resize || /\.(svg|gif)$/i.test(url)) return mediaUrl(url);
  if (url.startsWith(UPLOADS)) {
    const own = knownImageSize(url)?.width;
    return own && own <= SHARED_IMAGE_WIDTH ? mediaUrl(url) : copyOf(mediaUrl(url), resize, SHARED_IMAGE_WIDTH);
  }
  return siteUrl && SITE_IMAGE.test(url) ? copyOf(`${siteUrl}${url}`, resize, SHARED_IMAGE_WIDTH) : url;
}

let makesCopies: boolean | undefined;
/**
 * Whether Astro's image endpoint can make copies here, for a site that asked for them (`media.sharp`): it needs
 * `sharp`, which the built server looks for from the site's own folder (its bundle sits in it). A site installed
 * with pnpm (strict node_modules, sharp not a dependency of its own) or without sharp has none, and every copy would
 * answer 500, so its pictures go as they are instead and the server's log says so.
 */
function serverMakesCopies(): boolean {
  if (makesCopies !== undefined) return makesCopies;
  try {
    createRequire(join(process.cwd(), "package.json")).resolve("sharp");
    makesCopies = true;
  } catch {
    makesCopies = false;
    console.warn(
      "[brim] media.sharp is on but sharp is not installed: pictures in public/ are sent without smaller copies " +
        "(npm install sharp).",
    );
  }
  return makesCopies;
}

/** A picture of the site's own code, in `public/` (`/images/hero.jpg`): not an upload, not another site's. */
const SITE_IMAGE = /^\/(?!\/)(?!uploads\/)[^?#]+\.(?:jpe?g|png|webp|avif)$/i;

/**
 * Smaller copies of a picture of the site's own code: from the host's CDN when it copies `public/` there
 * (`media.siteUrl` with `resize`, as Brimsites does), else, for a site that asked for it (`media.sharp`), from Astro's
 * image endpoint on the server (`/_image`, sharp, WebP at quality 75: a third of a JPEG's bytes, alike to the eye),
 * never wider than the picture. Without either, and in a static build without a CDN, they are sent as they were
 * saved. Each copy has its own address, kept for a year.
 */
function siteImage(url: string, sizes: string): ImageSources | undefined {
  if (!SITE_IMAGE.test(url)) return undefined;
  const { siteUrl, resize, widths, sharp } = media();
  if (siteUrl && resize) {
    const src = `${siteUrl}${url}`;
    return { src, srcset: srcsetOf(src, resize, widths), sizes };
  }
  if (!sharp || (config.mode !== "server" && config.mode !== "dev") || !serverMakesCopies()) return undefined;
  const href = encodeURIComponent(url);
  const srcset = widths.map((width) => `/_image?href=${href}&w=${width}&f=webp&q=75 ${width}w`).join(", ");
  return { src: url, srcset, sizes };
}

/**
 * Reads an upload's file, to measure an image uploaded before sizes were kept: from the uploads folder of this
 * server, or from where the site serves its images (`media.publicUrl`).
 */
async function readUpload(url: string): Promise<Uint8Array | undefined> {
  const file = url.slice(UPLOADS.length);
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(file) || file.split("/").some((part) => part.startsWith("."))) return undefined;
  try {
    return new Uint8Array(await readFile(join(config.mediaDirectory, file)));
  } catch {
    // Not on this server's disk: kept in a storage, or uploaded to another server of the site.
  }
  const { publicUrl } = media();
  if (!publicUrl) return undefined;
  const response = await fetch(`${publicUrl}${url}`);
  if (!response.ok) return undefined;
  if (Number(response.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) return undefined;
  return new Uint8Array(await response.arrayBuffer());
}

let measuring: Promise<unknown> | undefined;

/**
 * Makes the sizes of the uploads known before a page is drawn: loads them (at most once a minute) and, once per
 * server, measures the images uploaded before sizes were kept. A page drawn at build time (`wait`) waits for that,
 * since it is drawn once; a running server draws its pages meanwhile and gives those images their sizes as they are
 * measured.
 */
export async function prepareImageSizes(db: Database, wait: boolean): Promise<void> {
  await loadImageSizes(db);
  measuring ??= measureImageSizes(db, readUpload).then(
    (report) => {
      if (report.measured > 0) console.info(`[brim] Measured ${report.measured} uploaded images.`);
      if (report.unreadable.length > 0) {
        console.warn(`[brim] ${report.unreadable.length} uploaded images could not be read to measure them.`);
      }
    },
    (error: unknown) => console.warn("[brim] Uploaded images could not be measured:", error),
  );
  if (wait) await measuring;
}
