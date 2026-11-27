# Changelog

What changed in Brim.js, newest first. Versions are semantic: only a major version may break the API of components
and config, and says so here under **Changed**; a minor version adds, a patch version fixes. Database migrations are
append-only.

## 1.1.1

### Fixed

- **AI apps write articles with pictures where they belong**: the MCP tells them that a `richtext` field cannot hold
  pictures, so text with pictures between its paragraphs goes in a `blocks` field as text and image blocks in reading
  order, and to fill each new item's preview picture. `brim_site` (and `/admin/api/types`) names it per type as
  `previewImage`. Before, ChatGPT wrote a whole article into one rich text and could only add a picture after it.

## 1.1.0

### Added

- **AI apps connect to the site's MCP by signing in (OAuth)**: paste `https://your-site.com/admin/mcp` into ChatGPT,
  Claude or any MCP client that signs in, sign in on the site and choose Allow. The app acts as you, with your role,
  and stays connected (it renews its hour-long access token itself) until you disconnect it in the editor's menu
  (**Connected apps**), change your password or are removed. The site serves the OAuth metadata under
  `/.well-known/oauth-*`, registers apps by itself and requires PKCE; `/admin/api/connections` lists and disconnects
  apps, and `/admin/api/info` says `oauth`. Access tokens (`brim token add`) work as before. Database migration 16.

## 1.0.5

### Fixed

- **Astro's integrations directory can find brimjs**: the package carries the `withastro` and `astro-integration`
  keywords that the directory on astro.build looks for on npm, and both packages name what they are for in npm search.

## 1.0.4

### Fixed

- **robots.txt and the sitemap say how long they may be kept** when the site's address is set (robots.txt an hour, the
  sitemap asked again each time). Left unsaid, a CDN kept them as long as it liked: a site moved to a new domain went
  on naming the old one in robots.txt.

## 1.0.3

### Changed

- **The starter opens with a welcome page**: that Brim.js is installed, and the four things to do first. Its samples are
  shorter and say what is true of a new site.

### Fixed

- **A form could not be sent again after a refused attempt** without reloading the page: each new attempt was refused
  as too fast. A wrong answer, or a hurried first try, now only costs that try.
- The words on the starter's buttons could not be read: its rule for links took their color. Its rules for bare
  elements now sit in a layer below Brim's. A site made with 1.0.0 to 1.0.2 changes `a { color: inherit }` in
  `src/styles/global.css` to `a:not([class*="brim-"]) { color: inherit }`.

## 1.0.2

### Fixed

- The packages' homepage and documentation links point to https://brimjs.org, where the site is.

## 1.0.1

### Fixed

- The starter is published as `@brimsites/create-brim`, so a new site starts with `npm create @brimsites/brim@latest`.
  The package's README and `brim init` named the old command, `npm create brim`.

## 1.0.0

The first release, published on npm as `@brimsites/brimjs` (with `@brimsites/create-brim`, `npm create @brimsites/brim`, to start a site). What it does is in
the [README](README.md) and at https://brimjs.org/docs.
