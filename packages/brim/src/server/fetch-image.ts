import { lookup as lookupCallback, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { MAX_UPLOAD_BYTES } from "../content/media.ts";

/** An image fetched from the web for the media library: its bytes and the name its address gives it. */
export interface FetchedImage {
  bytes: Uint8Array;
  name: string;
}

type Lookup = (host: string) => Promise<{ address: string }[]>;

const MAX_REDIRECTS = 3;

/**
 * Fetches an image from a public web address, for an AI agent moving a site's pictures into its media library.
 * The server does the fetching, so it refuses addresses inside its own network (localhost, private ranges, cloud
 * metadata): a token holder must not reach what only the server can. Redirects are followed by hand, each checked
 * the same way, and the answer must be an image of at most 10 MB.
 */
export async function fetchImage(
  address: string,
  fetcher: typeof fetch = pinnedFetch,
  resolve: Lookup = (host) => lookup(host, { all: true }),
  /**
   * The image type whoever gave the address says the file has, for a store that serves every file as
   * `application/octet-stream` (a chat app's link to a file the person attached). The upload checks the bytes anyway.
   */
  declaredType?: string,
): Promise<FetchedImage> {
  let url = parseAddress(address);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url, resolve);
    const response = await fetcher(url, { redirect: "manual", headers: { accept: "image/*" } });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = parseAddress(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`${url.href} answered ${response.status}.`);
    const served = response.headers.get("content-type") ?? "";
    const generic = served === "" || served.startsWith("application/octet-stream") || served.startsWith("binary/");
    const type = generic && declaredType?.startsWith("image/") ? declaredType : served;
    if (!type.startsWith("image/")) throw new Error(`${url.origin}${url.pathname} is not an image (${served || "no content type"}).`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) throw tooLarge();
    return { bytes: await readLimited(response), name: decodeURIComponent(url.pathname.split("/").pop() || "image") };
  }
  throw new Error(`${address} redirects more than ${MAX_REDIRECTS} times.`);
}

/**
 * A GET that checks the address it actually connects to. Checking the name first and letting `fetch` resolve it
 * again leaves a gap: a name can answer a public address to the check and a private one to the connection (DNS
 * rebinding). Here the connection's own lookup refuses private addresses, so what is checked is what is reached.
 */
export async function pinnedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  return new Promise((resolvePromise, reject) => {
    const outgoing = request(
      url,
      {
        method: "GET",
        headers,
        timeout: 15_000,
        lookup: (hostname, options, callback) => {
          lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) return callback(error, "", 0);
            const list = addresses as unknown as LookupAddress[];
            const usable = list.filter((entry) => !isPrivate(entry.address));
            if (usable.length === 0 || usable.length !== list.length) {
              return callback(new Error(`${hostname} is not a public address.`), "", 0);
            }
            if ((options as { all?: boolean }).all) return (callback as (e: null, a: LookupAddress[]) => void)(null, usable);
            const first = usable[0]!;
            callback(null, first.address, first.family);
          });
        },
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          for (const one of Array.isArray(value) ? value : [value]) responseHeaders.append(name, one);
        }
        const status = incoming.statusCode ?? 502;
        const body = status === 204 || status === 304 ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
        resolvePromise(new Response(body, { status, headers: responseHeaders }));
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error(`${url.host} did not answer in time.`)));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function parseAddress(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error(`"${address}" is not a web address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Only http and https addresses can be fetched.");
  if (url.username || url.password) throw new Error("An address with a user name or password cannot be fetched.");
  return url;
}

/** Refuses a host name that is, or resolves to, an address inside the server's own network. */
export async function assertPublicHost(
  host: string,
  resolve: Lookup = (name) => lookup(name, { all: true }),
): Promise<void> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.toLowerCase() === "localhost" || bare.toLowerCase().endsWith(".localhost")) {
    throw new Error(`${host} is not a public address.`);
  }
  const addresses = isIP(bare) ? [bare] : (await resolve(bare)).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isPrivate)) throw new Error(`${host} is not a public address.`);
}

async function assertPublic(url: URL, resolve: Lookup): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await resolve(host)).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isPrivate)) {
    throw new Error(`${url.host} is not a public address; upload the file with \`npx brim media add\` instead.`);
  }
}

/** Loopback, private, link-local, carrier-grade NAT and unspecified addresses, in IPv4 and IPv6. */
export function isPrivate(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPrivate(mapped);
  // An IPv6 address that carries an IPv4 one (mapped ::ffff:0:0/96, NAT64 64:ff9b::/96, compatible ::/96) reaches
  // that IPv4 address. The URL parser writes them in hex (`[::ffff:127.0.0.1]` becomes `::ffff:7f00:1`), so they are
  // read from the address's bytes, not from its spelling.
  const embedded = isIP(address) === 6 ? embeddedIPv4(address) : undefined;
  if (embedded) return isPrivate(embedded);
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
}

/** The IPv4 address inside an IPv4-mapped, NAT64 or IPv4-compatible IPv6 address, as a dotted string. */
function embeddedIPv4(address: string): string | undefined {
  const bytes = ipv6Bytes(address);
  if (!bytes) return undefined;
  const head = bytes.slice(0, 12);
  const zero = (from: number, to: number) => head.slice(from, to).every((byte) => byte === 0);
  const isMapped = zero(0, 10) && head[10] === 0xff && head[11] === 0xff;
  const isNat64 = head[0] === 0x00 && head[1] === 0x64 && head[2] === 0xff && head[3] === 0x9b && zero(4, 12);
  const isCompatible = zero(0, 12) && bytes.slice(12).some((byte) => byte !== 0);
  if (!isMapped && !isNat64 && !isCompatible) return undefined;
  return bytes.slice(12).join(".");
}

/** The 16 bytes of an IPv6 address (with `::` and a dotted IPv4 tail allowed), or undefined when it is not one. */
function ipv6Bytes(address: string): number[] | undefined {
  let text = address.replace(/%.*$/, "").toLowerCase();
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (tail) {
    const parts = tail.split(".").map(Number);
    text = `${text.slice(0, -tail.length)}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string | undefined) => (part ? part.split(":") : []);
  const left = groups(halves[0]);
  const right = groups(halves[1]);
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return undefined;
  const all = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...right];
  const bytes: number[] = [];
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw tooLarge();
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

function tooLarge(): Error {
  return new Error("The image is larger than 10 MB.");
}
