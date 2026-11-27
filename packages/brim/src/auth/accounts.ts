import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "../db/database.ts";
import { OAuthStore } from "./oauth.ts";
import { MIN_PASSWORD_LENGTH, generatePassword, hashPassword, verifyPassword } from "./password.ts";

/**
 * An owner manages the site; an editor runs its content.
 * What each may do is in `permissions.ts`.
 */
export type Role = "owner" | "editor";
const ROLE_NAMES: readonly Role[] = ["owner", "editor"];

export interface User {
  id: string;
  email: string;
  role: Role;
}

const SESSION_SECONDS = 60 * 60 * 24 * 14;
const SIGN_IN_LINK_SECONDS = 120;
/** How long a "forgot password" link works. */
const RESET_LINK_SECONDS = 60 * 60;
/** Marks access tokens, so one pasted in the wrong place is easy to recognise. */
const TOKEN_PREFIX = "brim_"; // betterleaks:allow
const TOKEN_NAME = /^[\w .-]{1,64}$/; // betterleaks:allow

/** An access token as listed: never the token itself, which is shown once when created. */
export interface AccessToken {
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
/** Verified when the email is unknown, so a login attempt takes the same time either way. */
const DECOY_HASH = await hashPassword(randomBytes(16).toString("hex"));

export class Accounts {
  readonly #db: Database;
  /** AI apps connected with OAuth: they act as a user too, and end with the user's password like access tokens. */
  readonly oauth: OAuthStore;

  constructor(db: Database) {
    this.#db = db;
    this.oauth = new OAuthStore(db);
  }

