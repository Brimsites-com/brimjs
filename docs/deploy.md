---
title: Deploy
section: Run
order: 4
lead: A Brim.js site is one Node server and one database file. Run it on your own server, as static files, or on Brimsites.
---

## Your own server

A Brim.js site is one ordinary server process, on anything that runs Node 22.23.4 or newer.

```bash
npm ci
npm run build    # astro build: a Node server in dist/
npm start        # brim start: pages, /admin (editor, API, MCP), forms and uploads
npx brim user add you@example.com --role owner   # once, on the server
```

It listens on `HOST` and `PORT` (default `0.0.0.0:4321`). Pages are drawn from the database on each request, so an edit is live as soon as it is saved and nothing is rebuilt. Visitors get published content only, without a trace of the editor. Brim sets up Astro's Node adapter itself.

What the server needs:

- A persistent disk for `.brim/data.db` and `public/uploads`, kept between deploys. Serverless hosts that throw the disk away fit only the static copy.
- One instance per site, since the database is a SQLite file. A remote libSQL database (`BRIM_DATABASE_URL`) moves the data off the disk; uploads still need the disk or the `media` storage option.
- HTTPS in front, from a reverse proxy such as Caddy or nginx. Pass `X-Forwarded-Host` and `X-Forwarded-Proto`.
- A process manager: systemd, pm2, Docker with a volume, or your platform's.

## Settings

| Variable | What it sets |
| --- | --- |
| `HOST`, `PORT` | Where the server listens |
| `BRIM_SITE_URL` | The public address, when `site` is not set in code |
| `BRIM_DATABASE_URL`, `BRIM_DATABASE_TOKEN` | The database, and its token (read only here, never from a build); without them `.brim/data.db` in the project |
| `BRIM_CLIENT_IP_HEADER` | The header in which your proxy gives the visitor's address (e.g. `x-real-ip`) |
| `BRIM_SMTP_URL`, `BRIM_MAIL_FROM` | An SMTP server for form emails (or `BRIM_MAIL_URL`, `BRIM_MAIL_TOKEN` for a mail service) |
| `BRIM_MEDIA_STORAGE_URL`, `BRIM_MEDIA_PUBLIC_URL`… | Where uploads are kept and served from ([Media](./media.md)) |
| `BRIM_VIDEO_UPLOADS_URL`, `BRIM_VIDEO_UPLOADS_TOKEN` | A video host, for video uploads from the editor |
| `BRIM_GOOGLE_ANALYTICS_ID` | A Google Analytics 4 measurement id (`G-…`), for sites with `<Analytics>` ([SEO, pages and feeds](./seo-and-pages.md#visitor-statistics)) |
| `BRIM_CAPTCHA_SECRET` | The secret of the forms' challenge (Turnstile or hCaptcha) |
| `BRIM_MEDIA_SITE_URL` | A CDN address for the files of `public/` ([Media](./media.md)) |
| `BRIM_HOST_SIGN_IN_URL`, `BRIM_HOST_SIGN_IN_NAME` | A host's own sign-in button on the editor's sign-in form ([Users and tokens](./users-and-tokens.md)) |

Set `BRIM_CLIENT_IP_HEADER` only when the proxy always writes that header itself and the server is reachable through the proxy alone. Without it every visitor has the proxy's address, so the limits on wrong passwords and form messages are shared by everyone.

`GET /admin/api/info` answers `{ name, version, schemaVersion, capabilities, … }` without signing in, for health
checks. A host that keeps pages in a CDN empties it when an `/admin` answer carries `X-Brim-Changed: live`
(capability `live-change-header`), and keys each page on the query parameters `query` says it reads (capability
`query-params`); see "Caching on a host" in the README.

## Updates and backups

To deploy a new version: pull the code, `npm ci`, `npm run build`, restart. Leave `.brim/` and `public/uploads` where they are; they are the site's content and are not in git.

Back up `.brim/data.db` and `public/uploads` on a schedule and before every update of Brim.js: migrations only go forward. While the server runs, `sqlite3 .brim/data.db ".backup backup.db"` makes a safe copy.

To put local content on your server, stop it and copy `.brim/data.db` and `public/uploads` over. That replaces what the server had.

## Static files

```bash
npm run build:static   # or BRIM_OUTPUT=static astro build
```

Writes plain files for any static host, with the content as it is at build time, without the editor, the MCP, forms, search or redirects. Edit locally, build again and upload. `brim({ output: "static" })` does the same from the config.

## Brimsites

[Brimsites](https://brimsites.com) is the managed hosting for Brim.js, from the same team. Connect a GitHub repository or drop the project folder in the dashboard, or deploy from the project with the Brimsites CLI:

```bash
npm install -g @brimsites/brimsites   # installed once on your computer, never in the site
brimsites login
brimsites sites create "My site" --link
brimsites deploy --wait
```

It runs the server, the database with backups, form emails and the site MCP. Plans and prices are on brimsites.com.

A deploy carries code, never `.brim/data.db`, so the live site keeps the content it has online. After the first deploy, bring your local content online from the project folder, with the dev server stopped:

```bash
brimsites restore --content replace --yes   # --users all also brings the local editor users
```

It keeps a copy of what was there first. `brimsites export` goes the other way. The full guide, for people and agents, ships with the package at `node_modules/@brimsites/brimjs/skills/brim-hosting/SKILL.md`.

## Before going live

- Set `site` in `astro.config.mjs` to the public address. Canonical tags, share links, the sitemap, feeds, password-reset links and the links in form emails use it.
- Run `npx brim check` and, with the site running, `npx brim check --content` for values left from testing.
- Give the site a way to send email, so form messages and Forgot password reach people.
