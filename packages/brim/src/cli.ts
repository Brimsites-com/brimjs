import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import type { Role } from "./auth/accounts.ts";
import { ROLES } from "./auth/permissions.ts";
import { checkSite, formatReport } from "./check.ts";
import { normalizePagePath, pageScope, siteScope } from "./content/ids.ts";
import { MediaStore } from "./content/media.ts";
import { init, initReport } from "./init.ts";
import { resolveDatabase } from "./config.ts";
import { type Brim, connect } from "./runtime/connect.ts";
import {
  type SeedTarget,
  contentFindings,
  exportSeedFiles,
  formatContentFindings,
  isLocalSite,
  runSeed,
} from "./seed-cli.ts";

const USAGE = `Usage:
  brim init [--brim <version>] [--lang <code>] [--no-git]
                                                Set up Brim.js in an Astro project that already exists: the
                                                dependency, the integration, the site's language (--lang, else the
                                                layout's <html lang>, else en), the conversion guide for AI agents,
                                                and git (git init, nothing committed) unless it is in git already.
  brim start                                    Run the site built by \`astro build\`: pages, /admin and forms.
                                                Listens on HOST and PORT (default 0.0.0.0:4321).
  brim check [folder] [--json]                  Read the site's source for duplicate or positional nodeIds and files
                                                left unchanged from the starter. Exits with 1 when there are errors.
  brim check --content                          Also read the running site's content: values left from testing
                                                (lorem ipsum, example.com, 0000000), terms nothing uses, and
                                                dynamic pages missing from the sitemap. Warnings only.
  brim info [--json]                            What the site's database holds: users, pages, items, media.
  brim seed [folder] [--dry-run]                Add the site's starting content from seed/<type>.json (pictures in
                                                seed/images/) to the running dev server. Only adds what the site
                                                does not have yet; never changes or deletes anything. Everything is
                                                checked first, and one mistake adds nothing.
  brim seed --export [folder] [--force]         Write the site's items into seed/<type>.json, with their pictures,
                                                to keep in git as its starting content.
                                                Both take --url <site> --token <token> for a site elsewhere.
  brim content [path] [--json]                  What the owner saved on a page (/ by default) and on the whole
                                                site (header, footer, settings): each element's nodeId, kind and
                                                value. Read it before changing a page's code. On Brimsites:
                                                brimsites content <site> [path].
  brim content --all [--json]                   Every place with saved content (pages, templates of item pages,
                                                the site), with how many elements each.
  brim media add <file>... [--item <type>/<id>] Put images into the site's media library (public/uploads), where
                                                the owner finds them, and print their /uploads addresses.
  brim open [email] [--page /path] [--url <site>]
                                                Open the editor in the browser, already signed in (a one-time link),
                                                on the dev server (http://localhost:4321) unless --url names the site.
  brim user add <email> [--role <role>]         Create a user who can sign in at /admin.
                                                The password is asked for, or read from stdin.
  brim user list [--json]                       List users with their role and number of tokens.
  brim user role <email> <role>                 Change a user's role: owner (everything), editor (writes, publishes,
                                                adds pages, reads forms) or writer (words and pictures only).
  brim user password <email>                    Set a new password (asked for, or read from stdin).
                                                Ends their sessions and access tokens.
  brim user link <email>                        Print a link that signs the user in once, within two minutes,
                                                without their password.
  brim user remove <email>                      Delete a user with their sessions and tokens.
  brim token add <email> [--name <name>]        Create an access token for the site's MCP (/admin/mcp).
                                                It acts as that user and is shown only once.
  brim token list <email>                       List a user's tokens.
  brim token revoke <email> <name>              Delete a token; clients using it stop working.`;

