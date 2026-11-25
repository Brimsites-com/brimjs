---
title: Convert an Astro site
section: Guides
order: 1
lead: Make an Astro site you already have editable, one element at a time, by hand or with your coding agent.
---

## 1. Add Brim.js

In the project's folder:

```bash
npx brimjs init
```

It adds the `brimjs` dependency and the `start` and `brim` scripts, adds `brim()` to `astro.config`, declares the site's language (`--lang`, else the layout's `<html lang>`, else `en`), keeps `.brim` and `public/uploads` out of git, runs `git init` when the project is not in git, and writes a conversion guide for coding agents (`.claude/skills/brim-convert/SKILL.md`, named in `AGENTS.md`).

The site builds and looks exactly as before. Running it again changes nothing that is set up. A site that sets another Astro adapter keeps it, but the editor, forms and MCP need a Node server.

Then install and add yourself:

```bash
npm install
npx brim user add you@example.com
```

## 2. Convert, in this order

1. The layout and `<Seo>`, so Page Settings work on every page.
2. Navigation and footer, with `Navbar` and `Footer`.
3. Texts, links and images: `<h1>Hello</h1>` becomes `<Text nodeId="hero-title" as="h1">Hello</Text>`.
4. Forms, with `defineForm`.
5. Contact details into `src/site-settings.ts`.
6. Markdown collections into content types, with a `blocks` field for the body and a `Listing` wherever items are listed. Bring the existing entries in with a [seed](./seed.md).

Or ask your agent: "convert this site to Brim.js, following the brim-convert skill". It keeps the look as it is and changes only how the content is held.

## 3. Check the work

```bash
npx brim check
npm run dev
npx brim open
```

`brim check` reports duplicate node ids, ids like `text-3` that move when the page changes, and contact details still in the code. Then click through the editor on a computer and a phone, and run `npx brim check --content` with the dev server up.

## 4. Hand it over and deploy

Add the client, and their copywriter, as an `editor` (see [Editing and handover](./editing.md)), then [deploy](./deploy.md) on your own server or on Brimsites, and bring the content you wrote locally with it.
