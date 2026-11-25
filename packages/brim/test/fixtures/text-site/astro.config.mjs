import { defineConfig } from "astro/config";
import brim from "@brimsites/brimjs";

// A site for the tests of Text's default content: one page whose Text an edit keeps whole, one per kind of
// markup it would lose.
export default defineConfig({ integrations: [brim()] });