async function main(args: string[]): Promise<void> {
  const [group, command] = args;
  // The email is the first word after the command that is neither an option nor an option's value, so
  // `brim user add --role editor ana@example.com` works as well as the order the help shows.
  const takesValue = (arg: string | undefined) => !!arg?.startsWith("--") && arg !== "--json";
  const email = args.slice(2).find((arg, index, rest) => !arg.startsWith("--") && !takesValue(rest[index - 1]));
  const json = args.includes("--json");
  if (group === "start") return start();
  if (group === "init") return setUp(option(args, "--brim"), !args.includes("--no-git"), option(args, "--lang"));
  if (group === "check") return check(command && !command.startsWith("--") ? command : ".", json, args);
  if (group === "info") return info(json);
  if (group === "content") return content(command && !command.startsWith("--") ? command : "/", args, json);
  if (group === "user" && command === "list") return listUsers(json);
  if (group === "media" && command === "add") return addMedia(args.slice(2), json);
  if (group === "open") return openEditor(args.slice(1));
  if (group === "seed") return seed(args.slice(1));
  if (!email) throw new Error(USAGE);
  if (group === "user" && command === "add") return addUser(email, args);
  if (group === "user" && command === "role" && args[3]) return setRole(email, args[3]);
  if (group === "user" && command === "password") return setPassword(email);
  if (group === "user" && command === "link") return signInLink(email);
  if (group === "user" && command === "remove") return removeUser(email);
  if (group === "token" && command === "add") return addToken(email, option(args, "--name") ?? "mcp");
  if (group === "token" && command === "list") return listTokens(email);
  if (group === "token" && command === "revoke" && args[3]) return revokeToken(email, args[3]);
  throw new Error(USAGE);
}

/** `brim init`: Brim.js in an Astro project that was not started from the template. */
async function setUp(brim: string | undefined, git: boolean, lang: string | undefined): Promise<void> {
  const agent = process.env.npm_config_user_agent ?? "";
  const runner = agent.startsWith("pnpm")
    ? "pnpm"
    : agent.startsWith("yarn")
      ? "yarn"
      : agent.startsWith("bun")
        ? "bun"
        : "npm";
  console.log(initReport(await init(process.cwd(), { brim, git, lang }), runner));
}

/** The server `astro build` wrote: one Node process for the pages, the editor, the site's MCP and forms. */
async function start(): Promise<void> {
  const entry = join(process.cwd(), "dist", "server", "entry.mjs");
  if (!existsSync(entry)) {
    throw new Error(
      "There is no built server in dist/server. Run `astro build` first; a static build (BRIM_OUTPUT=static) has no server to start.",
    );
  }
  process.env.HOST ??= "0.0.0.0";
  await import(pathToFileURL(entry).href);
  console.log(`Editor: http://localhost:${process.env.PORT ?? 4321}/admin/edit  (or npx brim open, already signed in)`);
}

/** Reads the source only, so it works before installing, building or creating a database. */
async function check(folder: string, json: boolean, args: string[]): Promise<void> {
  const report = checkSite(folder);
  if (!args.includes("--content")) {
    console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
    if (report.errors > 0) process.exitCode = 1;
    return;
  }
  // The content is read from the running site, which knows the content types, the settings and the routes.
  const url = (option(args, "--url") ?? `http://localhost:${process.env.PORT ?? 4321}`).replace(/\/+$/, "");
  await asSiteOwner(args, url, option(args, "--token") ?? process.env.BRIM_TOKEN, "check --content", async (target) => {
    const content = await contentFindings(target);
    if (json) {
      console.log(JSON.stringify({ ...report, content }, null, 2));
    } else {
      console.log(formatReport(report));
      console.log("");
      console.log(formatContentFindings(content));
    }
    if (report.errors > 0) process.exitCode = 1;
  });
}

/** A summary of the database, e.g. for a host deciding whether to keep an imported site's content. */
async function info(json: boolean): Promise<void> {
  await withSite(async ({ db, accounts }) => {
    const count = async (table: string) => Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n ?? 0);
    const items = await db.query("SELECT type, COUNT(*) AS n FROM brim_items GROUP BY type ORDER BY type");
    const summary = {
      users: (await accounts.listUsers()).map(({ email, role, createdAt, tokens }) => ({
        email,
        role,
        createdAt,
        tokens,
      })),
      pages: await count("brim_pages"),
      editedElements: await count("brim_nodes"),
      items: Object.fromEntries(items.map((row) => [String(row.type), Number(row.n)])),
      media: await count("brim_media"),
      formResponses: await count("brim_form_responses"),
    };
    if (json) return console.log(JSON.stringify(summary, null, 2));
    console.log(`Users            ${summary.users.map((user) => `${user.email} (${user.role})`).join(", ") || "none"}`);
    console.log(`Pages            ${summary.pages}`);
    console.log(`Edited elements  ${summary.editedElements}`);
    console.log(
      `Items            ${
        Object.entries(summary.items)
          .map(([type, n]) => `${type} ${n}`)
          .join(", ") || "none"
      }`,
    );
    console.log(`Uploaded images  ${summary.media}`);
    console.log(`Form responses   ${summary.formResponses}`);
  });
}

