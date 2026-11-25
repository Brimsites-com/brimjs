/** The version of the packages this repo publishes: one for both, written in their package.json. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
export const PACKAGES = ["brim", "create-brim"];
export const manifestPath = (name) => join(root, "packages", name, "package.json");

export const isVersion = (text) => /^\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.]*)?$/.test(text ?? "");

/** The version the packages are at; throws when they do not agree. */
export function currentVersion() {
  const found = PACKAGES.map((name) => [name, JSON.parse(readFileSync(manifestPath(name), "utf8")).version]);
  const versions = new Set(found.map(([, version]) => version));
  if (versions.size !== 1)
    throw new Error(`The packages are at different versions: ${found.map((pair) => pair.join(" ")).join(", ")}.`);
  return found[0][1];
}

/** Writes the version in every package, changing nothing else of its package.json. */
export function writeVersion(version) {
  for (const name of PACKAGES) {
    const source = readFileSync(manifestPath(name), "utf8");
    writeFileSync(manifestPath(name), source.replace(/^( *"version": )"[^"]*"/m, `$1"${version}"`));
  }
}

/** A version is released with notes: its own heading in CHANGELOG.md. */
export function assertNotes(version) {
  const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").split("\n");
  if (!lines.includes(`## ${version}`)) throw new Error(`CHANGELOG.md has no "## ${version}" heading.`);
}

/** Whether `next` comes after `version`; a prerelease (1.1.0-beta.1) comes before its release (1.1.0). */
export function isAfter(next, version) {
  const parse = (text) => {
    const [, numbers, pre] = /^([\d.]+)(?:-(.*))?$/.exec(text);
    return { numbers: numbers.split(".").map(Number), pre };
  };
  const [a, b] = [parse(next), parse(version)];
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i];
  if (a.pre === b.pre) return false;
  if (!a.pre || !b.pre) return !a.pre;
  return a.pre.localeCompare(b.pre, "en", { numeric: true }) > 0;
}
