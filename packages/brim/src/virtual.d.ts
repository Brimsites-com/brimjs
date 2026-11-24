declare module "virtual:brim/config" {
  const config: {
    databaseUrl: string;
    authToken: string | undefined;
    command: "dev" | "build" | "preview" | "sync";
    /** How pages are made: live for everyone in dev, from the database per request, or once at build. */
    mode: "dev" | "server" | "static";
    /** True when Brim serves the feeds of content types (`/rss/…`), so pages may link them. */
    feeds: boolean;
    /** Where uploaded images are written. */
    mediaDirectory: string;
    /** Where the built editor is, as an installed brimjs has it. */
    editorAssets: string;
    locales: import("./server/locales.ts").LocaleConfig | undefined;
    /** The video host named in the integration's options; the environment is read when the server starts. */
    videoUploads: import("./config.ts").VideoUploadsOptions | undefined;
    /** How the site sends email, as named in the options; the environment is read when the server starts. */
    mail: import("./config.ts").MailOptions | undefined;
    /** Where uploads are kept and served, as named in the options; the environment is read when the server starts. */
    media: import("./config.ts").MediaOptions | undefined;
    /** The brand colors from the integration's options, checked when the config was read. */
    brandColors: import("./config.ts").BrandColor[];
    /** Name, title template, fallbacks, theme color and favicon (the one named, or found in public/). */
    identity: import("./config.ts").SiteIdentity;
    contentTypes: import("./content/content-types.ts").ContentType[];
    pageTemplates: import("./content/page-templates.ts").PageTemplate[];
    /** The site's own settings, from `src/site-settings.ts`; null when it declares none. */
    siteSettings: import("./content/site-settings.ts").SiteSettings | null;
    /** The challenge forms ask for (its provider and public key), when the config sets one. */
    captcha: import("./forms/captcha.ts").CaptchaOptions | undefined;
    /** The private storage the config names for visitors' files, if any; the environment is read at start. */
    formFiles: { storage?: { url: string; headers?: Record<string, string> } | undefined };
    /** The emails the site writes itself, from `src/emails.ts`; null when it writes none. */
    emails: import("./mail/templates.ts").SiteEmails | null;
    /** The query parameters the site's code declares it reads (`brim({ query })`), checked when the config was read. */
    query: import("./server/query-params.ts").QueryRules;
    /** Names this build of the site's code: what its pages were seen reading is remembered for it alone. */
    build: string;
    /**
     * Whether pages seen drawn may declare what they read: no code of the site reads the query without saying so.
     * Otherwise only pages that called `readsQuery()` do.
     */
    learnQuery: boolean;
  };
  export default config;
}

declare module "virtual:brim/icons" {
  const icons: {
    options: import("./icons/library.ts").IconsOptions;
    packs: import("./icons/library.ts").IconPack[];
  };
  export default icons;
}

declare module "virtual:brim/routes" {
  const routes: import("./content/sitemap.ts").SiteRoutes;
  export default routes;
}

declare namespace App {
  interface Locals {
    brim: import("./runtime/context.ts").BrimContext;
  }
}
