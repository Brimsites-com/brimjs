import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { splitDatabaseUrl } from "./db/url.ts";
import type { IconsOptions } from "./icons/library.ts";

export interface DatabaseOptions {
  /** SQLite database URL. Defaults to `BRIM_DATABASE_URL`, then to a file in `.brim/` inside the project. */
  database?: string;
  /**
   * Token for a remote database while developing and building. Defaults to `BRIM_DATABASE_TOKEN`, which the built
   * server reads where it runs: a token written here is never put into the build.
   */
  authToken?: string;
}

/**
 * What `astro build` makes:
 * - `"server"` (default): a Node server that renders pages from the database on each request and answers
 *   `/admin` (editor, API, MCP) and forms. Start it with `brim start`.
 * - `"static"`: plain files for any static host, as the content is at build time. Nothing answers `/admin`.
 */
export type OutputMode = "server" | "static";

/**
 * A video host: a service that takes the videos uploaded in the editor, stores them and says where they play.
 * Brim only knows its address and speaks the small contract in the README; without one, videos are pasted links.
 */
export interface VideoUploadsOptions {
  /** HTTPS endpoint of the video host. `BRIM_VIDEO_UPLOADS_URL` wins over it. */
  url?: string | undefined;
  /** Sent to the host as `Authorization: Bearer <token>`. `BRIM_VIDEO_UPLOADS_TOKEN` wins over it. */
  token?: string | undefined; // betterleaks:allow
}

/**
 * How the site sends email (the notice the owner gets when someone writes through a form). Either an SMTP
 * server, or a mail service that speaks the small contract in the README. The owner can also set their own SMTP
 * server in the editor's Site Settings, which wins over both.
 */
export interface MailOptions {
  /** `smtps://user:password@host:465` or `smtp://…:587`. `BRIM_SMTP_URL` wins over it. */ // betterleaks:allow
  smtp?: string | undefined;
  /** The sender, `Name <address>` or an address. `BRIM_MAIL_FROM` wins over it. Needed with `smtp`. */
  from?: string | undefined;
  /** HTTPS endpoint of a mail service, used when there is no SMTP server. `BRIM_MAIL_URL` wins over it. */
  url?: string | undefined;
  /** Sent to the mail service as `Authorization: Bearer <token>`. `BRIM_MAIL_TOKEN` wins over it. */
  token?: string | undefined; // betterleaks:allow
}

/** A color of the site's brand: offered first wherever the editor picks a color, never changed there. */
export interface BrandColor {
  /** Shown when hovering the swatch, e.g. "Primary". */
  name: string;
  /** A hex color: `#rgb` or `#rrggbb`. */
  value: string;
}

const BRAND_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The brand colors as the config names them, as a list or as `{ name: "#hex" }`. A color that is not `#rgb` or
 * `#rrggbb` is an error, so a typo shows when the site starts instead of as a missing swatch.
 */
export function resolveBrandColors(input: BrandColor[] | Record<string, string> | undefined): BrandColor[] {
  if (!input) return [];
  const list = Array.isArray(input) ? input : Object.entries(input).map(([name, value]) => ({ name, value }));
  if (list.length > 24) throw new Error("brim: brandColors has more than 24 colors.");
  return list.map(({ name, value }) => {
    const clean = String(value ?? "").trim();
    if (!BRAND_HEX.test(clean)) throw new Error(`brim: brand color "${name}" is "${value}"; use #rgb or #rrggbb.`);
    return {
      name:
        String(name ?? "")
          .trim()
          .slice(0, 40) || clean,
      value: clean.toLowerCase(),
    };
  });
}

/**
 * Where uploaded images are kept and how they reach visitors. Everything is optional: by default images are files in
 * `public/uploads`, served by the site's own server at `/uploads/…`, at their full size.
 *
 *   media: {
 *     storage: { url: "https://storage.example.com/my-site", headers: { Authorization: `Bearer ${process.env.STORAGE_TOKEN}` } },
 *     publicUrl: "https://cdn.example.com/my-site",
 *     resize: "{url}?width={width}",
 *   }
 */