  async createUser(email: string, password: string, role: Role): Promise<User> { // betterleaks:allow
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    assertRole(role);
    const existing = await this.#db.query("SELECT id FROM brim_users WHERE email = ?", [normalized]);
    if (existing.length > 0) throw new Error(`A user with the email ${normalized} already exists.`);

    const user: User = { id: randomUUID(), email: normalized, role };
    await this.#db.query("INSERT INTO brim_users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)", [
      user.id,
      user.email,
      await hashPassword(password),
      role,
      new Date().toISOString(),
    ]);
    return user;
  }

  async authenticate(email: string, password: string): Promise<User | undefined> { // betterleaks:allow
    const rows = await this.#db.query("SELECT id, email, role, password_hash FROM brim_users WHERE email = ?", [
      normalizeEmail(email),
    ]);
    const row = rows[0];
    const valid = await verifyPassword(password, row ? String(row.password_hash) : DECOY_HASH);
    return row && valid ? { id: String(row.id), email: String(row.email), role: row.role as Role } : undefined;
  }

  /** Returns the token to hand to the browser. Only its hash is stored. */
  async startSession(userId: string): Promise<{ token: string; maxAgeSeconds: number }> {
    const token = randomBytes(32).toString("base64url");
    await this.#db.batch([
      { sql: "DELETE FROM brim_sessions WHERE expires_at < ?", args: [nowSeconds()] },
      {
        sql: "INSERT INTO brim_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        args: [hashToken(token), userId, nowSeconds() + SESSION_SECONDS],
      },
    ]);
    return { token, maxAgeSeconds: SESSION_SECONDS };
  }

  async sessionUser(token: string): Promise<User | undefined> {
    const rows = await this.#db.query(
      `SELECT u.id, u.email, u.role FROM brim_sessions s JOIN brim_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at >= ?`,
      [hashToken(token), nowSeconds()],
    );
    const row = rows[0];
    return row ? { id: String(row.id), email: String(row.email), role: row.role as Role } : undefined;
  }

  /**
   * A token that signs the user in once, within two minutes, with nothing to type: whoever runs the site hands
   * it over in a link (`brim user link`), the way a host's dashboard opens the editor for someone it already knows.
   * It is kept beside the sessions under a hash no session cookie can have, so it is never a session itself.
   */
  async createSignInToken(email: string): Promise<{ token: string; maxAgeSeconds: number }> {
    const user = await this.#userByEmail(email);
    const token = randomBytes(32).toString("base64url");
    await this.#db.batch([
      { sql: "DELETE FROM brim_sessions WHERE expires_at < ?", args: [nowSeconds()] },
      {
        sql: "INSERT INTO brim_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        args: [hashSignInToken(token), user.id, nowSeconds() + SIGN_IN_LINK_SECONDS],
      },
    ]);
    return { token, maxAgeSeconds: SIGN_IN_LINK_SECONDS };
  }

  /** The user a sign-in token was made for. The token stops working here, used or expired. */
  async redeemSignInToken(token: string): Promise<User | undefined> {
    const rows = await this.#db.query(
      "DELETE FROM brim_sessions WHERE token_hash = ? AND expires_at >= ? RETURNING user_id",
      [hashSignInToken(token), nowSeconds()],
    );
    if (!rows[0]) return undefined;
    const users = await this.#db.query("SELECT id, email, role FROM brim_users WHERE id = ?", [
      String(rows[0].user_id),
    ]);
    const row = users[0];
    return row ? { id: String(row.id), email: String(row.email), role: row.role as Role } : undefined;
  }

  /**
   * A one-time token for setting a new password, emailed when someone says they forgot theirs; `undefined` when no
   * user has that email (the caller answers the same either way). Kept beside the sessions under a hash no session
   * or sign-in link can have, and ended by the new password, which ends every session of the user.
   */
  async createResetToken(
    email: string,
    maxAgeSeconds = RESET_LINK_SECONDS,
  ): Promise<{ token: string; maxAgeSeconds: number } | undefined> {
    const rows = await this.#db.query("SELECT id FROM brim_users WHERE email = ?", [normalizeEmail(email)]);
    const userId = rows[0] ? String(rows[0].id) : undefined;
    if (!userId) return undefined;
    const token = randomBytes(32).toString("base64url");
    await this.#db.batch([
      { sql: "DELETE FROM brim_sessions WHERE expires_at < ?", args: [nowSeconds()] },
      {
        sql: "INSERT INTO brim_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        args: [hashResetToken(token), userId, nowSeconds() + maxAgeSeconds],
      },
    ]);
    return { token, maxAgeSeconds };
  }

  /**
   * Sets a new password with a reset token, which works once: every session, sign-in link, reset link and access
   * token of the user ends (see `setPassword`). Answers the user, or `undefined` for a token wrong, used or too old.
   */
  async resetPassword(token: string, password: string): Promise<User | undefined> { // betterleaks:allow
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const rows = await this.#db.query(
      "DELETE FROM brim_sessions WHERE token_hash = ? AND expires_at >= ? RETURNING user_id",
      [hashResetToken(token), nowSeconds()],
    );
    if (!rows[0]) return undefined;
    const users = await this.#db.query("SELECT id, email, role FROM brim_users WHERE id = ?", [String(rows[0].user_id)]);
    const row = users[0];
    if (!row) return undefined;
    await this.setPassword(String(row.email), password);
    return { id: String(row.id), email: String(row.email), role: row.role as Role };
  }

  async endSession(token: string): Promise<void> {
    await this.#db.query("DELETE FROM brim_sessions WHERE token_hash = ?", [hashToken(token)]);
  }

  /**
   * A long-lived token that acts as the user, for tools such as an AI client using the site's MCP.
   * Returns the token to show once; only its hash is stored.
   */
  async createToken(email: string, name: string): Promise<string> {
    if (!TOKEN_NAME.test(name)) throw new Error("A token name is 1 to 64 letters, digits, spaces, dots or dashes.");
    const user = await this.#userByEmail(email);
    const taken = await this.#db.query("SELECT 1 FROM brim_tokens WHERE user_id = ? AND name = ?", [user.id, name]);
    if (taken.length > 0) throw new Error(`${user.email} already has a token named "${name}".`);
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    await this.#db.query("INSERT INTO brim_tokens (token_hash, user_id, name, created_at) VALUES (?, ?, ?, ?)", [
      hashToken(token),
      user.id,
      name,
      new Date().toISOString(),
    ]);
    return token;
  }

  /** The user behind a bearer token: an access token from `brim token add`, or one an app got with OAuth. */
  async tokenUser(token: string): Promise<User | undefined> {
    if (OAuthStore.isAccessToken(token)) return this.oauth.accessUser(token);
    if (!token.startsWith(TOKEN_PREFIX)) return undefined;
    const hash = hashToken(token);
    const rows = await this.#db.query(
      "SELECT u.id, u.email, u.role FROM brim_tokens t JOIN brim_users u ON u.id = t.user_id WHERE t.token_hash = ?",
      [hash],
    );
    const row = rows[0];
    if (!row) return undefined;
    await this.#db.query("UPDATE brim_tokens SET last_used_at = ? WHERE token_hash = ?", [
      new Date().toISOString(),
      hash,
    ]);
    return { id: String(row.id), email: String(row.email), role: row.role as Role };
  }

  async listTokens(email: string): Promise<AccessToken[]> {
    const user = await this.#userByEmail(email);
    const rows = await this.#db.query(
      "SELECT name, created_at, last_used_at FROM brim_tokens WHERE user_id = ? ORDER BY created_at",
      [user.id],
    );
    return rows.map((row) => ({
      name: String(row.name),
      createdAt: String(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
    }));
  }

  /** Returns whether a token by that name existed. */
  async revokeToken(email: string, name: string): Promise<boolean> {
    const user = await this.#userByEmail(email);
    const before = await this.#db.query("SELECT 1 FROM brim_tokens WHERE user_id = ? AND name = ?", [user.id, name]);
    await this.#db.query("DELETE FROM brim_tokens WHERE user_id = ? AND name = ?", [user.id, name]);
    return before.length > 0;
  }

  /** Everyone who can sign in, owners first, with when they joined and how many tokens they hold. */
  async listUsers(): Promise<(User & { createdAt: string; tokens: number })[]> {
    const rows = await this.#db.query(
      `SELECT u.id, u.email, u.role, u.created_at, COUNT(t.token_hash) AS tokens
       FROM brim_users u LEFT JOIN brim_tokens t ON t.user_id = u.id
       GROUP BY u.id ORDER BY u.role = 'owner' DESC, u.email`,
    );
    return rows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      role: row.role as Role,
      createdAt: String(row.created_at),
      tokens: Number(row.tokens),
    }));
  }

  async setRole(email: string, role: Role): Promise<User> {
    assertRole(role);
    const user = await this.#userByEmail(email);
    if (user.role === "owner" && role !== "owner") await this.#assertAnotherOwner(user);
    await this.#db.query("UPDATE brim_users SET role = ? WHERE id = ?", [role, user.id]);
    return { ...user, role };
  }

  /** Signs the user out everywhere: sessions and access tokens go with them. */
  async removeUser(email: string): Promise<void> {
    const user = await this.#userByEmail(email);
    if (user.role === "owner") await this.#assertAnotherOwner(user);
    await this.#db.batch([
      { sql: "DELETE FROM brim_sessions WHERE user_id = ?", args: [user.id] },
      { sql: "DELETE FROM brim_tokens WHERE user_id = ?", args: [user.id] },
      ...OAuthStore.endAll(user.id),
      { sql: "DELETE FROM brim_users WHERE id = ?", args: [user.id] },
    ]);
  }

  /**
   * A new password signs the user out everywhere: open sessions, access tokens and connected apps all end. A password
   * is changed when someone else may know it, and they may have made themselves a token or connected an app with it.
   */
  async setPassword(email: string, password: string): Promise<void> { // betterleaks:allow
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const user = await this.#userByEmail(email);
    await this.#db.batch([
      { sql: "UPDATE brim_users SET password_hash = ? WHERE id = ?", args: [await hashPassword(password), user.id] }, // betterleaks:allow
      { sql: "DELETE FROM brim_sessions WHERE user_id = ?", args: [user.id] },
      { sql: "DELETE FROM brim_tokens WHERE user_id = ?", args: [user.id] },
      ...OAuthStore.endAll(user.id),
    ]);
  }

  /**
   * "Reset access", for someone who lost their password or may have shared it: a new password (handed back once),
   * every session and link of theirs ends, and their access tokens and connected apps too when asked (a tool they
   * connected stops).
   */
  async resetAccess(email: string, options: { revokeTokens?: boolean } = {}): Promise<{ password: string; revokedTokens: number }> { // betterleaks:allow
    const user = await this.#userByEmail(email);
    const password = generatePassword(); // betterleaks:allow
    const tokens = options.revokeTokens
      ? Number((await this.#db.query("SELECT COUNT(*) AS count FROM brim_tokens WHERE user_id = ?", [user.id]))[0]?.count ?? 0)
      : 0;
    await this.#db.batch([
      { sql: "UPDATE brim_users SET password_hash = ? WHERE id = ?", args: [await hashPassword(password), user.id] }, // betterleaks:allow
      { sql: "DELETE FROM brim_sessions WHERE user_id = ?", args: [user.id] },
      ...(options.revokeTokens
        ? [{ sql: "DELETE FROM brim_tokens WHERE user_id = ?", args: [user.id] }, ...OAuthStore.endAll(user.id)]
        : []),
    ]);
    return { password, revokedTokens: tokens };
  }

  /** A site always keeps an owner, so someone can still manage its users. */
  async #assertAnotherOwner(user: User): Promise<void> {
    const owners = await this.#db.query("SELECT COUNT(*) AS count FROM brim_users WHERE role = 'owner' AND id != ?", [
      user.id,
    ]);
    if (Number(owners[0]?.count ?? 0) === 0)
      throw new Error(`${user.email} is the only owner; make someone else owner first.`);
  }

  async #userByEmail(email: string): Promise<User> {
    const rows = await this.#db.query("SELECT id, email, role FROM brim_users WHERE email = ?", [
      normalizeEmail(email),
    ]);
    const row = rows[0];
    if (!row) throw new Error(`There is no user with the email ${normalizeEmail(email)}.`);
    return { id: String(row.id), email: String(row.email), role: row.role as Role };
  }
}

function assertRole(role: string): asserts role is Role {
  if (!ROLE_NAMES.includes(role as Role)) throw new Error('The role is "owner" or "editor".');
}

/** An email as accounts are kept and found by: every spelling of it that signs in is this one. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function hashSignInToken(token: string): string {
  return hashToken(`sign-in:${token}`);
}

function hashResetToken(token: string): string {
  return hashToken(`reset:${token}`);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
