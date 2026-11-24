#!/usr/bin/env node
// Copies the template into a new folder and fills in the site's name.
// Plain JavaScript with no dependencies, so `npm create brim` runs it straight from the registry.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: npm create brim [folder] [-- --name "Site name"] [--lang <code>] [--brim <version or path>] [--no-git]

  folder   Where to create the site (asked for when left out).
  --name   The site's name, shown in the navigation and footer.
  --lang   The site's language and its default (ro, en, de…; asked for when left out). Declared from the start,
           a second language can be added later without moving what the owner saved.
  --brim   The brimjs dependency: a version (^0.1.0), or the path of a brimjs package on this
           computer (../brimjs/packages/brim), installed into the site like a published one.
  --no-git Leave the new site out of git (by default it is a repository with a first commit).`;

const TEMPLATE = fileURLToPath(new URL("./template/", import.meta.url));
// npm leaves .gitignore out of published packages, so the template keeps it under another name.
const RENAMES = { _gitignore: ".gitignore" };
const TEXT_FILES = /\.(astro|ts|mjs|json|md|css)$|^_gitignore$/;

async function main(args) {
  if (args.includes("--help") || args.includes("-h")) return console.log(USAGE);
  const options = parseArgs(args);

  const folder = options.folder ?? (await ask("Folder for the new site", "my-brim-site"));
  const target = resolve(folder);
  if (await hasFiles(target)) throw new Error(`${folder} already exists and is not empty.`);

  const siteName = options.name ?? (await ask("Site name", titleCase(basename(target))));
  const lang = options.lang ?? (await ask("Language of the site (ro, en, de…)", "en"));
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) {
    throw new Error(`"${lang}" is not a language code, e.g. ro, en or pt-BR.`);
  }
  const values = {
    packageName: packageName(basename(target)),
    siteName,
    lang,
    brimVersion: brimDependency(options.brim ?? `^${await ownVersion()}`, target),
  };

  await mkdir(target, { recursive: true });
  await cp(TEMPLATE, target, { recursive: true });
  await fillIn(target, values);
  for (const [from, to] of Object.entries(RENAMES)) await rename(join(target, from), join(target, to));
  const versioned = options.git === false ? "skipped" : startRepository(target, siteName);

  const run = packageManager();
  const cd = relative(process.cwd(), target) || ".";
  console.log(`
Created ${siteName} in ${cd}.${
    versioned === "committed"
      ? "\nIt is a git repository with a first commit: commit as you go, so every change can be taken back."
      : versioned === "initialised"
        ? "\nIt is a git repository; make the first commit once git knows your name (git config user.name …)."
        : ""
  }

Next:
  cd ${cd}
  ${run} install
  ${run === "npm" ? "npx" : run} brim user add you@example.com   # the account that edits the site
  ${run} run dev

Then open http://localhost:4321: every page has an "Edit this page" button for you (online too, once signed in), or run
${run === "npm" ? "npx" : run} brim open to land in the editor already signed in. The editor is always at /admin/edit.

When it is ready, deploy it on Brimsites, the managed hosting for Brim.js, from the dashboard
(https://dashboard.brimsites.com) or from this folder, with the Brimsites CLI (npm install -g @brimsites/brimsites):
  brimsites login
  brimsites sites create "${siteName.replace(/"/g, "")}" --link
  brimsites deploy --wait`);
}

/**
 * Puts the new site in git with a first commit, unless it is already inside a repository or git is missing: every
 * change can then be seen and taken back, and the site is ready for GitHub and Brimsites. The local database and
 * uploads stay out (.gitignore). Answers what it managed: "committed", "initialised", or "skipped".
 */
function startRepository(target, siteName) {
  const git = (...args) => spawnSync("git", args, { cwd: target, stdio: "ignore" }).status === 0;
  if (git("rev-parse", "--is-inside-work-tree")) return "skipped";
  if (!git("init", "--quiet")) return "skipped";
  if (git("add", "--all") && git("commit", "--quiet", "--message", `Start ${siteName} with create-brim`))
    return "committed";
  return "initialised";
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--name" || arg === "--brim" || arg === "--lang") {
      const value = args[++index];
      if (!value) throw new Error(`${arg} needs a value.\n\n${USAGE}`);
      options[arg.slice(2)] = value;
    } else if (arg === "--no-git") {
      options.git = false;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}.\n\n${USAGE}`);
    } else if (options.folder) {
      throw new Error(`Only one folder can be given.\n\n${USAGE}`);
    } else {
      options.folder = arg;
    }
  }
  return options;
}

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(`${question} (${fallback}): `)).trim();
  prompt.close();
  return answer || fallback;
}

async function hasFiles(folder) {
  try {
    return (await stat(folder)).isDirectory() ? (await readdir(folder)).length > 0 : true;
  } catch {
    return false;
  }
}

/** Replaces `{{key}}` in every text file of the new site. */
async function fillIn(folder, values) {
  for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !TEXT_FILES.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    const filled = text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (!Object.hasOwn(values, key)) return match;
      // Values land inside JSON and JavaScript strings, so they are escaped like JSON.
      return /\.(json|ts|mjs|astro)$/.test(entry.name) ? JSON.stringify(values[key]).slice(1, -1) : values[key];
    });
    if (filled !== text) await writeFile(file, filled);
  }
}

/**
 * A version is written as it is. A path becomes a `file:` dependency, relative to the new site: the package manager copies brimjs into
 * the site's node_modules, so the site builds exactly as with a published version. A `link:` would leave
 * brimjs outside the project, where Astro and Vite treat its files as the site's own source and the build
 * breaks. Run the install again after changing brimjs.
 */
function brimDependency(value, target) {
  const path = value.startsWith("file:") || value.startsWith("link:") ? value.slice(5) : value;
  const isPath = /^(\.{1,2}\/|\/|~\/)/.test(path) || value.startsWith("file:") || value.startsWith("link:");
  if (!isPath) return value;
  if (value.startsWith("link:")) console.warn("brimjs is installed with file: instead of link: (see --help).");
  const absolute = resolve(path.replace(/^~(?=\/)/, homedir()));
  return `file:${relative(target, absolute) || "."}`;
}

async function ownVersion() {
  const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  return manifest.version;
}

function packageName(folderName) {
  return (
    folderName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "brim-site"
  );
}

function titleCase(folderName) {
  return folderName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function packageManager() {
  const agent = process.env.npm_config_user_agent ?? "";
  return ["pnpm", "yarn", "bun"].find((name) => agent.startsWith(name)) ?? "npm";
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