export interface MediaOptions {
  /**
   * Keep uploads in a storage reached over HTTP instead of on the server's disk: each image is sent with
   * `PUT <url>/uploads/<file>` and the headers given (for the storage's key). The database lists the images as
   * before, under their `/uploads/…` address, so content does not change when the storage does.
   * `BRIM_MEDIA_STORAGE_URL` and `BRIM_MEDIA_STORAGE_TOKEN` (sent as `Authorization: Bearer`) override it.
   */
  storage?: { url: string; headers?: Record<string, string> };
  /**
   * Where visitors get the images: `<publicUrl>/uploads/<file>`, e.g. a CDN in front of the storage. Pages then
   * point at it, and the server sends any request for `/uploads/…` there. `BRIM_MEDIA_PUBLIC_URL` overrides it.
   */
  publicUrl?: string;
  /**
   * How the CDN in front of the images makes smaller copies, as an address with `{url}` and `{width}`:
   * `"{url}?width={width}"`, or `"/cdn-cgi/image/width={width}/{url}"`. Brim's images then offer the browser a
   * `srcset` of those widths, so a phone downloads a small copy. `BRIM_MEDIA_RESIZE` overrides it.
   */
  resize?: string;
  /** The widths of the `srcset` when `resize` is set; by default 320, 640, 960, 1280, 1920 and 2560. */
  widths?: number[];
  /**
   * Where visitors get the pictures of the site's own code (`public/images/hero.jpg` at `<siteUrl>/images/hero.jpg`),
   * for a host that copies `public/` to its CDN at each deploy. With `resize`, they then get a `srcset` from that CDN
   * as uploads do; without it, a server makes their copies itself (Astro's `/_image`). `BRIM_MEDIA_SITE_URL`
   * overrides it.
   */
  siteUrl?: string;
  /**
   * Have the site's own server make the smaller copies of the pictures in `public/` with `sharp` (Astro's `/_image`),
   * for a site with no CDN that makes them. Off unless asked for: a site behind a CDN that resizes needs neither the
   * package nor the work. The site then depends on `sharp` itself (`npm install sharp`). `BRIM_MEDIA_SHARP` (`1` or
   * `0`) overrides it.
   */
  sharp?: boolean;
}

/** What `media` resolves to when the server starts: the environment wins, so a host can set it without the code. */
export interface MediaConfig {
  storage?: { url: string; headers: Record<string, string> };
  publicUrl?: string;
  resize?: string;
  widths: number[];
  siteUrl?: string;
  sharp?: true;
}

export const DEFAULT_IMAGE_WIDTHS = [320, 640, 960, 1280, 1920, 2560];

export function resolveMedia(options: MediaOptions = {}): MediaConfig {
  const pick = (name: string, value: string | undefined): string | undefined =>
    (process.env[name] ?? value ?? "").trim() || undefined;
  const envStorage = pick("BRIM_MEDIA_STORAGE_URL", undefined);
  const token = pick("BRIM_MEDIA_STORAGE_TOKEN", undefined); // betterleaks:allow
  const storage = envStorage
    ? { url: envStorage, headers: token ? { authorization: `Bearer ${token}` } : {} }
    : options.storage?.url
      ? { url: options.storage.url, headers: options.storage.headers ?? {} }
      : undefined;
  const publicUrl = pick("BRIM_MEDIA_PUBLIC_URL", options.publicUrl);
  const resize = pick("BRIM_MEDIA_RESIZE", options.resize);
  const siteUrl = pick("BRIM_MEDIA_SITE_URL", options.siteUrl);
  const asked = pick("BRIM_MEDIA_SHARP", undefined)?.toLowerCase();
  const sharp = asked ? ["1", "true", "yes", "on"].includes(asked) : options.sharp === true;
  const widths = (options.widths ?? DEFAULT_IMAGE_WIDTHS).filter((width) => Number.isInteger(width) && width > 0);
  return {
    ...(storage && { storage: { ...storage, url: storage.url.replace(/\/+$/, "") } }),
    ...(publicUrl && { publicUrl: publicUrl.replace(/\/+$/, "") }),
    ...(resize && { resize }),
    ...(siteUrl && { siteUrl: siteUrl.replace(/\/+$/, "") }),
    ...(sharp && { sharp: true as const }),
    widths: widths.length > 0 ? [...new Set(widths)].sort((a, b) => a - b) : DEFAULT_IMAGE_WIDTHS,
  };
}

