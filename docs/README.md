# Brim.js documentation

Brim.js makes Astro sites editable. You write pages in Astro with components that carry a stable `nodeId`; the owner edits them in a visual editor on the site itself, and their content lives in SQLite. One Node server draws the pages, so a saved edit is live at once.

These pages are the human documentation. The brimjs.org website renders them from this folder. For agents, the guides in `packages/brim/skills/` and the `AGENTS.md` of every new site carry the same rules.

## Start

- [Getting started](./getting-started.md)
- [Project structure](./project-structure.md)
- [Editing and handover](./editing.md)

## Build

- [Components and nodeId](./components.md)
- [Blocks](./blocks.md)
- [Galleries and carousels](./galleries-and-carousels.md)
- [Navigation](./navigation.md)
- [Forms](./forms.md)
- [Media](./media.md)
- [Site settings and identity](./site-settings.md)
- [Server code](./server-code.md)

## Content

- [Content types](./content-types.md)
- [Vocabularies](./vocabularies.md)
- [Listings and search](./listing-and-search.md)
- [Starting content](./seed.md)
- [Page templates](./page-templates.md)
- [Languages](./languages.md)
- [SEO, pages and feeds](./seo-and-pages.md)

## Run

- [Users and tokens](./users-and-tokens.md)
- [Site MCP](./mcp.md)
- [Command line](./cli.md)
- [Deploy](./deploy.md)
- [Versions and license](./versions.md)

## Guides

- [Convert an Astro site](./convert-astro-site.md)

## Writing these pages

One file per page, `docs/<slug>.md`, starting with front matter (`title`, `section`, `order`, `lead`, plain `key: value` lines). The body starts at `##` headings. Link other pages as `./<slug>.md`. Keep a page's slug once it is published: it is its address on the website.
