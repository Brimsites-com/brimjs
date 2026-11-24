import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { FILE_TYPES, type FileType, type FormFile, safeFileName } from "./file-types.ts";

export * from "./file-types.ts";

/**
 * Where the bytes of visitors' files are kept: a folder of the server that nothing serves, or a private storage
 * reached over HTTP. Paths are written by Brim only (`<message id>/<file id>`, two uuids).
 */
export interface PrivateFiles {
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** `undefined` when the file is not there (it was deleted, or the site was moved without its files). */
  read(path: string): Promise<Uint8Array | undefined>;
  remove(path: string): Promise<void>;
}

const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

function checked(path: string): string {
  // Paths come from the database, where Brim wrote them; anything else never reaches a disk or a storage.
  if (!PATH.test(path)) throw new Error("Not a form file.");
  return path;
}

/** Files in a folder of the server outside its public folder: `.brim/form-files` beside the local database. */
export class DiskPrivateFiles implements PrivateFiles {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const file = join(this.#directory, checked(path));
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600 });
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const file = join(this.#directory, checked(path));
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      return undefined;
    }
  }

  async remove(path: string): Promise<void> {
    const file = join(this.#directory, checked(path));
    await rm(file, { force: true });
    // The message's folder goes with its last file.
    await rmdir(dirname(file)).catch(() => undefined);
  }
}

/**
 * Files in a private storage: `PUT`, `GET` and `DELETE <url>/form-files/<message id>/<file id>` with the headers the
 * site gives (its key). The storage must answer only to that key: nothing under this address may be public.
 */
export class HttpPrivateFiles implements PrivateFiles {
  readonly #url: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch;

  constructor(url: string, headers: Record<string, string> = {}, fetcher: typeof fetch = fetch) {
    this.#url = url.replace(/\/+$/, "");
    this.#headers = headers;
    this.#fetch = fetcher;
  }

  #address(path: string): string {
    return `${this.#url}/form-files/${checked(path)}`;
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const response = await this.#fetch(this.#address(path), {
      method: "PUT",
      headers: { ...this.#headers, "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`The file could not be stored (${response.status}).`);
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const response = await this.#fetch(this.#address(path), {
      headers: this.#headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`The file could not be read (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async remove(path: string): Promise<void> {
    const response = await this.#fetch(this.#address(path), {
      method: "DELETE",
      headers: this.#headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`The file could not be deleted (${response.status}).`);
  }
}

/**
 * Where a site keeps visitors' files, or nothing when it has nowhere private:
 * - a private storage, when the host or the config names one (`BRIM_PRIVATE_STORAGE_URL` and `_TOKEN`, or
 *   `forms.files.storage`);
 * - else the server's own disk, unless the site keeps its uploads in a storage (`media.storage`): such a host's disk
 *   is not kept, and its media storage is public, so neither may take them. File fields are then left out of forms.
 */
export function resolveFormFiles(input: {
  storage?: { url: string; headers?: Record<string, string> } | undefined;
  /** True when uploads go to a storage (`media.storage`): the disk is then not a place to keep anything. */
  mediaInStorage: boolean;
  directory: string;
}): PrivateFiles | undefined {
  const url = (process.env.BRIM_PRIVATE_STORAGE_URL ?? "").trim();
  const token = (process.env.BRIM_PRIVATE_STORAGE_TOKEN ?? "").trim(); // betterleaks:allow
  if (/^https?:\/\//.test(url)) return new HttpPrivateFiles(url, token ? { authorization: `Bearer ${token}` } : {});
  if (input.storage?.url) return new HttpPrivateFiles(input.storage.url, input.storage.headers ?? {});
  return input.mediaInStorage ? undefined : new DiskPrivateFiles(input.directory);
}

/**
 * The folder of visitors' files on the server's disk: `form-files` beside the database when that is a local file
 * (`.brim/form-files`: ignored by git, served by nothing, and wherever the host put the database it keeps), else
 * `.brim/form-files` in the site's folder.
 */
export function formFilesDirectory(databaseUrl: string, projectRoot: string): string {
  const local = /^file:(?!:memory:)(.+)$/.exec(databaseUrl)?.[1]?.replace(/\?.*$/, "");
  return local ? join(dirname(resolve(projectRoot, local)), "form-files") : join(projectRoot, ".brim", "form-files");
}

function sealingKey(secret: string): Buffer {
  return createHash("sha256").update(`brim-form-files\n${secret}`).digest();
}

/**
 * A file as it is stored: sealed (AES-256-GCM) with a key made from the site's forms secret, which lives in the
 * database. Whoever reaches the stored bytes without the database (a storage made public by mistake, a copied
 * disk) holds nothing readable, and a file changed where it is stored is refused when opened.
 */
export function sealFile(secret: string, bytes: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(secret), iv);
  return new Uint8Array(Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]));
}

export function openFile(secret: string, sealed: Uint8Array): Uint8Array | undefined {
  if (sealed.byteLength < 28) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", sealingKey(secret), sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(sealed.byteLength - 16));
    return new Uint8Array(
      Buffer.concat([decipher.update(sealed.subarray(12, sealed.byteLength - 16)), decipher.final()]),
    );
  } catch {
    return undefined;
  }
}

/** The files of the site's form messages: sealed on their way in, opened on their way out. */
export class FormFiles {
  readonly #files: PrivateFiles;
  readonly #secret: () => Promise<string>;

  constructor(files: PrivateFiles, secret: () => Promise<string>) {
    this.#files = files;
    this.#secret = secret;
  }

  async write(responseId: string, fileId: string, bytes: Uint8Array): Promise<void> {
    await this.#files.write(`${responseId}/${fileId}`, sealFile(await this.#secret(), bytes));
  }

  async read(responseId: string, fileId: string): Promise<Uint8Array | undefined> {
    const sealed = await this.#files.read(`${responseId}/${fileId}`);
    return sealed && openFile(await this.#secret(), sealed);
  }

  /** Deletes the files of one message. A file that will not go is logged, and the others still go. */
  async remove(responseId: string, files: Pick<FormFile, "id">[]): Promise<void> {
    for (const file of files) {
      await this.#files.remove(`${responseId}/${file.id}`).catch((error: unknown) => {
        console.error("[brim] A form file was not deleted:", error instanceof Error ? error.message : error);
      });
    }
  }
}

/**
 * A visitor's file as the editor's API hands it to someone who may read messages: always a download, never a page.
 * The browser is told its real kind and forbidden to guess another, to run or load anything from it, or to keep it.
 */
export function fileDownload(file: FormFile, bytes: Uint8Array): Response {
  const type = (Object.keys(FILE_TYPES) as FileType[]).find((key) => FILE_TYPES[key].mime === file.mime);
  const name = safeFileName(file.name, type ?? "pdf");
  // The plain name for old clients, the full one (RFC 5987) for the rest; both are free of quotes and line ends.
  const plain = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": type ? file.mime : "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "no-store, private",
      "cross-origin-resource-policy": "same-origin",
      "x-robots-tag": "noindex",
    },
  });
}
