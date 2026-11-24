---
title: SEO, pages and feeds
section: Content
order: 7
lead: Page Settings, passwords, redirects, the sitemap and RSS feeds, managed by the owner and written by Seo.
---

## Page Settings

Each page's settings (Page Settings in the editor, `brim_update_page` over MCP) feed `<Seo>` in the layout:

- Search results: SEO title and description, with a preview and the lengths search engines show in full (about 60 and 155 characters).
- Shared links: the preview image, and a title and description of their own, with a preview of the card.
- Settings: hide from search engines (`noindex`, and the page leaves the sitemap), `nofollow`, and a canonical address.

`<Seo>` also writes the canonical address of every page, `hreflang` links between a page's languages, `<meta name="author">` on an item's page, and on the home page structured data (`WebSite` and `Organization`) once `identity.name` is set: the name, its other spellings from `identity.alternateName`, and the site's profiles elsewhere from the `sameAs` prop. Pass it the links kept in Site Settings, so the owner changes them in one place: `<Seo title={title} sameAs={[facebook, instagram]} />`. Empty ones are left out. See [Site settings and identity](./site-settings.md).

```astro
---
// src/layouts/Site.astro
import { Seo } from "brimjs/components";
const { title } = Astro.props;
---
<html lang="en">
  <head>
    <Seo title={title} />
  </head>
  <body><slot /></body>
</html>
```

## Visitor statistics

```astro
---
// src/layouts/Site.astro, at the end of <body>
import { Analytics } from "brimjs/components";
---
<Analytics policyHref="/privacy" />
<button type="button" data-cookie-settings hidden>Cookie settings</button>
```

With `BRIM_GOOGLE_ANALYTICS_ID` (a Google Analytics 4 measurement id, `G-…`) in the server's environment, `<Analytics>` asks visitors once whether they accept statistics and loads Google Analytics only after they do. Without the variable it draws nothing, so a copy of the site for testing counts nobody. Whoever is signed in to the editor is never counted, nor is the dev server. A browser that sends Global Privacy Control is taken as a refusal.

The texts are props (`text`, `acceptText`, `rejectText`, `policyText`), in the site's language; the look is your CSS on `.brim-consent`, `.brim-consent__text`, `.brim-consent__actions` and `.brim-consent__button`. An element with `data-cookie-settings`, written `hidden`, shows once there is something to choose and opens the choice again: the law asks that taking consent back is as easy as giving it. Say in your cookie policy that the site uses Google Analytics.

Nothing is used for advertising. A choice is asked again after 180 days, and taking it back deletes the cookies.

Cookies should stay on the host name they were set on, and the page asks for that. A Google tag that comes as a Tag Manager container configures itself and ignores the page: its cookies then land on the domain (`example.com`), which every site under it receives. Where that matters, such as a site on a domain shared with other people's sites, set the tag's `cookie_domain` to `none` in Google Tag Manager. The browser's console warns when the cookies are shared, in browsers that can tell.

## Passwords

An owner can put a page behind a password. Visitors see a small form instead, give it once and keep the page open on that device for 30 days; changing the password closes it again. Signed-in users open the page as it is. A protected page is never cached, carries `noindex` and leaves the sitemap. It needs the server: a static build writes a notice in its place.

## Redirects

Redirects live in Site Settings (owners only, or `brim_set_redirects`): an old path goes to a new path or a full address, permanently (301) or for a while (302), with the query kept. Moving a page or changing a published item's address adds its redirect and points older ones straight at the new address. A chain that leads back to itself is refused, and Brim's own routes cannot be redirected. Redirects answer on the server and the dev server; a static build has none.

## Sitemap and robots

Brim adds `/sitemap.xml` to every site whose `site` is set. It lists the published pages in code, pages from templates and item pages, and leaves out private pages, hidden ones, pages behind a password and pages whose canonical is elsewhere. `/robots.txt` points to it and keeps crawlers out of `/admin`. A site with its own `src/pages/sitemap.xml.ts` or robots file keeps it.

`brim check --content` warns about a dynamic route in `src/pages` that no content type draws, since Brim cannot know its addresses for the sitemap.

## RSS feeds

```ts
const post = defineContentType({
  key: "post",
  label: "Blog",
  singular: "Post",
  slug: "blog",
  component: PostPage,
  feed: { title: "Studio Nord · Journal", limit: 30 }, // or feed: true
  fields: [/* … */],
});
```

A type with `feed` gets an RSS 2.0 feed of its newest published items at `/rss/<slug>.xml`, and on a site with languages one per language at `/rss/<locale>/<slug>.xml`.

| Option | What it sets |
| --- | --- |
| `limit` | How many items (20 by default) |
| `date` | The date field; by default the type's first one, else when the item was created |
| `summary` | A `text`, `textarea` or `richtext` field; by default the first `textarea`, then the page description |
| `title`, `description` | The feed's own; by default the type's label after the site's name |

The picture is the item's first image field. Private items, items behind a password and items with no page are left out. Every page using `<Seo>` links the feeds of its language so readers find them. A static build writes feeds only when `site` is set.

## The site's address

Set `site` in `astro.config.mjs`, or let the host give it as `BRIM_SITE_URL`, so canonical links, the sitemap, feeds, share images and password-reset links name the address visitors use.
