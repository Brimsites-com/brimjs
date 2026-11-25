import type { Icon, IconSearch, IconSetInfo } from "../../icons/library.ts";
import type { ContentType as DeclaredType } from "../../content/content-types.ts";

import type { PageTemplateInfo } from "../../content/page-templates.ts";

import { patientFetch } from "./connection.ts";

export type { ContentField } from "../../content/content-types.ts";

/** A content type as the editor gets it: its template stays on the server, `hasPage` says whether it has one. */
export type ContentType = Omit<DeclaredType, "component"> & { hasPage: boolean };

/** The site's own settings as the API answers them. */
export interface SiteSettingsView {
  fields: import("../../content/content-types.ts").SiteSettingField[];
  values: Record<string, unknown>;
}
export type { PageTemplateInfo } from "../../content/page-templates.ts";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** What the site says about itself at /admin/api/info. */
export interface SiteInfo {
  capabilities: string[];
  /** The brand's colors from the site's config: offered first in color pickers, not changed in the editor. */
  brandColors?: { name: string; value: string }[];
  /** The site's languages, from Astro's i18n in its code; `null` for a site with one language. */
  locales?: SiteLocales | null;
  /** The site's name and what a page falls back to in search results and shared links. */
  identity?: SiteIdentityInfo;
  /** The host's own sign-in, offered on the sign-in form beside the password; `null` when the host has none. */
  hostSignIn?: { url: string; name: string } | null;
}

export interface SiteIdentityInfo {
  name: string | null;
  /** e.g. `%s — Acme Studio`. */
  titleTemplate: string | null;
  description: string | null;
  image: string | null;
}

export interface SiteLocales {
  defaultLocale: string;
  locales: string[];
  prefixDefaultLocale?: boolean;
}

let siteInfo: Promise<SiteInfo> | undefined;
/** Asked once per editor session; a failure counts as a site that offers nothing extra. */
export function loadSiteInfo(): Promise<SiteInfo> {
  siteInfo ??= api.info().catch(() => ({ capabilities: [] }));
  return siteInfo;
}

export interface User {
  email: string;
  role: "owner" | "editor" | "writer";
  /** What the role allows, as the server lists it (see `auth/permissions.ts`); the server checks each request. */
  permissions: Permission[];
}

export type Permission = "content" | "publish" | "pages" | "templates" | "responses" | "settings" | "users";

/** A change in the site's history, as the History panel lists it. */
export interface HistoryEntry {
  id: string;
  target: "node" | "item" | "page";
  action: "changed" | "reset" | "deleted";
  page: string;
  title: string;
  user: string;
  at: string;
}

type Session = { user: Omit<User, "permissions">; permissions?: Permission[] };
/** The signed-in user with what they may do; a server from before roles were checked allows everything it did. */
const withPermissions = ({ user, permissions }: Session): { user: User } => ({
  user: { ...user, permissions: permissions ?? ["content", "publish", "pages", "templates", "responses"] },
});

export type Visibility = "private" | "published";

export interface SeoSettings {
  title?: string;
  description?: string;
  image?: string;
  shareTitle?: string;
  shareDescription?: string;
  canonical?: string;
  noindex?: boolean;
  nofollow?: boolean;
}

export interface SitePage {
  path: string;
  visibility: Visibility;
  seo: SeoSettings;
  /** Set on pages added from a template, which the owner can rename and delete. */
  template?: string;
  title?: string;
}

/** An old address that sends visitors to another: a path of the site or a full address. */
export interface Redirect {
  from: string;
  to: string;
  /** 302 instead of 301: search engines keep the old address. */
  temporary?: boolean;
}

export interface NewPage {
  template: string;
  title: string;
  path?: string;
}

export interface Item {
  id: string;
  type: string;
  slug: string;
  title: string;
  visibility: Visibility;
  data: Record<string, unknown>;
  /** "" for the site's default language, else the language's code. */
  locale: string;
  /** The item this one translates; `null` for one written first. */
  translationOf: string | null;
  updatedAt: string;
}

export interface FormResponse {
  id: string;
  form: string;
  title: string;
  answers: {
    label: string;
    value: string;
    choices?: { label: string; icon?: string; image?: string }[];
    picked?: string[];
  }[];
  /** The files the visitor attached; each is downloaded from `/admin/api/responses/<id>/files/<file id>`. */
  files?: { id: string; label: string; name: string; mime: string; size: number }[];
  createdAt: string;
}

