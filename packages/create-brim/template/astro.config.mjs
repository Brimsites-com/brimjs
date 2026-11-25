import { defineConfig } from "astro/config";
import brim from "@brimsites/brimjs";

export default defineConfig({
  // Set the site's address before going live: share links and canonical tags use it.
  // site: "https://example.com",
  // The site's language, its default. Another one is added to `locales` when the site needs it: what the owner
  // already saved stays this language's.
  i18n: { defaultLocale: "{{lang}}", locales: ["{{lang}}"] },
  // Content types are declared in src/content-types/index.ts.
  integrations: [brim()],
});