/**
 * What the owner saved: on one page and the whole site, or (`--all`) where anything is saved at all. Elements the
 * editor never touched show the code's own words, so they are not here.
 */
async function content(path: string, args: string[], json: boolean): Promise<void> {
  await withSite(async (brim) => {
    if (args.includes("--all")) {
      const rows = await brim.db.query("SELECT scope, COUNT(*) AS n FROM brim_nodes GROUP BY scope ORDER BY scope");
      const places = rows.map((row) => ({ scope: String(row.scope), elements: Number(row.n) }));
      if (json) return console.log(JSON.stringify(places, null, 2));
      if (places.length === 0) return console.log("Nothing saved in the editor yet: every page shows its code's words.");
      for (const { scope, elements } of places) console.log(`${scope.padEnd(48)} ${elements}`);
      return;
    }
    const page = pageScope(path);
    const nodes = await brim.content.loadNodes([page, siteScope()]);
    const of = (scope: string) =>
      nodes
        .filter((node) => node.scope === scope)
        .map(({ nodeId, kind, value }) => ({ nodeId, kind, value }))
        .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    const saved = { path: normalizePagePath(path), page: of(page), site: of(siteScope()) };
    if (json) return console.log(JSON.stringify(saved, null, 2));
    const show = (value: unknown) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > 100 ? `${text.slice(0, 97)}…` : text;
    };
    for (const [title, list] of [[`Page ${saved.path}`, saved.page], ["Whole site", saved.site]] as const) {
      console.log(`${title}: ${list.length === 0 ? "nothing saved" : `${list.length} saved`}`);
      for (const node of list) console.log(`  ${node.nodeId.padEnd(32)} ${node.kind.padEnd(10)} ${show(node.value)}`);
    }
  });
}

async function listUsers(json: boolean): Promise<void> {
  await withSite(async ({ accounts }) => {
    const users = await accounts.listUsers();
    if (json)
      return console.log(
        JSON.stringify(
          users.map(({ id: _id, ...user }) => user),
          null,
          2,
        ),
      );
    if (users.length === 0) return console.log("No users yet. Add one with: brim user add <email>");
    for (const user of users) {
      console.log(
        `${user.email.padEnd(32)} ${user.role.padEnd(7)} tokens ${user.tokens}  since ${user.createdAt.slice(0, 10)}`,
      );
    }
  });
}

async function setRole(email: string, role: string): Promise<void> {
  if (!ROLES.includes(role as Role)) throw new Error(USAGE);
  await withSite(async ({ accounts }) => {
    const user = await accounts.setRole(email, role as Role);
    console.log(`${user.email} is now ${user.role}.`);
  });
}

async function signInLink(email: string): Promise<void> {
  await withSite(async ({ accounts }) => {
    const { token, maxAgeSeconds } = await accounts.createSignInToken(email);
    console.log(`Open this on the site within ${maxAgeSeconds / 60} minutes; it works once:`);
    console.log(`/admin/api/session/link?token=${token}`);
  });
}

async function setPassword(email: string): Promise<void> {
  const password = await readPassword(); // betterleaks:allow
  await withSite(async ({ accounts }) => {
    await accounts.setPassword(email, password);
    console.log(
      `Changed the password of ${email}; their open sessions were signed out and their access tokens revoked.`,
    );
  });
}

async function removeUser(email: string): Promise<void> {
  await withSite(async ({ accounts }) => {
    await accounts.removeUser(email);
    console.log(`Removed ${email} with their sessions and tokens.`);
  });
}

async function addUser(email: string, args: string[]): Promise<void> {
  const role = option(args, "--role") ?? "owner";
  if (!ROLES.includes(role as Role)) throw new Error(USAGE);
  const password = await readPassword(); // betterleaks:allow
  await withSite(async ({ accounts }) => {
    const user = await accounts.createUser(email, password, role as Role);
    console.log(`Created ${user.role} ${user.email}.`);
    // A password written down travels with the folder; a one-time link signs someone in without one.
    console.log(`Open the editor, signed in: npx brim open ${user.email}  (with the dev server running)`);
    console.log(`To let them in without passing the password around: npx brim user link ${user.email}`);
  });
}

