import type { Database } from "../db/database.ts";
import { type ImageSize, imageSize } from "./image-size.ts";

/**
 * The sizes of the uploaded images, by address (`/uploads/…`), so `imageSources` can give an `<img>` its `width` and
 * `height` without asking the database while a page is drawn. The middleware loads them before each page, at most
 * once a minute; an upload made by this server is known at once, one made by another server of the same site within
 * the minute.
 */
const known = new Map<string, ImageSize>();
let loadedAt = Number.NEGATIVE_INFINITY;
let loading: Promise<void> | undefined;

/** How long the sizes loaded are trusted before the next page reloads them. */
export const IMAGE_SIZES_REFRESH_MS = 60_000;

export function rememberImageSize(url: string, size: ImageSize): void {
  known.set(url, size);
}

/** The size of an uploaded image, when the media library knows it. */
export function knownImageSize(url: string): ImageSize | undefined {
  return known.get(url);
}

/** Forgets every size, so the next page loads them again: for tests, and after the library changed under it. */
export function forgetImageSizes(): void {
  known.clear();
  loadedAt = Number.NEGATIVE_INFINITY;
  loading = undefined;
}

/** Loads the sizes the media library keeps, unless they were loaded within the last minute. */
export function loadImageSizes(db: Database, now = Date.now()): Promise<void> {
  if (now - loadedAt < IMAGE_SIZES_REFRESH_MS) return Promise.resolve();
  loading ??= (async () => {
    try {
      const rows = await db.query("SELECT url, width, height FROM brim_media WHERE width > 0 AND height > 0");
      for (const row of rows) known.set(String(row.url), { width: Number(row.width), height: Number(row.height) });
      loadedAt = now;
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}

/** The address of the copy of `src` that is `width` pixels wide, as the CDN's `resize` writes it. */
export function copyOf(src: string, resize: string, width: number): string {
  return resize.replaceAll("{url}", src).replaceAll("{width}", String(width));
}

/**
 * The `srcset` of an upload served at `src`: a copy at each of `widths` the CDN makes with `resize`
 * (`"{url}?width={width}"`). When the image's own width is known, copies as wide or wider are left out (the CDN does
 * not enlarge it, so they would be the same file under other addresses) and the image itself is the widest, unless
 * it is wider than the widest copy: a photo straight from a camera is megabytes, so the list stops at that copy.
 */
export function srcsetOf(src: string, resize: string, widths: number[], ownWidth?: number): string {
  const smaller = ownWidth ? widths.filter((width) => width < ownWidth) : widths;
  const candidates = smaller.map((width) => `${copyOf(src, resize, width)} ${width}w`);
  if (ownWidth && ownWidth <= Math.max(...widths)) candidates.push(`${src} ${ownWidth}w`);
  return candidates.join(", ");
}

/**
 * The address an `<img>` falls back on (its `src`) and whoever reads it instead of the `srcset` gets: the image
 * itself, or the widest copy when the image is known to be wider than it.
 */
export function widestOf(src: string, resize: string, widths: number[], ownWidth?: number): string {
  const widest = Math.max(...widths);
  return ownWidth && ownWidth > widest ? copyOf(src, resize, widest) : src;
}

/** What measuring the images uploaded before sizes were kept did. */
export interface MeasureReport {
  measured: number;
  /** Files that could not be read (missing, or the storage did not answer): they are tried again next time. */
  unreadable: string[];
  /** Files read but not understood as an image: marked, so they are not read again. */
  unknown: string[];
}

/**
 * Measures the images of the media library that have no size yet (uploaded before brimjs kept it): reads each file
 * with `read`, saves its size and makes it known. Four files are read at a time.
 */
export async function measureImageSizes(
  db: Database,
  read: (url: string) => Promise<Uint8Array | undefined>,
): Promise<MeasureReport> {
  const rows = await db.query(
    "SELECT id, url FROM brim_media WHERE width IS NULL AND mime <> 'image/svg+xml' ORDER BY created_at",
  );
  const report: MeasureReport = { measured: 0, unreadable: [], unknown: [] };
  const queue = rows.map((row) => ({ id: String(row.id), url: String(row.url) }));
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      let bytes: Uint8Array | undefined;
      try {
        bytes = await read(next.url);
      } catch {
        bytes = undefined;
      }
      if (!bytes) {
        report.unreadable.push(next.url);
        continue;
      }
      const size = imageSize(bytes);
      // 0 × 0 marks a file read but not understood, so it is not fetched again on every start.
      await db.query("UPDATE brim_media SET width = ?, height = ? WHERE id = ?", [
        size?.width ?? 0,
        size?.height ?? 0,
        next.id,
      ]);
      if (size) {
        known.set(next.url, size);
        report.measured += 1;
      } else {
        report.unknown.push(next.url);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return report;
}
