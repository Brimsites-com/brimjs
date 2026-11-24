#!/usr/bin/env node
// Node does not run TypeScript from node_modules, so an installed brimjs runs the bundled command
// (built before packing); inside the brimjs repository the TypeScript source runs directly.
const installed = import.meta.url.includes("/node_modules/");
await import(installed ? "../dist/cli.js" : "../src/cli.ts");