async function addToken(email: string, name: string): Promise<void> {
  await withSite(async ({ accounts }) => {
    const token = await accounts.createToken(email, name);
    console.log(`Created the token "${name}" for ${email}. It is shown only this once:

  ${token}

Give it to an MCP client as a bearer token for <site>/admin/mcp, for example:

  claude mcp add --transport http my-site http://localhost:4321/admin/mcp \\
    --header "Authorization: Bearer ${token}"`);
  });
}

async function listTokens(email: string): Promise<void> {
  await withSite(async ({ accounts }) => {
    const tokens = await accounts.listTokens(email);
    if (tokens.length === 0) return console.log(`${email} has no tokens.`);
    for (const token of tokens) {
      console.log(`${token.name}  created ${token.createdAt}  last used ${token.lastUsedAt ?? "never"}`);
    }
  });
}

async function revokeToken(email: string, name: string): Promise<void> {
  await withSite(async ({ accounts }) => {
    const removed = await accounts.revokeToken(email, name);
    console.log(removed ? `Revoked the token "${name}".` : `${email} has no token named "${name}".`);
  });
}

/**
 * `brim media add`: images from this computer into the media library, as the editor uploads them, for pictures that
 * are content (an AI agent's photos, a migration's downloads) rather than files in the code's public/ folder.
 */
async function addMedia(args: string[], json: boolean): Promise<void> {
  const folder = option(args, "--item") ?? "";
  const files = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--item");
  if (files.length === 0) throw new Error(USAGE);
  await withSite(async (brim) => {
    if (folder) {
      const [type, id, ...rest] = folder.split("/");
      const item = id && rest.length === 0 ? await brim.items.get(id) : undefined;
      if (!item || item.type !== type) throw new Error(`There is no ${type ?? "item"} with the id ${id ?? folder}.`);
    }
    const store = new MediaStore(brim.db, pathToFileURL(join(process.cwd(), "public", "uploads") + "/"));
    const added = [];
    for (const file of files) {
      const uploaded = await store.upload(new Uint8Array(await readFile(file)), basename(file), folder);
      added.push({ file, url: uploaded.url });
      if (!json) console.log(`${file} → ${uploaded.url}`);
    }
    if (json) console.log(JSON.stringify(added, null, 2));
  });
}

/**
 * `brim open`: the editor in the person's browser, signed in with a one-time link, on a page if asked. Without an
 * email it signs in as the site's first owner. The address is printed too, for a browser on another machine.
 */
async function openEditor(args: string[]): Promise<void> {
  const page = option(args, "--page") ?? "/";
  const base = (option(args, "--url") ?? `http://localhost:${process.env.PORT ?? 4321}`).replace(/\/+$/, "");
  const given = args.find(
    (arg, index) => !arg.startsWith("--") && !["--page", "--url"].includes(args[index - 1] ?? ""),
  );
  await withSite(async ({ accounts }) => {
    const email = given ?? (await accounts.listUsers()).find((user) => user.role === "owner")?.email;
    if (!email) throw new Error("The site has no user yet: npx brim user add you@example.com, then npx brim open.");
    const { token } = await accounts.createSignInToken(email);
    const editor = `/admin/edit${page === "/" ? "" : `/${page.replace(/^\/+/, "")}`}`;
    const link = `${base}/admin/api/session/link?token=${token}&to=${encodeURIComponent(editor)}`;
    console.log(`Opening the editor as ${email}. If no browser opens, open this within 2 minutes (it works once):`);
    console.log(link);
    openInBrowser(link);
  });
}

/**
 * `brim seed`: the starting content in seed/ added to the running site, or, with --export, the site's content
 * written there. On this computer it signs in with an access token it creates for the site's first owner and deletes
 * afterwards; a site elsewhere needs --url and --token, so content never reaches it by accident.
 */
