import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { verifyPassword } from "../auth/password.ts";
import { readBytes } from "../server/http.ts";
import type { RateLimiter } from "../server/rate-limit.ts";

/** Wrong passwords a visitor may try on one page in ten minutes. */
const ATTEMPTS = 10;
const WINDOW_SECONDS = 10 * 60;
/** How long a visitor who gave the password keeps the page open. */
const ACCESS_SECONDS = 30 * 24 * 60 * 60;
const FIELD = "brim_page_password";
const MAX_FORM_BYTES = 16 * 1024;

export interface PageGate {
  request: Request;
  /** The page's address, normalized. */
  path: string;
  /** The page's hashed password; a new password closes the page again for everyone who had the old one. */
  hash: string;
  /** The site's secret, which signs the visitor's access. */
  secret: string;
  /** False in a static build, where no server is there to ask: the page is left out instead. */
  server: boolean;
  clientAddress: string | undefined;
  rateLimiter: RateLimiter;
  siteName: string | undefined;
}

/**
 * Whether a visitor may see a password-protected page: `undefined` when they may (they gave the password before),
 * else the response to send: the password form, the form again with a message, or a redirect once they gave it.
 */
export async function pageGate(gate: PageGate): Promise<Response | undefined> {
  const { request, path } = gate;
  if (!gate.server)
    return gatePage(gate, "This page is protected with a password, so it is not part of this site.", false);
  const cookie = accessCookieName(path);
  const token = accessToken(gate);
  if (readCookies(request, cookie).some((value) => sameText(value, token))) return undefined;

  if (request.method !== "POST") return gatePage(gate, undefined, true);
  const limit = `page-password:${gate.clientAddress ?? "unknown"}:${path}`;
  if (await gate.rateLimiter.exhausted(limit, ATTEMPTS, WINDOW_SECONDS)) {
    return gatePage(gate, "Too many attempts. Try again in a few minutes.", true, 429);
  }
  // The form holds one short field; anything larger is not it, and is refused before it is held in memory.
  const form = await readBytes(request, MAX_FORM_BYTES)
    .then((bytes) =>
      new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(),
    )
    .catch(() => undefined);
  const password = form?.get(FIELD); // betterleaks:allow
  // Only wrong passwords are counted, so visitors who share an address do not use up each other's attempts.
  if (typeof password !== "string" || !(await verifyPassword(password, gate.hash))) {
    await gate.rateLimiter.allow(limit, ATTEMPTS, WINDOW_SECONDS);
    return gatePage(gate, "That password is not right.", true);
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(request.url).pathname + new URL(request.url).search,
      "set-cookie": `${cookie}=${token}; Path=${path}; Max-Age=${ACCESS_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
      "cache-control": "no-store",
    },
  });
}

/** One cookie per page, so opening one protected page opens no other. */
export function accessCookieName(path: string): string {
  return `brim_page_${createHash("sha256").update(path).digest("base64url").slice(0, 16)}`;
}

function accessToken({ path, hash, secret }: PageGate): string {
  return createHmac("sha256", secret).update(`page-access\n${path}\n${hash}`).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookies(request: Request, name: string): string[] {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([key]) => key === name)
    .map(([, ...value]) => value.join("="));
}

/** The page a visitor sees instead of the protected one: its own small page, with nothing of the site's content. */
function gatePage(gate: PageGate, message: string | undefined, form: boolean, status = 401): Response {
  const title = gate.siteName ? `Protected page · ${escape(gate.siteName)}` : "Protected page";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f5; color: #18181b;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(22rem, calc(100% - 2rem)); padding: 2rem; border: 1px solid #e4e4e7; border-radius: 1rem;
    background: #fff; }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  p { margin: 0 0 1.25rem; color: #52525b; }
  .message { color: #b91c1c; }
  label { display: block; margin-bottom: 0.35rem; font-size: 0.875rem; font-weight: 600; }
  input { box-sizing: border-box; width: 100%; padding: 0.65rem 0.75rem; border: 1px solid #d4d4d8; border-radius: 0.5rem;
    font: inherit; }
  button { width: 100%; margin-top: 1rem; padding: 0.7rem; border: 0; border-radius: 0.5rem; background: #18181b;
    color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>This page is protected</h1>
  ${message ? `<p class="message" role="alert">${escape(message)}</p>` : form ? "<p>Enter the password to open it.</p>" : ""}
  ${
    form
      ? `<form method="post">
    <label for="password">Password</label>
    <input id="password" name="${FIELD}" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Open page</button>
  </form>`
      : ""
  }
</main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
