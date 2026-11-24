import type { User } from "../auth/accounts.ts";
import type { Brim } from "../runtime/connect.ts";
import { readCookies } from "./http.ts";

export const SESSION_COOKIE = "brim_session";

/**
 * Every session cookie the browser sent. Usually one; an old one kept under /admin (before the cookie covered the
 * whole site), or one from another Brim site on another port of localhost, comes along with it.
 */
export function sessionCookies(request: Request): string[] {
  return readCookies(request, SESSION_COOKIE).filter(Boolean);
}

export function bearerToken(request: Request): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1];
}

/** The user behind a request: an access token from `brim token add`, or the editor's session cookie. */
export async function requestUser(brim: Brim, request: Request): Promise<User | undefined> {
  const bearer = bearerToken(request);
  if (bearer) return brim.accounts.tokenUser(bearer);
  // The first cookie that is a live session of this site wins; a stale one sent before it no longer signs the
  // editor out.
  for (const session of sessionCookies(request)) {
    const user = await brim.accounts.sessionUser(session);
    if (user) return user;
  }
  return undefined;
}
