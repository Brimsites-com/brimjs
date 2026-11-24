---
title: Vocabularies
section: Content
order: 2
lead: Lists the owner keeps, such as categories, brands or rooms, that other items point at.
---

## Declare a vocabulary

A vocabulary is a content type whose items are its terms, so the owner adds, renames and pictures them in Content like any item, and the code never holds the list. Other types point at its terms with a reference field, which keeps the term's slug.

```ts
// src/content-types/index.ts
import { defineContentType, defineVocabulary } from "brimjs";
import ProductPage from "./ProductPage.astro";

export const category = defineVocabulary({
  key: "category",
  label: "Categories",
  singular: "Category",
  slug: "categories",
  ordered: true,
  fields: [
    { name: "description", label: "Description", type: "textarea" },
    { name: "image", label: "Image", type: "image" },
  ],
});

export const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "products",
  path: "/products/[category]/[slug]",
  component: ProductPage,
  fields: [
    { name: "category", label: "Category", vocabulary: "category", required: true },
    { name: "brands", label: "Brands", vocabulary: "brand", multiple: true },
  ],
});

export const contentTypes = [category, product];
```

`defineVocabulary` is `defineContentType` without the default `author` and `tags` fields. A field with `vocabulary` is a `reference` field; `type: "reference", to: "…"` points at any type.

## How references behave

- Wherever an item's fields are edited, the field offers the vocabulary's terms as you type, whatever the case and accents: one, or several as chips with `multiple`. When no term matches, Add "…" to Categories creates the term and picks it.
- Saving an item that names a term that does not exist is refused.
- A term that changes its address takes the items that point at it along, and their old addresses redirect.
- A term items still point at cannot be deleted until they point elsewhere.
- A single reference can be part of a `path`. `Listing` takes references as `facets` and finds items by their terms' titles when searching; `filter={{ category: "ceramics" }}` lists one term's items.

In code, `getReferences("product", product, "category")` from `brimjs/content` reads the terms an item points at, in the page's language, and `getItems("category")` lists them all, for a menu of categories. `getTerms("category")` gives the terms by slug, for labels.

## Pages for the terms

A vocabulary has no pages until it is given a `component` (and usually a `path`). Materials or colors can stay a plain list; product categories usually want a page:

```ts
import CategoryPage from "./CategoryPage.astro";

export const category = defineVocabulary({
  key: "category",
  label: "Categories",
  singular: "Category",
  slug: "categories",
  path: "/products/[slug]", // next to the products, at /products/[category]/[slug]
  component: CategoryPage,
  fields: [
    { name: "description", label: "Description", type: "richtext" },
    { name: "image", label: "Image", type: "image" },
  ],
});
```

```astro
---
// src/content-types/CategoryPage.astro
import type { ItemPageProps } from "brimjs";
import { Listing } from "brimjs/components";
import type { category } from "./index.ts";
const { item } = Astro.props as ItemPageProps<typeof category>;
---
<h1>{item.title}</h1>
<Listing nodeId="category-products" type="product" filter={{ category: item.slug }} />
```

Brim draws the term pages itself: no `src/pages/products/[category].astro` and no `getStaticPaths`. A term added in the editor has its page at once, the sitemap lists it, and in the editor's site map the products hang under their category. `brim check` warns about a page in `src/pages` that draws a vocabulary's terms by hand.

## Menus

`from: "category"` on a navbar link fills its sub-links with the terms, in the owner's order. See [Navigation](./navigation.md).

## Languages

A term is translated like any item, and its translations keep its slug, so references keep working across languages. A term not translated yet shows in its original language. See [Languages](./languages.md).
