import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AstroConfig, AstroIntegration } from "astro";
import {
  type BrimOptions,
  type DatabaseConfig,
  type OutputMode,
  resolveDatabase,
  resolveMail,
  resolveOutput,
  resolveHostSignIn,
  resolveVideoUploads,
  checkMedia,
  resolveBrandColors,
  resolveMedia,
  resolveIdentity,
  type BrandColor,
  type SiteIdentity,
} from "./config.ts";
import { Mailer } from "./mail/mailer.ts";
import type { SiteEmails } from "./mail/templates.ts";
import type { SiteSettings } from "./content/site-settings.ts";
import type { ContentType } from "./content/content-types.ts";
import type { PageTemplate } from "./content/page-templates.ts";
import type { SiteRoutes } from "./content/sitemap.ts";
import { captchaCheck, resolveCaptcha } from "./forms/captcha.ts";
import { FORMS_PATH, createFormsHandler } from "./forms/handler.ts";
import { formFilesDirectory, resolveFormFiles } from "./forms/files.ts";
import { IconLibrary } from "./icons/library.ts";
import { iconPackSources, iconsModule, loadIconPacks } from "./icons/load.ts";
import { MAX_UPLOAD_BYTES, storageFiles, uploadResponse } from "./content/media.ts";
import { connect } from "./runtime/connect.ts";
import { adoptLanguageScopes } from "./content/language-scopes.ts";
import { ADMIN_PATH, createAdminHandler } from "./server/handler.ts";
import type { LocaleConfig } from "./server/locales.ts";
import { toNodeMiddleware } from "./server/node.ts";
import { type QueryRules, parseQueryRules, undeclaredQueryReads } from "./server/query-params.ts";
import { VERSION } from "./version.ts";

export type { BrimOptions };

const CONFIG_MODULE = "virtual:brim/config";
const RESOLVED_CONFIG_MODULE = `\0${CONFIG_MODULE}`;
const ICONS_MODULE = "virtual:brim/icons";
const RESOLVED_ICONS_MODULE = `\0${ICONS_MODULE}`;
const ROUTES_MODULE = "virtual:brim/routes";
const RESOLVED_ROUTES_MODULE = `\0${ROUTES_MODULE}`;
/**
 * Astro's Node adapter is brimjs's own dependency, so it is found from this file, not from the site. It is
 * loaded by Node itself and only while the config is set up: pages import `brimjs` too, and a bundler that
 * could follow an import here would carry the adapter and its build tools into the site's server.
 */
const NODE_ADAPTER = "@astrojs/node";
const fromBrim = createRequire(import.meta.url);
/** The SQLite client, also brimjs's own dependency. */
const DATABASE_CLIENT = "@libsql/client";
const EDITOR_ASSETS = new URL("../editor-dist/", import.meta.url);
/** Where uploaded images are served from, on the dev server and on the built one. */
const UPLOADS_PATH = "/uploads/";
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;
/**
 * Where a site declares its content types, relative to `src/`: a module exporting `contentTypes`.
 * It is loaded through Vite, never imported by the Astro config, so a change shows up without a restart.
 */
const CONTENT_TYPES_MODULE = "content-types/index.ts";
/** Where a site declares the templates of pages the owner adds: a module exporting `pageTemplates`. */
const PAGE_TEMPLATES_MODULE = "page-templates/index.ts";
/** Where a site declares its own settings (phone, email, social profiles…): a module exporting `siteSettings`. */
const SITE_SETTINGS_MODULE = "site-settings.ts";
/** The emails the site writes itself: `export const emails = defineEmails({ form: … })`. */
const EMAILS_MODULE = "emails.ts";

