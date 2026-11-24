---
title: Server code
section: Build
order: 8
lead: A Brim.js site runs as a server, so it can have endpoints of its own next to the pages.
---

## An endpoint

It is plain Astro: a file in `src/pages` that exports `GET`, `POST` and so on answers at its address, and a page's frontmatter runs on the server on each request.

```ts
// src/pages/api/likes.ts → POST /api/likes
import type { APIRoute } from "astro";
import { getDatabase, getUser } from "brimjs/server";

export const POST: APIRoute = async ({ request }) => {
  const { page } = await request.json();
  const db = await getDatabase();
  await db.batch([
    { sql: "CREATE TABLE IF NOT EXISTS site_likes (page TEXT PRIMARY KEY, count INTEGER NOT NULL)" },
    { sql: "INSERT INTO site_likes VALUES (?, 1) ON CONFLICT (page) DO UPDATE SET count = count + 1", args: [page] },
  ]);
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!(await getUser(request))) return new Response(null, { status: 401 });
  await (await getDatabase()).batch([{ sql: "DELETE FROM site_likes" }]);
  return Response.json({ ok: true });
};
```

## What brimjs/server gives

| Function | What it gives |
| --- | --- |
| `getDatabase()` | The site's SQLite database, for tables of its own: `query(sql, args)` and `batch(statements)`, which runs in one transaction. Backed up and moved with the content. Leave the `brim_` prefix to Brim. |
| `getUser(request)` | Who is signed in to the editor, or `undefined` for a visitor |
| `readsQuery(names)` | Says which query parameters the page or endpoint being drawn reads (`["sort", "id"]`, or `"all"`), so a host caching pages keeps exactly those in its cache key. Call it where they are read, each time |

A route whose address is known ahead can be declared in the config instead:
`brim({ query: { "/api/products": ["sort", "id"], "/shop/*": ["color"] } })`. Brim's own blocks (Listing, Search)
declare what they read by themselves. Undeclared paths keep every parameter; `brim check` warns about code that reads
`searchParams` without declaring it. See "Declaring query parameters" in the README.

## Rules

- Read content as on pages, with `getItems` and `getItem` from `brimjs/content`.
- Secrets come from the environment (`process.env.MY_KEY`), set where the server runs, never written in the code.
- The addresses `/admin`, `/_brim` and `/uploads` are Brim's.
- Astro refuses a form posted from another site; an endpoint called by another service should take JSON.
- A static build has no server: a `GET` endpoint is run once and written as a file, and the other methods do not exist.
