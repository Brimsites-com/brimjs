---
title: Content types
section: Content
order: 1
lead: Repeatable content, such as articles, projects or products, is declared in code and filled in by the owner.
---

## Declare a type

```ts
// src/content-types/index.ts
import { defineContentType } from "brimjs";
import ProjectPage from "./ProjectPage.astro";

export const project = defineContentType({
  key: "project",
  label: "Projects",
  singular: "Project",
  slug: "projects",
  component: ProjectPage, // the template of every project's page: /projects/<address>
  feed: true, // an RSS feed at /rss/projects.xml
  fields: [
    { name: "summary", label: "Summary", type: "textarea", required: true },
    { name: "year", label: "Year", type: "number" },
    { name: "cover", label: "Cover image", type: "image" },
    { name: "content", label: "Content", type: "blocks" },
  ],
});

export const contentTypes = [project];
```

Brim loads this file itself, so a new type or field shows up in the editor and on the pages as soon as you save it. The owner adds and edits items under Content in the editor. Each item is `private` (a new one, until it is published) or `published`.

Every item also has a title and an address. A new item whose title another item has gets a number in its address (`lake-house-2`). Items come newest first, unless the type is `ordered` (below).

## Author and tags

- Brim adds a text field `author` after the declared ones. The item's page gives it to search engines as `<meta name="author">`. `author: false` leaves it out, for items nobody signs; a field named `author` in `fields` takes its place.
- Brim adds a `tags` field after the author, edited as chips that offer the tags the type's other items already have. `Listing` filters on them (`filter={{ tags: "garden" }}`). `tags: false` leaves them out; a field named `tags` takes their place, for example with fixed `options`.

## Field types

| Type | Shown in the form as |
| --- | --- |
| `text`, `email`, `url` | A one-line input |
| `textarea` | A few lines of plain text |
| `richtext` | Paragraphs, headings and lists |
| `blocks` | A stack of text, images, galleries, videos, buttons and more ([Blocks](./blocks.md)) |
| `number`, `date`, `boolean` | A number, a calendar, a switch |
| `select` | A choice from `options`, plain or `{ value, label }` |
| `image`, `gallery` | One image, or several |
| `tags` | Short words, edited as chips |
| `keyvalue` | Rows of label and value, like a spec sheet or opening hours |
| `reference` | Items of another type, picked or added as you type ([Vocabularies](./vocabularies.md)) |

The body of an item with a page (an article, a project, a service) is a `blocks` field, so the owner can add images, galleries and buttons between paragraphs. `richtext` is for text that should stay text, like a summary or a bio; mark it `// text only` so `brim check` does not suggest blocks for it. A field changed from `richtext` to `blocks` keeps what was written.

A `select` choice can carry a label: the item saves the value, the editor and pages show the label. `choiceLabel("product", "category", item.data.category)` from `brimjs/content` gives it on a page. A `keyvalue` field is a list of `{ label, value }` rows:

```astro
<dl>{(item.data.specs ?? []).map((row) => <><dt>{row.label}</dt><dd>{row.value}</dd></>)}</dl>
```

## The type's template

The `component` draws the page of every item and receives it as `item`. Elements given `item` and `field` show one of its fields and save into it when edited on the page (see [Components and nodeId](./components.md)).

```astro
---
// src/content-types/ProjectPage.astro
import type { ItemPageProps } from "brimjs";
import { Blocks, Field, Text } from "brimjs/components";
import Site from "../layouts/Site.astro";

const { item: project } = Astro.props as ItemPageProps;
---
<Site title={project.title}>
  <Text nodeId="project-title" item={project} field="title" as="h1">{project.title}</Text>
  <Field nodeId="project-year" item={project} field="year" />
  <Blocks nodeId="project-content" item={project} field="content" />
</Site>
```

The owner edits an item's page in one of two modes:

- The item (`/admin/edit/projects/lake-house`): the elements that show its fields are typed in place, and Page Settings holds its title, address and every field. The rest of the page is locked.
- The template (Edit template in the toolbar): everything on the page that is not one of the item's fields, and how the fields look. A change is saved once for the type and shows on the page of every item. Only owners can change templates.

A type without `component` has no page per item. A page written in `src/pages` wins over the template at its address.

## Addresses

An item's page is at `/<slug>/<address>` unless the type gives a `path`: fixed segments, `[slug]` for the item's address, and `[field]` for the value of a required `select`, `text` or reference field.

```ts
export const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "products",
  path: "/shop/[category]/[slug]", // /shop/lamps/arc-lamp
  component: ProductPage,
  fields: [{ name: "category", label: "Category", type: "select", options: ["lamps", "chairs"], required: true }],
});
```

The template, `item.url`, the sitemap, feeds and links picked in the editor all use this address. When a published item's address changes (a new slug, a new category), the old address redirects to the new one (301).

## Ordered types

Items come newest first. `ordered: true` lets the owner drag them into order in the editor's Content: the categories of a menu, a team, the steps of a process. `Listing`, `getItems` and menus built from the type then follow that order, unless the code sorts them otherwise. Over MCP it is `brim_reorder_items`. Do not add an "Order" number field for it; `brim check` warns about one.

## Reading items in code

```astro
---
import { getItem, getItems } from "brimjs/content";
import { project } from "../content-types/index.ts";

const projects = await getItems(project); // typed by the declaration
const lakeHouse = await getItem(project, "lake-house");
---
```

`defineContentType`, `defineVocabulary` and `defineSiteSettings` keep the types of their fields, so a misspelt field fails the build instead of showing nothing. Required fields are always there; the others may be missing. In a type's own template, import it with `import type` to avoid an import cycle, and use `ItemPageProps<typeof project>`. `getItems("project")` by key still works, with an open record as `data`.

To show items on a page, prefer a [`Listing`](./listing-and-search.md) over `getItems(…).map(…)`: in the editor, a listing adds new items with its filter filled in.

## For agents

`brim_list_items`, `brim_create_item`, `brim_update_item` and `brim_delete_item` work on items with the same checks as the editor. `brim_list_items` filters by `tag` and `locale`. Starting items can live in git as a seed; see [Starting content](./seed.md).
