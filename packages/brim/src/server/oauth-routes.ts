import type { User } from "../auth/accounts.ts";
import { type OAuthClient, OAuthError, redirectHost } from "../auth/oauth.ts";
import { type Permission, permissionsOf } from "../auth/permissions.ts";
import type { HostSignIn } from "../config.ts";
import type { Brim } from "../runtime/connect.ts";
import { HttpError, assertSameOrigin, json, readBytes, requestOrigin } from "./http.ts";
import type { RateLimiter } from "./rate-limit.ts";
import { sessionCookies } from "./auth.ts";

/**
 * The OAuth side of the site's MCP (see `auth/oauth.ts`): the addresses an MCP client discovers it by, the page where
 * a user signs in and allows an app, and the endpoints the app registers and gets its tokens at.
 *
 * - `/.well-known/oauth-protected-resource[/admin/mcp]`: the MCP says which authorization server it trusts (RFC 9728).
 * - `/.well-known/oauth-authorization-server`: that server's endpoints (RFC 8414). The site is its own server.
 * - `/admin/oauth/register`, `/authorize`, `/token`, `/revoke`.
 */
export const OAUTH_PATH = "/admin/oauth";
export const MCP_RESOURCE_PATH = "/admin/mcp";
const PROTECTED_RESOURCE = "/.well-known/oauth-protected-resource";
const AUTHORIZATION_SERVER = "/.well-known/oauth-authorization-server";

/** Apps one address may register in an hour: registering is open to anyone, so it is slowed down. */
const REGISTRATIONS_PER_HOUR = 20;
const TOKEN_REQUESTS_PER_MINUTE = 60; // betterleaks:allow
const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_BODY_BYTES = 16 * 1024;

/** What the endpoints answer to any origin: a browser-based MCP client reads them from its own page. */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-max-age": "86400",
};

/** The page's own rules: nothing loads from elsewhere, and no other site can show it in a frame. */
const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  // Not "no-referrer": with it a browser sends `Origin: null` on the page's own forms, which then look forged.
  "referrer-policy": "same-origin",
};

export interface OAuthRoutesOptions {
  brim: Brim;
  rateLimiter: RateLimiter;
  siteName?: string | undefined;
  favicon?: string | undefined;
  hostSignIn?: HostSignIn | undefined;
  /** The cookie of a new session (and the removal of an old one), as the editor's sign-in sets it. */
  signInHeaders: (request: Request, token: string, maxAgeSeconds: number) => Headers;
  /** The cookies that end the browser's session. */
  signOutHeaders: (request: Request) => Headers;
  /** What wrong passwords are counted by, shared with the editor's sign-in. */
  loginKeys: (clientAddress: string, email: string) => string[];
}

/** The address of the MCP's protected-resource metadata, for the `WWW-Authenticate` of a 401 from the MCP. */
export function resourceMetadataUrl(request: Request): string {
  return `${requestOrigin(request)}${PROTECTED_RESOURCE}${MCP_RESOURCE_PATH}`;
}

export function isOAuthPath(pathname: string): boolean {
  return (
    pathname === PROTECTED_RESOURCE ||
    pathname.startsWith(`${PROTECTED_RESOURCE}/`) ||
    pathname === AUTHORIZATION_SERVER ||
    pathname.startsWith(`${AUTHORIZATION_SERVER}/`) ||
    pathname.startsWith(`${OAUTH_PATH}/`)
  );
}

interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  challenge: string;
}

