import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { insideGit } from "./check.ts";
import { VERSION } from "./version.ts";

/** The guide an AI coding agent follows to convert the site; shipped with the package. */
const SKILL = new URL("../skills/brim-convert/SKILL.md", import.meta.url);
const CONFIG_FILES = ["astro.config.mjs", "astro.config.ts", "astro.config.js", "astro.config.mts"];
const IGNORED = [
  "# Brim.js: the local database (content, users, form responses) and images uploaded in the editor.",
  ".brim",
  "public/uploads",
];
const AGENTS_MARK = "<!-- brimjs -->";
const AGENTS_NOTE = `${AGENTS_MARK}
## Brim.js

This Astro site is editable with Brim.js: texts, images, links and navigation wrapped in Brim's components carry a
stable \`nodeId\`, and the owner's edits (stored in SQLite) replace what the code says. Never rename or reuse a
\`nodeId\`. To make more of the site editable, follow \`.claude/skills/brim-convert/SKILL.md\`; the components and
their props are documented in \`node_modules/brimjs/README.md\`. While the dev server runs, the site's MCP is at
\`/admin/mcp\` (token: \`npx brim token add <email>\`): use it to read and change content instead of the database.
To show the person the editor, run \`npx brim open\` with the dev server running (or open \`/admin/edit\`).
Never write a password or a token into a file of the project; to let someone sign in, use \`npx brim user link <email>\`.
Facts about the whole site (email, phone, WhatsApp, social profiles, address) are site settings, declared in
\`src/site-settings.ts\` and read with \`getSiteSettings()\` or \`<Setting name="…" />\`: never constants in the code.
The body of an item with a page (article, project, service) is a \`blocks\` field drawn with \`<Blocks>\`, so the
owner adds images, galleries and buttons between paragraphs; \`richtext\` is for text that stays text (\`// text only\`).
The emails the site sends (a form message's) are written in \`src/emails.ts\` with \`defineEmails\` and \`html\` from
\`brimjs\`; see one at \`/admin/api/emails/form\`.
Pictures: the site's own (what the design starts with: hero, sections, a gallery it ships with, logo, icons) are
files in \`public/\`, at most 2560 px wide; Brim sends smaller copies of them and the owner replaces them in the editor.
Pictures of items (products, projects, articles) and anything filled in bulk are uploads (MCP \`brim_upload_image\`
or \`npx brim media add <files…>\`) saved in the item's image field; never write an \`/uploads/…\` address in the code.
What the site is filled from (photos, catalogues, data for an import) stays out of git: keep it in \`import/\` or
outside the project; the live site gets the uploads with the content (\`brimsites restore\`), never with a deploy.
To deploy, host or move the site (Brimsites first, or a server of its own), follow
\`node_modules/brimjs/skills/brim-hosting/SKILL.md\`; a deploy never carries the local \`.brim/data.db\`.
Working on the site once it is online, ask once whether to download its live content first (\`brimsites export\`,
local \`.brim\` moved outside the project first), so you work on the site as it is now.
After the first deploy, offer once to save the live site's MCP (\`brimsites tokens create <site>\`, then
\`claude mcp add\`), so its content can be changed without the editor; the token never goes into a file.
`;

export interface InitOptions {
  /** The brimjs dependency to write: a version range, or anything else a package manager accepts. */
  brim?: string | undefined;
  /** `false` leaves a project that is not in git out of it. */
  git?: boolean;
  /** The site's language (`ro`, `en`…); by default the `lang` its layout writes, else `en`. */
  lang?: string | undefined;
}

export interface InitResult {
  /** What was done, in words, one line each. */
  done: string[];
  /** What could not be done automatically and is left to the person (or their agent). */
  manual: string[];
}

/**
 * Sets up Brim.js in an Astro project that already exists: the dependency, the integration, what git should
 * ignore, and the conversion guide for AI coding agents. Running it again changes nothing that is already there.
 */
