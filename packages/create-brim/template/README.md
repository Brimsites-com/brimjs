# {{siteName}}

An [Astro](https://astro.build) site made editable with Brim.js. The layout lives in code; texts, images,
links, settings and articles are edited in the browser and stored in SQLite.

## Start

```bash
npm install
npx brim user add you@example.com   # the account that edits the site
npm run dev
```

- Site: http://localhost:4321
- Editor: http://localhost:4321/admin/edit

## Where things are

```
astro.config.mjs        Brim integration and the content types it serves
src/
  content-types/        Repeatable content declared in code (articles, team…) and its page templates
  page-templates/       Templates of pages the owner adds in the editor (Site map → New page)
  layouts/Site.astro    The page shell: head, header, footer
  components/           The site's own sections, built from Brim primitives
  pages/                One file per page
  styles/global.css     Theme colors (--brim-theme-*) and base styles
public/                 Images and files served as they are
.brim/data.db           Local content, users and form responses (not in git)
```

`src/pages/components.astro` shows every Brim primitive and block, with the full icon set. Delete it when you no
longer need it.

## Rules that keep edits safe

- Every editable element has a `nodeId`. The owner's changes are stored under it, so keep ids stable: renaming
  one starts that element over from what the code says.
- Text in the code is the starting value. Once the owner edits it, their version is shown.
- A section used on several pages takes an `id` and prefixes its node ids with it, so each copy keeps its own edits.

## Build and run

```bash
npm run build
npm start
```

`npm run build` makes a Node server in `dist/`, and `npm start` runs it (`PORT`, default 4321). That one process
serves the pages, the editor at `/admin/edit`, the site MCP and forms. Pages are drawn from the database on each
request, so what the owner saves is live at once; visitors never see private pages or anything of the editor.

Point `BRIM_DATABASE_URL` (and `BRIM_DATABASE_TOKEN` for a remote libSQL database) at the database the running site
uses; without them it is `.brim/data.db` in this folder. Keep that file and `public/uploads` when you redeploy.

`npm run build:static` writes plain HTML, CSS and images instead, for a static host: the content as it is then,
without the editor, the MCP or forms.

## Deploy

The recommended way to put this site online is [Brimsites](https://dashboard.brimsites.com): managed, one-click
hosting for Brim.js. Connect this project's GitHub repository or drop the folder; Brimsites serves the pages from a
CDN and runs the database, the editor, forms, the site MCP and the rebuilds after each edit.

You can also host it yourself on anything that runs Node: `npm run build`, then `npm start`.

A deploy carries the code, not the content in `.brim/data.db`: to put what you made locally on the live site, use
`brimsites restore --content replace --yes` after the first deploy (the CLI: `npm install -g @brimsites/brimsites`). Both ways of hosting, step by step:
`node_modules/brimjs/skills/brim-hosting/SKILL.md`.
