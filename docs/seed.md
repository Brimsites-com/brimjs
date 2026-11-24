---
title: Starting content
section: Content
order: 4
lead: Keep a site's starting items in git as a seed, and add them to any copy of the site without touching what the owner wrote.
---

## What needs a seed

A new site needs no seed for its pages: the texts, images and links written in the code are what it shows until the owner changes them. What lives only in the database has to be put there:

- Items (products, articles, team members, a vocabulary's terms) are content, never code. Keep the starting ones in `seed/`.
- Editor users are made with `npx brim user add`, on each machine and online.
- A live site gets its content after the first deploy; see [Deploy](./deploy.md).

## Seed files

Each file in `seed/` is a list of items of the type it is named after, with pictures next to it in `seed/images/`:

```json
// seed/category.json
[{ "title": "Ceramics", "slug": "ceramics", "data": { "image": { "src": "images/ceramics.webp", "alt": "Glazed tiles" } } }]
```

```json
// seed/product.json
[{ "title": "Marazzi Art", "slug": "marazzi-art", "data": { "category": "ceramics", "price": 120 } }]
```

- Items are published unless they say `"visibility": "private"`. `slug` comes from the title when left out.
- `"locale": "ro"` makes an item the translation of the one with the same slug, or of the one `"translates"` names when its own slug differs.
- A vocabulary's terms are added before the items that point at them, wherever the seed lists them.
- A picture is a file next to the seed. Only the pictures of the items being added are uploaded, wherever the site keeps its media.

## Add it

While `npm run dev` runs:

```bash
npx brim seed --dry-run   # what it would add, writing nothing
npx brim seed             # add it
```

- It only adds. An item the site already has (same type, slug and language) stays exactly as it is, so the seed can run again on a fresh clone, a colleague's machine or after the owner has changed things. It never deletes anything.
- All or nothing. The whole seed is checked first, as the editor checks an item (required fields, select values, terms that exist); one mistake and nothing is added, with every mistake listed at once.
- It signs in to the dev server on this computer by itself, with an access token it deletes when done. A site elsewhere needs `--url https://… --token <token>`, given on purpose, and a database set up to be elsewhere (`BRIM_DATABASE_URL`) needs `--remote`. Owners only.

## Export it

```bash
npx brim seed --export
```

Writes the site's items into `seed/` with the pictures they use: the way to keep content made in the editor as the site's starting content. It does not write over seed files unless `--force`.

## For agents

An agent can add items through the site MCP (`brim_create_item`) instead. Never write `.brim/data.db` directly. Material a site is filled from (photos, catalogs, data for an import) stays out of git; keep it in an ignored `import/` folder or outside the project.