export default function brim(options: BrimOptions = {}): AstroIntegration {
  let database: DatabaseConfig;
  /** How this run makes pages: live in dev, from the database per request on the server, or once in a static build. */
  let mode: "dev" | OutputMode = "dev";
  /** True when Brim set up the Node adapter itself because the site has none. */
  let ownAdapter = false;
  let locales: LocaleConfig | undefined;
  let pages: string[] = [];
  /** What the sitemap reads of the code; read when its module loads, so it is the resolved routes. */
  let siteRoutes: SiteRoutes = { pages: [], patterns: [] };
  let devServer: DevServer | undefined;
  let mediaDirectory: URL;
  let projectRoot = "";
  let contentTypesFile: string | undefined;
  let pageTemplatesFile: string | undefined;
  let siteSettingsFile: string | undefined;
  let emailsFile: string | undefined;
  let icons: IconLibrary;
  let brandColors: BrandColor[] = [];
  let identity: SiteIdentity = {};

  return {
    name: "brimjs",
    hooks: {
      "astro:config:setup": ({ config, command, updateConfig, addMiddleware, injectRoute, logger }) => {
        database = resolveDatabase(options, fileURLToPath(config.root));
        locales = localeConfig(config.i18n);
        mediaDirectory = new URL("uploads/", config.publicDir);
        projectRoot = fileURLToPath(config.root);
        contentTypesFile = siteModule(config.srcDir, CONTENT_TYPES_MODULE);
        pageTemplatesFile = siteModule(config.srcDir, PAGE_TEMPLATES_MODULE);
        siteSettingsFile = siteModule(config.srcDir, SITE_SETTINGS_MODULE);
        emailsFile = siteModule(config.srcDir, EMAILS_MODULE);
        mode = command === "dev" ? "dev" : resolveOutput(options);
        // The site's address from its host when the code names none (`BRIM_SITE_URL`, e.g. its domain on Brimsites):
        // canonical links, the sitemap, feeds and shared pictures then name the address visitors use.
        const hostAddress = config.site ? undefined : siteAddress(process.env.BRIM_SITE_URL);
        if (hostAddress) updateConfig({ site: hostAddress });
        const site = config.site ?? hostAddress;
        // Read here, so a pack that is missing or malformed stops the site with the reason, not a page later.
        const iconSources = iconPackSources(options.icons, fileURLToPath(config.root));
        icons = new IconLibrary(options.icons, loadIconPacks(iconSources));
        const iconsCode = iconsModule(options.icons, iconSources);
        brandColors = resolveBrandColors(options.brandColors);
        checkMedia(options.media);
        identity = resolveIdentity(options.identity, fileURLToPath(config.publicDir), existsSync);
        if (options.assistant !== undefined)
          logger.warn("brim({ assistant }) is ignored: Brim.js no longer has an AI assistant.");
        const query = parseQueryRules(options.query);
        const siteCode = mode === "server" ? readSiteCode(config.root, config.srcDir) : [];
        // What the site's own code reads of the query without saying so: pages Brim sees drawn then declare nothing,
        // since such code could be part of any of them.
        const undeclared = undeclaredQueryReads(siteCode, query);
        if (undeclared.length > 0) {
          logger.warn(
            `Reads the query without declaring it: ${undeclared.map(({ file, line }) => `${file}:${line}`).join(", ")}. ` +
              'Say what it reads with readsQuery() from "brimjs/server" or brim({ query }), so a host can cache pages ' +
              "precisely; until then only declared pages are.",
          );
        }
        // The feeds of content types with `feed` set; their links are full addresses, so a build needs `site`.
        // A site with its own `src/pages/rss/` keeps it.
        const feeds =
          contentTypesFile !== undefined &&
          (Boolean(site) || command !== "build") &&
          !existsSync(new URL("pages/rss", config.srcDir));
        const runtimeConfig = {
          command,
          mode,
          feeds,
          locales,
          mediaDirectory: fileURLToPath(mediaDirectory),
          editorAssets: fileURLToPath(EDITOR_ASSETS),
          // As written in the config; BRIM_VIDEO_UPLOADS_URL and _TOKEN are read when the server starts.
          videoUploads: options.videoUploads,
          // As written in the config; BRIM_SMTP_URL, BRIM_MAIL_FROM, _URL and _TOKEN are read when the server starts.
          mail: options.mail,
          // As written in the config; BRIM_MEDIA_STORAGE_URL, _TOKEN, BRIM_MEDIA_PUBLIC_URL and _RESIZE are read
          // when the server starts.
          media: options.media,
          brandColors,
          identity,
          // The public key only; BRIM_CAPTCHA_SECRET is read when the server starts.
          captcha: resolveCaptcha(options.forms?.captcha),
          query,
          build: buildId(siteCode, query),
          learnQuery: undeclared.length === 0,
          // Kept beside the database the server runs with; BRIM_PRIVATE_STORAGE_URL and _TOKEN are read when the
          // server starts.
          formFiles: { storage: options.forms?.files?.storage },
        };
        // The built server reads where its database is when it starts, so the same build runs anywhere and a
        // remote database's token is never written into it. A database named in the config stays as written.
        const databaseModule = options.database
          ? `{ databaseUrl: ${JSON.stringify(database.databaseUrl)}, authToken: ${JSON.stringify(options.authToken)} ?? process.env.BRIM_DATABASE_TOKEN }`
          : `{ databaseUrl: process.env.BRIM_DATABASE_URL ?? ${JSON.stringify(database.databaseUrl)}, authToken: ${JSON.stringify(options.authToken)} ?? process.env.BRIM_DATABASE_TOKEN }`; // betterleaks:allow
        // Pages read the declarations through this module, so Vite reloads them when a file changes.
        const configModule = [
          contentTypesFile && `import { contentTypes } from ${JSON.stringify(contentTypesFile)};`,
          pageTemplatesFile && `import { pageTemplates } from ${JSON.stringify(pageTemplatesFile)};`,
          siteSettingsFile && `import { siteSettings } from ${JSON.stringify(siteSettingsFile)};`,
          emailsFile && `import { emails } from ${JSON.stringify(emailsFile)};`,
          `export default { ...${JSON.stringify(runtimeConfig)}, ...${databaseModule},`,
          `  contentTypes: ${contentTypesFile ? "contentTypes ?? []" : "[]"},`,
          `  pageTemplates: ${pageTemplatesFile ? "pageTemplates ?? []" : "[]"},`,
          `  siteSettings: ${siteSettingsFile ? "siteSettings ?? null" : "null"},`,
          `  emails: ${emailsFile ? "emails ?? null" : "null"} };`,
        ]
          .filter(Boolean)
          .join("\n");

        updateConfig({
          vite: {
            plugins: [
              {
                name: "brimjs:config",
                // Before Vite's own resolver, which would find the database client and bundle it.
                enforce: "pre",
                resolveId: (id) =>
                  id === CONFIG_MODULE
                    ? RESOLVED_CONFIG_MODULE
                    : id === ROUTES_MODULE
                      ? RESOLVED_ROUTES_MODULE
                      : id === ICONS_MODULE
                        ? RESOLVED_ICONS_MODULE
                        : ownAdapter && id.startsWith("@astrojs/node/")
                          ? // The adapter is brimjs's dependency, not the site's: its files are found from here.
                            fromBrim.resolve(id)
                          : command === "build" && id === DATABASE_CLIENT
                            ? // Left out of the bundle and named by where it is installed: it loads a native module
                              // that only its own folder can find.
                              { id: pathToFileURL(fromBrim.resolve(id)).href, external: true }
                            : undefined,
                load: (id) =>
                  id === RESOLVED_CONFIG_MODULE
                    ? configModule
                    : id === RESOLVED_ROUTES_MODULE
                      ? `export default ${JSON.stringify(siteRoutes)};`
                      : id === RESOLVED_ICONS_MODULE
                        ? iconsCode
                        : undefined,
              },
            ],
          },
        });
        addMiddleware({ entrypoint: "brimjs/middleware", order: "pre" });
        // Every link is fetched as the pointer reaches it (or as it is focused or touched), so the page is there by
        // the time it is clicked. A site that sets `prefetch` itself keeps its own.
        if (config.prefetch === undefined) {
          updateConfig({ prefetch: { prefetchAll: true, defaultStrategy: "hover" } });
        }
        // The dev server draws pages on each request, like the Node server: a page then reads its address's query
        // (a listing's facets, search and pages), which Astro hides from pages it would write once at build time.
        if (mode === "dev" && config.output !== "server") updateConfig({ output: "server" });
        if (mode === "server") {
          // Pages are drawn on each request. The site keeps its own adapter when it has one.
          // Astro runs an adapter as an integration and also asks the config whether one is set.
          const node = config.adapter ? undefined : (fromBrim(NODE_ADAPTER) as typeof import("@astrojs/node")).default;
          // The largest thing the server is sent is an image (10 MB); videos go from the browser straight to their
          // host. The adapter's own limit is 1 GB, which a visitor could fill the server's memory with.
          const adapter = node?.({ mode: "standalone", bodySizeLimit: MAX_REQUEST_BYTES });
          ownAdapter = adapter !== undefined;
          updateConfig({ output: "server", ...(adapter && { adapter, integrations: [adapter] }) });
          injectRoute({ pattern: `${ADMIN_PATH}/[...path]`, entrypoint: "brimjs/admin-route", prerender: false });
          injectRoute({ pattern: `${FORMS_PATH}/[...path]`, entrypoint: "brimjs/forms-route", prerender: false });
          injectRoute({ pattern: `${UPLOADS_PATH}[...file]`, entrypoint: "brimjs/uploads-route", prerender: false });
        }
        // Pages added from templates and the pages of items answer any address the site's own pages leave free.
        if (pageTemplatesFile || contentTypesFile) {
          // A static build lists their pages (`getStaticPaths`); the server looks each one up, and has no list to ignore.
          injectRoute({
            pattern: "/[...page]",
            entrypoint: mode === "static" ? "brimjs/template-page-static" : "brimjs/template-page",
          });
        }
        // The sitemap lists pages by their full address, so a build needs the site's address to write one.
        // A site that writes its own sitemap or robots.txt keeps it.
        const own = (file: string): boolean =>
          ["ts", "js", "xml", "txt"].some((extension) => siteModule(config.srcDir, `pages/${file}.${extension}`));
        if (feeds) {
          // A static build lists its feeds (`getStaticPaths`); the server makes each when it is asked.
          injectRoute({ pattern: "/rss/[...feed]", entrypoint: mode === "static" ? "brimjs/rss-static" : "brimjs/rss" });
        }
        // A server answers with its own address when `site` is not set; a static build has only `site` to write.
        const sitemap = !own("sitemap.xml") && (Boolean(site) || mode !== "static" || command !== "build");
        if (!own("sitemap.xml") && !sitemap) {
          logger.warn('No sitemap.xml: set `site` in astro.config (e.g. "https://example.com").');
        }
        if (sitemap) injectRoute({ pattern: "/sitemap.xml", entrypoint: "brimjs/sitemap" });
        // Without one, every crawler that asks for it gets the 404 page, drawn by the server each time.
        if (!own("robots.txt") && !existsSync(new URL("robots.txt", config.publicDir))) {
          injectRoute({ pattern: "/robots.txt", entrypoint: "brimjs/robots" });
        }
      },
      // The sitemap, robots.txt and feeds are written once by a static build; the server makes them on each request.
      "astro:route:setup": ({ route }) => {
        if (mode === "server" && /brim(js)?[/\\]src[/\\]runtime[/\\](sitemap|robots|rss)\.ts$/.test(route.component)) {
          route.prerender = false;
        }
      },
      "astro:config:done": ({ injectTypes }) => {
        injectTypes({
          filename: "brim.d.ts",
          content: `declare namespace App { interface Locals { brim: import("brimjs").BrimContext } }`,
        });
      },
      "astro:routes:resolved": ({ routes }) => {
        // Pages with a fixed address. The pages of items are listed with their content type, pages added from
        // templates with their own records.
        pages = routes.flatMap((route) =>
          route.type === "page" && route.pathname && !route.pathname.startsWith(ADMIN_PATH) && route.pathname !== "/404"
            ? [route.pathname]
            : [],
        );
        const patterns = routes.flatMap((route) => (route.type === "page" && !route.pathname ? [route.pattern] : []));
        siteRoutes = { pages, patterns };
        // A page added to or removed from src/pages reaches the sitemap without a restart.
        for (const name of ["ssr", "prerender"]) {
          const environment = devServer?.environments[name];
          const module = environment?.moduleGraph.getModuleById(RESOLVED_ROUTES_MODULE);
          if (environment && module) environment.moduleGraph.invalidateModule(module);
        }
      },
      // Where the editor is, said where people look when the dev server starts.
      "astro:server:start": ({ address, logger }) => {
        const host =
          address.family === "IPv6" || address.address === "::" || address.address === "0.0.0.0"
            ? "localhost"
            : address.address;
        logger.info(`Editor: http://${host}:${address.port}/admin/edit  (or npx brim open, already signed in)`);
      },
      "astro:server:setup": async ({ server }) => {
        devServer = server;
        const connection = await connect(database.databaseUrl, database.authToken);
        // A site that just turned languages on keeps what was saved before, as its default language's.
        if (locales) await adoptLanguageScopes(connection.db, locales.defaultLocale);
        const mailer = new Mailer(resolveMail(options.mail));
        const formFiles = resolveFormFiles({
          storage: options.forms?.files?.storage,
          mediaInStorage: Boolean(resolveMedia(options.media).storage),
          directory: formFilesDirectory(database.databaseUrl, projectRoot),
        });
        const admin = createAdminHandler({
          brim: connection,
          locales,
          assetsDirectory: EDITOR_ASSETS,
          contentTypes: async () => (await loadSiteModule(server, contentTypesFile)).contentTypes ?? [],
          pageTemplates: async () => (await loadSiteModule(server, pageTemplatesFile)).pageTemplates ?? [],
          siteSettings: async () => (await loadSiteModule(server, siteSettingsFile)).siteSettings ?? null,
          emails: async () => (await loadSiteModule(server, emailsFile)).emails ?? null,
          mediaDirectory,
          mediaFiles: storageFiles(resolveMedia(options.media).storage),
          formFiles,
          videoUploads: resolveVideoUploads(options.videoUploads),
          hostSignIn: resolveHostSignIn(),
          mailer,
          icons,
          brandColors,
          identity,
          pages: () => pages,
          patterns: () => siteRoutes.patterns,
          // Astro keeps what getStaticPaths returned until it is told content changed: pages and items
          // added or hidden in the editor would otherwise answer 404, or stay listed, until a restart.
          onChange: () => {
            for (const name of ["ssr", "prerender"]) server.environments[name]?.hot.send("astro:content-changed", {});
          },
        });
        // Uploads are read from disk when asked, as on the built server: Vite would answer 404 for an image uploaded a
        // moment ago, which is when the page drawn after the upload asks for it.
        server.middlewares.use(
          toNodeMiddleware(async (request) => {
            const { pathname } = new URL(request.url);
            if (!pathname.startsWith(UPLOADS_PATH)) return undefined;
            // Brim names its files with letters, digits, dashes and dots only, so nothing needs decoding.
            return uploadResponse(
              fileURLToPath(mediaDirectory),
              pathname.slice(UPLOADS_PATH.length),
              resolveMedia(options.media).publicUrl,
            );
          }),
        );
        server.middlewares.use(toNodeMiddleware(admin));
        server.middlewares.use(
          toNodeMiddleware(
            createFormsHandler(connection, {
              mailer,
              files: formFiles,
              siteName: identity.name,
              captcha: captchaCheck(resolveCaptcha(options.forms?.captcha)),
              // Read at each message: a change to src/emails.ts shows in the next email, without a restart.
              emails: async () => (await loadSiteModule(server, emailsFile)).emails ?? null,
            }),
          ),
        );
      },
    },
  };
}

