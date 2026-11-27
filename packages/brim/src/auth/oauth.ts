import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Database, Row } from "../db/database.ts";
import type { Role, User } from "./accounts.ts";

/**
 * OAuth 2.1 for the site's MCP, so an AI app (ChatGPT, Claude, any MCP client) connects with the user signing in and
 * saying yes, instead of a token pasted by hand. The app registers itself (RFC 7591), the user allows it on the site
 * (authorization code with PKCE), and the app gets a short access token and a refresh token, which it trades for a
 * new pair whenever the access token runs out. The connection lasts until the user disconnects it, changes their
 * password or is removed: nothing ends it on a schedule.
 *
 * Every token is kept only as a hash. An access token acts as its user, with their role, like an access token from
 * `brim token add`.
 */

/** How long an access token works before the app refreshes it. */
export const ACCESS_TOKEN_SECONDS = 60 * 60; // betterleaks:allow
/** How long the one-time code of a sign-in waits for the app to trade it. */
const CODE_SECONDS = 5 * 60;
/**
 * A refresh token that was just replaced still works this long: an app whose answer got lost on the way asks again
 * with the one it holds, and its connection should not break for that.
 */
const REFRESH_GRACE_SECONDS = 2 * 60;
/** An app that registered and never got connected is forgotten after a day. */
const UNUSED_CLIENT_SECONDS = 24 * 60 * 60;
/** `last_used_at` moves at most this often, so a busy app does not write on every request. */
const LAST_USED_STEP_SECONDS = 5 * 60;

const ACCESS_PREFIX = "brim_at_"; // betterleaks:allow
const REFRESH_PREFIX = "brim_rt_"; // betterleaks:allow
const CLIENT_PREFIX = "brimc_";
const SECRET_PREFIX = "brim_cs_"; // betterleaks:allow

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const MAX_CLIENT_NAME = 100;
/** Schemes a redirect can never go to: they run code or read files instead of opening an app. */
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"]);

export type ClientAuthMethod = "none" | "client_secret_post" | "client_secret_basic";
const AUTH_METHODS: readonly ClientAuthMethod[] = ["none", "client_secret_post", "client_secret_basic"]; // betterleaks:allow

/** An error an OAuth endpoint answers with, in the shape RFC 6749 gives it. */
export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, description: string, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  /** Whether the app proves itself with a secret at the token endpoint. */
  confidential: boolean;
}

export interface RegisteredClient extends OAuthClient {
  /** Shown once, to the app that registered. */
  clientSecret?: string;
  authMethod: ClientAuthMethod;
  createdAt: string;
}

export interface TokenPair {
  access_token: string; // betterleaks:allow
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string; // betterleaks:allow
}

/** A connection as listed: who allowed which app, never its tokens. */
export interface OAuthConnection {
  id: string;
  app: string;
  /** Where the app sends people back to (`chatgpt.com`), the part of its name nobody else can claim. */
  appHost: string;
  email: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export class OAuthStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  static isAccessToken(token: string): boolean {
    return token.startsWith(ACCESS_PREFIX);
  }

  /** Dynamic client registration (RFC 7591): any app may register; a user still has to allow it. */
  async register(body: Record<string, unknown>): Promise<RegisteredClient> {
    const redirectUris = parseRedirectUris(body.redirect_uris);
    const name = cleanName(body.client_name) || new URL(redirectUris[0]!).host || "An app";
    const authMethod = (body.token_endpoint_auth_method ?? "client_secret_basic") as ClientAuthMethod;
    if (!AUTH_METHODS.includes(authMethod)) {
      throw new OAuthError("invalid_client_metadata", `token_endpoint_auth_method is one of ${AUTH_METHODS.join(", ")}.`);
    }
    const grantTypes = body.grant_types;
    if (grantTypes !== undefined) {
      if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code")) {
        throw new OAuthError("invalid_client_metadata", 'grant_types must include "authorization_code".');
      }
    }
    const responseTypes = body.response_types;
    if (responseTypes !== undefined && (!Array.isArray(responseTypes) || !responseTypes.includes("code"))) {
      throw new OAuthError("invalid_client_metadata", 'response_types must include "code".');
    }

