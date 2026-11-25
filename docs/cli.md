---
title: Command line
section: Run
order: 3
lead: The brim command, in every site's folder, checks the code, seeds content, reads what the owner saved and opens the editor.
---

## Commands

Run them with `npx brim …` (or `pnpm brim …`) in the site's folder.

| Command | What it does |
| --- | --- |
| `brim init [--lang <code>] [--brim <version>] [--no-git]` | Set up Brim.js in an Astro project that already exists |
| `brim check [folder] [--json]` | Read the source for mistakes; exits with 1 on errors |
| `brim check --content` | Also read the running site's content for values left from testing |
| `brim seed [folder] [--dry-run]` | Add the starting content of `seed/`; never changes what is there |
| `brim seed --export [folder] [--force]` | Write the site's items and their pictures into `seed/` |
| `brim content [path] [--json]` | What the owner saved on a page (`/` by default) and on the whole site |
| `brim content --all [--json]` | Every place with saved content, with how many elements |
| `brim media add <files…> [--item <type>/<id>]` | Upload pictures into the media library and print their addresses |
| `brim open [email] [--page /path] [--url <site>]` | Open the editor in the browser, already signed in |
| `brim info [--json]` | What the database holds: users, pages, items, media |
| `brim start` | Run the built server: pages, `/admin` and forms, on `HOST` and `PORT` |

`brim seed` and `brim check --content` sign in to the local dev server by themselves; a site elsewhere needs `--url <site> --token <token>`. Users and tokens have [their own page](./users-and-tokens.md), and seeds are on [Starting content](./seed.md).

## brim check

`brim check` reads `src/**/*.astro`, `.tsx`, `.jsx` and `.mdx` without building, and reports one line per finding with file and line.

- Errors: a `nodeId` used twice on one page (counting the local components the page draws), two different `scope="site"` elements sharing an id, and a password written in a file of the project.
- Warnings: ids that name a position (`text-3`, generated UUIDs), files left unchanged from the starter, `/uploads/…` addresses in code, oversized pictures in `public/`, contact details written in code, image sizes written as numbers, `<img src={mediaUrl(…)}>`, an order kept in a number field, rich text used as an item's body, and a site not in git.

It exits with 1 when there are errors, so it fits in CI.

`brim check --content` reads the running site and warns about lorem ipsum, example addresses, numbers of one repeated digit, TODO notes and "placeholder" left in items, settings and pages; terms nothing uses; dynamic pages missing from the sitemap; published items with no description, image or date for search engines; and fields that look meant for them but are not (`seo_title`). These are warnings: some may be on purpose.

## Before changing a page's code

A `nodeId` renamed or removed drops its saved value. See what the owner wrote first:

```bash
npx brim content /contact   # the page's saved elements and the site's (header, footer, settings)
npx brim content --all      # every place with saved content
```

The MCP's `brim_page_content` gives an agent the same, and `GET /admin/api/nodes?path=/contact` answers it on the API.