async function seed(args: string[]): Promise<void> {
  const values = ["--url", "--token"];
  const folder = args.find((arg, index) => !arg.startsWith("--") && !values.includes(args[index - 1] ?? "")) ?? "seed";
  const url = (option(args, "--url") ?? `http://localhost:${process.env.PORT ?? 4321}`).replace(/\/+$/, "");
  const token = option(args, "--token") ?? process.env.BRIM_TOKEN;
  const exporting = args.includes("--export");

  const work = async (target: SeedTarget) => {
    if (exporting) {
      const done = await exportSeedFiles(folder, target, args.includes("--force"));
      console.log(
        `Wrote ${done.items} item(s) into ${done.files.map((file) => `${folder}/${file}`).join(", ") || "nothing"}, ` +
          `with ${done.images} picture(s) in ${folder}/images/.`,
      );
      return;
    }
    const dryRun = args.includes("--dry-run");
    const result = await runSeed(folder, target, dryRun);
    const label = (entry: { type: string; slug: string; locale: string }) =>
      `${entry.type}/${entry.slug}${entry.locale ? ` (${entry.locale})` : ""}`;
    if (result.create.length === 0) {
      console.log(`Nothing to add: the site already has all ${result.existing.length} item(s) of ${folder}/.`);
      return;
    }
    console.log(
      `${dryRun ? "Would add" : "Added"} ${result.create.length} item(s)` +
        (dryRun ? "" : `, with ${result.uploaded} picture(s)`) +
        `; ${result.existing.length} already there, left as they are.`,
    );
    for (const entry of result.create) console.log(`  + ${label(entry)}  ${entry.title}`);
    if (dryRun) console.log("Nothing was written. Run it without --dry-run to add them.");
  };

  await asSiteOwner(args, url, token, "seed", work);
}

/**
 * Runs `work` signed in to the site at `url`: with the token given, or, for a site on this computer, with an access
 * token made for its first owner in the local database and deleted afterwards. Refuses a site elsewhere without a
 * token, and a database set up to be elsewhere without --remote, so a command never reaches the live site by accident.
 */
async function asSiteOwner(
  args: string[],
  url: string,
  token: string | undefined,
  command: string,
  work: (target: SeedTarget) => Promise<void>,
): Promise<void> {
  if (token) return work({ url, token });
  if (!isLocalSite(url)) {
    throw new Error(
      `${url} is not on this computer: give a token for it with --token (npx brim token add <email> on that site).`,
    );
  }
  const database = resolveDatabase({}, process.cwd());
  if (!database.databaseUrl.startsWith("file:") && !args.includes("--remote")) {
    throw new Error(
      "The database set up here (BRIM_DATABASE_URL) is not on this computer, so it may be the live site's. " +
        `Add --remote if you mean brim ${command} to use it.`,
    );
  }
  await withSite(async ({ accounts }) => {
    const owner = (await accounts.listUsers()).find((user) => user.role === "owner");
    if (!owner)
      throw new Error(`The site has no owner yet: npx brim user add you@example.com, then npx brim ${command}.`);
    const name = `brim ${command} ${Date.now()}`;
    const created = await accounts.createToken(owner.email, name);
    try {
      await work({ url, token: created });
    } finally {
      await accounts.revokeToken(owner.email, name);
    }
  });
}

/** Hands an address to the system's browser; quietly does nothing where there is none (a server, a container). */
function openInBrowser(address: string): void {
  const [command, ...args] =
    process.platform === "darwin"
      ? ["open", address]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", address]
        : ["xdg-open", address];
  try {
    spawn(command!, args, { stdio: "ignore", detached: true })
      .on("error", () => undefined)
      .unref();
  } catch {
    // No browser here: the address was printed.
  }
}

/** Opens the database of the site in the current folder for the length of one command. */
async function withSite(run: (brim: Brim) => Promise<void>): Promise<void> {
  const database = resolveDatabase({}, process.cwd());
  const brim = await connect(database.databaseUrl, database.authToken);
  try {
    await run(brim);
  } finally {
    brim.db.close();
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let piped = "";
    for await (const chunk of process.stdin) piped += chunk;
    return piped.replace(/\r?\n$/, "");
  }
  // Typed characters are not echoed back to the terminal.
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
  const prompt = createInterface({ input: process.stdin, output: silent, terminal: true });
  process.stdout.write("Password: ");
  const password = await prompt.question(""); // betterleaks:allow
  prompt.close();
  process.stdout.write("\n");
  return password;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