    const clientId = CLIENT_PREFIX + randomBytes(16).toString("base64url");
    const clientSecret = authMethod === "none" ? undefined : SECRET_PREFIX + randomBytes(32).toString("base64url"); // betterleaks:allow
    const createdAt = new Date().toISOString();
    await this.#db.batch([
      // Apps that registered and were never allowed by anyone leave no trace.
      {
        sql: `DELETE FROM brim_oauth_clients WHERE created_at < ?
              AND client_id NOT IN (SELECT client_id FROM brim_oauth_grants)
              AND client_id NOT IN (SELECT client_id FROM brim_oauth_codes)`,
        args: [new Date(Date.now() - UNUSED_CLIENT_SECONDS * 1000).toISOString()],
      },
      {
        sql: "INSERT INTO brim_oauth_clients (client_id, secret_hash, name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [clientId, clientSecret ? hash(clientSecret) : null, name, JSON.stringify(redirectUris), createdAt],
      },
    ]);
    return {
      clientId,
      name,
      redirectUris,
      confidential: clientSecret !== undefined,
      authMethod,
      createdAt,
      ...(clientSecret && { clientSecret }),
    };
  }

  async client(clientId: string): Promise<OAuthClient | undefined> {
    const rows = await this.#db.query("SELECT client_id, secret_hash, name, redirect_uris FROM brim_oauth_clients WHERE client_id = ?", [
      clientId,
    ]);
    const row = rows[0];
    return row ? clientOf(row) : undefined;
  }

  /**
   * The app at the token endpoint, proving itself with its secret when it has one. `secret` is what it sent, in the
   * body or in Basic authentication.
   */
  async authenticateClient(clientId: string, secret: string | undefined): Promise<OAuthClient> {
    const rows = await this.#db.query("SELECT client_id, secret_hash, name, redirect_uris FROM brim_oauth_clients WHERE client_id = ?", [
      clientId,
    ]);
    const row = rows[0];
    if (!row) throw new OAuthError("invalid_client", "This app is not registered here.", 401);
    if (row.secret_hash !== null && (secret === undefined || !sameHash(hash(secret), String(row.secret_hash)))) {
      throw new OAuthError("invalid_client", "The app's secret is wrong.", 401);
    }
    return clientOf(row);
  }

  /** A user allowed the app: a one-time code for it to trade, tied to its PKCE challenge and redirect. */
  async createCode(client: OAuthClient, user: User, redirectUri: string, challenge: string): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    await this.#db.batch([
      { sql: "DELETE FROM brim_oauth_codes WHERE expires_at < ?", args: [nowSeconds()] },
      {
        sql: `INSERT INTO brim_oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, expires_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [hash(code), client.clientId, user.id, redirectUri, challenge, nowSeconds() + CODE_SECONDS],
      },
    ]);
    return code;
  }

  /** Trades a code for the first tokens of a new connection. A code works once, used or not. */
  async exchangeCode(client: OAuthClient, code: string, redirectUri: string | undefined, verifier: string): Promise<TokenPair> {
    const rows = await this.#db.query(
      "DELETE FROM brim_oauth_codes WHERE code_hash = ? RETURNING client_id, user_id, redirect_uri, challenge, expires_at",
      [hash(code)],
    );
    const row = rows[0];
    if (!row || Number(row.expires_at) < nowSeconds()) {
      throw new OAuthError("invalid_grant", "The code is wrong, used or too old. Connect again.");
    }
    if (row.client_id !== client.clientId) throw new OAuthError("invalid_grant", "The code was given to another app.");
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new OAuthError("invalid_grant", "redirect_uri is not the one the code was asked with.");
    }
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) || !sameHash(pkceChallenge(verifier), String(row.challenge))) {
      throw new OAuthError("invalid_grant", "code_verifier does not match the code_challenge.");
    }
    const user = await this.#db.query("SELECT 1 FROM brim_users WHERE id = ?", [String(row.user_id)]);
    if (user.length === 0) throw new OAuthError("invalid_grant", "The user who allowed this app is gone.");

    const pair = newPair();
    await this.#db.query(
      `INSERT INTO brim_oauth_grants (id, client_id, user_id, access_hash, access_expires_at, refresh_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        client.clientId,
        String(row.user_id),
        hash(pair.access_token),
        nowSeconds() + ACCESS_TOKEN_SECONDS,
        hash(pair.refresh_token),
        new Date().toISOString(),
      ],
    );
    return pair;
  }

  /**
   * A new pair for a refresh token. The refresh token is replaced each time (rotation); the one just replaced still
   * works for a couple of minutes, for an app that did not get the answer.
   */
  async refresh(client: OAuthClient, refreshToken: string): Promise<TokenPair> { // betterleaks:allow
    if (!refreshToken.startsWith(REFRESH_PREFIX)) throw new OAuthError("invalid_grant", "The refresh token is not valid.");
    const presented = hash(refreshToken);
    const pair = newPair();
    const access = [hash(pair.access_token), nowSeconds() + ACCESS_TOKEN_SECONDS, hash(pair.refresh_token)];
    let rows = await this.#db.query(
      `UPDATE brim_oauth_grants
       SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, previous_refresh_hash = refresh_hash, rotated_at = ?
       WHERE refresh_hash = ? AND client_id = ? RETURNING id`,
      [...access, nowSeconds(), presented, client.clientId],
    );
    if (rows.length === 0) {
      rows = await this.#db.query(
        `UPDATE brim_oauth_grants SET access_hash = ?, access_expires_at = ?, refresh_hash = ?
         WHERE previous_refresh_hash = ? AND client_id = ? AND rotated_at >= ? RETURNING id`,
        [...access, presented, client.clientId, nowSeconds() - REFRESH_GRACE_SECONDS],
      );
    }
    if (rows.length === 0) throw new OAuthError("invalid_grant", "The refresh token is not valid. Connect again.");
    return pair;
  }

  /** The user an access token acts as, while it works. */
  async accessUser(token: string): Promise<User | undefined> {
    if (!OAuthStore.isAccessToken(token)) return undefined;
    const rows = await this.#db.query(
      `SELECT g.id AS grant_id, u.id, u.email, u.role FROM brim_oauth_grants g JOIN brim_users u ON u.id = g.user_id
       WHERE g.access_hash = ? AND g.access_expires_at >= ?`,
      [hash(token), nowSeconds()],
    );
    const row = rows[0];
    if (!row) return undefined;
    await this.#db.query("UPDATE brim_oauth_grants SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)", [
      new Date().toISOString(),
      String(row.grant_id),
      new Date(Date.now() - LAST_USED_STEP_SECONDS * 1000).toISOString(),
    ]);
    return { id: String(row.id), email: String(row.email), role: row.role as Role };
  }

  /** RFC 7009: the app gives up a token, access or refresh, and its connection ends. Unknown tokens are no error. */
  async revokeToken(client: OAuthClient, token: string): Promise<void> {
    const hashed = hash(token);
    await this.#db.query(
      "DELETE FROM brim_oauth_grants WHERE client_id = ? AND (access_hash = ? OR refresh_hash = ? OR previous_refresh_hash = ?)",
      [client.clientId, hashed, hashed, hashed],
    );
  }

  /** The connections of one user, or of everyone when `userId` is left out, newest first. */
  async connections(userId?: string): Promise<OAuthConnection[]> {
    const rows = await this.#db.query(
      `SELECT g.id, g.created_at, g.last_used_at, c.name, c.redirect_uris, u.email
       FROM brim_oauth_grants g
       JOIN brim_oauth_clients c ON c.client_id = g.client_id
       JOIN brim_users u ON u.id = g.user_id
       ${userId ? "WHERE g.user_id = ?" : ""}
       ORDER BY g.created_at DESC`,
      userId ? [userId] : [],
    );
    return rows.map((row) => ({
      id: String(row.id),
      app: String(row.name),
      appHost: redirectHost(JSON.parse(String(row.redirect_uris))[0] ?? ""),
      email: String(row.email),
      createdAt: String(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
    }));
  }

  /** Disconnects one app. With `userId`, only a connection of that user. Returns whether there was one. */
  async disconnect(id: string, userId?: string): Promise<boolean> {
    const rows = await this.#db.query(
      `DELETE FROM brim_oauth_grants WHERE id = ?${userId ? " AND user_id = ?" : ""} RETURNING id`,
      userId ? [id, userId] : [id],
    );
    return rows.length > 0;
  }

  /** Statements that end every connection of a user, for when they change their password or are removed. */
  static endAll(userId: string): { sql: string; args: string[] }[] {
    return [
      { sql: "DELETE FROM brim_oauth_grants WHERE user_id = ?", args: [userId] },
      { sql: "DELETE FROM brim_oauth_codes WHERE user_id = ?", args: [userId] },
    ];
  }
}

