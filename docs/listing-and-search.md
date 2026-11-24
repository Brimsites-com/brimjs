---
title: Listings and search
section: Content
order: 3
lead: Listing shows the items of a content type, with filters, search and pages for visitors. Search searches the whole site.
---

## Listing

`Listing` shows the items of a content type. Which items, in what order and how is the site's code; the owner changes what is listed by editing the items, not the listing.

```astro
---
import { Listing } from "brimjs/components";
---
<!-- The guides, sorted by title, each as the site draws it -->
<Listing nodeId="guides" type="doc" filter={{ section: "Guides" }} sort="title">
  {(item) => <a href={item.url}>{item.title}</a>}
</Listing>

<!-- On a project's page: three other projects, as plain cards -->
<Listing nodeId="more" type="project" exclude={project.id} limit={3} columns={3} />
```

| Prop | What it does |
| --- | --- |
| `filter` | Field values an item must have, `{ featured: true }`; text matches whatever its case, a list matches any of its values, and a tags field matches when one of its tags is asked for |
| `sort` | A field of the type, or `title`, `created`, `updated`, `position`; default `created`, or the owner's order for an `ordered` type |
| `order` | `ascending` or `descending`; descending for `created` and `updated` by default, ascending otherwise |
| `limit`, `exclude` | How many, and an item id (or several) to leave out |

Without a function child Brim draws a plain card per item: `variation` (`grid` or `list`), `columns`, `gap`, the `image` and `text` fields it shows, the `tags` it shows as labels (`.brim-listing__tag`), `links` and `imageAspectRatio`.

Visitors see published items; in the editor private ones show too. Selecting a listing in the editor shows how many items it lists, opens them, and adds a new one with the fields its `filter` asks for already filled in, so the new item lands in the listing it was added from.

For card images, use `<Image bare item={item} field="cover" … />` inside the function child, so the owner can replace a picture from the card. See [Media](./media.md).

## Facets, search and pages

A catalog lets visitors narrow the list themselves. The `filter` of the code still applies first:

```astro
<Listing
  nodeId="catalog"
  type="product"
  filter={{ category: "ceramics" }}
  facets={["brand", "tags"]}
  search={["title", "summary", "brand", "specs"]}
  pageSize={12}
  labels={{ search: "Search", apply: "Apply", reset: "Reset", results: "{count} products", next: "Next", previous: "Previous" }}
/>
```

- `facets`: fields visitors pick values of, as checkboxes with a count beside each value (`select`, `text`, `tags`, `number`, `boolean` or a reference). Values in one facet widen the list, facets narrow it.
- `search`: `true` searches the title and the type's text-like fields; a list names them. Every word must be found, whatever its case and accents.
- `pageSize`: how many items a page shows.

Everything goes through the page's address (`?brand=marazzi&q=oak&page=2`; `paramPrefix` for a page with several such listings). The page is drawn on the server with no script, and every state has an address to share.

Brim draws a form, a line with the count, the cards and the page links, as `.brim-listing-browser__*` classes. To write them yourself, pass `controls`: it receives the whole state (`items`, `total`, `facets` with their `options`, `query`, `page`, `pageCount`, `pageHref(n)`, `resetHref`, `otherParams`) and Brim draws only the items.

```astro
<Listing nodeId="catalog" type="product" facets={["brand"]} pageSize={12} controls={(state) => <MyFilters state={state} />}>
  {(item) => <ProductCard item={item} />}
</Listing>
```

`ItemOf<typeof product>` and `BrowseState<ItemOf<typeof product>>` from `brimjs` type the children and `controls`. A static build has no address to read, so it lists every item without the controls.

## Search

`Search` searches the whole site: the items of several content types, by any word of their title, texts, rich text and blocks, whatever the case and accents. Items with the words in their title come first, and each result has the sentence the words were found in.

```astro
---
// src/pages/search.astro
import { Search } from "brimjs/components";
---
<Search types={["article", "project"]} labels={{ search: "Search", button: "Search", results: "{count} results for “{query}”", empty: "Nothing for “{query}”." }} />
```

The words are in the address (`/search?q=oak`), so any search box of the site can send visitors there with a plain form:

```html
<form action="/search"><input type="search" name="q" /></form>
```

Without `types` it searches every type whose items have pages, except vocabularies. `pageSize` (20 by default) splits the results into pages, and `param` renames `q`. A function child draws the results from the state (`SearchState`: `query`, `results` with each one's `title`, `url`, `excerpt`, `type`, `typeLabel` and `item`, `total`, `page`, `pageCount`, `pageHref`).

For your own code, `searchItems` from `brimjs` runs the same matching over items you pass it.

Search needs pages drawn on request (the dev server, the Node server, Brimsites). A static copy shows the box alone.
