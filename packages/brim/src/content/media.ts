import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database, Row, SqlValue } from "../db/database.ts";
import { imageSize } from "./image-size.ts";
import { rememberImageSize } from "./image-sizes.ts";
import { ValidationError } from "./validation-error.ts";

export interface MediaFile {
  id: string;
  /** Address the image is served from, e.g. `/uploads/3f2a….jpg`. */
  url: string;
  /** The name the file had on the owner's computer. */
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  /** "" for the site's gallery, or `<type>/<item id>` for the folder of one item. */
  folder: string;
  /** The image's size in pixels, as it is drawn; absent for images not measured yet. */
  width?: number;
  height?: number;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SERVED_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/**
 * `/uploads/<file>`, read from the uploads folder when asked. The built server answers with it for images uploaded
 * after the build; the dev server too, as its own list of public files learns of a new one only after the page
 * drawn just after an upload has asked for it.
 */
export async function uploadResponse(directory: string, file: string, publicUrl?: string): Promise<Response> {
  const type = SERVED_TYPES[file.split(".").pop()?.toLowerCase() ?? ""];
  // Names are written by Brim; anything else, or a path climbing out of the folder, is not an upload.
  if (!type || !/^[\w.-]+(\/[\w.-]+)*$/.test(file) || file.split("/").some((part) => part.startsWith("."))) {
    return new Response("Not found", { status: 404 });
  }
  // Images served from elsewhere (a CDN): an address written by the site's own code, or shown in the editor, leads
  // there. Files still on this server, uploaded before, are answered from here.
  if (publicUrl) {
    try {
      const body = await readFile(join(directory, file));
      return new Response(body, { headers: uploadHeaders(type) });
    } catch {
      return new Response(null, { status: 301, headers: { location: `${publicUrl}/uploads/${file}` } });
    }
  }
  try {
    const body = await readFile(join(directory, file));
    return new Response(body, { headers: uploadHeaders(type) });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function uploadHeaders(type: string): Record<string, string> {
  return {
    "content-type": type,
    "cache-control": "public, max-age=31536000, immutable",
    // An SVG can carry a script; shown as an image it never runs, opened on its own it must not either.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "x-content-type-options": "nosniff",
  };
}

/**
 * Image formats accepted for upload, recognised by the file's first bytes rather than its name
 * or declared type. SVG is left out on purpose: it can carry scripts.
 */
const FORMATS: { mime: string; extension: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", extension: "jpg", matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  { mime: "image/png", extension: "png", matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) },
  { mime: "image/gif", extension: "gif", matches: (bytes) => ascii(bytes, 0, 4) === "GIF8" },
  {
    mime: "image/webp",
    extension: "webp",
    matches: (bytes) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP",
  },
  { mime: "image/avif", extension: "avif", matches: (bytes) => ascii(bytes, 4, 12) === "ftypavif" },
];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Where the files of uploads are written: the server's disk, or a storage reached over HTTP. */
export interface MediaFiles {
  /** `path` is the file's name under the uploads, e.g. `product/<id>/<uuid>.jpg`. */
  write(path: string, bytes: Uint8Array, mime: string): Promise<void>;
}

/** Uploads as files in a folder of the server, `public/uploads` by default. */
export class DiskFiles implements MediaFiles {
  readonly #directory: URL;

  constructor(directory: URL) {
    this.#directory = directory;
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const file = new URL(path, this.#directory);
    await mkdir(new URL(".", file), { recursive: true });
    await writeFile(file, bytes);
  }
}

/**
 * Uploads sent to a storage over HTTP: `PUT <url>/uploads/<path>` with the headers the site gives (its key). Any
 * storage that takes a file that way works, and so does a host's own endpoint in front of one.
 */
export class HttpFiles implements MediaFiles {
  readonly #url: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch;

  constructor(url: string, headers: Record<string, string> = {}, fetcher: typeof fetch = fetch) {
    this.#url = url.replace(/\/+$/, "");
    this.#headers = headers;
    this.#fetch = fetcher;
  }

  async write(path: string, bytes: Uint8Array, mime: string): Promise<void> {
    const address = `${this.#url}/uploads/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await this.#fetch(address, {
      method: "PUT",
      headers: { ...this.#headers, "content-type": mime },
      body: new Uint8Array(bytes),
    });
    // The storage's answer may name it; the owner only needs to know the image was not kept.
    if (!response.ok) throw new Error(`The image could not be stored (${response.status}).`);
  }
}

/** The storage `media.storage` names, or nothing when uploads stay on the server's disk. */
export function storageFiles(
  storage: { url: string; headers: Record<string, string> } | undefined,
): MediaFiles | undefined {
  return storage ? new HttpFiles(storage.url, storage.headers) : undefined;
}

/** The owner's uploaded images: files on disk or in a storage, listed in the database under `/uploads/…`. */
export class MediaStore {
  readonly #db: Database;
  readonly #files: MediaFiles;
  readonly #publicPath: string;

  /**
   * `files` is where files are written (a folder of the server, or a storage); `publicPath` is the address prefix
   * the database lists them under, the same wherever they are kept.
   */
  constructor(db: Database, files: URL | MediaFiles, publicPath = "/uploads") {
    this.#db = db;
    this.#files = files instanceof URL ? new DiskFiles(files) : files;
    this.#publicPath = publicPath;
  }

  /** Every image, newest first. A library of thousands is read a page at a time with `page`. */
  async list(): Promise<MediaFile[]> {
    const rows = await this.#db.query("SELECT * FROM brim_media ORDER BY created_at DESC, id DESC");
    return rows.map(toMediaFile);
  }

  /**
   * One page of the library, newest first: the images whose name holds `search` (any case), in `folder` when it is
   * given ("" is the gallery), after the one `after` names (the `next` of the page before). `next` is absent on the
   * last page. The picker reads it this way, so every image of a library of thousands is reachable and searched.
   */
  async page(
    options: { search?: string; folder?: string; after?: string; limit?: number } = {},
  ): Promise<{ files: MediaFile[]; next?: string }> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 120), 1), 500);
    const where: string[] = [];
    const args: SqlValue[] = [];
    const search = options.search?.trim();
    if (search) {
      where.push("name LIKE ? ESCAPE '\\'");
      args.push(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    }
    if (options.folder !== undefined) {
      where.push("folder = ?");
      args.push(options.folder);
    }
    const [createdAt, id] = (options.after ?? "").split("|");
    if (createdAt && id) {
      where.push("(created_at < ? OR (created_at = ? AND id < ?))");
      args.push(createdAt, createdAt, id);
    }
    const rows = await this.#db.query(
      `SELECT * FROM brim_media${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...args, limit + 1],
    );
    const files = rows.slice(0, limit).map(toMediaFile);
    const last = files.at(-1);
    return rows.length > limit && last ? { files, next: `${last.createdAt}|${last.id}` } : { files };
  }

  /**
   * `folder` is "" for the gallery or `<type>/<item id>`, checked by the caller against existing items;
   * files of a folder are written to a subfolder of the same path.
   */
  async upload(bytes: Uint8Array, name: string, folder = ""): Promise<MediaFile> {
    if (folder !== "" && !/^[a-z][a-z0-9_]*\/[\w-]{1,64}$/.test(folder)) {
      throw new ValidationError("This folder does not exist.");
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ValidationError("The image is larger than 10 MB.");
    const format = FORMATS.find((candidate) => candidate.matches(bytes));
    if (!format) throw new ValidationError("Only JPEG, PNG, GIF, WebP and AVIF images can be uploaded.");

    // The stored name is generated, so nothing in the uploaded name can reach the file system.
    const id = randomUUID();
    const fileName = `${folder ? `${folder}/` : ""}${id}.${format.extension}`;
    await this.#files.write(fileName, bytes, format.mime);
    const size = imageSize(bytes);

    const file: MediaFile = {
      id,
      url: `${this.#publicPath}/${fileName}`,
      name: name.slice(0, 200) || fileName,
      mime: format.mime,
      size: bytes.byteLength,
      createdAt: new Date().toISOString(),
      folder,
      ...size,
    };
    await this.#db.query(
      "INSERT INTO brim_media (id, url, name, mime, size, created_at, folder, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        file.id,
        file.url,
        file.name,
        file.mime,
        file.size,
        file.createdAt,
        file.folder,
        size?.width ?? 0,
        size?.height ?? 0,
      ],
    );
    // Pages drawn by this server give the image its size from now on.
    if (size) rememberImageSize(file.url, size);
    return file;
  }
}

function toMediaFile(row: Row): MediaFile {
  return {
    folder: String(row.folder ?? ""),
    id: String(row.id),
    url: String(row.url),
    name: String(row.name),
    mime: String(row.mime),
    size: Number(row.size),
    createdAt: String(row.created_at),
    ...(Number(row.width) > 0 && Number(row.height) > 0 && { width: Number(row.width), height: Number(row.height) }),
  };
}