/** The S256 challenge of a PKCE verifier (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The host (or app scheme) a redirect address goes back to, as a person reads it. */
export function redirectHost(uri: string): string {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : url.protocol.slice(0, -1);
  } catch {
    return "";
  }
}

function parseRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris is a list of at least one address.");
  }
  if (value.length > MAX_REDIRECT_URIS) {
    throw new OAuthError("invalid_redirect_uri", `redirect_uris holds at most ${MAX_REDIRECT_URIS} addresses.`);
  }
  return value.map((uri) => {
    if (typeof uri !== "string" || uri.length > MAX_URI_LENGTH || !URL.canParse(uri)) {
      throw new OAuthError("invalid_redirect_uri", `${String(uri).slice(0, 100)} is not an address.`);
    }
    const url = new URL(uri);
    if (url.hash) throw new OAuthError("invalid_redirect_uri", "A redirect address has no #fragment.");
    if (BLOCKED_SCHEMES.has(url.protocol)) throw new OAuthError("invalid_redirect_uri", `${url.protocol} addresses are not allowed.`);
    // Plain http only to this computer, where an app listens for its own sign-in (RFC 8252).
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new OAuthError("invalid_redirect_uri", "A redirect address uses https, or http on localhost.");
    }
    return uri;
  });
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is taken out.
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_CLIENT_NAME);
}

function clientOf(row: Row): OAuthClient {
  return {
    clientId: String(row.client_id),
    name: String(row.name),
    redirectUris: JSON.parse(String(row.redirect_uris)) as string[],
    confidential: row.secret_hash !== null,
  };
}

function newPair(): TokenPair {
  return {
    access_token: ACCESS_PREFIX + randomBytes(32).toString("base64url"), // betterleaks:allow
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: REFRESH_PREFIX + randomBytes(32).toString("base64url"), // betterleaks:allow
  };
}

function hash(value: string): string {
  return createHash("sha256").update(`oauth:${value}`).digest("base64url");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
