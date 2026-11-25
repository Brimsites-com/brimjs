export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY_BYTES = 64 * 1024;

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * The request's body, up to `max` bytes. A larger one is refused as soon as it is known to be larger: by its
 * declared length before anything is read, else while reading, so no more than `max` is ever held in memory.
 */
export async function readBytes(
  request: Request,
  max: number,
  tooLarge = "The request is too large.",
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new HttpError(413, tooLarge);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** `maxBytes` raises the limit for the few requests that carry a lot at once, such as a site's seed. */
export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HttpError(415, "Send the request as JSON.");
  }
  const text = new TextDecoder().decode(await readBytes(request, maxBytes));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "The request must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function readCookie(request: Request, name: string): string | undefined {
  return readCookies(request, name)[0];
}

/**
 * Every value the browser sent under `name`, in its order. A browser can hold several cookies of one name, for
 * different paths or set by another app on the same host (every port of localhost shares cookies), and sends the
 * most specific path first.
 */
export function readCookies(request: Request, name: string): string[] {
  const values: string[] = [];
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) values.push(value.join("="));
  }
  return values;
}

/**
 * The site's public address as it was set: by its host (`BRIM_SITE_URL`, its own domain on Brimsites), else by its
 * code (`site` in the Astro config).
 */
export function givenOrigin(siteUrl?: string | URL): string | undefined {
  for (const value of [process.env.BRIM_SITE_URL, siteUrl]) {
    try {
      const url = new URL(String(value ?? "").trim());
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Not set, or not an address: the next one says it.
    }
  }
  return undefined;
}

/**
 * The site's public address, as it was set or else as the request names it. Never the server's own address behind a
 * proxy (`localhost:43967`), which `request.url` holds there. Only for an answer to whoever asked: what is sent to
 * someone else takes `trustedOrigin`.
 */
export function publicOrigin(request: Request, siteUrl?: string | URL): string {
  return givenOrigin(siteUrl) ?? requestOrigin(request);
}

/**
 * The site's public address for what reaches someone other than the sender of the request (emails): the one that was
 * set. The request's own `Host` is its sender's to write, so it is believed only on this computer, and otherwise
 * there is none.
 */
export function trustedOrigin(request: Request, siteUrl?: string | URL): string | undefined {
  const given = givenOrigin(siteUrl);
  if (given) return given;
  const origin = requestOrigin(request);
  return URL.canParse(origin) && isLocalHost(new URL(origin).hostname) ? origin : undefined;
}

export function isLocalHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname) || hostname.endsWith(".localhost");
}

/**
 * The address the visitor used. A server behind a reverse proxy, or one that does not trust the `Host` header
 * for building URLs, sees an internal address in `request.url`; the visitor's browser names the real one in
 * `Host`, and a proxy in `X-Forwarded-Host` / `X-Forwarded-Proto`. A page of another site cannot change these
 * headers on a request its visitor's browser sends, so they are safe to compare `Origin` with.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (name: string) => request.headers.get(name)?.split(",")[0]?.trim() || undefined;
  const protocol = first("x-forwarded-proto");
  const scheme = protocol === "https" || protocol === "http" ? protocol : url.protocol.slice(0, -1);
  return `${scheme}://${first("x-forwarded-host") ?? first("host") ?? url.host}`;
}

/**
 * The visitor's address, which the limits on wrong passwords and form messages count by. Behind a reverse proxy the
 * connection comes from the proxy, so every visitor would share one address: `BRIM_CLIENT_IP_HEADER` names the
 * header in which the proxy gives the visitor's own (e.g. `x-real-ip`). Set it only when the proxy always writes
 * that header itself, or a visitor could write any address there.
 */
export function clientAddress(request: Request, connection: string): string {
  const header = process.env.BRIM_CLIENT_IP_HEADER?.trim();
  const given = header ? request.headers.get(header)?.split(",")[0]?.trim() : undefined;
  return given && given.length <= 64 ? given : connection;
}

/** A browser sends `Origin` on every state-changing request; another site's page cannot fake ours. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  // Hosts are compared, not schemes: a proxy that ends TLS may not say so, and the browser's `Origin` does.
  if (!origin || !URL.canParse(origin) || new URL(origin).host !== new URL(requestOrigin(request)).host) {
    throw new HttpError(403, "This request did not come from the site itself.");
  }
}
