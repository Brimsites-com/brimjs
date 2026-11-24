/**
 * Files visitors attach to a form's message. Forms are the one place where anyone at all writes to the site, so
 * every choice here is the narrow one:
 * - a file is what its first bytes say it is, never what its name or declared type says, and only kinds that a
 *   browser cannot run are taken (no SVG, HTML, scripts, archives, office documents or executables);
 * - its stored name is generated; the name the visitor gave is kept only as text, cleaned;
 * - it is kept outside everything the site serves (never under `/uploads`, never in the media library), sealed with
 *   a key of the site's database, and read back only through the editor's API by a role that may read messages.
 */
export const FILE_TYPES = {
  pdf: { mime: "application/pdf", extension: "pdf", label: "PDF" },
  jpg: { mime: "image/jpeg", extension: "jpg", label: "JPEG" },
  png: { mime: "image/png", extension: "png", label: "PNG" },
  webp: { mime: "image/webp", extension: "webp", label: "WebP" },
  gif: { mime: "image/gif", extension: "gif", label: "GIF" },
} as const;

export type FileType = keyof typeof FILE_TYPES;

/** What a file field takes when it does not say: documents and photos. A GIF is taken only when the field asks. */
export const DEFAULT_FILE_TYPES: FileType[] = ["pdf", "jpg", "png", "webp"];

/** One file, at most. A phone's photo is 3 to 6 MB. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/**
 * All the files of one message. The server refuses any request above a little over 10 MB (the adapter's
 * `bodySizeLimit`), so a message cannot be allowed more than that.
 */
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
/** The files of one message, over all its file fields; one field takes 1, or this many when it is `multiple`. */
export const MAX_FILES = 5;
/** What the other fields of a message may weigh beside its files: the spec, the answers, the multipart framing. */
export const MAX_FIELDS_BYTES = 512 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[], at = 0): boolean =>
  signature.every((byte, index) => bytes[at + index] === byte);
const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const SIGNATURES: Record<FileType, (bytes: Uint8Array) => boolean> = {
  // "%PDF-" at the very start: readers accept it a little further in, which is how a file is two things at once.
  pdf: (bytes) => ascii(bytes, 0, 5) === "%PDF-",
  jpg: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  png: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: (bytes) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP",
  gif: (bytes) => ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a",
};

/** The kind of file these bytes are, by how they start; `undefined` for anything Brim does not take. */
export function sniffFileType(bytes: Uint8Array): FileType | undefined {
  return (Object.keys(SIGNATURES) as FileType[]).find((type) => SIGNATURES[type](bytes));
}

/**
 * The kinds a field takes, from what its author wrote (`["pdf", "jpg"]`, or `"pdf, .jpg, image/png"` as BrimCMS
 * kept it). Anything that is not one of Brim's kinds is dropped; a field left with none takes the default ones, so
 * a mistake can only ever narrow what is taken, never widen it.
 */
export function fileTypes(accept: unknown): FileType[] {
  const words = (Array.isArray(accept) ? accept : typeof accept === "string" ? accept.split(/[\s,]+/) : [])
    .filter((word): word is string => typeof word === "string")
    .map((word) => word.trim().toLowerCase().replace(/^\./, ""));
  const known = (Object.keys(FILE_TYPES) as FileType[]).filter(
    (type) =>
      words.includes(type) || words.includes(FILE_TYPES[type].mime) || (type === "jpg" && words.includes("jpeg")),
  );
  return known.length > 0 ? known : DEFAULT_FILE_TYPES;
}

/** The `accept` of the field's input: a hint for the visitor's file picker; the server checks the bytes. */
export function acceptAttribute(types: FileType[]): string {
  return types.map((type) => `.${FILE_TYPES[type].extension}`).join(",");
}

/**
 * The name a visitor's file had, as text safe to keep and show: no folders, no control characters, nothing a
 * header or a file system reads as more than a name, and the extension of what the file really is. It is never
 * used to store the file.
 */
export function safeFileName(name: string, type: FileType): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    // Control characters, and the ones that end a header value or a path, or flip the reading direction.
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069"<>:|?*%;]/g, "")
    .replace(/\.[^.]*$/, "")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 100);
  return `${base || "file"}.${FILE_TYPES[type].extension}`;
}

/** A file kept with a message: what the editor lists. Its bytes are read through the API, by its ids. */
export interface FormFile {
  id: string;
  /** The label of the field it answers. */
  label: string;
  /** The name it had on the visitor's computer, cleaned (`safeFileName`). */
  name: string;
  mime: string;
  size: number;
}

/** `1.4 MB`, `320 KB`: a file's size as people read it. */
export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
