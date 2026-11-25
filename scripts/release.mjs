#!/usr/bin/env node
/**
 * Sets the version of `@brimsites/brimjs` and `create-brim`, which are always released together:
 *
 *   pnpm release 1.0.1     writes it in both package.json files; its notes must be in CHANGELOG.md
 *   pnpm release --check [1.0.1]   checks that both packages have that version, and the changelog its notes
 *
 * It publishes nothing. Commit the change, merge it into main, then push the tag `v1.0.1` on that commit of main:
 * `.github/workflows/release.yml` checks the versions again and publishes.
 */
import { assertNotes, currentVersion, isAfter, isVersion, writeVersion } from "./versions.mjs";

const [first, second] = process.argv.slice(2);
try {
  const current = currentVersion();
  if (first === "--check") {
    if (second !== undefined && second !== current)
      throw new Error(
        `The packages are at ${current}, not ${second}. Run "pnpm release ${second}" and merge it first.`,
      );
    assertNotes(current);
    console.log(`brimjs and create-brim are at ${current}, with notes in CHANGELOG.md.`);
  } else {
    if (!isVersion(first)) throw new Error("Usage: pnpm release <version>, e.g. pnpm release 1.0.1");
    if (!isAfter(first, current)) throw new Error(`The packages are at ${current}: ${first} does not come after it.`);
    assertNotes(first);
    writeVersion(first);
    console.log(`brimjs and create-brim: ${current} → ${first}.`);
    console.log(`Commit it, merge it into main, then push the tag v${first}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
