#!/usr/bin/env node
/**
 * Publishes brim.js as the private package @brimsites/brimjs on GitHub Packages, for the Brimsites
 * organization only. In the repo the package keeps its name, `brimjs`; only the published copy is renamed.
 *
 *   node scripts/publish-private.mjs 0.1.0
 *
 * Publishes exactly what is on origin/main (the working tree must be clean and up to date). It signs in with
 * the GitHub CLI's token (`gh auth refresh -s write:packages,read:packages` once); no token is written to disk
 * outside a temporary folder that is removed at the end.
 *
 * Sites install it under its usual name, so `import … from "brimjs"` keeps working:
 *   package.json   "brimjs": "npm:@brimsites/brimjs@^0.1.0"
 *   .npmrc         @brimsites:registry=https://npm.pkg.github.com
 *                  //npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REGISTRY = "https://npm.pkg.github.com";
const NAME = "@brimsites/brimjs";
const root = resolve(import.meta.dirname, "..");
const pkgDir = join(root, "packages", "brim");
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...options }).trim();

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("Give the version to publish, e.g.: node scripts/publish-private.mjs 0.1.0");
  process.exit(1);
}

run("git", ["fetch", "-q", "origin", "main"]);
if (run("git", ["status", "--porcelain"])) throw new Error("The working tree has changes. Commit or stash them first.");
const commit = run("git", ["rev-parse", "HEAD"]);
if (commit !== run("git", ["rev-parse", "origin/main"])) throw new Error("HEAD is not origin/main. Publish only what is pushed.");

const work = mkdtempSync(join(tmpdir(), "brimjs-publish-"));
try {
  // pnpm pack runs prepack (editor and CLI builds) and turns workspace: versions into real ones.
  run("pnpm", ["pack", "--pack-destination", work], { cwd: pkgDir, stdio: ["ignore", "pipe", "inherit"] });
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack made no tarball.");
  run("tar", ["-xzf", join(work, tarball), "-C", work]);

  const manifestPath = join(work, "package", "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  Object.assign(manifest, {
    name: NAME,
    version,
    repository: { type: "git", url: "git+https://github.com/Brimsites/brimjs.git", directory: "packages/brim" },
    publishConfig: { registry: REGISTRY },
    brimjsCommit: commit,
  });
  delete manifest.scripts?.prepack;
  // npm 11 drops a bin written as "./bin/…" when publishing; the same path without "./" is kept.
  for (const [command, path] of Object.entries(manifest.bin ?? {})) manifest.bin[command] = path.replace(/^\.\//, "");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const token = run("gh", ["auth", "token"]);
  const npmrc = join(work, ".npmrc");
  writeFileSync(npmrc, `@brimsites:registry=${REGISTRY}\n//npm.pkg.github.com/:_authToken=${token}\n`, { mode: 0o600 });
  execFileSync("npm", ["publish", "--userconfig", npmrc, "--registry", REGISTRY], {
    cwd: join(work, "package"),
    stdio: "inherit",
  });
  console.log(`Published ${NAME}@${version} from ${commit.slice(0, 7)}.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
