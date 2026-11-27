import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "https://acme.example";
const OWNER = "owner@example.test";
const EDITOR = "editor@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const visitor = { clientAddress: "203.0.113.7" };

let brim: Brim;
let admin: AdminHandler;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  brim = {
    db,
    content: new ContentStore(db),
    items: new ItemStore(db),
    forms: new FormStore(db),
    history: new HistoryStore(db),
    drafts: new DraftStore(db),
    accounts: new Accounts(db),
  };
  await brim.accounts.createUser(OWNER, PASSWORD, "owner");
  await brim.accounts.createUser(EDITOR, PASSWORD, "editor");
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    identity: { name: "Acme Gardens" },
    renderPage: async () => "<html></html>",
  });
});

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await admin(new Request(`${ORIGIN}${path}`, init), visitor);
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

function form(params: Record<string, string>, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params).toString(),
  };
}

async function register(metadata: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const response = await send("/admin/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", ...metadata }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Record<string, any>;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizePath(clientId: string, challenge: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    ...extra,
  });
  return `/admin/oauth/authorize?${params}`;
}

/** Signs in on the authorize page and returns the session cookie it set. */
async function signIn(path: string, email = OWNER): Promise<string> {
  const response = await send(path, form({ action: "sign-in", email, password: PASSWORD }, { origin: ORIGIN })); // betterleaks:allow
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(path);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("brim_session=") && !value.startsWith("brim_session=;"));
  return cookie!.split(";")[0]!;
}

/** The whole dance, as ChatGPT does it: register, sign in, allow, trade the code. */
async function connect(email = OWNER): Promise<{ client: Record<string, any>; tokens: Record<string, any>; cookie: string }> {
  const client = await register();
  const { verifier, challenge } = pkce();
  const path = authorizePath(client.client_id, challenge);
  const cookie = await signIn(path, email);
  const allowed = await send(path, form({ action: "allow" }, { origin: ORIGIN, cookie }));
  expect(allowed.status).toBe(303);
  const back = new URL(allowed.headers.get("location")!);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("xyz");
  expect(back.searchParams.get("iss")).toBe(ORIGIN);
  const tokenResponse = await send(
    "/admin/oauth/token",
    form({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
    }),
  );
  expect(tokenResponse.status).toBe(200);
  return { client, tokens: (await tokenResponse.json()) as Record<string, any>, cookie };
}

async function mcp(accessToken: string | null): Promise<Response> { // betterleaks:allow
  return send("/admin/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(accessToken && { authorization: `Bearer ${accessToken}` }) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

function refresh(client: Record<string, any>, refreshToken: string): Promise<Response> { // betterleaks:allow
  return send("/admin/oauth/token", form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: client.client_id })); // betterleaks:allow
}

