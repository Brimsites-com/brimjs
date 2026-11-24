---
title: Getting started
section: Start
order: 1
lead: Create a Brim.js site, sign in to its editor and change your first text.
---

## What you need

Node.js 22.23.4 or newer, and npm, pnpm or any package manager.

## Create a site

```bash
npm create brim@latest my-site
```

It makes a new Astro project: a layout with header and footer, sections in `src/components`, home, about, blog and contact pages, an `article` content type, a landing page template, site settings for your contact details, theme colors, and a `components` page that shows every component, block and icon. The project is a git repository with a first commit.

The folder, the site's name and its language are asked for when you leave them out. To skip the questions, pass them after `--`:

```bash
npm create brim@latest my-site -- --name "Studio Nord" --lang en
```

| Option | What it does |
| --- | --- |
| `--name` | The site's name, shown in the navigation and footer |
| `--lang` | The site's language and default (`en`, `ro`, `de`…) |
| `--brim` | The `brimjs` dependency: a version (`^0.1.0`) or the path of a local checkout (`./packages/brim`) |
| `--no-git` | Leave the new site out of git |

## Run it

```bash
cd my-site
npm install
npx brim user add you@example.com   # the account that edits the site
npm run dev
```

| Address | What it is |
| --- | --- |
| http://localhost:4321 | The site |
| http://localhost:4321/admin/edit | The editor, for the user you just added |

The password is asked for when you add the user, or read from stdin in scripts. With the dev server running, `npx brim open` opens the editor in your browser, already signed in.

## Change something

Every page has an Edit this page button for whoever may edit, and `?edit` after any address opens that page in the editor. Click the big heading and type, then press Save (⌘S). Until you save, changes wait in a draft only the editor shows, and ⌘Z takes them back.

What you save is stored in the site's database under the element's `nodeId`. Your source files are never rewritten. See [Editing and handover](./editing.md) for how drafts, roles and history work.

## Let an agent build it

Every new project includes `AGENTS.md` with the rules an AI coding agent needs: use Brim components with stable node ids, put repeatable content in content types and contact details in site settings, keep pictures that are content out of git, never edit the database directly. Point Claude Code, Codex or Cursor at the project and describe the site you want.

Once the site runs, the same agent can change content through the [site MCP](./mcp.md) instead of the code.

## Add Brim to an existing Astro site

In the project's folder:

```bash
npx brimjs init
```

It adds the dependency and the `brim()` integration, keeps the database and uploads out of git, and writes a conversion guide for coding agents. Nothing on the site changes until you make elements editable. See [Convert an Astro site](./convert-astro-site.md).