export async function init(directory: string, options: InitOptions = {}): Promise<InitResult> {
  const result: InitResult = { done: [], manual: [] };
  const packagePath = join(directory, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error("There is no package.json here. Run this in the folder of an Astro project.");
  }
  const packageSource = await readFile(packagePath, "utf8");
  const manifest = JSON.parse(packageSource) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  if (!manifest.dependencies?.astro && !manifest.devDependencies?.astro) {
    throw new Error(
      "This project does not depend on astro. Brim.js makes Astro sites editable; start a new one with `npm create brim`.",
    );
  }

  let changed = false;
  if (!manifest.dependencies?.brimjs && !manifest.devDependencies?.brimjs) {
    manifest.dependencies = { ...manifest.dependencies, brimjs: options.brim ?? `^${VERSION}` };
    changed = true;
    result.done.push(`Added brimjs ${manifest.dependencies.brimjs} to package.json.`);
  }
  for (const [name, command] of Object.entries({ start: "brim start", brim: "brim" })) {
    if (manifest.scripts?.[name] === undefined) {
      manifest.scripts = { ...manifest.scripts, [name]: command };
      changed = true;
      result.done.push(`Added the "${name}" script (${command}).`);
    }
  }
  if (changed) {
    const indent = /^(\s+)"/m.exec(packageSource)?.[1] ?? "  ";
    await writeFile(packagePath, `${JSON.stringify(manifest, null, indent)}\n`);
  }

  const lang = options.lang ?? (await layoutLanguage(directory)) ?? "en";
  if (!LANGUAGE.test(lang)) throw new Error(`"${lang}" is not a language code, e.g. ro, en or pt-BR.`);
  const configName = CONFIG_FILES.find((name) => existsSync(join(directory, name)));
  if (!configName) {
    await writeFile(
      join(directory, "astro.config.mjs"),
      `import { defineConfig } from "astro/config";\nimport brim from "brimjs";\n\nexport default defineConfig({\n  ${languageLine(lang)}\n  integrations: [brim()],\n});\n`,
    );
    result.done.push(`Created astro.config.mjs with the brim() integration and the site's language (${lang}).`);
  } else {
    const source = await readFile(join(directory, configName), "utf8");
    const integrated = addIntegration(source);
    const patched = integrated === undefined ? undefined : addLanguage(integrated, lang);
    if (patched === undefined) {
      result.manual.push(
        `Add Brim to ${configName} yourself: \`import brim from "brimjs";\` and \`brim()\` in \`integrations\`.`,
      );
    } else if (patched !== source) {
      await writeFile(join(directory, configName), patched);
      result.done.push(`Added the brim() integration to ${configName}.`);
      if (patched !== integrated) result.done.push(`Declared the site's language (${lang}) in ${configName}.`);
    }
    if (/\badapter\s*:/.test(source)) {
      result.manual.push(
        `${configName} sets an adapter. Brim keeps it, but its editor, forms and MCP need a Node server: see "Deploy" in the brimjs README.`,
      );
    }
  }

  const ignorePath = join(directory, ".gitignore");
  const ignore = existsSync(ignorePath) ? await readFile(ignorePath, "utf8") : "";
  const lines = ignore.split(/\r?\n/).map((line) => line.trim().replace(/^\/|\/$/g, ""));
  const missing = IGNORED.filter((line) => !line.startsWith("#") && !lines.includes(line));
  if (missing.length > 0) {
    const block = [IGNORED[0], ...missing].join("\n");
    await writeFile(ignorePath, `${ignore}${ignore === "" || ignore.endsWith("\n") ? "" : "\n"}${block}\n`);
    result.done.push(`Added ${missing.join(" and ")} to .gitignore.`);
  }

  const skillPath = join(directory, ".claude", "skills", "brim-convert", "SKILL.md");
  const skill = await readFile(fileURLToPath(SKILL), "utf8");
  if (!existsSync(skillPath) || (await readFile(skillPath, "utf8")) !== skill) {
    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, skill);
    result.done.push(`Wrote the conversion guide for AI agents to ${relative(directory, skillPath)}.`);
  }

  const agentsPath = join(directory, "AGENTS.md");
  const agents = existsSync(agentsPath) ? await readFile(agentsPath, "utf8") : "";
  if (!agents.includes(AGENTS_MARK)) {
    await writeFile(
      agentsPath,
      `${agents}${agents === "" || agents.endsWith("\n\n") ? "" : agents.endsWith("\n") ? "\n" : "\n\n"}${AGENTS_NOTE}`,
    );
    result.done.push(`${agents === "" ? "Created" : "Added a Brim.js section to"} AGENTS.md.`);
  }
  // Claude Code reads CLAUDE.md; one that does not exist yet simply points at AGENTS.md.
  if (!existsSync(join(directory, "CLAUDE.md"))) {
    await writeFile(join(directory, "CLAUDE.md"), "@AGENTS.md\n");
    result.done.push("Created CLAUDE.md, pointing at AGENTS.md.");
  }

  // Every change an agent or the owner makes to the code should be seen and taken back: the site goes into git.
  // Nothing is committed: the project may hold files that must not be, which only its owner knows.
  if (options.git !== false && !insideGit(directory)) {
    const made = spawnSync("git", ["init", "--quiet"], { cwd: directory, stdio: "ignore" });
    if (made.status === 0) {
      result.done.push("Put the project in git (git init). Commit once you have checked what it holds.");
    } else {
      result.manual.push("Put the project in git (git init), so every change can be seen and taken back.");
    }
  }
  return result;
}

