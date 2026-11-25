---
title: Languages
section: Content
order: 6
lead: A site has several languages when its Astro config says so. The editor then switches, copies and translates pages and items.
---

## Turn languages on

A site has several languages only if its code says so, with Astro's own `i18n` setting:

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import brim from "@brimsites/brimjs";

export default defineConfig({
  i18n: { defaultLocale: "en", locales: ["en", "ro"] },
  integrations: [brim()],
});
```

A new site declares its own language from the start (`create-brim` asks for it, `brim init` takes `--lang` or reads the layout's `<html lang>`), so adding a second one later is one more code in `locales`. With one language the editor shows no language menus.

A site that turns languages on later keeps what its owner saved: the navbar, footer, shared texts, Site Settings and template changes saved without a language become the default language's, the first time the server or a build runs with languages.

## Pages

Each language's page is its own page (`/about` and `/ro/about`), written in `src/pages` as usual or drawn under `[locale]`. Its texts are edited separately, and the navbar, footer and site settings are kept per language.

The editor's top bar shows the page's language, and picking another opens the same page in it. When that page does not exist yet, a page from a template is added in that language, private, with this page's texts; a page written in code has to be added in code first. Copy this page's text fills the other language's page where it has no text yet and never overwrites a translation.

## Items

An item is in one language. On its page the language menu opens its translations or makes a private copy to translate, linked to the original, with its own address (`/ro/projects/casa-de-la-lac`). Items of a type without a template do this from their form. What the owner changes on a type's template is kept per language.

`getItems` and `getItem` answer the items of the page's language; pass `{ locale: "ro" }` (or `"*"` for all) where there is no page yet. `getTranslations` gives a language switcher the others:

```astro
---
import type { ItemPageProps } from "@brimsites/brimjs";
import { getTranslations } from "@brimsites/brimjs/content";

const { item: project } = Astro.props as ItemPageProps;
const translations = await getTranslations("project", project);
---
```

`<Seo>` links an item's translations for search engines with `hreflang`, each at its own address.

## Vocabularies and choices

- A vocabulary term is translated like any item, and its translations keep its slug, so references keep working. A term not translated yet shows in its original language, never as its bare slug.
- A `select` choice takes its label in other languages: `{ value: "glossy", label: "Glossy", labels: { ro: "Lucios" } }`.

## For agents

`brim_translate_item` makes a private, linked translation of an item, and `brim_list_items` filters by `locale`. Write in the default language first, then translate.
