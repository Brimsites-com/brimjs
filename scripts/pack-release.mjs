#!/usr/bin/env node
/**
 * Packs `brimjs` and `create-brim` as they are published on npm, at the version their package.json says:
 *
 *   node scripts/pack-release.mjs 1.0.0 <empty folder>
 *
 * The version is given to be sure it is the one meant; `pnpm release` sets it. Nothing is published:
 * `.github/workflows/release.yml` publishes what this makes when a tag `v<version>` is pushed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PACKAGES, assertNotes, currentVersion, isVersion, manifestPath } from "./versions.mjs";

const [version, folder] = process.argv.slice(2);
if (!isVersion(version) || !folder) {
  console.error("Usage: node scripts/pack-release.mjs <version> <empty folder>");
  process.exit(1);
}
const current = currentVersion();
if (version !== current) throw new Error(`The packages are at ${current}, not ${version}.`);
assertNotes(version);

const out = resolve(folder);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty.`);

for (const name of PACKAGES) {
  execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: dirname(manifestPath(name)), stdio: "inherit" });
}
for (const name of ["brimjs", "create-brim"]) {
  if (!readdirSync(out).includes(`${name}-${version}.tgz`)) throw new Error(`${name}-${version}.tgz was not made.`);
}