export interface MediaFile {
  id: string;
  url: string;
  name: string;
  /** "" for the gallery, or the key of the content type whose folder holds the image. */
  folder: string;
  /** A small copy for the picker, when the site's CDN makes them (`media.resize`). */
  thumbnail?: string;
}

/** What the site's video host answers when asked for a place to upload a video. */
export interface VideoUploadTicket {
  id: string;
  upload: { protocol: string; endpoint: string; headers?: Record<string, string>; metadata?: Record<string, string> };
  url: string;
  posterUrl: string | null;
}

export interface VideoStatus {
  id: string;
  status: "processing" | "ready" | "failed";
  progress: number;
  url: string;
  posterUrl: string | null;
}

/** One video already on the site's video host. */
export interface UploadedVideo {
  id: string;
  name: string;
  /** In bytes. */
  size: number;
  status: "processing" | "ready" | "failed";
  url: string;
  posterUrl: string | null;
  createdAt: string;
}

export type ItemDraft = Pick<Item, "slug" | "title" | "visibility" | "data">;

/**
 * One change held in the draft, as the server answers it: the draft of one thing before and after it, `null` being
 * no draft (what is saved). Undo writes `before` back, redo `after`.
 */
export interface DraftChange {
  target: "node" | "item" | "seo";
  key: string;
  page: string;
  before: unknown;
  after: unknown;
}

/** What every draft write answers: the change, and how many changes nobody has saved yet. */
export interface Drafted {
  change: DraftChange;
  drafts: number;
}

/** Identifies one editable node on the page being edited. */
export interface NodeRef {
  path: string;
  /** `template` on the page of an item: the node belongs to its type's template, shared by every item. */
  scope: "page" | "site" | "template";
  nodeId: string;
  /** Set when the element shows a field of a content item: saving it changes the item. */
  item?: string;
  field?: string;
}

/** What the server said, or why it could not be understood (a proxy's page instead of the server's answer). */
async function answer<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || payload === null) {
    const away = payload === null && response.status >= 502 && response.status <= 504;
    throw new ApiError(
      response.status,
      payload?.error ?? (away ? "The editor is not answering. Reload the page to try again." : fallback),
    );
  }
  return payload;
}

/** Set while someone is editing: it asks them to sign in again and resolves once they have. */
let signInAgain: (() => Promise<void>) | null = null;

/**
 * Called by the editor with a way to sign in again without leaving it, or `null` once nobody is editing. A session
 * that runs out in the middle of a change then keeps the change: the request waits and is sent again after.
 */
export function whenSignedOut(handler: (() => Promise<void>) | null): void {
  signInAgain = handler;
}

/**
 * `patientFetch`, sent again after signing in when the session ran out. A 401 means the server refused the request
 * before doing anything, so sending it again cannot do it twice.
 */
async function send(url: string, init: () => RequestInit): Promise<Response> {
  for (;;) {
    const response = await patientFetch(url, init);
    if (response.status !== 401 || !signInAgain) return response;
    await response.body?.cancel();
    await signInAgain();
  }
}

