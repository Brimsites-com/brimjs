/**
 * A small client for the tus resumable upload protocol (https://tus.io, version 1.0.0): one request creates
 * the upload, then the file goes up in pieces. Only one piece is ever read from the file at a time, so a
 * video of a few gigabytes never sits in memory.
 */

/** Where and how to upload, as a video host hands it out. */
export interface TusTarget {
  endpoint: string;
  /** Sent with every request: the host's own way of knowing the upload is allowed. */
  headers?: Record<string, string>;
  /** Sent once, as `Upload-Metadata`, when the upload is created. */
  metadata?: Record<string, string>;
}

export interface TusOptions {
  /** Bytes per request. Progress is reported after each one. */
  chunkSize?: number;
  /** Aborting it stops the upload; the returned promise rejects with the signal's reason. */
  signal?: AbortSignal;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** How often one piece is tried again after the connection or the server failed. */
  retries?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

export class TusError extends Error {}

const VERSION = "1.0.0";
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

/** `Upload-Metadata`: `key base64(value)` pairs, separated by commas. */
export function encodeMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => {
      const bytes = new TextEncoder().encode(String(value));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return `${key} ${btoa(binary)}`;
    })
    .join(",");
}

/** Uploads `file` and resolves to the address of the finished upload. */
export async function tusUpload(file: Blob, target: TusTarget, options: TusOptions = {}): Promise<string> {
  const send = options.fetch ?? fetch;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const retries = options.retries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1500;
  const { signal } = options;
  const common = { ...target.headers, "Tus-Resumable": VERSION };
  const request = (url: string, init: RequestInit): Promise<Response> =>
    send(url, { ...init, ...(signal && { signal }) });

  const metadata = encodeMetadata(target.metadata ?? {});
  const created = await request(target.endpoint, {
    method: "POST",
    headers: { ...common, "Upload-Length": String(file.size), ...(metadata && { "Upload-Metadata": metadata }) },
  });
  const location = created.headers.get("location");
  if (created.status !== 201 || !location) {
    throw new TusError(await failure(created, "The video host did not accept the upload."));
  }
  const uploadUrl = new URL(location, target.endpoint).href;

  /** Where the server says the upload is, after a piece may or may not have arrived. */
  async function serverOffset(): Promise<number> {
    const head = await request(uploadUrl, { method: "HEAD", headers: common });
    const offset = Number(head.headers.get("upload-offset"));
    if (!head.ok || !Number.isSafeInteger(offset)) throw new TusError("The upload was lost. Start it again.");
    return offset;
  }

  let offset = 0;
  let attempt = 0;
  options.onProgress?.(0, file.size);
  while (offset < file.size) {
    const piece = file.slice(offset, offset + chunkSize);
    try {
      const response = await request(uploadUrl, {
        method: "PATCH",
        headers: { ...common, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
        body: piece,
      });
      if (response.status >= 500 || response.status === 409 || response.status === 423) {
        throw new RetryableError(await failure(response, "The upload was interrupted."));
      }
      if (!response.ok) throw new TusError(await failure(response, "The video host refused the upload."));
      // A host that does not let the page read the header still took the whole piece.
      const reported = Number(response.headers.get("upload-offset") ?? Number.NaN);
      offset = Number.isSafeInteger(reported) && reported > offset ? reported : offset + piece.size;
      attempt = 0;
      options.onProgress?.(Math.min(offset, file.size), file.size);
    } catch (error) {
      if (signal?.aborted || error instanceof TusError) throw error;
      // The connection dropped or the server stumbled: ask where it got to and go on from there.
      if (++attempt > retries) {
        throw new TusError(
          error instanceof RetryableError ? error.message : "The connection was lost during the upload.",
        );
      }
      await wait(retryDelayMs * attempt, signal);
      // If even that cannot be asked, the same piece is tried again.
      offset = await serverOffset().catch((lost) => {
        if (signal?.aborted) throw lost;
        return offset;
      });
    }
  }
  return uploadUrl;
}

class RetryableError extends Error {}

/** What a refused request says about itself, when it says anything a person can read. */
async function failure(response: Response, fallback: string): Promise<string> {
  const text = (await response.text().catch(() => "")).trim();
  try {
    const answer = JSON.parse(text) as { error?: unknown; message?: unknown };
    const said = answer.error ?? answer.message;
    if (typeof said === "string" && said) return said;
  } catch {
    // Not JSON: tus servers answer in plain text.
  }
  return text && text.length < 200 && !text.startsWith("<") ? text : fallback;
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