export function createOAuthRoutes(options: OAuthRoutesOptions) {
  const { brim, rateLimiter } = options;
  const oauth = brim.accounts.oauth;

  /** The site as the authorization server and as the MCP's resource: the address the app reached it by. */
  function metadata(request: Request, pathname: string): Response {
    const origin = requestOrigin(request);
    if (pathname.startsWith(PROTECTED_RESOURCE)) {
      return json(
        {
          resource: `${origin}${MCP_RESOURCE_PATH}`,
          authorization_servers: [origin],
          bearer_methods_supported: ["header"],
          resource_name: options.siteName || new URL(origin).host,
        },
        { headers: CORS },
      );
    }
    const auth = ["none", "client_secret_post", "client_secret_basic"];
    return json(
      {
        issuer: origin,
        authorization_endpoint: `${origin}${OAUTH_PATH}/authorize`,
        token_endpoint: `${origin}${OAUTH_PATH}/token`,
        registration_endpoint: `${origin}${OAUTH_PATH}/register`,
        revocation_endpoint: `${origin}${OAUTH_PATH}/revoke`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: auth,
        revocation_endpoint_auth_methods_supported: auth,
        authorization_response_iss_parameter_supported: true,
      },
      { headers: CORS },
    );
  }

  function oauthError(error: unknown): Response {
    if (error instanceof OAuthError) {
      return json(
        { error: error.code, error_description: error.message },
        {
          status: error.status,
          headers: { ...CORS, ...(error.status === 401 && { "www-authenticate": 'Basic realm="oauth"' }) },
        },
      );
    }
    if (error instanceof HttpError) {
      return json({ error: error.status === 429 ? "slow_down" : "invalid_request", error_description: error.message }, {
        status: error.status,
        headers: CORS,
      });
    }
    throw error;
  }

  /** The body of a token or revoke request: a form, as RFC 6749 sends it, or JSON, which some clients send. */
  async function readParams(request: Request): Promise<URLSearchParams> {
    const text = new TextDecoder().decode(await readBytes(request, MAX_BODY_BYTES));
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new OAuthError("invalid_request", "The request is not valid JSON.");
      }
      if (typeof body !== "object" || body === null) throw new OAuthError("invalid_request", "Send the parameters as an object.");
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) if (typeof value === "string") params.set(key, value);
      return params;
    }
    return new URLSearchParams(text);
  }

  /** The app sending a token or revoke request, with its secret checked when it has one. */
  async function requestClient(request: Request, params: URLSearchParams): Promise<OAuthClient> {
    let clientId = params.get("client_id") ?? undefined;
    let secret = params.get("client_secret") ?? undefined;
    const basic = /^Basic\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
    if (basic) {
      const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) throw new OAuthError("invalid_client", "Basic authentication is client_id:client_secret.", 401);
      clientId = decodeForm(decoded.slice(0, colon));
      secret = decodeForm(decoded.slice(colon + 1)) || undefined;
    }
    if (!clientId) throw new OAuthError("invalid_client", "client_id is required.", 401);
    return oauth.authenticateClient(clientId, secret);
  }

  async function register(request: Request, clientAddress: string): Promise<Response> {
    try {
      if (!(await rateLimiter.allow(`oauth-register:${clientAddress}`, REGISTRATIONS_PER_HOUR, 60 * 60))) {
        throw new HttpError(429, "Too many apps registered from this address. Try again in an hour.");
      }
      const text = new TextDecoder().decode(await readBytes(request, MAX_BODY_BYTES));
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new OAuthError("invalid_client_metadata", "Send the app's metadata as JSON.");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new OAuthError("invalid_client_metadata", "Send the app's metadata as a JSON object.");
      }
      const client = await oauth.register(body as Record<string, unknown>);
      return json(
        {
          client_id: client.clientId,
          ...(client.clientSecret && { client_secret: client.clientSecret, client_secret_expires_at: 0 }), // betterleaks:allow
          client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
          client_name: client.name,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: client.authMethod,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        { status: 201, headers: CORS },
      );
    } catch (error) {
      return oauthError(error);
    }
  }

  async function token(request: Request, clientAddress: string): Promise<Response> {
    try {
      if (!(await rateLimiter.allow(`oauth-token:${clientAddress}`, TOKEN_REQUESTS_PER_MINUTE, 60))) {
        throw new HttpError(429, "Too many token requests. Try again in a minute.");
      }
      const params = await readParams(request);
      const client = await requestClient(request, params);
      const grantType = params.get("grant_type");
      if (grantType === "authorization_code") {
        const code = params.get("code");
        const verifier = params.get("code_verifier");
        if (!code || !verifier) throw new OAuthError("invalid_request", "code and code_verifier are required.");
        assertResource(request, params.get("resource"));
        return json(await oauth.exchangeCode(client, code, params.get("redirect_uri") ?? undefined, verifier), { headers: CORS });
      }
      if (grantType === "refresh_token") {
        const refreshToken = params.get("refresh_token"); // betterleaks:allow
        if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is required.");
        assertResource(request, params.get("resource"));
        return json(await oauth.refresh(client, refreshToken), { headers: CORS });
      }
      throw new OAuthError("unsupported_grant_type", "grant_type is authorization_code or refresh_token.");
    } catch (error) {
      return oauthError(error);
    }
  }

  async function revoke(request: Request): Promise<Response> {
    try {
      const params = await readParams(request);
      const client = await requestClient(request, params);
      const given = params.get("token");
      if (!given) throw new OAuthError("invalid_request", "token is required.");
      await oauth.revokeToken(client, given);
      return json({}, { headers: CORS });
    } catch (error) {
      return oauthError(error);
    }
  }

  /** RFC 8707: an app may name what it wants a token for; only this site's MCP (or the site itself) is offered. */
  function assertResource(request: Request, resource: string | null): void {
    if (resource === null || resource === "") return;
    const origin = requestOrigin(request);
    const ours = [origin, `${origin}/`, `${origin}${MCP_RESOURCE_PATH}`, `${origin}${MCP_RESOURCE_PATH}/`];
    if (!ours.includes(resource)) throw new OAuthError("invalid_target", `${resource} is not this site's MCP.`);
  }

  /**
   * Reads what the app asks for. A request that names no known app, or a redirect it did not register, is shown as
   * an error on the page itself: sending the browser there would let anyone use the site to send people anywhere.
   * Any other mistake goes back to the app, as OAuth says.
   */
  async function readAuthorize(
    request: Request,
    params: URLSearchParams,
  ): Promise<{ request: AuthorizeRequest } | { response: Response }> {
    const clientId = params.get("client_id") ?? "";
    const client = clientId ? await oauth.client(clientId) : undefined;
    if (!client) {
      return { response: errorPage("This app is not registered with this site. Start connecting again from the app.", 400) };
    }
    const given = params.get("redirect_uri");
    const redirectUri = given ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return { response: errorPage("The app asked to come back to an address it did not register. Start connecting again from the app.", 400) };
    }
    const state = params.get("state");
    const back = (error: string, description: string) => ({
      response: redirectTo(redirectUri, { error, error_description: description, state, iss: requestOrigin(request) }),
    });
    if (params.get("response_type") !== "code") return back("unsupported_response_type", 'response_type must be "code".');
    const challenge = params.get("code_challenge") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get("code_challenge_method") !== "S256") {
      return back("invalid_request", "PKCE is required: code_challenge with code_challenge_method S256.");
    }
    try {
      assertResource(request, params.get("resource"));
    } catch (error) {
      return back("invalid_target", error instanceof Error ? error.message : "The resource is not this site's MCP.");
    }
    return { request: { client, redirectUri, state, challenge } };
  }

  /** The signed-in user of the browser: a session only, never a bearer token, since a person has to say yes. */
  async function browserUser(request: Request): Promise<User | undefined> {
    for (const session of sessionCookies(request)) {
      const user = await brim.accounts.sessionUser(session);
      if (user) return user;
    }
    return undefined;
  }

  async function authorize(request: Request, clientAddress: string): Promise<Response> {
    const url = new URL(request.url);
    const read = await readAuthorize(request, url.searchParams);
    if ("response" in read) return read.response;
    const asked = read.request;
    const self = `${OAUTH_PATH}/authorize${url.search}`;

    if (request.method === "GET") {
      const user = await browserUser(request);
      return user ? consentPage(asked, user, self) : signInPage(asked, self);
    }
    if (request.method !== "POST") return errorPage("Not found.", 404);

    try {
      assertSameOrigin(request);
    } catch {
      return errorPage("This request did not come from the site itself.", 403);
    }
    const form = new URLSearchParams(new TextDecoder().decode(await readBytes(request, MAX_BODY_BYTES)));
    const action = form.get("action");

    if (action === "sign-in") {
      const email = form.get("email")?.trim() ?? "";
      const password = form.get("password") ?? ""; // betterleaks:allow
      if (!email || !password) return signInPage(asked, self, "Enter your email and password.", 400);
      const counted: string[] = [];
      const giveBack = async () => {
        for (const key of counted) await rateLimiter.release(key, LOGIN_WINDOW_SECONDS);
      };
      for (const key of options.loginKeys(clientAddress, email)) {
        counted.push(key);
        if (await rateLimiter.allow(key, LOGIN_ATTEMPTS, LOGIN_WINDOW_SECONDS)) continue;
        await giveBack();
        return signInPage(asked, self, "Too many sign-in attempts. Try again in a few minutes.", 429);
      }
      const user = await brim.accounts.authenticate(email, password);
      if (!user) return signInPage(asked, self, "The email or password is wrong.", 401);
      await giveBack();
      const session = await brim.accounts.startSession(user.id);
      const headers = options.signInHeaders(request, session.token, session.maxAgeSeconds);
      headers.set("location", self);
      return new Response(null, { status: 303, headers });
    }

    if (action === "switch") {
      for (const session of sessionCookies(request)) await brim.accounts.endSession(session);
      const headers = options.signOutHeaders(request);
      headers.set("location", self);
      return new Response(null, { status: 303, headers });
    }

    const back = { state: asked.state, iss: requestOrigin(request) };
    if (action === "deny") {
      return redirectTo(asked.redirectUri, { ...back, error: "access_denied", error_description: "The user said no." });
    }
    if (action === "allow") {
      const user = await browserUser(request);
      if (!user) return signInPage(asked, self, "Your session ended. Sign in again.", 401);
      const code = await oauth.createCode(asked.client, user, asked.redirectUri, asked.challenge);
      return redirectTo(asked.redirectUri, { ...back, code });
    }
    return errorPage("Not found.", 404);
  }

  function page(title: string, body: string, status = 200): Response {
    const favicon = options.favicon ? `<link rel="icon" href="${escape(options.favicon)}" />` : "";
    return new Response(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escape(title)}</title>
    ${favicon}
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <main class="card">${body}</main>
  </body>
</html>
`,
      { status, headers: PAGE_HEADERS },
    );
  }

  function errorPage(message: string, status: number): Response {
    return page("Cannot connect", `<h1>Cannot connect</h1><p class="error">${escape(message)}</p>`, status);
  }

  function siteLabel(): string {
    return escape(options.siteName || "this site");
  }

  function appLine(asked: AuthorizeRequest): string {
    const host = redirectHost(asked.redirectUri);
    return `<p class="app"><strong>${escape(asked.client.name)}</strong>${
      host ? `<span class="muted">returns to ${escape(host)}</span>` : ""
    }</p>`;
  }

  function signInPage(asked: AuthorizeRequest, self: string, error = "", status = 200): Response {
    const host = options.hostSignIn
      ? `<p class="or">or</p>
        <a class="button secondary" href="${escape(options.hostSignIn.url)}" target="_blank" rel="noreferrer">Continue with ${escape(options.hostSignIn.name)}</a>
        <a class="link" href="${escape(self)}">I signed in, go on</a>`
      : "";
    return page(
      `Connect to ${options.siteName || "the site"}`,
      `<h1>Connect an app to ${siteLabel()}</h1>
      ${appLine(asked)}
      <p>Sign in with your account on this site to let it edit the site for you.</p>
      ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
      <form method="post" action="${escape(self)}">
        <input type="hidden" name="action" value="sign-in" />
        <label>Email<input name="email" type="email" autocomplete="username" required autofocus /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="button" type="submit">Sign in</button>
      </form>
      ${host}`,
      status,
    );
  }

  function consentPage(asked: AuthorizeRequest, user: User, self: string): Response {
    const can = permissionsOf(user.role);
    const items = (Object.keys(ABILITIES) as Permission[]).filter((permission) => can.includes(permission));
    return page(
      `Connect to ${options.siteName || "the site"}`,
      `<h1>Allow this app to edit ${siteLabel()}?</h1>
      ${appLine(asked)}
      <p>It will act as <strong>${escape(user.email)}</strong> (${escape(user.role)}) and can:</p>
      <ul>${items.map((permission) => `<li>${ABILITIES[permission]}</li>`).join("")}</ul>
      <p class="muted">It stays connected until you disconnect it in the editor's menu (Connected apps) or change your password. Every change it makes is in History and can be taken back.</p>
      <form method="post" action="${escape(self)}" class="actions">
        <button class="button" type="submit" name="action" value="allow">Allow</button>
        <button class="button secondary" type="submit" name="action" value="deny">Cancel</button>
      </form>
      <form method="post" action="${escape(self)}">
        <button class="link" type="submit" name="action" value="switch">Not ${escape(user.email)}? Use another account</button>
      </form>`,
    );
  }

  return async function handle(request: Request, clientAddress: string, pathname: string): Promise<Response> {
    if (request.method === "OPTIONS" && pathname !== `${OAUTH_PATH}/authorize`) {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (pathname.startsWith(PROTECTED_RESOURCE) || pathname.startsWith(AUTHORIZATION_SERVER)) {
      // The resource's own metadata, at the bare address or with the MCP's path after it; the server's, bare.
      const known =
        pathname === PROTECTED_RESOURCE ||
        pathname === `${PROTECTED_RESOURCE}${MCP_RESOURCE_PATH}` ||
        pathname === AUTHORIZATION_SERVER;
      if (!known || request.method !== "GET") return json({ error: "Not found." }, { status: 404, headers: CORS });
      return metadata(request, pathname);
    }
    const route = pathname.slice(OAUTH_PATH.length);
    if (route === "/authorize") return authorize(request, clientAddress);
    if (request.method === "POST" && route === "/register") return register(request, clientAddress);
    if (request.method === "POST" && route === "/token") return token(request, clientAddress);
    if (request.method === "POST" && route === "/revoke") return revoke(request);
    return json({ error: "Not found." }, { status: 404, headers: CORS });
  };
}

/** What a connected app may do, said for the consent page by the permissions of the user's role. */
const ABILITIES: Partial<Record<Permission, string>> = {
  content: "Change texts, images, links and blocks, and add items",
  publish: "Publish, unpublish and delete pages and items",
  pages: "Add, rename and move pages",
  templates: "Change the templates of content types",
  responses: "Read what visitors sent through the forms",
  settings: "Change Site Settings and redirects",
  users: "Manage the site's users",
};

/** Back to the app, with what it is told added to its own address's query. */
function redirectTo(uri: string, params: Record<string, string | null>): Response {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return new Response(null, { status: 303, headers: { location: url.href, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

function decodeForm(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const PAGE_CSS = `
:root { color-scheme: light dark; --bg: #f6f5f2; --card: #fff; --text: #1d1b18; --muted: #6b665e; --line: #e2ded6;
  --accent: #c8321e; --accent-text: #fff; --error: #b42318; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #151412; --card: #1f1d1a; --text: #f1eee8; --muted: #a39d93;
  --line: #34312c; --error: #f97066; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); padding: 24px; }
.card { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
h1 { font-size: 1.25rem; line-height: 1.3; margin: 0 0 16px; }
p, li { line-height: 1.5; font-size: 0.95rem; }
ul { padding-left: 1.2em; margin: 0 0 16px; }
.app { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; }
.muted { color: var(--muted); font-size: 0.85rem; }
.error { color: var(--error); }
form { display: grid; gap: 12px; margin-top: 16px; }
label { display: grid; gap: 6px; font-size: 0.9rem; font-weight: 500; }
input { font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; }
.actions { grid-template-columns: 1fr 1fr; }
.button { display: block; text-align: center; text-decoration: none; font: inherit; font-weight: 600; padding: 11px 14px;
  border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); cursor: pointer; }
.button.secondary { background: transparent; color: var(--text); border-color: var(--line); }
.link { display: block; text-align: center; margin-top: 10px; background: none; border: 0; color: var(--muted); font: inherit;
  font-size: 0.85rem; text-decoration: underline; cursor: pointer; }
.or { text-align: center; color: var(--muted); margin: 16px 0 10px; }
`;
