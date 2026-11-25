---
title: Site settings and identity
section: Build
order: 7
lead: Contact details the owner keeps up to date, and who the site is, its colors and icons, set once in code.
---

## Site settings

Facts about the whole site that its owner changes now and then (phone, email, WhatsApp, social profiles, address, opening hours, links to legal pages) are site settings. Declare them in `src/site-settings.ts`, with the same fields as a content type plus a `group` (the section of Site Settings they show in) and a `default`:

```ts
// src/site-settings.ts
import { defineSiteSettings } from "@brimsites/brimjs";

export const siteSettings = defineSiteSettings({
  fields: [
    { name: "phone", label: "Phone", type: "text", group: "Contact", default: "+40 721 000 000" },
    { name: "email", label: "Email", type: "email", group: "Contact" },
    { name: "hours", label: "Opening hours", type: "keyvalue", group: "Contact" },
    { name: "instagram", label: "Instagram", type: "url", group: "Social" },
  ],
});
```

The owner edits them in Site Settings, in each of the site's languages, and every page shows the change at once. Pages read them with `getSiteSettings(siteSettings)` from `@brimsites/brimjs/content`, typed, and show one with `<Setting>`, which opens Site Settings at that field when clicked in the editor:

```astro
---
import { Setting } from "@brimsites/brimjs/components";
import { getSiteSettings } from "@brimsites/brimjs/content";
import { siteSettings } from "../site-settings.ts";
const { phone, instagram } = await getSiteSettings(siteSettings);
---
{phone && <a href={`tel:${phone}`}><Setting name="phone" /></a>}
{instagram && <a href={instagram}>Instagram</a>}
```

A field the owner empties stays empty (`null`), so the page can leave out what was removed. `brim check` warns about emails, phone numbers and social links written in the code instead. Agents use `brim_site_settings` and `brim_set_site_settings`.

## Identity

Who the site is lives in `astro.config.mjs`, set in code and not changed in the editor:

```js
// astro.config.mjs
brim({
  identity: {
    name: "Studio Nord", // og:site_name, the title of a page without one, the editor's tab
    alternateName: ["StudioNord", "studionord.com"], // other ways people write the name, for search engines
    titleTemplate: "%s — Studio Nord", // how <Seo> writes page titles
    description: "A small team that builds fast websites.", // for pages without their own
    image: "/share.png", // shared-link image for pages without their own
    themeColor: "#b85c42", // the browser bar on phones
    favicon: "/favicon.svg", // without it: public/favicon.svg, .ico or .png when there
  },
});
```

`<Seo>` writes all of it into each page's head. A page's own values and what the owner sets in Page Settings come first. A setting that is not valid stops the site from starting and says which.

## Brand colors

```js
brim({ brandColors: { Primary: "#ff7138", Ink: "#242420", Sand: "#faf9f6" } });
```

They are offered first wherever the editor picks a color: the text color and highlight menus, and the color fields of blocks. They live in code, so owners use them but cannot change them. A color is `#rgb` or `#rrggbb`, at most 24. Picking one writes its value, so changing a brand color later does not repaint what was already colored.

## Icons

The Icon and Button blocks let the owner pick an icon. Without any setting the picker offers Brim's own set. `icons` narrows it or adds packs, each shown as a tab:

```js
brim({
  icons: {
    builtIn: ["heart", "star", "arrow-right"], // true (default) for all, false for none
    packs: [
      "@iconify-json/tabler", // an installed Iconify package
      "./src/icons/brand.json", // a JSON file of the site, in the same format
    ],
  },
});
```

A pack is in the Iconify JSON format, so any `@iconify-json/*` package works as it is. A pack's icon is saved as `prefix:name` (`tabler:rocket`) and can be written in code too: `<Icon nodeId="…" icon="tabler:rocket" />`. Only the icons a page shows are sent to visitors. A pack that is missing or malformed stops the site from starting.
