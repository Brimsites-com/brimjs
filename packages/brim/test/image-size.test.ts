import { beforeEach, describe, expect, it } from "vitest";
import { imageSize } from "../src/content/image-size.ts";
import {
  copyOf,
  forgetImageSizes,
  knownImageSize,
  loadImageSizes,
  measureImageSizes,
  srcsetOf,
  widestOf,
} from "../src/content/image-sizes.ts";
import { MediaStore } from "../src/content/media.ts";
import type { Database } from "../src/db/database.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

/** Bytes written as numbers, ASCII strings and big-endian integers, the way image headers are laid out. */
function bytes(...parts: (number | string | number[] | Uint8Array)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else if (typeof part === "string") out.push(...[...part].map((char) => char.charCodeAt(0)));
    else out.push(...part);
  }
  return new Uint8Array(out);
}
const u16 = (value: number) => [value >> 8, value & 0xff];
const u32 = (value: number) => [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const le16 = (value: number) => [value & 0xff, value >> 8];
const le24 = (value: number) => [value & 0xff, (value >> 8) & 0xff, value >> 16];
const le32 = (value: number) => [...le16(value & 0xffff), ...le16(value >>> 16)];

function png(width: number, height: number): Uint8Array {
  return bytes(0x89, "PNG\r\n\x1a\n", u32(13), "IHDR", u32(width), u32(height), 8, 6, 0, 0, 0, u32(0));
}

/** An EXIF block (TIFF, big-endian) whose only entry is the orientation. */
function exif(orientation: number): number[] {
  return [...bytes("MM", u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), 0, 0, u32(0))];
}