async function request<T>(method: string, route: string, body?: unknown): Promise<T> {
  const init = (): RequestInit => ({
    method,
    ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  // Signing in and out answer for themselves: a wrong password is a 401 too.
  const url = `/admin/api${route}`;
  const response = route === "/session" ? await patientFetch(url, init) : await send(url, init);
  return answer<T>(response, "Something went wrong.");
}

/** The owner's own email server as the editor sees it: the password is only "saved" or not. */
export interface SmtpServerView {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean; // betterleaks:allow
}

/** The site's email settings, and who sends: the site's own server, the server's setup, the host, or nobody. */
export interface MailSettings {
  /** The roles whose users all get every form message: owners, editors. */
  notifyRoles: ("owner" | "editor" | "writer")[];
  /** Whether owners are among them; for clients from before roles could be chosen. */
  notifyOwners: boolean;
  notify: string[];
  senderName: string;
  smtp: SmtpServerView | null;
  delivery: "site" | "server" | "service" | "none";
}

export interface MailSettingsUpdate {
  notifyRoles: ("owner" | "editor" | "writer")[];
  notify: string[] | string;
  senderName: string;
  /** An empty password keeps the saved one. */
  smtp: (Omit<SmtpServerView, "hasPassword"> & { password: string }) | null; // betterleaks:allow
}

export const api = {
  session: () => request<Session>("GET", "/session").then(withPermissions),
  // betterleaks:allow (a parameter named after what it carries, not a secret)
  signIn: (email: string, password: string) => request<Session>("POST", "/session", { email, password }).then(withPermissions), // betterleaks:allow
  signOut: () => request<object>("DELETE", "/session"),
  /** "Forgot password": the answer is the same whether the email has an account or not. */
  forgotPassword: (email: string) => // betterleaks:allow
    request<{ sent: boolean; message: string }>("POST", "/password/forgot", { email }),
  /** A new password with the emailed link's token; signs this browser in. */
  resetPassword: (token: string, password: string) => // betterleaks:allow
    request<Session>("POST", "/password/reset", { token, password }).then(withPermissions), // betterleaks:allow
  /** A signed-in user's new password, given the current one; other sessions end, this one goes on. */
  changePassword: (current: string, password: string) => // betterleaks:allow
    request<{ user: User }>("PUT", "/password", { current, password }), // betterleaks:allow
  /** With the SEO settings the editor's preview shows, drafts included. */
  pages: () => request<{ pages: SitePage[] }>("GET", "/pages?draft"),
  setVisibility: (path: string, visibility: Visibility) => request<SitePage>("PUT", "/pages", { path, visibility }),
  /** Held in the draft until saved. */
  setSeo: (path: string, seo: SeoSettings) => request<SitePage & Drafted>("PUT", "/pages", { path, seo, draft: true }),
  movePage: (path: string, to: string) => request<{ page: SitePage }>("POST", "/pages/move", { path, to }),
  redirects: () => request<{ redirects: Redirect[] }>("GET", "/redirects"),
  setRedirects: (redirects: Redirect[]) => request<{ redirects: Redirect[] }>("PUT", "/redirects", { redirects }),
  templates: () => request<{ templates: PageTemplateInfo[] }>("GET", "/templates"),
  createPage: (page: NewPage) => request<{ page: SitePage }>("POST", "/pages", page),
  deletePage: (path: string) => request<object>("DELETE", "/pages", { path }),
  responses: () => request<{ responses: FormResponse[] }>("GET", "/responses"),
  deleteResponse: (id: string) => request<object>("DELETE", "/responses", { id }),
  media: (query: { search?: string; folder?: string; after?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.search) params.set("search", query.search);
    if (query.folder !== undefined) params.set("folder", query.folder);
    if (query.after) params.set("after", query.after);
    const search = params.toString();
    return request<{ files: MediaFile[]; next?: string }>("GET", `/media${search ? `?${search}` : ""}`);
  },
  upload: async (file: File, folder = ""): Promise<MediaFile> => {
    const response = await send("/admin/api/media", () => ({
      method: "POST",
      headers: { "x-file-name": encodeURIComponent(file.name), "x-media-folder": encodeURIComponent(folder) },
      body: file,
    }));
    const payload = await answer<{ file?: MediaFile }>(response, "Could not upload the image.");
    if (!payload.file) throw new ApiError(response.status, "Could not upload the image.");
    return payload.file;
  },
  types: () => request<{ types: ContentType[] }>("GET", "/types"),
  /** As the editor's preview shows them, drafts included. */
  items: (type: string) => request<{ items: Item[] }>("GET", `/items?type=${encodeURIComponent(type)}&draft`),
  createItem: (type: string, draft: ItemDraft, locale?: string) =>
    request<{ item: Item }>("POST", "/items", { type, ...draft, ...(locale && { locale }) }),
  /** A private copy of the item in another language, linked to it. */
  translateItem: (id: string, locale: string) => request<{ item: Item }>("POST", "/items/translate", { id, locale }),
  /** The page in another language, filled with this page's content where it has none yet. */
  translatePage: (path: string, locale: string) =>
    request<{ path: string; created: boolean; copied: number }>("POST", "/pages/translate", { path, locale }),
  /** Saved at once, as from the item's form: whatever was drafted of the item is settled with it. */
  updateItem: (id: string, draft: ItemDraft) => request<{ item: Item }>("PUT", "/items", { id, ...draft }),
  /** The item's content held in the draft until saved; `path` is the page it was changed on. */
  draftItem: (id: string, draft: ItemDraft, path: string) =>
    request<{ item: Item } & Drafted>("PUT", "/items", { id, ...draft, path, draft: true }),
  /** Who can see an item changes at once, never with the draft. */
  setItemVisibility: (id: string, visibility: Visibility) =>
    request<{ item: Item }>("PUT", "/items/visibility", { id, visibility }),
  deleteItem: (id: string) => request<object>("DELETE", "/items", { id }),
  /** The order of an `ordered` type's items written first, first to last. */
  reorderItems: (type: string, ids: string[]) =>
    request<{ items: { id: string; position: number }[] }>("PUT", "/items/order", { type, ids }),
  /** Answers with the item when the node shows one of its fields. */
  saveNode: (node: NodeRef, kind: string, value: unknown) =>
    request<{ item?: Item } & Drafted>("PUT", "/nodes", { ...node, kind, value, draft: true }),
  resetNode: (node: NodeRef) => request<Drafted>("DELETE", "/nodes", { ...node, draft: true }),
  /** How many changes nobody has saved yet, and the pages they are on. */
  drafts: () => request<{ drafts: number; pages: string[] }>("GET", "/drafts"),
  /** Undo or redo: one thing's draft put back; answers with the item when it is one. */
  putDraft: (change: Pick<DraftChange, "target" | "key" | "page">, value: unknown) =>
    request<Drafted & { item?: Item }>("PUT", "/drafts", {
      target: change.target,
      key: change.key,
      path: change.page,
      value,
    }),
  saveDrafts: () =>
    request<{ saved: number; failed: { page: string; error: string }[]; drafts: number }>("POST", "/drafts/save"),
  discardDrafts: () => request<{ drafts: number }>("DELETE", "/drafts"),
  /** The latest changes, on one page or (without a path) on the whole site. */
  history: (path?: string) =>
    request<{ history: HistoryEntry[] }>(
      "GET",
      path === undefined ? "/history" : `/history?path=${encodeURIComponent(path)}`,
    ),
  restoreHistory: (id: string) => request<object>("POST", "/history/restore", { id }),
  /** The site's own settings (src/site-settings.ts): its fields and their values in one language. */
  siteSettings: (locale?: string) =>
    request<SiteSettingsView>("GET", `/site-settings${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`),
  saveSiteSettings: (values: Record<string, unknown>, locale?: string) =>
    request<SiteSettingsView>("PUT", "/site-settings", { values, ...(locale && { locale }) }),
  mail: () => request<MailSettings>("GET", "/mail"),
  saveMail: (settings: MailSettingsUpdate) => request<MailSettings>("PUT", "/mail", settings),
  testMail: () => request<{ sentTo: string }>("POST", "/mail/test"),
  /** The icon sets this site offers and, with a value, the icon a block has now (`null` when it is unknown). */
  icons: (value?: string) =>
    request<{ sets: IconSetInfo[]; icon?: Icon | null }>(
      "GET",
      value === undefined ? "/icons" : `/icons?value=${encodeURIComponent(value)}`,
    ),
  /** The icons of one set whose name contains the search, the first of them. */
  searchIcons: (set: string, search: string) =>
    request<IconSearch>("GET", `/icons/${encodeURIComponent(set)}?q=${encodeURIComponent(search)}`),
  /** What this site can do; `video-uploads` is there when a video host is set up. */
  info: () => request<SiteInfo>("GET", "/info"),
  createVideo: (file: { name: string; size: number; type: string }) =>
    request<VideoUploadTicket>("POST", "/videos", file),
  videoStatus: (id: string) => request<VideoStatus>("GET", `/videos/${encodeURIComponent(id)}`),
  /** The videos on the site's video host, newest first; `supported` is false when the host does not list them. */
  listVideos: () => request<{ supported: boolean; videos: UploadedVideo[] }>("GET", "/videos"),
  deleteVideo: (id: string) => request<{ deleted: true }>("DELETE", `/videos/${encodeURIComponent(id)}`),
};
