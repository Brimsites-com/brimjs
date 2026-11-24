import { defineConfig } from "astro/config";
import brim from "brimjs";

// Content types are declared in src/content-types/index.ts.
// The editor offers Brim's own icons and the site's own pack, and the brand's colors first in its color pickers.
// The identity names the site in page tags and the editor's tab.
export default defineConfig({
  integrations: [
    brim({
      icons: { packs: ["./src/icons/brand.json"] },
      brandColors: { Terracotta: "#b85c42", Slate: "#36464f", Sand: "#e7e3dc" },
      identity: {
        name: "Acme Studio",
        alternateName: ["AcmeStudio"],
        description: "A small team that builds fast websites.",
        themeColor: "#b85c42",
      },
    }),
  ],
});