/** Checks `media` when the config is read, so a mistake fails at startup rather than on the first upload. */
export function checkMedia(options: MediaOptions | undefined): void {
  if (!options) return;
  const address = (value: string, name: string) => {
    if (!/^https?:\/\//.test(value)) throw new Error(`brim({ media }): ${name} must be an http or https address.`);
  };
  if (options.storage) address(options.storage.url, "storage.url");
  if (options.publicUrl) address(options.publicUrl, "publicUrl");
  if (options.siteUrl) address(options.siteUrl, "siteUrl");
  if (options.resize && !(options.resize.includes("{url}") && options.resize.includes("{width}")))
    throw new Error('brim({ media }): resize must hold {url} and {width}, e.g. "{url}?width={width}".');
}

/** Content types are not an option: they live in `src/content-types/index.ts`, exported as `contentTypes`. */
export interface BrimOptions extends DatabaseOptions {
  /** Defaults to `BRIM_OUTPUT`, then to `"server"`. */
  output?: OutputMode;
  videoUploads?: VideoUploadsOptions;
  /** Where uploaded images are kept and how they reach visitors: see `MediaOptions`. */
  media?: MediaOptions;
  mail?: MailOptions;
  /** Which icons the editor offers: Brim's own set, some of it, and packs you add. */
  icons?: IconsOptions;
  /**
   * The brand's colors, offered first in the editor's color pickers (text color, highlight, color fields). They
   * are set here, in code, so editors use them but cannot change them. `{ Primary: "#ff7138" }` or a list.
   */
  brandColors?: BrandColor[] | Record<string, string>;
  /**
   * Who the site is, set in code: its name, how page titles are written, what a page without its own
   * description or share image falls back to, its theme color and its favicon. See `IdentityOptions`.
   */
  identity?: IdentityOptions;
  /** The site's forms: see `FormsConfigOptions`. */
  forms?: FormsConfigOptions;
  /** @deprecated Brim.js no longer has an AI assistant: ignored, with a warning when the site starts. */
  assistant?: unknown;
  /**
   * The query parameters pages and routes of the site's own code read, for a host that keeps pages in a CDN
   * (Brimsites): a path, or a pattern where `*` stands for any characters, → the names, or `"all"`.
   * `{ "/api/products": ["sort", "id"], "/shop/*": ["color"], "/legacy/*": "all" }`. Brim's own blocks declare
   * what they read by themselves; a page can also say it with `readsQuery()` from `@brimsites/brimjs/server`.
   */
  query?: Record<string, readonly string[] | "all">;
}

export interface FormsConfigOptions {
  /**
   * A challenge every form asks visitors to pass, from Cloudflare Turnstile or hCaptcha:
   * `{ provider: "turnstile", siteKey: "0x4AAA…" }`. The secret key goes in the server's `BRIM_CAPTCHA_SECRET`.
   */
  captcha?: import("./forms/captcha.ts").CaptchaOptions;
  /**
   * Where the files visitors attach are kept, for a site that keeps its uploads in a storage (`media.storage`):
   * `{ storage: { url, headers } }` names a private one, reached with `PUT`, `GET` and `DELETE
   * <url>/form-files/<message>/<file>`. Nothing under it may be public. `BRIM_PRIVATE_STORAGE_URL` and
   * `BRIM_PRIVATE_STORAGE_TOKEN` (sent as `Authorization: Bearer`) override it. A site that keeps uploads on its
   * own disk needs nothing: the files go to `.brim/form-files`, which nothing serves.
   */
  files?: { storage?: { url: string; headers?: Record<string, string> } };
}

export interface IdentityOptions {
  /** The site's name: `og:site_name`, the title of a page without one, the editor's tab ("Edit · Acme"). */
  name?: string;
  /**
   * Other ways people write the name, the preferred one first: `["AcmeStudio", "acme.com"]`. Search engines read
   * them in the home page's structured data; visitors never see them.
   */
  alternateName?: string | readonly string[];
  /** How a page's title is written, `%s` being the page's own: `"%s — Acme Studio"`. */
  titleTemplate?: string;
  /** For pages without a description of their own. */
  description?: string;
  /** Shown when a page without its own image is shared: a file of `public` or an address. */
  image?: string;
  /** The browser's color for the site's bar on phones: `#rrggbb`. */
  themeColor?: string;
  /** The icon in browser tabs, also the editor's. Without it, `public/favicon.svg`, `.ico` or `.png` when there. */
  favicon?: string;
}

/** The identity as pages and the editor use it, checked when the site starts. */
export interface SiteIdentity {
  name?: string | undefined;
  alternateName?: string[] | undefined;
  titleTemplate?: string | undefined;
  description?: string | undefined;
  image?: string | undefined;
  themeColor?: string | undefined;
  favicon?: string | undefined;
}

const FAVICON_FILES = ["favicon.svg", "favicon.ico", "favicon.png"];

/** The favicon to use: the one the config names, else the first favicon file in the site's `public` folder. */
export function resolveFavicon(
  favicon: string | undefined,
  publicDir: string,
  exists: (path: string) => boolean,
): string | undefined {
  const named = favicon?.trim();
  if (named) {
    if (!/^(\/|https:\/\/)/.test(named))
      throw new Error(`brim: identity.favicon "${named}" must start with "/" (a file of public/) or https://.`);
    return named;
  }
  const found = FAVICON_FILES.find((file) => exists(`${publicDir.replace(/\/$/, "")}/${file}`));
  return found ? `/${found}` : undefined;
}

/** The `type` of a favicon's link tag, from its file extension. */
export function faviconType(href: string): string | undefined {
  const extension = href.split("?")[0]?.split(".").pop()?.toLowerCase();
  return { svg: "image/svg+xml", ico: "image/x-icon", png: "image/png" }[extension ?? ""];
}

/**
 * The video host to use, read when the server starts: the environment wins, so a host can turn uploads on for
 * a site without touching its code. `undefined` (no address) leaves the feature off.
 */
export function resolveVideoUploads(options: VideoUploadsOptions = {}): VideoUploadsOptions | undefined {
  const url = (process.env.BRIM_VIDEO_UPLOADS_URL ?? options.url ?? "").trim();
  if (!url) return undefined;
  const token = process.env.BRIM_VIDEO_UPLOADS_TOKEN ?? options.token; // betterleaks:allow
  return { url, token };
}

/**
 * A host's own sign-in, offered as a second way in on the editor's sign-in form: a host that already knows its
 * people (Brimsites) checks who they are and sends them back through a sign-in link. Set by the host in the
 * environment only, never in the site's code; `undefined` leaves the form as it was.
 */
export interface HostSignIn {
  /** Where the button leads, on the host. */
  url: string;
  /** Who the button names: "Continue with {name}". */
  name: string;
}

export function resolveHostSignIn(): HostSignIn | undefined {
  const url = (process.env.BRIM_HOST_SIGN_IN_URL ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return undefined;
  return { url, name: (process.env.BRIM_HOST_SIGN_IN_NAME ?? "").trim() || "your host" };
}

/** How the server sends email, read when it starts: the environment wins, like for the video host. */
export function resolveMail(options: MailOptions = {}): MailOptions {
  const pick = (name: string, value: string | undefined): string | undefined =>
    (process.env[name] ?? value ?? "").trim() || undefined;
  return {
    smtp: pick("BRIM_SMTP_URL", options.smtp),
    from: pick("BRIM_MAIL_FROM", options.from),
    url: pick("BRIM_MAIL_URL", options.url),
    token: pick("BRIM_MAIL_TOKEN", options.token), // betterleaks:allow
  };
}

export interface DatabaseConfig {
  databaseUrl: string; // betterleaks:allow
  authToken: string | undefined; // betterleaks:allow
}

export function resolveDatabase(options: DatabaseOptions, projectRoot: string): DatabaseConfig {
  const { url, authToken } = splitDatabaseUrl(
    options.database ?? process.env.BRIM_DATABASE_URL ?? localDatabaseUrl(projectRoot),
  );
  return {
    databaseUrl: url, // betterleaks:allow
    authToken: options.authToken ?? authToken ?? process.env.BRIM_DATABASE_TOKEN, // betterleaks:allow
  };
}

/** The environment wins, so one project can be built both ways without touching its config. */
export function resolveOutput(options: BrimOptions): OutputMode {
  const chosen = process.env.BRIM_OUTPUT ?? options.output ?? "server";
  if (chosen !== "server" && chosen !== "static") {
    throw new Error(`Brim's output must be "server" or "static", not "${chosen}".`);
  }
  return chosen;
}

function localDatabaseUrl(projectRoot: string): string {
  const directory = join(projectRoot, ".brim");
  mkdirSync(directory, { recursive: true });
  return `file:${join(directory, "data.db")}`;
}

const ADDRESS = /^(\/|https:\/\/)/;

/** Checks the identity the config names; a mistake stops the site from starting and says which setting. */
export function resolveIdentity(
  identity: IdentityOptions | undefined,
  publicDir: string,
  exists: (path: string) => boolean,
): SiteIdentity {
  const text = (value: string | undefined, max: number): string | undefined => value?.trim().slice(0, max) || undefined;
  const titleTemplate = text(identity?.titleTemplate, 200);
  if (titleTemplate && !titleTemplate.includes("%s")) {
    throw new Error(`brim: identity.titleTemplate "${titleTemplate}" needs %s where the page's title goes.`);
  }
  const image = text(identity?.image, 500);
  if (image && !ADDRESS.test(image))
    throw new Error(`brim: identity.image "${image}" must start with "/" or https://.`);
  const themeColor = text(identity?.themeColor, 20);
  if (themeColor && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(themeColor)) {
    throw new Error(`brim: identity.themeColor "${themeColor}" must be #rgb or #rrggbb.`);
  }
  const name = text(identity?.name, 120);
  const alternateName = resolveAlternateNames(identity?.alternateName, name);
  return {
    name,
    ...(alternateName.length > 0 && { alternateName }),
    titleTemplate,
    description: text(identity?.description, 500),
    image,
    themeColor,
    favicon: resolveFavicon(identity?.favicon, publicDir, exists),
  };
}

/** The other names of the site, each once and without the name itself, as it is written already. */
function resolveAlternateNames(value: unknown, name: string | undefined): string[] {
  if (value === undefined) return [];
  const given = typeof value === "string" ? [value] : value;
  if (!Array.isArray(given) || given.some((other) => typeof other !== "string")) {
    throw new Error('brim: identity.alternateName must be a text or a list of texts: ["AcmeStudio", "acme.com"].');
  }
  const names = given.map((other: string) => other.trim().slice(0, 120)).filter((other) => other && other !== name);
  return [...new Set(names)].slice(0, 10);
}

/** The addresses of `sameAs` that can be published: full web addresses, each once; empty settings are left out. */
export function profileAddresses(values: readonly unknown[] | undefined): string[] {
  const addresses = (values ?? [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => /^https?:\/\//i.test(value) && URL.canParse(value));
  return [...new Set(addresses)];
}

/** A page's title through the template: `About` → `About — Acme`; the site's name alone stays as it is. */
export function pageTitleOf(title: string | undefined, identity: SiteIdentity): string {
  const own = title?.trim();
  if (!own) return identity.name ?? "";
  if (!identity.titleTemplate || own === identity.name) return own;
  return identity.titleTemplate.replace("%s", own);
}
