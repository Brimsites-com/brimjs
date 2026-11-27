import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Role, type User, normalizeEmail } from "../auth/accounts.ts";
import { type Permission, REFUSALS, ROLES, can, permissionsOf } from "../auth/permissions.ts";
import type { HistoryRecord } from "../content/history.ts";
import type { DraftTarget, ItemContentDraft, NodeDraft } from "../content/drafts.ts";
import { type ContentType, isSlug, itemPageOf, slugify, standardField } from "../content/content-types.ts";
import { isNodeId, normalizePagePath, pageScope, siteScope, typeScope } from "../content/ids.ts";
import { FIELD_KIND, applyToItem } from "../content/item-fields.ts";
import { type Item, parseItem } from "../content/items.ts";
import { type PageTemplate, templateInfo } from "../content/page-templates.ts";
import { FormFiles, type PrivateFiles, fileDownload } from "../forms/files.ts";
import { MAX_UPLOAD_BYTES, type MediaFiles, MediaStore } from "../content/media.ts";
import { blockDefinitions } from "../blocks/schemas/index.ts";
import { parseSettings } from "../blocks/settings.ts";
import type { NodeKind, PageRecord, SeoSettings, StoredNode, Visibility } from "../content/types.ts";
import { ValidationError, parseNodeValue, parseSeo } from "../content/validate.ts";
import { parseRedirects, redirectsAfterMove } from "../content/redirects.ts";
import { generatePassword } from "../auth/password.ts";
import type { Brim } from "../runtime/connect.ts";
import {
  HttpError,
  assertSameOrigin,
  isLocalHost,
  json,
  publicOrigin,
  readBytes,
  readJson,
  requestOrigin,
} from "./http.ts";
import { itemPathSegments } from "../content/item-path.ts";
import { type LocaleConfig, itemPagePath, localeOfPath, pathInLocale, storedLocale } from "./locales.ts";
import { RateLimiter } from "./rate-limit.ts";
import { SESSION_COOKIE, bearerToken, requestUser, sessionCookies } from "./auth.ts";
import { SCHEMA_VERSION } from "../db/schema.ts";
import type { QueryRules } from "./query-params.ts";
import { VERSION } from "../version.ts";
import { handleMcp } from "../mcp/server.ts";
import { createOAuthRoutes, isOAuthPath, resourceMetadataUrl } from "./oauth-routes.ts";
import {
  type BrandColor,
  type HostSignIn,
  type SiteIdentity,
  type VideoUploadsOptions,
  faviconType,
} from "../config.ts";
import { VideoHost, parseNewVideo } from "./video-host.ts";
import type { Mailer } from "../mail/mailer.ts";
import { MailSettingsStore } from "../mail/settings.ts";
import {
  ROLE_DESCRIPTIONS,
  accountNotice,
  confirmationNotice,
  formNotice,
  passwordResetNotice,
  testNotice,
} from "../mail/notify.ts";
import {
  type AccountEmail,
  type ConfirmationEmail,
  type FormEmail,
  type SiteEmails,
  writtenBySite,
} from "../mail/templates.ts";
import { formPage } from "../forms/form-page.ts";
import { IconLibrary } from "../icons/library.ts";
import type { ToolContext } from "../mcp/tools.ts";
import { fetchImage } from "./fetch-image.ts";
import {
  assertTermSlug,
  assertUnused,
  checkReferences,
  isReferenced,
  renameReferences,
} from "../content/references.ts";
import { applySeed, exportSeed, planSeed } from "../content/seed.ts";
import { checkContent } from "../content/content-check.ts";
import {
  SITE_SETTINGS_NODE,
  type SiteSettings,
  parseSettings as parseSiteSettings,
  settingsAsType,
  settingsValues,
} from "../content/site-settings.ts";

/** A seed comes in one request, so it can be checked whole: a few hundred items with their text (the server takes
 * requests up to a little over 10 MB). */
const MAX_SEED_BYTES = 10 * 1024 * 1024;

export const ADMIN_PATH = "/admin";
const API_PATH = `${ADMIN_PATH}/api`;
const MCP_PATH = `${ADMIN_PATH}/mcp`;
const ASSETS_PATH = `${ADMIN_PATH}/assets`;
const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;
/** "Forgot password" emails: per address of the asker, and per email asked for (so nobody's inbox is flooded). */
const RESET_ASKS_PER_ADDRESS = 5;
const RESET_ASKS_PER_EMAIL = 3;
const RESET_WINDOW_SECONDS = 60 * 60;
/** How long the link to choose a password works: in the email of someone just added, and after a reset of access. */
const WELCOME_LINK_HOURS = 7 * 24;
const RESET_ACCESS_LINK_HOURS = 24;
/** Account emails one owner can have sent in an hour, so a script gone wrong cannot flood anyone. */
const ACCOUNT_EMAILS_PER_HOUR = 30;
/** Which of the site's templates (`src/emails.ts`) writes each account email. */
const ACCOUNT_TEMPLATES = { added: "userAdded", role: "roleChanged", reset: "accessReset" } as const;

const ASSETS: Record<string, string> = {
  "editor.js": "text/javascript; charset=utf-8",
  "editor.css": "text/css; charset=utf-8",
};

export interface AdminOptions {
  brim: Brim;
  /**
   * The site's public address (Astro's `site`), for links that leave the site in an email, such as a "forgot
   * password" link. Never taken from the request alone: its Host header is the sender's to write.
   */
  siteUrl?: string | undefined;
  /** Astro's i18n setup, when the site is multilingual. */
  locales?: LocaleConfig | undefined;
  /** The site's content types. Asked for on each request, so changes to their declaration show up at once. */
  contentTypes?: () => ContentType[] | Promise<ContentType[]>;
  /** The site's page templates, asked for on each request like the content types. */
  pageTemplates?: () => PageTemplate[] | Promise<PageTemplate[]>;
  /** The site's own settings (`src/site-settings.ts`), or null when it declares none. */
  siteSettings?: () => SiteSettings | null | Promise<SiteSettings | null>;
  /** The emails the site writes itself (`src/emails.ts`), for their preview. */
  emails?: () => SiteEmails | null | undefined | Promise<SiteEmails | null | undefined>;
  /** Where uploaded images are written: the `uploads` folder of the site's public directory. */
  mediaDirectory?: URL;
  /** Where uploads are written when not in `mediaDirectory`: a storage reached over HTTP (`media.storage`). */
  mediaFiles?: MediaFiles | undefined;
  /**
   * Where the files visitors attach to form messages are kept (`resolveFormFiles`): read here for a download,
   * deleted here with their message. Without it the site takes no files.
   */
  formFiles?: PrivateFiles | undefined;
  /** A small copy of an upload for the editor's picker, when the site's CDN makes them; `undefined` otherwise. */
  thumbnail?: ((url: string) => string | undefined) | undefined;
  /** The video host that takes videos uploaded in the editor. Without one, videos are pasted links only. */
  videoUploads?: VideoUploadsOptions | undefined;
  /** A host's own sign-in, offered on the sign-in form beside the password (`BRIM_HOST_SIGN_IN_URL`). */
  hostSignIn?: HostSignIn | undefined;
  /** Sends the site's email; Site Settings shows who sends and can send a test. */
  mailer?: Mailer | undefined;
  /** The icons the editor offers. Without it: Brim's own set. */
  icons?: IconLibrary | undefined;
  /** The brand's colors, offered first in the editor's color pickers. */
  brandColors?: BrandColor[] | undefined;
  /** The site's name and favicon, shown in the editor's tab too. */
  identity?: SiteIdentity | undefined;
  /** How the video host is reached; tests put a fake host here. */
  fetch?: typeof fetch;
  /** Paths of the site's pages, for the editor's page switcher. */
  pages?: () => string[];
  /** Patterns of the dynamic routes in src/pages (`/produse/[category]`), for `brim check --content`. */
  patterns?: () => string[];
  /** Directory holding the built editor (`editor.js`, `editor.css`). */
  assetsDirectory: URL;
  /** Called after content changed, with the pages to rebuild. `undefined` means the whole site. */
  onChange?: (pagePath: string | undefined) => void | Promise<void>;
  /**
   * The HTML of a page as the dev server renders it, for the MCP's page reading.
   * Defaults to fetching the page from the site itself.
   */
  renderPage?: (url: URL) => Promise<string>;
  /**
   * The query parameters each page and route of the site reads (see `QueryRules`), answered in /admin/api/info for
   * a host that keeps pages in a CDN. Without it the site declares nothing and every parameter is kept.
   */
  queryParams?: () => QueryRules | Promise<QueryRules>;
}

/**
 * The header a request that changed what visitors see is answered with (`X-Brim-Changed: live`), so a host that keeps
 * pages in a CDN empties it then, and only then: drafts saved, an item published, a page moved, the redirects or the
 * site's settings changed, a change taken back. Drafts being typed, reads, sign-ins and uploads never carry it. Said
 * in /admin/api/info as the capability `live-change-header`.
 */
export const LIVE_CHANGE_HEADER = "x-brim-changed";

/** Whether the request being answered (an MCP message's tool calls included) changed what visitors see. */
const liveChanges = new AsyncLocalStorage<{ live: boolean }>();

export interface RequestInfo {
  /** Address of the visitor, used only to slow down password guessing. */
  clientAddress: string;
  /**
   * Where this server itself answers, when `request.url` cannot be trusted to say so: the dev server builds that
   * from the `Host` header. Astro's built server already puts only an address it checked in `request.url`.
   */
  serverOrigin?: string | undefined;
}

export type AdminHandler = (request: Request, info: RequestInfo) => Promise<Response | undefined>;

/**
 * Everything under `/admin`: the editor's pages, its assets and the protected API.
 * Resolves to `undefined` for any other path, so the caller can serve the site.
 */
