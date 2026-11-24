// Bundles the `brim` command into dist/cli.js. Node does not run TypeScript from node_modules,
// so an installed brimjs needs this JavaScript copy; inside this repository bin/brim.js runs the source.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// `brim check` compares a site with create-brim's template, which is not installed in a site, so the list of
// template files and their hashes goes into the bundle. It is read by the same code the CLI runs from source
// (src/starter.ts), turned into JavaScript by esbuild and loaded from memory.
const starter = await build({
  entryPoints: [fileURLToPath(new URL("../src/starter.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const starterCode = Buffer.from(starter.outputFiles[0].text).toString("base64");
const { readStarter } = await import(`data:text/javascript;base64,${starterCode}`);
const manifest = readStarter(fileURLToPath(new URL("../../create-brim/template/", import.meta.url)));
if (manifest.length === 0) throw new Error("create-brim's template has no files in src or public.");

await build({
  entryPoints: [fileURLToPath(new URL("../src/cli.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  define: { __BRIM_STARTER_MANIFEST__: JSON.stringify(manifest) },
});
