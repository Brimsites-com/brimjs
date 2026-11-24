import type { VideoUploadsOptions } from "../config.ts";
import { ValidationError } from "../content/validate.ts";
import { HttpError } from "./http.ts";

/** What the editor says about a video before uploading it. */
export interface NewVideo {
  name: string;
  size: number;
  type: string;
}

/** One uploaded video, as the host lists it. */
export interface HostedVideo {
  id: string;
  name: string;
  /** In bytes. */
  size: number;
  status: "processing" | "ready" | "failed";
  url: string;
  posterUrl: string | null;
  /** An ISO date, or "" when the host did not say. */
  createdAt: string;
}

const HOST_TIMEOUT_MS = 20_000;
const MAX_NAME = 255;
/** Ids are the host's own; this only keeps them from changing the address that is asked. */
const VIDEO_ID = /^[A-Za-z0-9._~-]{1,200}$/;
/** What a host that does not know a call answers: the call is optional, so this is not an error. */
const NOT_SUPPORTED = [404, 405, 501];

/** One entry of the host's list, or `undefined` when it is not a video the editor could use or delete. */
function hostedVideo(entry: unknown): HostedVideo | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const { id, name, size, status, url, posterUrl, createdAt } = entry as Record<string, unknown>;
  if (typeof id !== "string" || !VIDEO_ID.test(id) || typeof url !== "string") return undefined;
  if (status !== "processing" && status !== "ready" && status !== "failed") return undefined;
  return {
    id,
    name: typeof name === "string" ? name : "",
    size: typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0,
    status,
    url,
    posterUrl: typeof posterUrl === "string" ? posterUrl : null,
    createdAt: typeof createdAt === "string" ? createdAt : "",
  };
}

export function parseNewVideo(body: Record<string, unknown>): NewVideo {
  const { name, size, type } = body;
  if (typeof name !== "string" || name.trim() === "" || name.length > MAX_NAME) {
    throw new ValidationError(`"name" must be the file's name, at most ${MAX_NAME} characters.`);
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    throw new ValidationError('"size" must be the file\'s size in bytes.');
  }
  if (typeof type !== "string" || !/^video\/[\w.+-]+$/i.test(type)) {
    throw new ValidationError("Only video files can be uploaded here.");
  }
  return { name: name.trim(), size, type: type.toLowerCase() };
}

/**
 * The video host of a site: any service that answers the calls below (see "Video uploads" in the README).
 * The site's server talks to it; the browser only ever gets the upload address the host hands out.
 */
export class VideoHost {
  readonly #url: string;
  readonly #token: string | undefined;
  readonly #fetch: typeof fetch;

  private constructor(url: string, token: string | undefined, fetchImpl: typeof fetch) {
    this.#url = url.replace(/\/+$/, "");
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  /** `undefined` when no host is set up, or its address cannot be used: the feature is then off. */
  static from(options: VideoUploadsOptions | undefined, fetchImpl: typeof fetch = fetch): VideoHost | undefined {
    const url = options?.url?.trim();
    if (!url || !URL.canParse(url)) return undefined;
    const { protocol, hostname } = new URL(url);
    // The token travels with every call, so the address is HTTPS; a host on this machine is for development.
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (protocol !== "https:" && !(protocol === "http:" && local)) return undefined;
    return new VideoHost(url, options?.token || undefined, fetchImpl);
  }

  /** Asks for a place to upload a video. Answers what the host answered: `id`, `upload`, `url`, `posterUrl`. */
  async create(video: NewVideo): Promise<Record<string, unknown>> {
    const answer = await this.#call("POST", this.#url, video);
    const upload = answer.upload as Record<string, unknown> | undefined;
    if (typeof answer.id !== "string" || typeof upload?.endpoint !== "string") {
      throw new HttpError(502, "The video host gave an answer Brim does not understand.");
    }
    return answer;
  }

  /** Where a video is: `processing`, `ready` or `failed`, with its progress and the address to play. */
  async status(id: string): Promise<Record<string, unknown>> {
    if (!VIDEO_ID.test(id)) throw new HttpError(404, "This video does not exist.");
    return this.#call("GET", `${this.#url}/${encodeURIComponent(id)}`);
  }

  /**
   * The site's uploaded videos, newest first as the host orders them. `undefined` when the host does not list
   * videos: listing is optional for a host, and the editor then shows no list.
   */
  async list(): Promise<HostedVideo[] | undefined> {
    let answer: Record<string, unknown>;
    try {
      answer = await this.#call("GET", this.#url);
    } catch (failure) {
      if (failure instanceof HttpError && NOT_SUPPORTED.includes(failure.status)) return undefined;
      throw failure;
    }
    if (!Array.isArray(answer.videos)) {
      throw new HttpError(502, "The video host gave an answer Brim does not understand.");
    }
    return answer.videos.map(hostedVideo).filter((video) => video !== undefined);
  }

  /** Removes a video from the host for good. Pages that still show it stop playing it. */
  async delete(id: string): Promise<void> {
    if (!VIDEO_ID.test(id)) throw new HttpError(404, "This video does not exist.");
    await this.#call("DELETE", `${this.#url}/${encodeURIComponent(id)}`, undefined, true);
  }

  /** `empty` lets a successful answer have no body, as a 204 does. */
  async #call(method: string, url: string, body?: unknown, empty = false): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(this.#token && { authorization: `Bearer ${this.#token}` }),
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, "The video host did not answer. Try again in a moment.");
    }
    const answer = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!response.ok) {
      // The host's own words are meant for the person uploading; its status says whose fault it was.
      const message =
        typeof answer?.error === "string" && answer.error ? answer.error : "The video host refused the request.";
      // Not 401 or 403 though: those would say the editor's own sign-in failed, when it is the site's token.
      const passed = response.status >= 400 && response.status < 600 && ![401, 403].includes(response.status);
      throw new HttpError(passed ? response.status : 502, message);
    }
    if (answer === undefined && empty) return {};
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      throw new HttpError(502, "The video host gave an answer Brim does not understand.");
    }
    return answer;
  }
}