export function createAdminHandler(options: AdminOptions): AdminHandler {
  const {
    brim,
    locales,
    assetsDirectory,
    onChange,
    pages = () => [],
    contentTypes = () => [],
    pageTemplates = () => [],
    siteSettings = () => null,
  } = options;
  const rateLimiter = new RateLimiter(brim.db);
  const mediaFiles = options.mediaFiles ?? options.mediaDirectory;
  const media = mediaFiles ? new MediaStore(brim.db, mediaFiles) : undefined;

  const formFiles = options.formFiles && new FormFiles(options.formFiles, () => brim.forms.secret());

  const videos = VideoHost.from(options.videoUploads, options.fetch);
  const oauthRoutes = createOAuthRoutes({
    brim,
    rateLimiter,
    siteName: options.identity?.name,
    favicon: options.identity?.favicon,
    hostSignIn: options.hostSignIn,
    signInHeaders,
    signOutHeaders,
    loginKeys: (clientAddress, email) => loginKeys({ clientAddress }, email),
  });
  const mailSettings = new MailSettingsStore(brim.db);

  /** The signed-in user, when their role allows all of `permissions` (see `auth/permissions.ts`). */
  async function allowed(request: Request, ...permissions: Permission[]): Promise<User> {
    const user = await currentUser(request);
    for (const permission of permissions) need(user, permission);
    return user;
  }

  function need(user: User, permission: Permission): void {
    if (!can(user, permission)) throw new HttpError(403, REFUSALS[permission]);
  }

  /**
   * After content changed: the dev server draws the pages again (`onChange`), and a change visitors can see marks
   * the request, which is then answered with `X-Brim-Changed: live`.
   */
  async function changed(pagePath: string | undefined, visible = true): Promise<void> {
    const request = liveChanges.getStore();
    if (visible && request) request.live = true;
    await onChange?.(pagePath);
  }

  /** What the site's pages read, as /admin/api/info says it; a failure to read it declares nothing. */
  async function queryRules(): Promise<QueryRules> {
    try {
      return (await options.queryParams?.()) ?? {};
    } catch {
      return {};
    }
  }

  /** Site Settings are the owners' to change. */
  const currentOwner = (request: Request): Promise<User> => allowed(request, "settings");

  /** Remembers an element's saved value before it changes, so the change can be taken back. */
  async function rememberNode(
    user: User,
    scope: string,
    nodeId: string,
    page: string,
    action: "changed" | "reset",
    always = false,
  ): Promise<void> {
    const saved = (await brim.content.loadNodes([scope])).find((node) => node.nodeId === nodeId);
    if (!saved && action === "reset") return;
    await brim.history.record({
      target: "node",
      key: `${scope}\n${nodeId}`,
      action,
      page,
      title: nodeId,
      before: saved ? { kind: saved.kind, value: saved.value } : null,
      user: user.email,
      always,
    });
  }

  /** Remembers an item before it changes or is deleted, with what was placed on its own page when it goes. */
  async function rememberItem(
    user: User,
    item: Item,
    action: "changed" | "deleted",
    nodes: StoredNode[] = [],
    always = false,
    translations: string[] = [],
  ): Promise<void> {
    await brim.history.record({
      target: "item",
      key: item.id,
      action,
      page: "",
      title: item.title,
      before: { item, nodes, ...(translations.length > 0 && { translations }) },
      user: user.email,
      always,
    });
  }

  /** Takes a change back: the content becomes what it was before it. Returns the pages to draw again. */
  async function restore(user: User, record: HistoryRecord): Promise<void> {
    if (record.target === "node") {
      const [scope = "", nodeId = ""] = record.key.split("\n");
      need(user, scope.startsWith("type:") ? "templates" : "content");
      const before = record.before as { kind: string; value: unknown } | null;
      await rememberNode(user, scope, nodeId, record.page, before ? "changed" : "reset", true);
      if (before) await brim.content.saveNode(scope, nodeId, before.kind, before.value);
      else await brim.content.resetNode(scope, nodeId);
      return;
    }
    if (record.target === "item") {
      const {
        item,
        nodes = [],
        translations = [],
      } = record.before as { item: Item; nodes?: StoredNode[]; translations?: string[] };
      const current = await brim.items.get(item.id);
      if (current) {
        need(user, "content");
        const type = await contentType(current.type);
        await rememberItem(user, current, "changed", [], true);
        await brim.items.update(current, {
          slug: item.slug,
          title: item.title,
          visibility: item.visibility,
          data: item.data,
        });
        await itemMoved(type, current, { ...current, slug: item.slug, data: item.data, visibility: current.visibility });
        return;
      }
      need(user, "publish");
      const restored = await brim.items.restore(item);
      if (!restored.translationOf) await brim.items.relink(restored.id, translations);
      for (const node of nodes) await brim.content.saveNode(node.scope, node.nodeId, node.kind, node.value);
      await brim.history.remove(record.id);
      return;
    }
    need(user, "pages");
    const { page, nodes = [] } = record.before as { page: PageRecord; nodes?: StoredNode[] };
    if (
      !page.template ||
      pages().some((coded) => normalizePagePath(coded) === page.path) ||
      (await brim.content.page(page.path)).template
    ) {
      throw new ValidationError(`The address ${page.path} is used by another page now.`);
    }
    // It comes back private: whoever restores it looks at it before visitors do.
    await brim.content.createPage(page.path, page.template, page.title ?? "", "private");
    if (Object.keys(page.seo ?? {}).length > 0) await brim.content.setPageSeo(page.path, page.seo as SeoSettings);
    for (const node of nodes) await brim.content.saveNode(node.scope, node.nodeId, node.kind, node.value);
    await brim.history.remove(record.id);
  }

  async function mailView(): Promise<Record<string, unknown>> {
    const settings = await mailSettings.get();
    return { ...(await mailSettings.view()), delivery: options.mailer?.delivery(settings) ?? "none" };
  }
  const icons = options.icons ?? new IconLibrary();

  function videoHost(): VideoHost {
    if (!videos) throw new HttpError(501, "Video uploads are not set up for this site. Paste a video link instead.");
    return videos;
  }

  function mediaStore(): MediaStore {
    if (!media) throw new HttpError(501, "Uploads are not set up for this site.");
    return media;
  }

  /** The user behind the request: the editor's session cookie, or an access token from `brim token add`. */
  /**
   * Where a "forgot password" link points: the site's configured address, or the host's. A request's own Host is
   * trusted only on this computer (`localhost`): anywhere else whoever asks could write it, and the link, with its
   * token, would go to their server.
   */
  function resetLinkOrigin(request: Request): string {
    const configured = [options.siteUrl, process.env.BRIM_SITE_URL]
      .map((value) => String(value ?? "").trim())
      .find((value) => /^https?:\/\//.test(value));
    if (configured) return new URL(configured).origin;
    const origin = requestOrigin(request);
    if (isLocalHost(new URL(origin).hostname)) return origin;
    throw new HttpError(501, "Set `site` in astro.config.mjs so password links point at your site.");
  }

  /**
   * Tells someone what changed in their access to the site, through the site's own email (its template in
   * `src/emails.ts`, or Brim's), with a link to choose their password when they need one. The change is made either
   * way: the answer says whether the email went out, and why not.
   */
  async function sendAccountEmail(
    request: Request,
    kind: AccountEmail["kind"],
    user: User,
    by: User,
    previousRole?: Role,
  ): Promise<{ emailed: boolean; emailError?: string }> {
    try {
      const settings = await mailSettings.get();
      const mailer = options.mailer;
      if (!mailer || mailer.delivery(settings) === "none") {
        return { emailed: false, emailError: "Email is not set up for this site, so no email was sent." };
      }
      if (!(await rateLimiter.allow(`account-mail:${by.id}`, ACCOUNT_EMAILS_PER_HOUR, 60 * 60))) {
        return { emailed: false, emailError: "Too many account emails this hour, so no email was sent." };
      }
      const origin = resetLinkOrigin(request);
      const hours = linkHours(kind);
      const link = hours ? await brim.accounts.createResetToken(user.email, hours * 60 * 60) : undefined;
      const email = accountEmail(origin, kind, user, by, link?.token, previousRole);
      await mailer.send(settings, await accountMessage(email));
      return { emailed: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("[brim] The account email was not sent:", reason);
      return { emailed: false, emailError: reason };
    }
  }

  function linkHours(kind: AccountEmail["kind"]): number {
    return kind === "added" ? WELCOME_LINK_HOURS : kind === "reset" ? RESET_ACCESS_LINK_HOURS : 0;
  }

  /** What an account email's template is given. */
  function accountEmail(
    origin: string,
    kind: AccountEmail["kind"],
    user: User,
    by: User | undefined,
    passwordToken: string | undefined, // betterleaks:allow
    previousRole?: Role,
  ): AccountEmail {
    return {
      kind,
      site: new URL(origin).host,
      siteUrl: origin,
      email: user.email,
      role: user.role,
      roleDescription: ROLE_DESCRIPTIONS[user.role],
      ...(previousRole && { previousRole }),
      ...(by && { by: by.email }),
      editorUrl: `${origin}${ADMIN_PATH}/edit`,
      // The token is in the fragment, which browsers never send, so a link checker opening it cannot use it up.
      ...(passwordToken && {
        passwordUrl: `${origin}${ADMIN_PATH}/edit#reset=${passwordToken}`,
        passwordLinkHours: linkHours(kind), // betterleaks:allow
      }),
      ...(options.hostSignIn && { hostSignIn: { name: options.hostSignIn.name, url: options.hostSignIn.url } }),
      sentAt: new Date(),
    };
  }

  /** The account email as the site's template writes it (`src/emails.ts`), or Brim's own. */
  async function accountMessage(email: AccountEmail) {
    const settings = await mailSettings.get();
    const template = (await Promise.resolve(options.emails?.()).catch(() => undefined))?.[ACCOUNT_TEMPLATES[email.kind]];
    return writtenBySite(accountNotice(email, settings), template, email);
  }

  /** An email shown as a page of its own, for its author to look at: `?text` shows its subject and text version. */
  function emailPreview(request: Request, message: { subject: string; html: string; text: string; fromName: string }): Response {
    const text = new URL(request.url).searchParams.has("text");
    const headers = {
      "content-type": text ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      "cache-control": "no-store",
      // The visitor's words are in it: nothing in the preview runs.
      "content-security-policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
    };
    // A page of its own, as a phone shows it: the email clients' own viewport, not a desktop's 980 px.
    const shown = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${message.subject.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</title>${message.html}`;
    return new Response(text ? `Subject: ${message.subject}\nFrom: ${message.fromName}\n\n${message.text}` : shown, { headers });
  }

  /** A change to the users, its refusals said the way the API says them. */
  async function usersChange<T>(change: () => Promise<T>): Promise<T> {
    try {
      return await change();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("There is no user")) throw new HttpError(404, message);
      if (message.includes("already exists")) throw new HttpError(409, message);
      throw new ValidationError(message);
    }
  }

  function roleOf(value: unknown): Role {
    if (!ROLES.includes(value as Role)) throw new ValidationError('The role is "owner" or "editor".');
    return value as Role;
  }

  async function currentUser(request: Request): Promise<User> {
    const user = await requestUser(brim, request);
    if (!user) {
      throw new HttpError(401, bearerToken(request) ? "The access token is not valid." : "Sign in to continue.");
    }
    return user;
  }

  async function contentType(key: unknown): Promise<ContentType> {
    const type = (await contentTypes()).find((candidate) => candidate.key === key);
    if (!type) throw new HttpError(404, "This content type does not exist.");
    return type;
  }

  /** An item's language as stored: "" for the default one; a code the site does not declare is refused. */
  /** Where a language's site settings are kept: the site's shared content of that language, as pages read it. */
  function settingsScope(value: unknown): string {
    if (!locales) return siteScope();
    const code = value === undefined || value === null || value === "" ? locales.defaultLocale : String(value);
    if (!locales.locales.includes(code)) throw new ValidationError(`"${code}" is not one of the site's languages.`);
    return siteScope(code);
  }

  function localeOf(value: unknown): string {
    if (value === undefined || value === null || value === "") return "";
    const stored = storedLocale(String(value), locales);
    if (stored === undefined) throw new ValidationError(`"${String(value)}" is not one of the site's languages.`);
    return stored;
  }

  async function existingItem(body: Record<string, unknown>): Promise<Item> {
    const item = await brim.items.get(requireString(body.id, "id"));
    if (!item) throw new HttpError(404, "This item does not exist.");
    return item;
  }

  async function pageTemplate(key: unknown): Promise<PageTemplate> {
    const template = (await pageTemplates()).find((candidate) => candidate.key === key);
    if (!template) throw new HttpError(404, "This page template does not exist.");
    return template;
  }

  /** A page added from a template; pages written in code cannot be removed or renamed here. */
  async function templatePage(path: string): Promise<PageRecord> {
    const page = await brim.content.page(path);
    if (!page.template) throw new HttpError(404, "Only pages added from a template can be changed this way.");
    return page;
  }

  /** The address of a new page: free, and not one the site's code or its content types answer. */
  async function newPagePath(body: Record<string, unknown>, template: PageTemplate, title: string): Promise<string> {
    const given = typeof body.path === "string" && body.path.trim() !== "" ? body.path.trim() : undefined;
    const path = normalizePagePath(
      given?.replace(/^\/*/, "/") ?? `/${template.folder ? `${template.folder}/` : ""}${slugify(title) || "page"}`,
    );
    const segments = path.split("/").slice(1);
    if (path === "/" || !segments.every(isSlug)) {
      throw new ValidationError(
        "The address can only have lowercase letters, digits and dashes, e.g. /services/lawn-care.",
      );
    }
    const reserved = [ADMIN_PATH.slice(1), "404", "uploads", ...(await contentTypes()).flatMap(addressPrefixes)];
    if (reserved.includes(segments[0] ?? "")) throw new ValidationError(`The address ${path} is reserved.`);
    if (pages().some((page) => normalizePagePath(page) === path) || (await brim.content.page(path)).template) {
      throw new ValidationError(`The address ${path} is already used by another page.`);
    }
    return path;
  }

  /**
   * What follows an item to its new address when its slug (or a value in its path) changes: its page's search
   * settings, what the owner placed on its page when that is written in code, and, for a published item, a redirect
   * from the old address, so links and search results that point there still arrive.
   */
  async function itemMoved(type: ContentType, existing: Item, item: Item): Promise<void> {
    const from = normalizePagePath(itemPagePath(type, existing, locales));
    const to = normalizePagePath(itemPagePath(type, item, locales));
    if (from === to) return;
    await brim.content.movePageSettings(from, to);
    if (!type.component) await brim.content.moveNodes(pageScope(from), pageScope(to));
    const redirects = await brim.content.redirects();
    if (existing.visibility === "published") {
      await brim.content.setRedirects(redirectsAfterMove(redirects, from, to));
    } else if (redirects.some((redirect) => redirect.from === to)) {
      await brim.content.setRedirects(redirects.filter((redirect) => redirect.from !== to));
    }
  }

  /** `slug`, or the first of `slug-2`, `slug-3`… that no item of the type has in that language. */
  async function freeSlug(type: string, slug: string, locale: string | undefined): Promise<string> {
    const taken = async (candidate: string) => (await brim.items.bySlug(type, candidate, { locale: locale ?? "" })) !== undefined;
    if (!(await taken(slug))) return slug;
    for (let number = 2; number < 1000; number++) {
      const candidate = `${slug.slice(0, 120)}-${number}`;
      if (!(await taken(candidate))) return candidate;
    }
    return slug;
  }

  /** A new page at an address an old redirect still points away from: the redirect goes, so the page is seen. */
  async function clearRedirectFrom(path: string): Promise<boolean> {
    const redirects = await brim.content.redirects();
    if (!redirects.some((redirect) => redirect.from === path)) return false;
    await brim.content.setRedirects(redirects.filter((redirect) => redirect.from !== path));
    return true;
  }

  /**
   * A term moved to a new slug: its translations, which share its slug, move with it, and the items pointing at it
   * (in every language) follow, once no item keeps the old slug.
   */
  async function termMoved(types: ContentType[], type: ContentType, existing: Item, item: Item): Promise<void> {
    if (item.slug === existing.slug || !isReferenced(types, type.key)) return;
    if (existing.translationOf === null) {
      for (const translation of await brim.items.translations(existing)) {
        if (translation.id === existing.id || translation.slug !== existing.slug) continue;
        const moved = await brim.items.update(translation, { ...translation, slug: item.slug });
        await itemMoved(type, translation, moved);
      }
    }
    if (!(await brim.items.list(type.key)).some((other) => other.slug === existing.slug)) {
      for (const changed of await renameReferences(types, brim.items, existing, item.slug)) {
        await itemMoved(changed.type, changed.before, changed.item);
      }
    }
  }

  /** An element that shows a field of an item: only the field is saved, into the item, checked like the item form. */
  async function saveToItem(
    user: User,
    body: Record<string, unknown>,
    nodeId: string,
    kind: string,
    value: Record<string, unknown>,
  ): Promise<Response> {
    const live = await existingItem({ id: body.item });
    const field = requireString(body.field, "field");
    if (body.draft === true) {
      const existing = await brim.drafts.overlayItem(live);
      const next = applyToItem(await contentType(live.type), existing, field, kind, value);
      return json({ nodeId, kind, ...(await draftItem(live, next, pagePathOf(body))) });
    }
    const type = await contentType(live.type);
    const next = applyToItem(type, live, field, kind, value);
    await rememberItem(user, live, "changed");
    const item = await brim.items.update(live, next);
    await itemMoved(type, live, item);
    await changed(undefined);
    return json({ nodeId, kind, item });
  }

  /** Where a node is kept: with the whole site, with its page, or with the template of the item whose page it is. */
  async function scopeOf(body: Record<string, unknown>, pagePath: string): Promise<string> {
    if (body.scope === "site") return siteScope(localeOfPath(pagePath, locales));
    if (body.scope === "page") return pageScope(pagePath);
    if (body.scope === "template") {
      const itemPage = itemPageOf(await contentTypes(), pagePath, locales);
      if (!itemPage) throw new HttpError(400, `${pagePath} is not the page of an item, so it has no template.`);
      return typeScope(itemPage.type.key, localeOfPath(pagePath, locales));
    }
    throw new HttpError(400, '"scope" must be "page", "site" or "template".');
  }

  /** An element's value as sent: a block's settings checked against its schema, a primitive against its shape. */
  function nodeValueOf(kind: string, input: unknown): unknown {
    const block = Object.hasOwn(blockDefinitions, kind) ? blockDefinitions[kind] : undefined;
    return block && !isPrimitive(kind) ? parseSettings(block, input) : parseNodeValue(kind as NodeKind, input);
  }

  /**
   * Writes one draft and answers with the change, so the editor can take it back (`before`) and make it again
   * (`after`); `null` is no draft, the saved content. `drafts` counts the changes nobody has saved yet.
   */
  async function writeDraft(
    target: DraftTarget,
    key: string,
    value: unknown,
    page: string,
  ): Promise<{ change: { target: DraftTarget; key: string; page: string; before: unknown; after: unknown }; drafts: number }> {
    const before = await brim.drafts.get(target, key);
    await brim.drafts.set(target, key, value, page);
    return {
      change: { target, key, page, before: before ?? null, after: value ?? null },
      drafts: await brim.drafts.count(),
    };
  }

  /** An item's content held back as a draft; who can see it is never drafted. Answers with the item as previewed. */
  async function draftItem(live: Item, next: ItemContentDraft, page: string) {
    const content: ItemContentDraft = { slug: next.slug, title: next.title, data: next.data };
    const same = content.slug === live.slug && content.title === live.title && sameJson(content.data, live.data);
    const answer = await writeDraft("item", live.id, same ? undefined : content, page);
    return { ...answer, item: { ...live, ...content } };
  }

  /** Checks a draft the editor sends back to undo or redo a change, as if it were made anew. */
  async function checkedDraft(user: User, target: DraftTarget, key: string, value: unknown): Promise<unknown> {
    if (target === "node") {
      const [scope = "", nodeId = "", ...rest] = key.split("\n");
      if (rest.length > 0 || !isNodeId(nodeId) || !/^(page:|site|type:)/.test(scope)) {
        throw new HttpError(400, "This is not an element of the site.");
      }
      assertElement(nodeId);
      if (scope.startsWith("type:")) need(user, "templates");
      if (value === null) return undefined;
      const draft = value as Record<string, unknown>;
      if (draft.reset === true) return { reset: true };
      const kind = requireString(draft.kind, "kind");
      return { kind, value: nodeValueOf(kind, draft.value) };
    }
    if (target === "item") {
      const live = await existingItem({ id: key });
      if (value === null) return undefined;
      const type = await contentType(live.type);
      const parsed = parseItem(type, { ...(value as Record<string, unknown>), visibility: live.visibility });
      return { slug: parsed.slug, title: parsed.title, data: parsed.data };
    }
    if (target === "seo") return value === null ? undefined : parseSeo(value);
    throw new HttpError(400, '"target" must be "node", "item" or "seo".');
  }

  /**
   * Writes every draft to the content visitors see, each remembered in the history so it can be taken back.
   * A draft that cannot be saved (an address taken meanwhile, an item deleted) stays, and is reported.
   */
  async function saveDrafts(user: User): Promise<{ saved: number; failed: { page: string; error: string }[] }> {
    let saved = 0;
    const failed: { page: string; error: string }[] = [];
    for (const row of await brim.drafts.all()) {
      try {
        if (row.target === "node") {
          const [scope = "", nodeId = ""] = row.key.split("\n");
          if (scope.startsWith("type:")) need(user, "templates");
          const draft = row.value as NodeDraft;
          if ("reset" in draft) {
            await rememberNode(user, scope, nodeId, row.page, "reset", true);
            await brim.content.resetNode(scope, nodeId);
          } else {
            await rememberNode(user, scope, nodeId, row.page, "changed", true);
            await brim.content.saveNode(scope, nodeId, draft.kind, draft.value);
          }
        } else if (row.target === "item") {
          const existing = await brim.items.get(row.key);
          if (existing) {
            const content = row.value as ItemContentDraft;
            const type = await contentType(existing.type);
            await rememberItem(user, existing, "changed", [], true);
            const item = await brim.items.update(existing, { ...content, visibility: existing.visibility });
            await itemMoved(type, existing, item);
            await termMoved(await contentTypes(), type, existing, item);
          }
        } else {
          await brim.content.setPageSeo(row.key, row.value as SeoSettings);
        }
        await brim.drafts.set(row.target, row.key, undefined, row.page);
        saved++;
      } catch (error) {
        if (!(error instanceof HttpError || error instanceof ValidationError)) throw error;
        failed.push({ page: row.page, error: error.message });
      }
    }
    if (saved > 0) await changed(undefined);
    return { saved, failed };
  }

  const routes: Record<string, (request: Request, info: RequestInfo) => Promise<Response>> = {
    // What runs here, for a host or a tool checking that it can work with this site. Open to anyone.
    // The icon sets the editor offers and, when asked, the icon a block has now.
    "GET /icons": async (request) => {
      await currentUser(request);
      const value = new URL(request.url).searchParams.get("value");
      return json({ sets: icons.sets(), ...(value !== null && { icon: icons.find(value) ?? null }) });
    },
    "GET /info": async () =>
      json({
        name: "brimjs",
        version: VERSION,
        schemaVersion: SCHEMA_VERSION,
        // The editor reads this too: it offers "Upload video" only when a video host is set up.
        capabilities: [
          "sign-in-link",
          "mail-settings",
          "roles",
          // `/admin/api/users`: an owner (or a host with an owner's token) adds users, changes roles and resets
          // access there, and the site emails the person about it.
          "users",
          "history",
          "drafts",
          // AI apps connect to /admin/mcp with OAuth (the user signs in and allows them); `/admin/api/connections`
          // lists and disconnects them.
          "oauth",
          // A request that changed what visitors see is answered with `X-Brim-Changed: live`.
          "live-change-header",
          // `query` below: the query parameters each page and route reads.
          ...(options.queryParams ? ["query-params"] : []),
          ...(videos ? ["video-uploads"] : []),
          // Forms can take files from visitors only where the site has a private place to keep them.
          ...(formFiles ? ["form-files"] : []),
        ],
        // The sign-in form offers it beside the password; the host sends its user back through /session/link.
        hostSignIn: options.hostSignIn ?? null,
        brandColors: options.brandColors ?? [],
        // The site's languages, from Astro's i18n in its code: the editor switches and translates between them.
        locales: locales ?? null,
        // What a page falls back to in search results and shared links, for the previews in Page Settings.
        identity: {
          name: options.identity?.name ?? null,
          titleTemplate: options.identity?.titleTemplate ?? null,
          description: options.identity?.description ?? null,
          image: options.identity?.image ?? null,
        },
        ...(options.queryParams && { query: await queryRules() }),
      }),

    "POST /session": async (request, info) => {
      const body = await readJson(request);
      const email = requireString(body.email, "email");
      const password = requireString(body.password, "password"); // betterleaks:allow

      // Every attempt is counted before the password is checked, so attempts sent all at once cannot pass the limit
      // together; one that signs in correctly is given back, so it uses up nobody's attempts.
      const counted: string[] = [];
      const giveBack = async () => {
        for (const key of counted) await rateLimiter.release(key, LOGIN_WINDOW_SECONDS);
      };
      for (const key of loginKeys(info, email)) {
        counted.push(key);
        if (await rateLimiter.allow(key, LOGIN_ATTEMPTS, LOGIN_WINDOW_SECONDS)) continue;
        // A refused attempt was not tried: it is given back, so waiting out the window is enough. Nothing after it is
        // counted, so an address past its limit leaves no row for each email it goes on to name.
        await giveBack();
        throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
      }

      const user = await brim.accounts.authenticate(email, password);
      if (!user) throw new HttpError(401, "The email or password is wrong.");
      await giveBack();

      const session = await brim.accounts.startSession(user.id);
      return json(
        { user, permissions: permissionsOf(user.role) },
        { headers: signInHeaders(request, session.token, session.maxAgeSeconds) },
      );
    },

    /**
     * "Forgot password": emails a one-time link to set a new one, valid for an hour. The answer is the same whether
     * the email belongs to a user or not, and the email goes out after the answer, so neither the words nor the time
     * taken tell who has an account here.
     */
    "POST /password/forgot": async (request, info) => {
      const body = await readJson(request);
      const email = normalizeEmail(requireString(body.email, "email"));
      if (!(await rateLimiter.allow(`reset:address:${info.clientAddress}`, RESET_ASKS_PER_ADDRESS, RESET_WINDOW_SECONDS))) {
        throw new HttpError(429, "Too many requests. Try again in an hour.");
      }
      const settings = await mailSettings.get();
      if (!options.mailer || options.mailer.delivery(settings) === "none") {
        throw new HttpError(501, "This site cannot send email yet. Ask whoever runs it to reset your password.");
      }
      const origin = resetLinkOrigin(request);
      const answer = json({
        sent: true,
        message: "If this email has an account here, a link to set a new password is on its way.",
      });
      if (!(await rateLimiter.allow(`reset:email:${emailKey(email)}`, RESET_ASKS_PER_EMAIL, RESET_WINDOW_SECONDS))) return answer;
      const mailer = options.mailer;
      void (async () => {
        const reset = await brim.accounts.createResetToken(email);
        if (!reset) return;
        // The token is in the address's fragment, which browsers never send to a server or in a Referer.
        const link = `${origin}${ADMIN_PATH}/edit#reset=${reset.token}`;
        await mailer.send(settings, passwordResetNotice(new URL(origin).host, settings, email, link));
      })().catch((error: unknown) => {
        console.error("[brim] The password reset email was not sent:", error instanceof Error ? error.message : error);
      });
      return answer;
    },

    /** Sets a new password with the emailed link, signs everyone else out, and signs this browser in. */
    "POST /password/reset": async (request, info) => {
      const body = await readJson(request);
      const token = requireString(body.token, "token");
      const password = requireString(body.password, "password"); // betterleaks:allow
      if (!(await rateLimiter.allow(`reset-use:address:${info.clientAddress}`, LOGIN_ATTEMPTS, LOGIN_WINDOW_SECONDS))) {
        throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
      }
      let user: User | undefined;
      try {
        user = await brim.accounts.resetPassword(token, password);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
      if (!user) throw new HttpError(410, "This link has expired or was already used. Ask for a new one.");
      const session = await brim.accounts.startSession(user.id);
      return json(
        { user, permissions: permissionsOf(user.role) },
        { headers: signInHeaders(request, session.token, session.maxAgeSeconds) },
      );
    },

    /**
     * A signed-in user changes their password, giving the one they have. Every other session and access token ends
     * (whoever knew the old password is out); this browser stays signed in with a new session.
     */
    "PUT /password": async (request, info) => {
      const user = await currentUser(request);
      if (bearerToken(request)) throw new HttpError(403, "Change the password in the editor, signed in.");
      const body = await readJson(request);
      const current = requireString(body.current, "current");
      const password = requireString(body.password, "password"); // betterleaks:allow
      const keys = loginKeys(info, user.email);
      for (const key of keys) {
        if (!(await rateLimiter.allow(key, LOGIN_ATTEMPTS, LOGIN_WINDOW_SECONDS))) {
          throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
        }
      }
      if (!(await brim.accounts.authenticate(user.email, current))) {
        throw new ValidationError("The current password is wrong.");
      }
      for (const key of keys) await rateLimiter.release(key, LOGIN_WINDOW_SECONDS);
      try {
        await brim.accounts.setPassword(user.email, password);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
      const session = await brim.accounts.startSession(user.id);
      return json({ user }, { headers: signInHeaders(request, session.token, session.maxAgeSeconds) });
    },

    /**
     * The AI apps connected with OAuth: one's own, or everyone's for an owner who asks with `?all` (a host's dashboard
     * does, with an owner's token). With the MCP's address, which is what a person pastes into the app.
     */
    "GET /connections": async (request) => {
      const user = await currentUser(request);
      const all = new URL(request.url).searchParams.has("all");
      if (all) need(user, "users");
      return json({
        mcp: `${requestOrigin(request)}${MCP_PATH}`,
        connections: await brim.accounts.oauth.connections(all ? undefined : user.id),
      });
    },

    // Who is signed in and what their role allows, so the editor offers only what will work.
    "GET /session": async (request) => {
      const user = await currentUser(request);
      return json({ user, permissions: permissionsOf(user.role) });
    },

    // A link from `brim user link` (or from a host's dashboard): signs its user in once and opens the editor.
    // A link that is wrong, used or too old opens the editor too, where the sign-in form waits.
    "GET /session/link": async (request, info) => {
      const params = new URL(request.url).searchParams;
      const token = params.get("token") ?? "";
      // `to` opens the editor on one page (`/admin/edit/despre-noi`); only an address inside the editor is followed.
      const to = params.get("to") ?? "";
      const target = /^\/admin\/edit(\/[\w\-/.]*)?$/.test(to) && !to.includes("..") ? to : `${ADMIN_PATH}/edit`;
      const headers = new Headers({
        location: target,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      const allowed = await rateLimiter.allow(
        `link:address:${info.clientAddress}`,
        LOGIN_ATTEMPTS,
        LOGIN_WINDOW_SECONDS,
      );
      const user = allowed && token ? await brim.accounts.redeemSignInToken(token) : undefined;
      if (user) {
        const session = await brim.accounts.startSession(user.id);
        for (const cookie of signInHeaders(request, session.token, session.maxAgeSeconds).getSetCookie()) {
          headers.append("set-cookie", cookie);
        }
      }
      return new Response(null, { status: 303, headers });
    },

    "DELETE /session": async (request) => {
      for (const token of sessionCookies(request)) await brim.accounts.endSession(token);
      return json({}, { headers: signOutHeaders(request) });
    },

    // Pages written in code, then the ones added from templates, in one list by address.
    "GET /pages": async (request) => {
      await currentUser(request);
      const paths = [...new Set(pages().map(normalizePagePath))];
      const coded = await Promise.all(paths.map((path) => brim.content.page(path)));
      const added = (await brim.content.templatePages()).filter((page) => !paths.includes(page.path));
      // The editor asks with `?draft`: the SEO settings it shows are the ones it previews.
      const draft = new URL(request.url).searchParams.has("draft");
      const listed = draft
        ? await Promise.all(
            [...coded, ...added].map(async (page) => ({
              ...page,
              seo: await brim.drafts.overlaySeo(page.path, page.seo),
            })),
          )
        : [...coded, ...added];
      return json({ pages: listed.sort((a, b) => a.path.localeCompare(b.path)) });
    },

    "POST /pages": async (request) => {
      await allowed(request, "pages");
      const body = await readJson(request);
      const template = await pageTemplate(body.template);
      const title = titleOf(body);
      const path = await newPagePath(body, template, title);
      const visibility = visibilityOf(body.visibility ?? "private");
      const page = await brim.content.createPage(path, template.key, title, visibility);
      // A private page shows nobody anything yet.
      await changed(path, visibility === "published");
      return json({ page }, { status: 201 });
    },

    "PUT /pages": async (request) => {
      await allowed(request, "content");
      const body = await readJson(request);
      const path = pagePathOf(body);
      const seo = body.seo === undefined ? undefined : parseSeo(body.seo);
      // From the editor, SEO settings wait in the draft like the page's content; nothing else here is drafted.
      if (body.draft === true) {
        if (!seo) throw new HttpError(400, "Only a page's SEO settings can be drafted.");
        const page = await brim.content.page(path);
        const answer = await writeDraft("seo", path, sameJson(seo, page.seo) ? undefined : seo, path);
        return json({ ...page, seo, ...answer });
      }
      if (body.title !== undefined) {
        await templatePage(path);
        await brim.content.setPageTitle(path, titleOf(body));
      }
      if (body.visibility !== undefined) await brim.content.setPageVisibility(path, visibilityOf(body.visibility));
      if (seo) await brim.content.setPageSeo(path, seo);
      await changed(path);
      return json(await brim.content.page(path));
    },

    // A page added from a template gets a new address; the old one keeps working, as a redirect to the new one.
    "POST /pages/move": async (request) => {
      await allowed(request, "pages");
      const body = await readJson(request);
      const page = await templatePage(pagePathOf(body));
      const template = (await pageTemplates()).find((candidate) => candidate.key === page.template);
      if (!template) throw new ValidationError("This page's template is no longer in the site's code.");
      const requested = typeof body.to === "string" ? normalizePagePath(body.to.trim().replace(/^\/*/, "/")) : "";
      if (requested === page.path) return json({ page });
      const to = await newPagePath({ path: body.to }, template, page.title ?? "");
      await brim.content.movePage(page.path, to);
      await brim.content.setRedirects(redirectsAfterMove(await brim.content.redirects(), page.path, to));
      await changed(page.path);
      await changed(to);
      return json({ page: await brim.content.page(to) });
    },

    "GET /redirects": async (request) => {
      await currentUser(request);
      return json({ redirects: await brim.content.redirects() });
    },

    // The whole list, as the owner keeps it in Site Settings.
    "PUT /redirects": async (request) => {
      await currentOwner(request);
      const redirects = parseRedirects((await readJson(request)).redirects);
      await brim.content.setRedirects(redirects);
      await changed(undefined);
      return json({ redirects });
    },

    "DELETE /pages": async (request) => {
      const user = await allowed(request, "pages");
      const page = await templatePage(pagePathOf(await readJson(request)));
      const { path } = page;
      await brim.history.record({
        target: "page",
        key: path,
        action: "deleted",
        page: path,
        title: page.title || path,
        before: { page, nodes: await brim.content.loadNodes([pageScope(path)]) },
        user: user.email,
        always: true,
      });
      await brim.content.deletePage(path);
      await changed(path);
      return json({});
    },

    "GET /templates": async (request) => {
      await currentUser(request);
      return json({ templates: (await pageTemplates()).map(templateInfo) });
    },

    "GET /media": async (request) => {
      await currentUser(request);
      // A page of the library at a time (`?search=`, `?folder=` with "" for the gallery, `?after=` the `next` of
      // the page before), with small copies for the picker, not the uploads at their full size.
      const params = new URL(request.url).searchParams;
      const { files, next } = await mediaStore().page({
        ...(params.has("search") && { search: params.get("search") ?? "" }),
        ...(params.has("folder") && { folder: params.get("folder") ?? "" }),
        ...(params.has("after") && { after: params.get("after") ?? "" }),
        ...(params.has("limit") && { limit: Number(params.get("limit")) || 120 }),
      });
      const { thumbnail } = options;
      return json({
        files: thumbnail
          ? files.map((file) => {
              const small = thumbnail(file.url);
              return small ? { ...file, thumbnail: small } : file;
            })
          : files,
        ...(next && { next }),
      });
    },

    // The image is the request body itself; its original name travels in a header.
    "POST /media": async (request) => {
      await allowed(request, "content");
      const store = mediaStore();
      if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) {
        throw new HttpError(413, "The image is larger than 10 MB.");
      }
      // An image goes to the gallery, or to the folder of one item: `<type>/<item id>`.
      const folder = safeDecode(request.headers.get("x-media-folder") ?? "");
      if (folder) {
        const [typeKey, itemId, ...rest] = folder.split("/");
        const item = itemId && rest.length === 0 ? await brim.items.get(itemId) : undefined;
        if (!item || item.type !== (await contentType(typeKey)).key)
          throw new HttpError(404, "This folder does not exist.");
      }
      const bytes = await readBytes(request, MAX_UPLOAD_BYTES, "The image is larger than 10 MB.");
      const name = safeDecode(request.headers.get("x-file-name") ?? "");
      return json({ file: await store.upload(bytes, name, folder) }, { status: 201 });
    },

    // Asks the video host for a place to upload one video. The bytes then go from the browser straight to
    // the host: they never pass through the site.
    "POST /videos": async (request) => {
      await allowed(request, "content");
      const host = videoHost();
      return json(await host.create(parseNewVideo(await readJson(request))), { status: 201 });
    },

    // The videos uploaded to the host, for the editor to use again or delete. A host need not list them:
    // `supported` is then false and the editor shows no list.
    "GET /videos": async (request) => {
      await allowed(request, "content");
      const list = await videoHost().list();
      return json({ supported: list !== undefined, videos: list ?? [] });
    },

    // The site's email settings. What the server itself was given to send with is never part of the answer.
    /**
     * The email the owner gets for a form message, as the site's template writes it (Brim's own without one): with
     * the newest message received, or an example. `?text` shows its text version. To see it while writing
     * src/emails.ts.
     */
    "GET /emails/form": async (request) => {
      // It shows the newest message a visitor sent, so it asks for what reading the messages asks for.
      await allowed(request, "responses");
      const origin = publicOrigin(request, options.siteUrl);
      const newest = (await brim.forms.list())[0];
      const page = newest ? formPage(newest.form) : "/produse/exemplu";
      const answers = newest?.answers ?? [
        { label: "Nume", value: "Ana Popescu" },
        { label: "E-mail", value: "ana@example.com" },
        { label: "Mesaj", value: "Bună ziua, aș dori o ofertă pentru 40 m²." },
      ];
      const email: FormEmail = {
        form: newest?.title ?? "Contact",
        site: new URL(origin).host,
        siteUrl: origin,
        ...(page && { page: `${origin}${page}` }),
        answers: answers.map(({ label, value }) => ({ label, value })),
        responsesUrl: `${origin}/admin/edit`,
        responseUrl: newest ? `${origin}/admin/edit?response=${encodeURIComponent(newest.id)}` : `${origin}/admin/edit`,
        sentAt: newest ? new Date(newest.createdAt) : new Date(),
      };
      const settings = await mailSettings.get();
      const base = formNotice({
        site: email.site,
        title: email.form,
        answers: email.answers,
        ...(email.page && { page: email.page }),
        responsesUrl: email.responsesUrl,
        responseUrl: email.responseUrl,
        settings,
        to: [],
      });
      const template = (await Promise.resolve(options.emails?.()).catch(() => undefined))?.form;
      const message = await writtenBySite(base, template, { ...email, replyTo: base.replyTo });
      return emailPreview(request, message);
    },

    /**
     * The email someone gets when they are added (`?kind=added`), their role changes (`role`) or their access is
     * reset (`reset`), as the site's template writes it, addressed to the owner asking and sending nothing. `?text`
     * shows its text version.
     */
    "GET /emails/account": async (request) => {
      const owner = await allowed(request, "users");
      const kind = new URL(request.url).searchParams.get("kind") ?? "added";
      if (kind !== "added" && kind !== "role" && kind !== "reset") {
        throw new ValidationError('The kind is "added", "role" or "reset".');
      }
      const origin = publicOrigin(request, options.siteUrl);
      const example = { ...owner, email: "ana@example.com", role: "editor" as const };
      const email = accountEmail(origin, kind, example, owner, kind === "role" ? undefined : "example", kind === "role" ? "owner" : undefined);
      return emailPreview(request, await accountMessage(email));
    },

    /**
     * The confirmation a visitor gets, as the site's `confirmation` template writes it (Brim's own without one), with
     * an example subject and message: `?subject=` and `?message=` try others, `?text` shows its text version.
     */
    "GET /emails/confirmation": async (request) => {
      await currentUser(request);
      const origin = publicOrigin(request, options.siteUrl);
      const query = new URL(request.url).searchParams;
      const settings = await mailSettings.get();
      const email: ConfirmationEmail = {
        form: "Contact",
        site: new URL(origin).host,
        siteUrl: origin,
        page: `${origin}/contact`,
        subject: query.get("subject")?.slice(0, 150) || "Am primit mesajul tău",
        message: query.get("message")?.slice(0, 5_000) || "Mulțumim! Am primit mesajul tău și revenim în cel mult o zi lucrătoare.",
        answers: [],
        sentAt: new Date(),
      };
      const base = confirmationNotice({
        site: email.site,
        subject: email.subject,
        message: email.message,
        settings: { ...settings, senderName: settings.senderName || options.identity?.name || "" },
        to: "visitor@example.com",
      });
      const template = (await Promise.resolve(options.emails?.()).catch(() => undefined))?.confirmation;
      const message = await writtenBySite(base, template, email);
      const text = query.has("text");
      const headers = {
        "content-type": text ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
      };
      const shown = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${message.subject.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</title>${message.html}`;
      return new Response(text ? `Subject: ${message.subject}\nFrom: ${message.fromName}\n\n${message.text}` : shown, { headers });
    },

    "GET /mail": async (request) => {
      await currentOwner(request);
      return json(await mailView());
    },

    "PUT /mail": async (request) => {
      await currentOwner(request);
      await mailSettings.update(await readJson(request));
      return json(await mailView());
    },

    // Sends a short email to the owner asking, to show the settings work.
    "POST /mail/test": async (request) => {
      const user = await currentOwner(request);
      if (!(await rateLimiter.allow(`mail-test:${user.id}`, 5, 10 * 60))) {
        throw new HttpError(429, "Too many test emails. Try again in a few minutes.");
      }
      const settings = await mailSettings.get();
      if (!options.mailer) throw new HttpError(501, "Email is not set up for this site.");
      await options.mailer.send(settings, testNotice(new URL(publicOrigin(request, options.siteUrl)).host, settings, user.email));
      return json({ sentTo: user.email });
    },

    // The site's users, for its owners, and for a host's dashboard with an owner's token. Adding someone, changing
    // their role or resetting their access emails them (`notify: false` leaves it to the caller).
    "GET /users": async (request) => {
      await allowed(request, "users");
      const users = await brim.accounts.listUsers();
      return json({ users: users.map(({ email, role, createdAt, tokens }) => ({ email, role, createdAt, tokens })) });
    },

    /** Adds a user. Without a password one is made and answered once; the email lets them choose their own. */
    "POST /users": async (request) => {
      const owner = await allowed(request, "users");
      const body = await readJson(request);
      const email = requireString(body.email, "email");
      const role = roleOf(body.role ?? "editor");
      const given = body.password === undefined ? undefined : requireString(body.password, "password"); // betterleaks:allow
      const password = given ?? generatePassword(); // betterleaks:allow
      const user = await usersChange(() => brim.accounts.createUser(email, password, role));
      const told = body.notify === false ? { emailed: false } : await sendAccountEmail(request, "added", user, owner);
      return json({ user, ...(given === undefined && { password }), ...told }, { status: 201 });
    },

    "PUT /users": async (request) => {
      const owner = await allowed(request, "users");
      const body = await readJson(request);
      const email = requireString(body.email, "email").trim().toLowerCase();
      const role = roleOf(body.role);
      const before = (await brim.accounts.listUsers()).find((user) => user.email === email);
      if (!before) throw new HttpError(404, `There is no user with the email ${email}.`);
      if (before.role === role) return json({ user: { id: before.id, email, role }, emailed: false });
      const user = await usersChange(() => brim.accounts.setRole(email, role));
      const told =
        body.notify === false ? { emailed: false } : await sendAccountEmail(request, "role", user, owner, before.role);
      return json({ user, ...told });
    },

    /**
     * "Reset access": a new password (answered once), every session of theirs ends, their access tokens too with
     * `revokeTokens`, and the email gives them a link to choose a new password.
     */
    "POST /users/reset": async (request) => {
      const owner = await allowed(request, "users");
      const body = await readJson(request);
      const email = requireString(body.email, "email");
      const result = await usersChange(() =>
        brim.accounts.resetAccess(email, { revokeTokens: body.revokeTokens === true }),
      );
      const user = (await brim.accounts.listUsers()).find(
        (candidate) => candidate.email === email.trim().toLowerCase(),
      );
      const told =
        body.notify === false || !user ? { emailed: false } : await sendAccountEmail(request, "reset", user, owner);
      return json({ email: email.trim().toLowerCase(), ...result, ...told });
    },

    "DELETE /users": async (request) => {
      await allowed(request, "users");
      const email = requireString((await readJson(request)).email, "email");
      await usersChange(() => brim.accounts.removeUser(email));
      return json({ email: email.trim().toLowerCase(), removed: true });
    },

    "GET /responses": async (request) => {
      await allowed(request, "responses");
      return json({ responses: await brim.forms.list() });
    },

    "DELETE /responses": async (request) => {
      await allowed(request, "responses");
      // The files a visitor attached go with their message, at once and for good: they are not in the history.
      const removed = await brim.forms.remove(requireString((await readJson(request)).id, "id"));
      if (removed && removed.files.length > 0) await formFiles?.remove(removed.id, removed.files);
      return json({});
    },

    // The component cannot travel; the editor only needs to know which types have a page per item.
    // The site's own settings: the fields it declares, and their values in one language (the saved ones over the
    // code's defaults). Anyone who changes content changes them: they are the site's words, not its structure.
    "GET /site-settings": async (request) => {
      await currentUser(request);
      const declared = await siteSettings();
      const locale = localeOf(new URL(request.url).searchParams.get("locale") ?? undefined);
      const saved = (await brim.content.loadNodes([siteScope(locale)])).find(
        (node) => node.nodeId === SITE_SETTINGS_NODE,
      );
      return json({ fields: declared?.fields ?? [], values: settingsValues(declared, saved?.value) });
    },

    "PUT /site-settings": async (request) => {
      const user = await allowed(request, "content");
      const declared = await siteSettings();
      if (!declared) throw new HttpError(404, "This site declares no settings of its own (src/site-settings.ts).");
      const body = await readJson(request);
      const scope = settingsScope(body.locale);
      const saved = (await brim.content.loadNodes([scope])).find((node) => node.nodeId === SITE_SETTINGS_NODE);
      // Only the values given change: an agent or a form can set one setting without sending all of them.
      const merged = {
        ...(typeof saved?.value === "object" && saved.value ? (saved.value as object) : {}),
        ...(body.values as object),
      };
      const values = parseSiteSettings(declared.fields, merged, false);
      await checkReferences(await contentTypes(), brim.items, settingsAsType(declared), {
        title: "",
        slug: "x",
        visibility: "published",
        data: values,
      });
      await rememberNode(user, scope, SITE_SETTINGS_NODE, "/", "changed");
      await brim.content.saveNode(scope, SITE_SETTINGS_NODE, SITE_SETTINGS_NODE, values);
      await changed(undefined);
      return json({ fields: declared.fields, values: settingsValues(declared, values) });
    },

    "GET /types": async (request) => {
      await currentUser(request);
      const types = (await contentTypes()).map(({ component, ...type }) => ({ ...type, hasPage: Boolean(component) }));
      return json({ types });
    },

    /** What the content still gets wrong (`brim check --content`): stand-in values, unused terms, unlisted pages. */
    "GET /check/content": async (request) => {
      await currentOwner(request);
      const declared = await siteSettings();
      const saved = await brim.content.allNodes();
      const languages = locales ? locales.locales : [undefined];
      const settings = languages.map((code) => {
        const scope = siteScope(code);
        const stored = saved.find((node) => node.scope === scope && node.nodeId === SITE_SETTINGS_NODE);
        return {
          locale: code && code !== locales?.defaultLocale ? code : "",
          values: settingsValues(declared, stored?.value),
        };
      });
      const findings = await checkContent({
        contentTypes: await contentTypes(),
        items: brim.items,
        nodes: saved,
        settings,
        patterns: options.patterns?.() ?? [],
      });
      return json({ findings });
    },

    /**
     * The site's content as a seed (`brim seed --export`): every item, to keep in git as the site's starting
     * content. Owners only: it holds private items too.
     */
    "GET /seed": async (request) => {
      await currentOwner(request);
      const types = await contentTypes();
      const all = (await Promise.all(types.map((type) => brim.items.list(type.key)))).flat();
      return json({ items: exportSeed(types, all) });
    },

    /**
     * Adds a seed's items that the site does not have yet (`brim seed`). Only adds: an item that exists (same type,
     * slug and language) stays exactly as it is. Everything is checked first, and one mistake adds nothing;
     * `dryRun` answers what would be added without adding it. Owners only.
     */
    "POST /seed": async (request) => {
      await currentOwner(request);
      const body = await readJson(request, MAX_SEED_BYTES);
      const plan = await planSeed(await contentTypes(), brim.items, body.items, localeOf);
      // `index` is the item's place in the seed, which the CLI uploads the pictures of before adding it.
      const planned = plan.create.map(({ index, type, draft, locale }) => ({
        index,
        type: type.key,
        slug: draft.slug,
        title: draft.title,
        locale,
      }));
      if (body.dryRun === true) return json({ create: planned, existing: plan.existing });
      const added = await applySeed(brim.items, plan);
      if (added.length > 0) await changed(undefined);
      return json({
        added: added.map(({ id, type, slug, locale }) => ({ id, type, slug, locale })),
        existing: plan.existing,
      });
    },

    "GET /items": async (request) => {
      await currentUser(request);
      const params = new URL(request.url).searchParams;
      const type = await contentType(params.get("type"));
      const locale = params.has("locale") ? localeOf(params.get("locale")) : undefined;
      // An `ordered` type is listed in the owner's order, so the editor shows it as the site does. The list kept in
      // the server's memory is read again only where items changed: read whole, a type with a thousand items took
      // seconds on a remote database, each time the content browser opened.
      const items = await brim.items.listCached(type.key, {
        ...(type.ordered && { sort: "position" as const }),
        ...(locale !== undefined && { locale }),
      });
      // The editor asks with `?draft`: items as its preview shows them.
      return json({ items: params.has("draft") ? await brim.drafts.overlayItems(items) : items });
    },

    /** The owner's order of an `ordered` type's items: `{ type, ids }`, its items written first, first to last. */
    "PUT /items/order": async (request) => {
      await allowed(request, "content");
      const body = await readJson(request);
      const type = await contentType(body.type);
      if (!type.ordered) {
        throw new ValidationError(`"${type.label}" is not put in order by hand: declare it with \`ordered: true\`.`);
      }
      if (!Array.isArray(body.ids) || body.ids.some((id: unknown) => typeof id !== "string")) {
        throw new ValidationError('"ids" must be a list of item ids.');
      }
      const items = await brim.items.reorder(type.key, body.ids as string[]);
      await changed(undefined);
      return json({ items: items.map(({ id, position }) => ({ id, position })) });
    },

    "POST /items": async (request) => {
      await allowed(request, "content");
      const body = await readJson(request);
      const type = await contentType(body.type);
      // A new item stays out of sight until it is published, like a new page.
      const draft = parseItem(type, { ...body, visibility: body.visibility ?? "private" });
      await checkReferences(await contentTypes(), brim.items, type, draft);
      const locale = localeOf(body.locale);
      if (draft.visibility === "published") draft.data = withPublishedDate(type, draft.data);
      // An address made from the title that another item already has gets a number (lake-house-2), as the person
      // asked for no address of their own; one they typed themselves is refused instead, so they choose.
      const typedSlug = typeof body.slug === "string" && body.slug.trim() !== "";
      if (!typedSlug) draft.slug = await freeSlug(type.key, draft.slug, locale);
      const item = await brim.items.create(type.key, draft, { locale });
      const cleared = await clearRedirectFrom(normalizePagePath(itemPagePath(type, item, locales)));
      // A private item shows nobody anything yet, unless a redirect at its address went.
      await changed(undefined, item.visibility === "published" || cleared);
      return json({ item }, { status: 201 });
    },

    /** A translation of an item into another of the site's languages: a private copy, linked to the original. */
    "POST /items/translate": async (request) => {
      await allowed(request, "content");
      const body = await readJson(request);
      const source = await existingItem(body);
      const type = await contentType(source.type);
      const locale = localeOf(body.locale);
      const family = await brim.items.translations(source);
      if (family.some((item) => item.locale === locale)) {
        throw new ValidationError("This item already has a translation in that language.");
      }
      const original = source.translationOf ?? source.id;
      const item = await brim.items.create(
        type.key,
        { title: source.title, slug: source.slug, visibility: "private", data: source.data },
        { locale, translationOf: original },
      );
      // Its page starts from the original's words where it has none yet: those on the template in the original's
      // language, or, for a page written in code, those on the original's own page.
      // The translation itself is private; words copied to the template of its language show on that language's
      // published items at once.
      let template = 0;
      if (type.component && locales) {
        const code = (stored: string): string => stored || locales.defaultLocale;
        template = await brim.content.copyNodes(typeScope(type.key, code(source.locale)), typeScope(type.key, code(locale)));
      } else if (!type.component) {
        await brim.content.copyNodes(ownPageScope(type, source, locales), ownPageScope(type, item, locales));
      }
      await changed(undefined, template > 0);
      return json({ item }, { status: 201 });
    },

    /**
     * The same page in another language, filled with this page's content where it has none yet. A page written
     * in code must exist in that language in the code; a page added from a template is added there too.
     */
    "POST /pages/translate": async (request) => {
      await allowed(request, "content");
      if (!locales) throw new ValidationError("This site has one language: add others to Astro's i18n in its code.");
      const body = await readJson(request);
      const from = pagePathOf(body);
      const locale = requireString(body.locale, "locale");
      if (!locales.locales.includes(locale))
        throw new ValidationError(`"${locale}" is not one of the site's languages.`);
      const to = pathInLocale(from, locale, locales);
      if (to === from) throw new ValidationError("This page is already in that language.");
      const coded = pages().some((page) => normalizePagePath(page) === to);
      const target = await brim.content.page(to);
      let created = false;
      if (!coded && !target.template) {
        const source = await brim.content.page(from);
        if (!source.template) {
          throw new ValidationError(
            `This page has no ${locale.toUpperCase()} version in the site yet (${to}). It has to be added in the site's code first (src/pages), then it can be translated here.`,
          );
        }
        await brim.content.createPage(to, source.template, source.title ?? "", "private");
        created = true;
      }
      const copied = await brim.content.copyNodes(pageScope(from), pageScope(to));
      const source = await brim.content.page(from);
      const seo = Object.keys(target.seo).length === 0 && Object.keys(source.seo).length > 0;
      if (seo) await brim.content.setPageSeo(to, source.seo);
      // A page added here is private; one that was there already shows what was copied to it.
      await changed(to, !created && (copied > 0 || seo));
      return json({ path: to, created, copied });
    },

    "PUT /items": async (request) => {
      const user = await allowed(request, "content");
      const body = await readJson(request);
      const existing = await existingItem(body);
      const type = await contentType(existing.type);
      if (body.draft === true) {
        const parsed = parseItem(type, { ...body, visibility: existing.visibility });
        assertTermSlug(await contentTypes(), existing, parsed.slug);
        return json(await draftItem(existing, parsed, pagePathOf(body)));
      }
      const draft = parseItem(type, body);
      assertTermSlug(await contentTypes(), existing, draft.slug);
      if (draft.visibility === "published" && existing.visibility === "private")
        draft.data = withPublishedDate(type, draft.data);
      const types = await contentTypes();
      await checkReferences(types, brim.items, type, draft);
      await rememberItem(user, existing, "changed");
      const item = await brim.items.update(existing, draft);
      await itemMoved(type, existing, item);
      await termMoved(types, type, existing, item);
      // Saved as a whole from its form: what was drafted of it is settled.
      await brim.drafts.set("item", existing.id, undefined, "");
      await changed(undefined);
      return json({ item });
    },

    "DELETE /items": async (request) => {
      const user = await allowed(request, "publish");
      const existing = await existingItem(await readJson(request));
      // An item whose type was removed from the code can still be deleted; there is no page of it to clear.
      const types = await contentTypes();
      const type = types.find((candidate) => candidate.key === existing.type);
      // A term items still point at stays until they point elsewhere; its translations share its slug, so only the
      // last one in use is guarded.
      if (
        !(await brim.items.list(existing.type)).some(
          (other) => other.id !== existing.id && other.slug === existing.slug,
        )
      ) {
        await assertUnused(types, brim.items, existing);
      }
      const ownScope = type && !type.component ? ownPageScope(type, existing, locales) : undefined;
      // An original's translations are remembered, so putting it back makes it their original again.
      const translations = existing.translationOf ? [] : await brim.items.translationIds(existing.id);
      await rememberItem(
        user,
        existing,
        "deleted",
        ownScope ? await brim.content.loadNodes([ownScope]) : [],
        true,
        translations,
      );
      await brim.items.remove(existing.id);
      if (ownScope) await brim.content.removeNodes(ownScope);
      await changed(undefined);
      return json({});
    },

    // Who can see an item changes at once, never with the draft: it leaves the item's drafted content alone.
    "PUT /items/visibility": async (request) => {
      const user = await allowed(request, "publish");
      const body = await readJson(request);
      const existing = await existingItem(body);
      const visibility = visibilityOf(body.visibility);
      await rememberItem(user, existing, "changed");
      const publishing = visibility === "published" && existing.visibility === "private";
      const type = publishing ? (await contentTypes()).find(({ key }) => key === existing.type) : undefined;
      const data = type ? withPublishedDate(type, existing.data) : existing.data;
      const item = await brim.items.update(existing, { ...existing, data, visibility });
      // What waits in the draft is saved over the item later, so it gets the date too.
      const draft = type && ((await brim.drafts.get("item", item.id)) as ItemContentDraft | undefined);
      if (type && draft) {
        const page = (await brim.drafts.all()).find((row) => row.target === "item" && row.key === item.id)?.page ?? "";
        await brim.drafts.set("item", item.id, { ...draft, data: withPublishedDate(type, draft.data) }, page);
      }
      await changed(undefined);
      return json({ item: await brim.drafts.overlayItem(item) });
    },

    // How many changes nobody has saved yet, and on which pages.
    "GET /drafts": async (request) => {
      await currentUser(request);
      const rows = await brim.drafts.all();
      return json({ drafts: rows.length, pages: [...new Set(rows.map((row) => row.page).filter(Boolean))] });
    },

    // Undo and redo: one thing's draft put back as it was before or after a change. `null` is no draft.
    "PUT /drafts": async (request) => {
      const user = await allowed(request, "content");
      const body = await readJson(request);
      const target = requireString(body.target, "target") as DraftTarget;
      const key = requireString(body.key, "key");
      const value = await checkedDraft(user, target, key, body.value ?? null);
      const answer = await writeDraft(target, key, value, typeof body.path === "string" ? body.path : "");
      const live = target === "item" ? await brim.items.get(key) : undefined;
      return json({ ...answer, ...(live && { item: await brim.drafts.overlayItem(live) }) });
    },

    // Save: every draft becomes what visitors see.
    "POST /drafts/save": async (request) => {
      const user = await allowed(request, "content");
      const result = await saveDrafts(user);
      return json({ ...result, drafts: await brim.drafts.count() });
    },

    // Discard: every draft is thrown away and the editor shows what is saved.
    "DELETE /drafts": async (request) => {
      await allowed(request, "content");
      await brim.drafts.clear();
      return json({ drafts: 0 });
    },

    /**
     * What the owner saved on a page (`?path=/contact`): its own elements, the template's when it is an item's page,
     * and the site's shared ones (header, footer, settings), each with its kind and value. What code alone draws,
     * untouched in the editor, is not here: the page shows the code's own words for it. To see, before a change to a
     * page's code, what the owner wrote there.
     */
    "GET /nodes": async (request) => {
      await currentUser(request);
      const path = normalizePagePath(new URL(request.url).searchParams.get("path") ?? "/");
      const itemPage = itemPageOf(await contentTypes(), path, locales);
      const locale = localeOfPath(path, locales);
      const scopes = {
        page: pageScope(path),
        ...(itemPage && { template: typeScope(itemPage.type.key, locale) }),
        site: siteScope(locale),
      };
      const saved = await brim.content.loadNodes(Object.values(scopes));
      const of = (scope: string) =>
        saved
          .filter((node) => node.scope === scope)
          .map(({ nodeId, kind, value }) => ({ nodeId, kind, value }))
          .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
      return json({
        path,
        page: of(scopes.page),
        ...(scopes.template && { template: of(scopes.template) }),
        site: of(scopes.site),
      });
    },

    "PUT /nodes": async (request) => {
      const user = await allowed(request, "content");
      const body = await readJson(request);
      const path = pagePathOf(body);
      const nodeId = nodeIdOf(body);
      const kind = requireString(body.kind, "kind");
      // A field element has nothing of its own to keep: its value is the item's field, checked like the item form.
      if (kind === FIELD_KIND) {
        if (body.item === undefined) {
          throw new ValidationError(`A ${FIELD_KIND} element is changed through its item: pass "item" and "field".`);
        }
        if (typeof body.value !== "object" || body.value === null) {
          throw new ValidationError('"value" must be an object.');
        }
        return saveToItem(user, body, nodeId, kind, body.value as Record<string, unknown>);
      }
      const value = nodeValueOf(kind, body.value);
      if (body.item !== undefined) return saveToItem(user, body, nodeId, kind, value as Record<string, unknown>);
      if (body.scope === "template") need(user, "templates");
      const scope = await scopeOf(body, path);
      if (body.draft === true) {
        return json({ nodeId, kind, value, ...(await writeDraft("node", `${scope}\n${nodeId}`, { kind, value }, path)) });
      }
      await rememberNode(user, scope, nodeId, path, "changed");
      await brim.content.saveNode(scope, nodeId, kind, value);
      await changed(body.scope === "page" ? path : undefined);
      return json({ nodeId, kind, value });
    },

    "DELETE /nodes": async (request) => {
      const user = await allowed(request, "content");
      const body = await readJson(request);
      const path = pagePathOf(body);
      if (body.scope === "template") need(user, "templates");
      const scope = await scopeOf(body, path);
      if (body.draft === true) return json(await writeDraft("node", `${scope}\n${nodeIdOf(body)}`, { reset: true }, path));
      await rememberNode(user, scope, nodeIdOf(body), path, "reset");
      await brim.content.resetNode(scope, nodeIdOf(body));
      await changed(body.scope === "page" ? path : undefined);
      return json({});
    },

    // What changed lately, newest first: on one page (`?path=`), or on the whole site.
    "GET /history": async (request) => {
      await currentUser(request);
      const params = new URL(request.url).searchParams;
      const path = params.get("path");
      return json({
        history: await brim.history.list({
          page: path === null ? undefined : normalizePagePath(path),
          limit: Number(params.get("limit")) || undefined,
        }),
      });
    },

    // Takes one change back: the element, item or deleted page becomes what it was before that change.
    "POST /history/restore": async (request) => {
      const user = await currentUser(request);
      const record = await brim.history.get(requireString((await readJson(request)).id, "id"));
      if (!record) throw new HttpError(404, "This change is no longer in the site's history.");
      await restore(user, record);
      await changed(undefined);

      return json({ restored: { target: record.target, title: record.title, page: record.page } });
    },
  };

  /** Routes with a name in their address, tried when no fixed route matches. */
  const namedRoutes: {
    method: string;
    pattern: RegExp;
    handle: (request: Request, name: string) => Promise<Response>;
  }[] = [
    {
      // Disconnects an AI app: one's own, or anyone's for an owner. Its tokens stop working at once.
      method: "DELETE",
      pattern: /^\/connections\/([^/]+)$/,
      handle: async (request, id) => {
        const user = await currentUser(request);
        const disconnected = await brim.accounts.oauth.disconnect(safeDecode(id), can(user, "users") ? undefined : user.id);
        if (!disconnected) throw new HttpError(404, "There is no such connected app.");
        return json({ disconnected: true });
      },
    },
    {
      // One set's icons whose name contains `q`: a pack can hold thousands, so the editor asks as it is typed.
      method: "GET",
      pattern: /^\/icons\/([^/]+)$/,
      handle: async (request, set) => {
        await currentUser(request);
        const query = new URL(request.url).searchParams;
        return json(icons.search(safeDecode(set), query.get("q") ?? "", Number(query.get("limit")) || undefined));
      },
    },
    {
      /**
       * One file a visitor attached to a form message, for a role that may read messages (never a visitor). The file is
       * found through the message's own list, by two ids: no name or path from the request reaches the storage. Always a download, never shown in the page, never cached.
       */
      method: "GET",
      pattern: /^\/responses\/([^/]+\/files\/[^/]+)$/,
      handle: async (request, ids) => {
        await allowed(request, "responses");
        const [responseId = "", , fileId = ""] = ids.split("/");
        const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
        if (!uuid.test(responseId) || !uuid.test(fileId)) throw new HttpError(404, "This file does not exist.");
        const file = (await brim.forms.get(responseId))?.files.find((candidate) => candidate.id === fileId);
        if (!file || !formFiles) throw new HttpError(404, "This file does not exist.");
        const bytes = await formFiles.read(responseId, fileId);
        // Listed but not there: the site's content was moved (export, restore) without its files.
        if (!bytes) throw new HttpError(404, "This file is no longer kept on this site.");
        return fileDownload(file, bytes);
      },
    },
    {
      // Whether an uploaded video is ready to play yet.
      method: "GET",
      pattern: /^\/videos\/([^/]+)$/,
      handle: async (request, id) => {
        await currentUser(request);
        return json(await videoHost().status(safeDecode(id)));
      },
    },
    {
      // Removes an uploaded video from the host for good. No content changes: a block that showed it keeps its
      // address, so this is not a change that marks the request as one visitors can see.
      method: "DELETE",
      pattern: /^\/videos\/([^/]+)$/,
      handle: async (request, id) => {
        await allowed(request, "content");
        await videoHost().delete(safeDecode(id));
        return json({ deleted: true });
      },
    },
  ];

  async function api(request: Request, info: RequestInfo, route: string): Promise<Response> {
    try {
      const fixed = routes[`${request.method} ${route}`];
      const named = fixed
        ? undefined
        : namedRoutes.find((entry) => entry.method === request.method && entry.pattern.test(route));
      if (!fixed && !named) throw new HttpError(404, "Not found.");
      // A browser could be tricked into sending the cookie from another site, never a bearer token.
      if (request.method !== "GET" && !bearerToken(request)) assertSameOrigin(request);
      if (fixed) return await fixed(request, info);
      return await named!.handle(request, named!.pattern.exec(route)?.[1] ?? "");
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
      if (error instanceof ValidationError) return json({ error: error.message }, { status: 422 });
      throw error;
    }
  }

  /** Tools of the site's MCP go through the same API as the editor, with the same checks. */
  async function mcp(request: Request, info: RequestInfo): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    try {
      if (!bearerToken(request)) throw new HttpError(401, "Send an access token: Authorization: Bearer <token>.");
      await currentUser(request);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      // An MCP client finds how to connect from here (RFC 9728): the site's OAuth, where its user signs in. A token
      // that ran out is said to be one, so the app refreshes it.
      const metadata = `resource_metadata="${resourceMetadataUrl(request)}"`;
      const challenge = bearerToken(request) ? `Bearer error="invalid_token", ${metadata}` : `Bearer ${metadata}`;
      return json({ error: error.message }, { status: error.status, headers: { "www-authenticate": challenge } });
    }

    return handleMcp(request, toolContext(request, info, { authorization }));
  }

  /**
   * What the MCP's tools run with: the editor's API called as the person asking, with their token or their signed-in
   * session, so their role and every check of the API apply.
   */
  function toolContext(request: Request, info: RequestInfo, credentials: Record<string, string>): ToolContext {
    const origin = requestOrigin(request);
    // A session's cookie is sent with the site's own origin: the API checks it on every change.
    const headers = credentials.authorization ? credentials : { ...credentials, origin };
    return {
      api: async (method, route, body) => {
        const url = new URL(`${API_PATH}${route}`, origin);
        const response = await api(
          new Request(url, {
            method,
            headers: { ...headers, ...(body && { "content-type": "application/json" }) },
            ...(body && { body: JSON.stringify(body) }),
          }),
          info,
          url.pathname.slice(API_PATH.length),
        );
        const answer = (await response.json()) as Record<string, unknown>;
        if (!response.ok) throw new Error(String(answer.error ?? `The site answered ${response.status}.`));
        return answer;
      },
      renderPage: async (path) => {
        // Asked from this server itself, never from an address the request's headers name: those are the
        // caller's to write, and the token must not travel to a host of their choosing.
        const origin = info.serverOrigin ?? new URL(request.url).origin;
        // "//host/x" and "/\\host/x" are addresses of another host for the URL parser: refused, so the token stays here.
        if (!path.startsWith("/") || /^\/[/\\]/.test(path) || path.includes("\\")) {
          throw new HttpError(400, `"${path}" is not a page of this site.`);
        }
        const url = new URL(normalizePagePath(path), origin);
        if (url.origin !== new URL(origin).origin) throw new HttpError(400, `"${path}" is not a page of this site.`);
        if (options.renderPage) return options.renderPage(url);
        // The token (or session) travels along, so the server draws the page as its editor sees it.
        const response = await fetch(url, { headers, redirect: "manual" });
        if (!response.ok) throw new Error(`The page ${path} answered ${response.status}.`);
        return response.text();
      },
      storedValue: async (path, scope, nodeId) => {
        const nodes = await brim.content.loadNodes([await scopeOf({ scope }, normalizePagePath(path))]);
        return nodes.find((node) => node.nodeId === nodeId)?.value;
      },
      // Through the API's own route, so the token's role, the size limit and the folder check all apply.
      upload: async (bytes, name, folder) => {
        const url = new URL(`${API_PATH}/media`, origin);
        const response = await api(
          new Request(url, {
            method: "POST",
            headers: {
              ...headers,
              "content-length": String(bytes.byteLength),
              "x-file-name": encodeURIComponent(name),
              ...(folder && { "x-media-folder": encodeURIComponent(folder) }),
            },
            body: new Uint8Array(bytes),
          }),
          info,
          "/media",
        );
        const answer = (await response.json()) as Record<string, unknown>;
        if (!response.ok) throw new Error(String(answer.error ?? `The site answered ${response.status}.`));
        return answer;
      },
      fetchImage: (url) => fetchImage(url, options.fetch),
    };
  }

  async function asset(name: string): Promise<Response> {
    const contentType = ASSETS[name];
    if (!contentType) return new Response("Not found", { status: 404 });
    try {
      const body = await readFile(new URL(name, assetsDirectory));
      return new Response(body, { headers: { "content-type": contentType, "cache-control": "no-cache" } });
    } catch {
      return new Response("The editor is not built. Run `pnpm --filter @brimsites/brimjs build:editor`.", { status: 500 });
    }
  }

  async function respond(request: Request, info: RequestInfo, pathname: string): Promise<Response> {
    if (isOAuthPath(pathname)) return oauthRoutes(request, info.clientAddress, pathname);
    if (pathname.startsWith(`${API_PATH}/`)) return api(request, info, pathname.slice(API_PATH.length));
    if (pathname === MCP_PATH) return mcp(request, info);
    if (pathname.startsWith(`${ASSETS_PATH}/`)) return asset(pathname.slice(ASSETS_PATH.length + 1));
    // `/admin` is where people look first: it opens the editor at its own address.
    if (pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`) {
      return new Response(null, {
        status: 302,
        headers: { location: `${ADMIN_PATH}/edit`, "cache-control": "no-store" },
      });
    }
    return new Response(editorPage(options.identity ?? {}), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",

        "x-robots-tag": "noindex",
      },
    });
  }

  return async (request, info) => {
    const { pathname } = new URL(request.url);
    if (pathname !== ADMIN_PATH && !pathname.startsWith(`${ADMIN_PATH}/`) && !isOAuthPath(pathname)) return undefined;
    const changes = { live: false };
    const response = await liveChanges.run(changes, () => respond(request, info, pathname));
    // Only a change that was accepted: a refused one (an error after a partial write included) says nothing.
    if (changes.live && response.status < 400) response.headers.set(LIVE_CHANGE_HEADER, "live");
    for (const [name, value] of Object.entries(ADMIN_HEADERS)) {
      if (!response.headers.has(name)) response.headers.set(name, value);
    }
    return response;
  };
}

/**
 * On everything under /admin. The editor is never shown inside another site's page, where a visitor could be led
 * to click in it without seeing it; its answers are read as the type they say; and its addresses, which can carry a
 * sign-in link's token, are not passed on to other sites.
 */
const ADMIN_HEADERS: Record<string, string> = {
  "content-security-policy": "frame-ancestors 'self'",
  "x-frame-options": "SAMEORIGIN",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

/** The editor's page: the site's name in its tab title, and the site's favicon when it has one. */
function editorPage(identity: SiteIdentity): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const favicon = identity.favicon;
  const type = favicon ? faviconType(favicon) : undefined;
  const link = favicon ? `<link rel="icon" href="${escape(favicon)}"${type ? ` type="${type}"` : ""} />` : "";
  return EDITOR_PAGE.replace("<!--favicon-->", link).replace(
    "<title>Edit site</title>",
    `<title>${identity.name ? `Edit · ${escape(identity.name)}` : "Edit site"}</title>`,
  );
}

const EDITOR_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Edit site</title>
    <!--favicon-->
    <link rel="stylesheet" href="${ASSETS_PATH}/editor.css" />
  </head>
  <body>
    <div id="brim-editor"></div>
    <script type="module" src="${ASSETS_PATH}/editor.js"></script>
  </body>
</html>
`;

/**
 * The cookie of a new session, and the removal of an old one under /admin (kept there before the cookie covered
 * the whole site): the browser would send that one first on every editor request.
 */
function signInHeaders(request: Request, token: string, maxAgeSeconds: number): Headers {
  const headers = new Headers({ "set-cookie": sessionCookie(request, token, maxAgeSeconds) });
  headers.append("set-cookie", sessionCookie(request, "", 0, ADMIN_PATH));
  return headers;
}

/** Ends the browser's session: its cookie, and the old one kept under /admin before the cookie covered the site. */
function signOutHeaders(request: Request): Headers {
  const headers = new Headers({ "set-cookie": sessionCookie(request, "", 0) });
  headers.append("set-cookie", sessionCookie(request, "", 0, ADMIN_PATH));
  return headers;
}

function sessionCookie(request: Request, token: string, maxAgeSeconds: number, path = "/"): string {
  const secure = requestOrigin(request).startsWith("https:") ? "; Secure" : "";
  // Sent with page requests too: the server shows a signed-in editor the live, editable page.
  return `${SESSION_COOKIE}=${token}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

/** An email in the name of a limit: as accounts know it, and hashed, so what was typed is neither kept nor long. */
function emailKey(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32);
}

/** What wrong passwords are counted by: the visitor's address first, then the account. */
function loginKeys(info: RequestInfo, email: string): string[] {
  return [`login:address:${info.clientAddress}`, `login:email:${emailKey(email)}`];
}

/** `text` is a primitive with its own value shape, though BrimCMS also had a block by that name. */
function isPrimitive(kind: string): boolean {
  return kind === "text";
}

function requireString(input: unknown, name: string): string {
  if (typeof input !== "string" || input === "") throw new HttpError(400, `"${name}" is required.`);
  return input;
}

/** Whether two JSON values say the same, so a draft that changes nothing is no draft. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pagePathOf(body: Record<string, unknown>): string {
  const path = requireString(body.path, "path");
  if (!path.startsWith("/")) throw new HttpError(400, '"path" must start with "/".');
  return normalizePagePath(path);
}

const MAX_TITLE = 300;

function titleOf(body: Record<string, unknown>): string {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "") throw new ValidationError("The title is required.");
  if (title.length > MAX_TITLE) throw new ValidationError("The title is too long.");
  return title;
}

/** An article's data as it is published: dated today, unless it says a date already. */
function withPublishedDate(type: ContentType, data: Record<string, unknown>): Record<string, unknown> {
  if (!type.article || !standardField(type, "published") || data.published) return data;
  return { ...data, published: new Date().toISOString().slice(0, 10) };
}

function visibilityOf(input: unknown): Visibility {
  if (input !== "private" && input !== "published") {
    throw new HttpError(400, '"visibility" must be "private" or "published".');
  }
  return input;
}

/** The first segments of a type's addresses, which no page the owner adds may start with. */
function addressPrefixes(type: ContentType): string[] {
  const first = itemPathSegments(type)[0];
  return [...new Set([type.slug, ...(first && "fixed" in first ? [first.fixed] : [])])];
}

/**
 * Where the page of an item of a type without a template, written in the site's code, keeps what the owner placed on
 * it. A type with a template keeps that on the template instead, shared by all its items.
 */
function ownPageScope(type: ContentType, item: Pick<Item, "slug" | "locale" | "data">, locales?: LocaleConfig): string {
  return pageScope(itemPagePath(type, item, locales));
}

/** Site Settings are kept beside the elements but checked field by field: they are not saved as an element. */
function assertElement(nodeId: string): void {
  if (nodeId !== SITE_SETTINGS_NODE) return;
  throw new HttpError(400, "Site Settings are changed in Site Settings, or with brim_set_site_settings.");
}

function nodeIdOf(body: Record<string, unknown>): string {
  const nodeId = requireString(body.nodeId, "nodeId");
  if (!isNodeId(nodeId)) throw new HttpError(400, `"${nodeId}" is not a valid nodeId.`);
  assertElement(nodeId);
  return nodeId;
}

/** A name taken from an address; one that is not valid percent-encoding matches nothing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
