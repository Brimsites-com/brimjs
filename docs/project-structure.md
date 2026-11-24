---
title: Project structure
section: Start
order: 2
lead: A Brim.js site is your own Astro code plus a few declaration files and one database file.
---

## The files

```text
astro.config.mjs        brim(): identity, brand colors, icons, mail, media…
src/
  content-types/        Repeatable content declared in code, with each type's page template
  page-templates/       Templates of pages the owner adds in the editor
  site-settings.ts      The site's own settings: phone, email, address, socials
  forms.ts              Forms declared once, placed anywhere (optional)
  emails.ts             How the site's form emails read (optional)
  layouts/Site.astro    The page shell: head, header, footer
  components/           The site's own sections, built from Brim components
  pages/                One file per page
  styles/global.css     Theme colors (--brim-theme-*) and base styles
seed/                   Starting items in git, added with brim seed (optional)
public/                 Pictures the design starts with
public/uploads/         Images uploaded in the editor (not in git)
.brim/data.db           Content, users, media and form responses (not in git)
AGENTS.md               Rules for AI coding agents
```

## Code in git, content in SQLite

What you write in source is the default. A value the owner saved for the same `nodeId` replaces it when the page is drawn. Source is never rewritten, so you can keep changing the design while the owner keeps editing the words.

- Pages and content items are `private` or `published`. There is no site-wide publish step.
- Brim components hold content, not design. `Navbar`, `Footer`, galleries and carousels hand you their data; the markup and styling are yours.
- What the owner chooses is data, and how it looks is the site's code. The fields of a form, a block's width, a carousel's slides: the owner sets them in the side panel, and your markup and CSS draw them.
- Brim's own CSS is the least that makes a component work, in the `brim` cascade layer. Any CSS of the site wins over it, whatever its selectors, without `!important`.
- No framework runtime. Components render to HTML; add React, Vue or Svelte islands when a page needs them.

## The server

`astro build` makes one Node server, and `brim start` runs it. Pages are drawn from the database on each request, so a saved change is live at once and nothing is rebuilt. The dev server draws pages on request too.

Visitors get published content only, with no trace of the editor. A signed-in editor gets the same addresses with private content and the editing markers.

A static copy is still one command away (`BRIM_OUTPUT=static astro build`), without the editor, the MCP, forms or search. See [Deploy](./deploy.md).

## The database

Everything the owner creates lives in `.brim/data.db`, a single SQLite file in the project, listed in `.gitignore`. A deploy carries code, never this file.

```bash
npx brim info          # users, pages, edited elements, items, media, form responses
npx brim content /     # what the owner saved on a page, before you change its code
```

Never write to the database directly. Use the editor, the [site MCP](./mcp.md), `brim seed` or the CLI. Database migrations only go forward, and a newer Brim.js brings an older database up to date by itself when it opens it.

## Theme colors

The starter's `src/styles/global.css` names the site's colors as `--brim-theme-*` variables. Brim's blocks read them, and the editor offers them in its color pickers.

| Variable | Used for |
| --- | --- |
| `--brim-theme-background` | Page background |
| `--brim-theme-light1`, `--brim-theme-light2` | Soft surfaces and borders |
| `--brim-theme-accent`, `--brim-theme-accent-contrast` | Buttons and highlights, and text on them |
| `--brim-theme-primary` | Main text |
| `--brim-theme-dark1`, `--brim-theme-dark2` | Secondary text and dark surfaces |

Brand colors named in `astro.config.mjs` are offered first in every color picker. See [Site settings and identity](./site-settings.md).