/**
 * An Astro config with Brim's integration added. The same text when it is already there; `undefined` when the
 * config is written in a way this cannot safely change.
 */
export function addIntegration(source: string): string | undefined {
  if (/from\s+["']brimjs["']/.test(source)) return source;
  const list = /\bintegrations\s*:\s*\[/.exec(source);
  const config = /\bdefineConfig\s*\(\s*\{|export\s+default\s*\{/.exec(source);
  let patched: string;
  if (list) {
    const at = list.index + list[0].length;
    const rest = source.slice(at);
    const space = /^\s*/.exec(rest)?.[0] ?? "";
    // An empty list, a list over several lines, or one written on a single line.
    const added = rest.trimStart().startsWith("]") ? "brim()" : space.includes("\n") ? `${space}brim(),` : "brim(), ";
    patched = source.slice(0, at) + added + rest;
  } else if (config) {
    const at = config.index + config[0].length;
    patched = `${source.slice(0, at)}\n  integrations: [brim()],${source.slice(at)}`;
  } else {
    return undefined;
  }
  return `import brim from "brimjs";\n${patched}`;
}

/** A language code as Astro takes it: `ro`, `en`, `pt-BR`. */
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/**
 * The line that declares a site's one language, its default. Declared from the start, the site keeps what its owner
 * saves (navbar, footer, settings, templates) under that language, so adding a second one later moves nothing.
 */
export function languageLine(lang: string): string {
  return `i18n: { defaultLocale: ${JSON.stringify(lang)}, locales: [${JSON.stringify(lang)}] },`;
}

/** An Astro config with the site's language declared; the same text when it declares languages already. */
export function addLanguage(source: string, lang: string): string {
  if (/\bi18n\s*:/.test(source)) return source;
  const config = /\bdefineConfig\s*\(\s*\{|export\s+default\s*\{/.exec(source);
  if (!config) return source;
  const at = config.index + config[0].length;
  return `${source.slice(0, at)}\n  ${languageLine(lang)}${source.slice(at)}`;
}

/** The language a site's layout already writes in `<html lang="…">`, if one does. */
async function layoutLanguage(directory: string): Promise<string | undefined> {
  const folder = join(directory, "src", "layouts");
  if (!existsSync(folder)) return undefined;
  for (const name of await readdir(folder)) {
    if (!name.endsWith(".astro")) continue;
    const match = /<html[^>]*\blang=["']([A-Za-z-]+)["']/.exec(await readFile(join(folder, name), "utf8"));
    if (match?.[1] && LANGUAGE.test(match[1])) return match[1];
  }
  return undefined;
}

export function initReport(result: InitResult, runner: string): string {
  const exec = runner === "npm" ? "npx" : runner;
  return [
    ...(result.done.length > 0 ? result.done : ["Brim.js is already set up here; nothing to change."]),
    ...(result.manual.length > 0 ? ["", "Left to you:", ...result.manual.map((line) => `  - ${line}`)] : []),
    "",
    "Next:",
    `  ${runner} install`,
    `  ${exec} brim user add you@example.com   # the account that edits the site`,
    `  ${runner} run dev                        # the editor is at /admin/edit`,
    "",
    "Nothing on the site is editable yet. Ask your AI coding agent to make it so:",
    '  "Convert this site to Brim.js, following the brim-convert skill."',
    "or wrap elements yourself, one at a time:",
    '  <Text nodeId="hero-title" as="h1">Your heading</Text>',
    "",
    "When it is ready, deploy it in one click on Brimsites, the managed hosting for Brim.js:",
    "  https://dashboard.brimsites.com",
  ].join("\n");
}
