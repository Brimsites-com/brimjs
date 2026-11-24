#!/usr/bin/env node
/**
 * Packs `brimjs` and `create-brim` as they are published on npm, at one version:
 *
 *   node scripts/pack-release.mjs 1.0.0 <empty folder>
 *
 * In the repo both are at 0.0.0; the version is written into them while they are packed (the `brim` command carries
 * the version it was built with) and taken out again. Nothing is published: `.github/workflows/release.yml` publishes
 * what this makes when a tag `v<version>` is pushed. The version must have its own heading in CHANGELOG.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [version, folder] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "") || !folder) {
  console.error("Usage: node scripts/pack-release.mjs <version> <empty folder>");
  process.exit(1);
}
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
if (!changelog.split("\n").includes(`## ${version}`)) throw new Error(`CHANGELOG.md has no "## ${version}" heading.`);

const out = resolve(folder);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty.`);

const manifests = ["brim", "create-brim"].map((name) => join(root, "packages", name, "package.json"));
const sources = manifests.map((path) => readFileSync(path, "utf8"));
try {
  for (const [index, path] of manifests.entries()) {
    const manifest = JSON.parse(sources[index]);
    manifest.version = version;
    // npm drops a bin written as "./bin/…" when publishing; the same path without "./" is kept.
    for (const [command, file] of Object.entries(manifest.bin ?? {})) manifest.bin[command] = file.replace(/^\.\//, "");
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const path of manifests) {
    execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: join(path, ".."), stdio: "inherit" });
  }
} finally {
  for (const [index, path] of manifests.entries()) writeFileSync(path, sources[index]);
}
for (const name of ["brimjs", "create-brim"]) {
  if (!readdirSync(out).includes(`${name}-${version}.tgz`)) throw new Error(`${name}-${version}.tgz was not made.`);
}