const CODE_FILE = /\.(?:astro|[cm]?[jt]sx?|mdx?)$/;
const SKIPPED = new Set(["node_modules", ".git", ".astro", "dist"]);

/** The site's code in `src/`, by path relative to the site's folder. */
function readSiteCode(root: URL, srcDir: URL): { file: string; text: string }[] {
  const rootPath = fileURLToPath(root);
  const files: { file: string; text: string }[] = [];
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) walk(path);
      } else if (entry.isFile() && CODE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        files.push({ file: relative(rootPath, path).split(sep).join("/"), text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(fileURLToPath(srcDir));
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The same code builds with the same name, whatever the environment it was built with: what its pages read is
 * remembered across rebuilds and restarts, and forgotten when the code (or Brim.js) changes.
 */
function buildId(siteCode: { file: string; text: string }[], query: QueryRules): string {
  const hash = createHash("sha256").update(VERSION).update(JSON.stringify(query));
  for (const { file, text } of siteCode) hash.update(`\0${file}\0${text}`);
  return hash.digest("hex").slice(0, 24);
}

function siteModule(srcDir: URL, name: string): string | undefined {
  const file = fileURLToPath(new URL(name, srcDir));
  return existsSync(file) ? file : undefined;
}

interface SiteModule {
  contentTypes?: ContentType[];
  pageTemplates?: PageTemplate[];
  siteSettings?: SiteSettings;
  emails?: SiteEmails;
}

/**
 * One of the site's declarations, loaded through the dev server's SSR environment: the same module the pages
 * render with, which Vite replaces when the file changes.
 */
async function loadSiteModule(server: DevServer, file: string | undefined): Promise<SiteModule> {
  const environment: object = server.environments.ssr;
  // Only a runnable environment has a runner; Astro's SSR environment in dev is one.
  const runner = "runner" in environment ? (environment.runner as ModuleRunner) : undefined;
  if (!file || !runner) return {};
  return (await runner.import(file)) as SiteModule;
}

/** Vite's dev server, as Astro hands it to integrations; brimjs does not depend on Vite directly. */
type DevServer = Parameters<NonNullable<AstroIntegration["hooks"]["astro:server:setup"]>>[0]["server"];

interface ModuleRunner {
  import(url: string): Promise<unknown>;
}

function localeConfig(i18n: AstroConfig["i18n"]): LocaleConfig | undefined {
  if (!i18n) return undefined;
  return {
    defaultLocale: i18n.defaultLocale,
    locales: i18n.locales.map((locale) => (typeof locale === "string" ? locale : locale.path)),
    prefixDefaultLocale: typeof i18n.routing === "object" && i18n.routing.prefixDefaultLocale === true,
  };
}

/** `BRIM_SITE_URL` as Astro's `site`: an http(s) address, its origin only; anything else is not one. */
export function siteAddress(value: string | undefined): string | undefined {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