function jpeg(width: number, height: number, orientation?: number): Uint8Array {
  const app1 = orientation
    ? bytes(0xff, 0xe1, u16(2 + 6 + exif(orientation).length), "Exif\0\0", exif(orientation))
    : [];
  const app0 = bytes(0xff, 0xe0, u16(16), "JFIF\0", 1, 1, 0, u16(1), u16(1), 0, 0);
  const sof = bytes(0xff, 0xc2, u16(17), 8, u16(height), u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  return bytes(0xff, 0xd8, app0, app1, sof, 0xff, 0xda);
}

function riff(chunks: Uint8Array): Uint8Array {
  return bytes("RIFF", le32(chunks.length + 4), "WEBP", chunks);
}

function box(type: string, ...body: (number | string | number[] | Uint8Array)[]): Uint8Array {
  const content = bytes(...body);
  return bytes(u32(content.length + 8), type, content);
}

/** An AVIF whose primary item (2) is a grid; item 1, a tile, has its own smaller `ispe`, listed first. */
function avifGrid(width: number, height: number, rotation = 0): Uint8Array {
  const tile = box("ispe", u32(0), u32(512), u32(512));
  const whole = box("ispe", u32(0), u32(width), u32(height));
  const irot = box("irot", rotation);
  const ipco = box("ipco", tile, whole, irot);
  const ipma = box("ipma", 0, 0, 0, 0, u32(2), u16(1), 1, 0x81, u16(2), 2, 0x02, 0x83);
  const meta = box("meta", u32(0), box("pitm", u32(0), u16(2)), box("iprp", ipco, ipma));
  return bytes(box("ftyp", "avif", u32(0), "mif1avif"), meta);
}

describe("an image's size, read from its bytes", () => {
  it("reads PNG, GIF and JPEG", () => {
    expect(imageSize(png(1707, 2560))).toEqual({ width: 1707, height: 2560 });
    expect(imageSize(bytes("GIF89a", le16(320), le16(200), 0, 0, 0))).toEqual({ width: 320, height: 200 });
    expect(imageSize(jpeg(2560, 1707))).toEqual({ width: 2560, height: 1707 });
  });

  it("turns a photo the camera stored sideways, as the browser draws it", () => {
    expect(imageSize(jpeg(2560, 1707, 6))).toEqual({ width: 1707, height: 2560 });
    expect(imageSize(jpeg(2560, 1707, 8))).toEqual({ width: 1707, height: 2560 });
    expect(imageSize(jpeg(2560, 1707, 3))).toEqual({ width: 2560, height: 1707 });
  });

  it("reads the three kinds of WebP", () => {
    const lossy = bytes("VP8 ", le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, le16(1280), le16(1920));
    expect(imageSize(riff(lossy))).toEqual({ width: 1280, height: 1920 });
    const bits = (1707 - 1) | ((2560 - 1) << 14);
    expect(imageSize(riff(bytes("VP8L", le32(5), 0x2f, le32(bits))))).toEqual({ width: 1707, height: 2560 });
    const extended = bytes("VP8X", le32(10), 0, 0, 0, 0, le24(4096 - 1), le24(2731 - 1));
    expect(imageSize(riff(extended))).toEqual({ width: 4096, height: 2731 });
  });

  it("reads a WebP's EXIF orientation", () => {
    const tiff = exif(6);
    const extended = bytes("VP8X", le32(10), 0x08, 0, 0, 0, le24(4096 - 1), le24(2731 - 1));
    const chunk = bytes("EXIF", le32(tiff.length), tiff);
    expect(imageSize(riff(bytes(extended, chunk)))).toEqual({ width: 2731, height: 4096 });
  });

  it("reads an AVIF's main image, not one of its tiles, and its rotation", () => {
    expect(imageSize(avifGrid(1707, 2560))).toEqual({ width: 1707, height: 2560 });
    expect(imageSize(avifGrid(2560, 1707, 1))).toEqual({ width: 1707, height: 2560 });
  });

  it("says nothing for what is not an image, or stops before its size", () => {
    expect(imageSize(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeUndefined();
    expect(imageSize(png(10, 10).subarray(0, 18))).toBeUndefined();
    expect(imageSize(jpeg(10, 10).subarray(0, 24))).toBeUndefined();
    expect(imageSize(new Uint8Array())).toBeUndefined();
  });
});

describe("the sizes of the media library", () => {
  let db: Database;

  beforeEach(async () => {
    forgetImageSizes();
    db = openDatabase(":memory:");
    await migrate(db);
  });

  async function addOld(id: string, url: string, mime = "image/webp"): Promise<void> {
    await db.query("INSERT INTO brim_media (id, url, name, mime, size, created_at) VALUES (?, ?, ?, ?, 1, ?)", [
      id,
      url,
      id,
      mime,
      new Date().toISOString(),
    ]);
  }

  it("measures an image when it is uploaded, and knows it at once", async () => {
    const written: string[] = [];
    const store = new MediaStore(db, { write: async (path) => void written.push(path) });
    const file = await store.upload(jpeg(2560, 1707, 6), "photo.jpg", "project/abc");
    expect(file).toMatchObject({ width: 1707, height: 2560 });
    expect(knownImageSize(file.url)).toEqual({ width: 1707, height: 2560 });
    expect((await store.list())[0]).toMatchObject({ url: file.url, width: 1707, height: 2560 });
  });

  it("measures the images uploaded before, reads each once, and tries again those it could not read", async () => {
    await addOld("a", "/uploads/project/1/a.png");
    await addOld("b", "/uploads/b.png");
    await addOld("c", "/uploads/c.webp");
    await addOld("d", "/uploads/d.svg", "image/svg+xml");
    const reads: string[] = [];
    const files: Record<string, Uint8Array> = {
      "/uploads/project/1/a.png": png(1707, 2560),
      "/uploads/c.webp": bytes("not an image"),
    };
    const read = async (url: string) => {
      reads.push(url);
      if (url === "/uploads/b.png") throw new Error("storage down");
      return files[url];
    };

    const report = await measureImageSizes(db, read);
    expect(report).toEqual({ measured: 1, unreadable: ["/uploads/b.png"], unknown: ["/uploads/c.webp"] });
    expect(reads.sort()).toEqual(["/uploads/b.png", "/uploads/c.webp", "/uploads/project/1/a.png"]);
    expect(knownImageSize("/uploads/project/1/a.png")).toEqual({ width: 1707, height: 2560 });

    reads.length = 0;
    await measureImageSizes(db, read);
    expect(reads).toEqual(["/uploads/b.png"]);
  });

  it("loads the sizes kept, at most once a minute", async () => {
    await addOld("a", "/uploads/a.png");
    await db.query("UPDATE brim_media SET width = 800, height = 600");
    await loadImageSizes(db, 1_000);
    expect(knownImageSize("/uploads/a.png")).toEqual({ width: 800, height: 600 });

    await db.query("UPDATE brim_media SET width = 600, height = 800");
    await loadImageSizes(db, 30_000);
    expect(knownImageSize("/uploads/a.png")).toEqual({ width: 800, height: 600 });
    await loadImageSizes(db, 62_000);
    expect(knownImageSize("/uploads/a.png")).toEqual({ width: 600, height: 800 });
  });
});

describe("the srcset of an upload", () => {
  const widths = [320, 640, 960, 1280, 1920, 2560];
  const src = "https://cdn.test/uploads/a.webp";

  it("stops at the image's own width, which the CDN does not go past", () => {
    expect(srcsetOf(src, "{url}?width={width}", widths, 1707)).toBe(
      [320, 640, 960, 1280].map((width) => `${src}?width=${width} ${width}w`).join(", ") + `, ${src} 1707w`,
    );
    expect(srcsetOf(src, "{url}?width={width}", widths, 2560)).toMatch(
      /\?width=1920 1920w, https:\/\/cdn\.test\/uploads\/a\.webp 2560w$/,
    );
  });

  it("never offers a photo wider than the widest copy as it was uploaded", () => {
    const srcset = srcsetOf(src, "{url}?width={width}", widths, 4000);
    expect(srcset.split(", ")).toEqual(widths.map((width) => `${src}?width=${width} ${width}w`));
    expect(widestOf(src, "{url}?width={width}", widths, 4000)).toBe(`${src}?width=2560`);
    // An image the copies cover, or one not measured yet, is its own fallback.
    expect(widestOf(src, "{url}?width={width}", widths, 2560)).toBe(src);
    expect(widestOf(src, "{url}?width={width}", widths)).toBe(src);
    expect(copyOf(src, "/cdn-cgi/image/width={width}/{url}", 1200)).toBe(`/cdn-cgi/image/width=1200/${src}`);
  });

  it("offers every copy for an image not measured yet", () => {
    expect(srcsetOf(src, "{url}?w={width}", widths).split(", ")).toHaveLength(6);
  });
});