describe("discovery", () => {
  it("points an MCP client from the MCP's 401 to the site's OAuth", async () => {
    const response = await mcp(null);
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate")!;
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)![1]!;
    expect(metadataUrl).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/admin/mcp`);

    const resource = (await (await send(new URL(metadataUrl).pathname)).json()) as Record<string, any>;
    expect(resource).toMatchObject({ resource: `${ORIGIN}/admin/mcp`, authorization_servers: [ORIGIN], resource_name: "Acme Gardens" });
    expect(await (await send("/.well-known/oauth-protected-resource")).json()).toEqual(resource);

    const server = await send("/.well-known/oauth-authorization-server");
    expect(server.headers.get("access-control-allow-origin")).toBe("*");
    expect(await server.json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/admin/oauth/authorize`,
      token_endpoint: `${ORIGIN}/admin/oauth/token`,
      registration_endpoint: `${ORIGIN}/admin/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
  });

  it("leaves other addresses under /.well-known to the site", async () => {
    expect(await admin(new Request(`${ORIGIN}/.well-known/security.txt`), visitor)).toBeUndefined();
    expect((await send("/.well-known/oauth-authorization-server/elsewhere")).status).toBe(404);
  });

  it("says the site takes OAuth in /admin/api/info", async () => {
    const info = (await (await send("/admin/api/info")).json()) as { capabilities: string[] };
    expect(info.capabilities).toContain("oauth");
  });
});

describe("connecting an app", () => {
  it("signs in, asks the user, and gives the app tokens that work on the MCP", async () => {
    const client = await register();
    const { challenge } = pkce();
    const path = authorizePath(client.client_id, challenge);

    const signInPage = await send(path);
    expect(signInPage.status).toBe(200);
    const signInHtml = await signInPage.text();
    expect(signInHtml).toContain("ChatGPT");
    expect(signInHtml).toContain("returns to chatgpt.com");
    expect(signInHtml).toContain('name="password"');
    expect(signInPage.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    // "no-referrer" would make the browser send `Origin: null` with the page's forms, refused as forged.
    expect(signInPage.headers.get("referrer-policy")).toBe("same-origin");

    const cookie = await signIn(path);
    const consent = await (await send(path, { headers: { cookie } })).text();
    expect(consent).toContain("Allow this app to edit Acme Gardens?");
    expect(consent).toContain(OWNER);
    expect(consent).toContain("Manage the site's users");

    const { tokens } = await connect();
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(tokens.access_token).toMatch(/^brim_at_/);
    expect(tokens.refresh_token).toMatch(/^brim_rt_/);
    const listed = await mcp(tokens.access_token);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).toContain("brim_read_page");
  });

  it("shows an editor only what their role allows", async () => {
    const client = await register();
    const path = authorizePath(client.client_id, pkce().challenge);
    const cookie = await signIn(path, EDITOR);
    const consent = await (await send(path, { headers: { cookie } })).text();
    expect(consent).toContain("(editor)");
    expect(consent).not.toContain("Manage the site's users");
  });

  it("sends the user back with access_denied when they say no", async () => {
    const client = await register();
    const path = authorizePath(client.client_id, pkce().challenge);
    const cookie = await signIn(path);
    const denied = await send(path, form({ action: "deny" }, { origin: ORIGIN, cookie }));
    const back = new URL(denied.headers.get("location")!);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.has("code")).toBe(false);
  });

  it("refuses a wrong password, and an allow without a session", async () => {
    const client = await register();
    const path = authorizePath(client.client_id, pkce().challenge);
    const wrong = await send(path, form({ action: "sign-in", email: OWNER, password: "nope nope nope" }, { origin: ORIGIN })); // betterleaks:allow
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("The email or password is wrong.");
    const anonymous = await send(path, form({ action: "allow" }, { origin: ORIGIN }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("location")).toBeNull();
  });

  it("refuses a form sent from another site", async () => {
    const client = await register();
    const path = authorizePath(client.client_id, pkce().challenge);
    const cookie = await signIn(path);
    const forged = await send(path, form({ action: "allow" }, { origin: "https://evil.example", cookie }));
    expect(forged.status).toBe(403);
    expect(forged.headers.get("location")).toBeNull();
  });

  it("never sends the browser to an address the app did not register", async () => {
    const client = await register();
    const path = authorizePath(client.client_id, pkce().challenge, { redirect_uri: "https://evil.example/callback" });
    const response = await send(path);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect((await send(authorizePath("brimc_unknown", pkce().challenge))).status).toBe(400);
  });

  it("requires PKCE with S256", async () => {
    const client = await register();
    const plain = await send(authorizePath(client.client_id, "a".repeat(43), { code_challenge_method: "plain" }));
    expect(plain.status).toBe(303);
    expect(new URL(plain.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });

  it("uses another account after signing out on the page", async () => {
    const client = await register();
    const path = authorizePath(client.client_id, pkce().challenge);
    const cookie = await signIn(path);
    const switched = await send(path, form({ action: "switch" }, { origin: ORIGIN, cookie }));
    expect(switched.status).toBe(303);
    expect(switched.headers.getSetCookie().some((value) => value.startsWith("brim_session=;"))).toBe(true);
    expect(await (await send(path, { headers: { cookie } })).text()).toContain('name="password"');
  });
});

describe("tokens", () => {
  it("trades a code once, and only with its verifier", async () => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const path = authorizePath(client.client_id, challenge);
    const cookie = await signIn(path);
    const code = new URL((await send(path, form({ action: "allow" }, { origin: ORIGIN, cookie }))).headers.get("location")!)
      .searchParams.get("code")!;
    const trade = (codeVerifier: string) =>
      send("/admin/oauth/token", form({ grant_type: "authorization_code", code, client_id: client.client_id, code_verifier: codeVerifier }));

    const wrong = await trade(pkce().verifier);
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");
    // The wrong try used the code up: a code that leaked cannot be guessed at.
    expect((await trade(verifier)).status).toBe(400);
  });

  it("refreshes for good: a new pair each time, the old access token stops", async () => {
    const { client, tokens } = await connect();
    const first = await refresh(client, tokens.refresh_token);
    expect(first.status).toBe(200);
    const next = (await first.json()) as Record<string, any>;
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(tokens.access_token)).status).toBe(401);
    expect((await mcp(next.access_token)).status).toBe(200);

    // An app that lost the answer asks again with the token it held, and is not cut off.
    const retried = await refresh(client, tokens.refresh_token);
    expect(retried.status).toBe(200);
    const latest = (await retried.json()) as Record<string, any>;
    expect((await refresh(client, latest.refresh_token)).status).toBe(200);
  });

  it("forgets a replaced refresh token after a couple of minutes", async () => {
    const { client, tokens } = await connect();
    const next = (await (await refresh(client, tokens.refresh_token)).json()) as Record<string, any>;
    vi.useFakeTimers({ now: Date.now() + 3 * 60 * 1000, toFake: ["Date"] });
    try {
      expect((await refresh(client, tokens.refresh_token)).status).toBe(400);
      expect((await refresh(client, next.refresh_token)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the app its access token ran out, so it refreshes", async () => {
    const { tokens } = await connect();
    vi.useFakeTimers({ now: Date.now() + 61 * 60 * 1000, toFake: ["Date"] });
    try {
      const expired = await mcp(tokens.access_token);
      expect(expired.status).toBe(401);
      expect(expired.headers.get("www-authenticate")).toContain('error="invalid_token"');
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks a confidential app for its secret", async () => {
    const client = await register({ token_endpoint_auth_method: "client_secret_basic" });
    expect(client.client_secret).toMatch(/^brim_cs_/);
    const { verifier, challenge } = pkce();
    const path = authorizePath(client.client_id, challenge);
    const cookie = await signIn(path);
    const code = new URL((await send(path, form({ action: "allow" }, { origin: ORIGIN, cookie }))).headers.get("location")!)
      .searchParams.get("code")!;
    const params = { grant_type: "authorization_code", code, code_verifier: verifier };
    const without = await send("/admin/oauth/token", form({ ...params, client_id: client.client_id }));
    expect(without.status).toBe(401);
    const basic = Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64");
    // The code was used up by the refused try, as any try uses it.
    const code2 = new URL((await send(path, form({ action: "allow" }, { origin: ORIGIN, cookie }))).headers.get("location")!)
      .searchParams.get("code")!;
    const withSecret = await send("/admin/oauth/token", form({ ...params, code: code2 }, { authorization: `Basic ${basic}` }));
    expect(withSecret.status).toBe(200);
  });

  it("ends when the app revokes its token", async () => {
    const { client, tokens } = await connect();
    const revoked = await send("/admin/oauth/revoke", form({ token: tokens.refresh_token, client_id: client.client_id }));
    expect(revoked.status).toBe(200);
    expect((await mcp(tokens.access_token)).status).toBe(401);
  });
});

describe("registration", () => {
  it("refuses redirects that are not https, or that run code", async () => {
    for (const uri of ["http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#frag"]) {
      const response = await send("/admin/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [uri] }),
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("invalid_redirect_uri");
    }
    // An app on this computer, and a desktop app's own scheme, may.
    await register({ redirect_uris: ["http://127.0.0.1:33418/callback", "cursor://anysphere.cursor-mcp/oauth/callback"] });
  });

  it("slows down an address that registers too many apps", async () => {
    for (let i = 0; i < 20; i++) await register();
    const response = await send("/admin/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
    });
    expect(response.status).toBe(429);
  });
});

describe("connected apps", () => {
  it("are listed and disconnected by their user", async () => {
    const { tokens, cookie } = await connect();
    const listed = (await (await send("/admin/api/connections", { headers: { cookie } })).json()) as Record<string, any>;
    expect(listed.mcp).toBe(`${ORIGIN}/admin/mcp`);
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections[0]).toMatchObject({ app: "ChatGPT", appHost: "chatgpt.com", email: OWNER });

    const removed = await send(`/admin/api/connections/${listed.connections[0].id}`, { method: "DELETE", headers: { cookie, origin: ORIGIN } });
    expect(removed.status).toBe(200);
    expect((await mcp(tokens.access_token)).status).toBe(401);
  });

  it("are all an owner's to see and disconnect, and only their own an editor's", async () => {
    const editor = await connect(EDITOR);
    const owner = await connect(OWNER);
    const ownerToken = await brim.accounts.createToken(OWNER, "dashboard");
    const all = (await (await send("/admin/api/connections?all", { headers: { authorization: `Bearer ${ownerToken}` } })).json()) as Record<
      string,
      any
    >;
    expect(all.connections.map((connection: { email: string }) => connection.email).sort()).toEqual([EDITOR, OWNER]);

    const editorView = (await (await send("/admin/api/connections", { headers: { cookie: editor.cookie } })).json()) as Record<string, any>;
    expect(editorView.connections).toHaveLength(1);
    expect((await send("/admin/api/connections?all", { headers: { cookie: editor.cookie } })).status).toBe(403);

    const ownersConnection = all.connections.find((connection: { email: string }) => connection.email === OWNER).id;
    const refused = await send(`/admin/api/connections/${ownersConnection}`, {
      method: "DELETE",
      headers: { cookie: editor.cookie, origin: ORIGIN },
    });
    expect(refused.status).toBe(404);
    expect((await mcp(owner.tokens.access_token)).status).toBe(200);

    const editorsConnection = all.connections.find((connection: { email: string }) => connection.email === EDITOR).id;
    const byOwner = await send(`/admin/api/connections/${editorsConnection}`, { method: "DELETE", headers: { authorization: `Bearer ${ownerToken}` } });
    expect(byOwner.status).toBe(200);
    expect((await mcp(editor.tokens.access_token)).status).toBe(401);
  });

  it("end when the user's password changes or they are removed", async () => {
    const owner = await connect(OWNER);
    const editor = await connect(EDITOR);
    await brim.accounts.setPassword(OWNER, "another long password");
    expect((await mcp(owner.tokens.access_token)).status).toBe(401);
    expect((await refresh(owner.client, owner.tokens.refresh_token)).status).toBe(400);
    await brim.accounts.removeUser(EDITOR);
    expect((await refresh(editor.client, editor.tokens.refresh_token)).status).toBe(400);
  });
});
