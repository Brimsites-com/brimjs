// Bundles the browser editor into editor-dist/ (editor.js and editor.css),
// served by the admin handler under /admin/assets/. It is never part of a site's public build.
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await build({
  entryPoints: [fileURLToPath(new URL("../src/editor/client/main.tsx", import.meta.url))],
  outfile: fileURLToPath(new URL("../editor-dist/editor.js", import.meta.url)),
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
