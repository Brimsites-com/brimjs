---
title: Components and nodeId
section: Build
order: 1
lead: Brim components make one piece of a page editable. The nodeId is the contract between your code and the owner's content.
---

## A first example

```astro
---
// src/components/Hero.astro
import { Text, Image, Link } from "@brimsites/brimjs/components";
---

<Text nodeId="hero-title" as="h1">
  Websites your clients can edit
</Text>
<Image nodeId="hero-image" src="/hero.jpg" alt="The studio at work" />
<Link nodeId="hero-cta" href="/about">Meet the studio</Link>
```

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import brim from "@brimsites/brimjs";

export default defineConfig({ integrations: [brim()] });
```

What you write is the starting content. Once the owner changes an element, their value is drawn instead.

## The basic components

All of them come from `@brimsites/brimjs/components`.

| Component | What the owner can change |
| --- | --- |
| `Text` | One element of text: words, line breaks, bold, italic, links, colors; the element (`as`) |
| `RichText` | Flowing content: paragraphs, headings and lists |
| `Link` | The label and the address, picked from the site's pages and items or typed |
| `Image` | The picture, its description, caption, link and focal point; `bare` draws only the `<img>` |
| `Field` | An item's picked value: a date, number, choice, switch, link or email |
| `Setting` | One of the site's settings, edited in Site Settings |
| `Navbar`, `Footer` | The logo, name and links; you render the markup ([Navigation](./navigation.md)) |
| `MobileMenu` | Nothing: a menu that opens over the page on phones ([Menu on phones](./navigation.md#menu-on-phones)) |
| `Seo` | Title, description, share image and the rest of Page Settings ([SEO, pages and feeds](./seo-and-pages.md)) |
| `Analytics` | Nothing: visitor statistics, once the visitor accepts ([Visitor statistics](./seo-and-pages.md#visitor-statistics)) |
| `Shared` | Makes everything inside it site-wide |
| `Blocks` | An item's free-form `blocks` field |

The richer components (buttons, galleries, forms, videos, listings) are on [Blocks](./blocks.md).

## Rules for node ids

- Every visible text, image, link and button gets a `nodeId`, unique on its page.
- Keep ids stable. Saved content is stored under the id; renaming one makes that element start over from the code. `npx brim content` shows what would be lost.
- Name the element, not its position: `hero-title`, not `text-3`. `brim check` warns about positional ids.
- A section used more than once takes an `id` prop and prefixes its node ids with it, so each copy keeps its own edits.

```astro
---
// src/components/Feature.astro
import { Text } from "@brimsites/brimjs/components";
const { id, title } = Astro.props;
---
<Text nodeId={`${id}-title`} as="h2">{title}</Text>
```

`brim check` reports a `nodeId` used twice on one page, following the local components the page draws. It checks ids built from a prop when every use passes the prop as a literal (`<Feature id="home-feature" />`).

## What a Text may hold

What you write inside `<Text>` is its starting content, and the owner's first edit saves it as inline formatting: words, line breaks, bold, italic, underline, strikethrough, sub- and superscript, colors and links. In markup that is `<br>`, `<strong>` or `<b>`, `<em>` or `<i>`, `<u>`, `<s>`, `<sub>`, `<sup>`, `<span style="color:…">` and `<a href>`, with no other attributes.

```astro
<Text nodeId="cta-title" as="h2">A space of your own.<br />From the <strong>first</strong> step</Text>
```

Anything else would be lost on that first edit, so Brim refuses it while you can still change the code:

- another Brim element inside a Text (`<Text><Link … /></Text>`),
- paragraphs, lists and other block elements, pictures and icons,
- a class or another attribute on an inline element.

In `astro dev` the page stops with an error naming the `nodeId`. On the live site the page shows as before, but the editor will not let anyone type into that element. Use `RichText` for paragraphs and lists, move the other element out, or split the text into several Texts, each with its own `nodeId`.

Style inline markup inside a Text with global CSS (or `:global()`): what the owner saves is drawn without your component's scoped-style attributes.

## Page and site scope

By default a saved value belongs to its page. Pass `scope="site"` for an element shared by every page, such as a line in the footer, and one edit changes it everywhere.

A section shown on several pages with the same content, like a FAQ or a call to action, goes inside `<Shared>`. Everything in it is saved once for the site, and in the editor its elements say "Shared across the site".

```astro
---
import { Shared } from "@brimsites/brimjs/components";
import Faq from "../components/Faq.astro";
---
<Shared>
  <Faq />
</Shared>
```

It is `scope="site"` for every element inside; an element that names its own `scope` keeps it. A section that prefixes its ids with an `id` prop gets one shared copy per `id`. `Navbar` and `Footer` are always site-wide.

## Elements bound to an item

On an item's page, `Text`, `RichText`, `Image`, `Field`, `Gallery`, `Carousel` and `Blocks` take `item` and `field`. The element shows that field, and editing it on the page saves the item itself. Its toolbar names the field it shows (`Project · Summary`), and what is typed there shows at once in Page Settings.

```astro
<Text nodeId="project-title" as="h1" item={project} field="title">{project.title}</Text>
<Field nodeId="project-year" item={project} field="year" />
```

`Field` writes a date or a number in the item's language, a choice as its label, a set switch as the field's label, and a link or an email as a link. A function child writes the value its own way:

```astro
<Field nodeId="project-status" item={project} field="status" as="p">
  {(status, text) => (status ? `Status: ${text}` : "")}
</Field>
```

See [Content types](./content-types.md) for templates and item pages.

## Links

Every link the owner edits (a button's, the navbar's, a `Link`, an item's `url` field, a link in rich text) is picked the same way. Browse opens a picker with the site's pages and the pages of its items, with a search and the private ones marked, and for each a part of the page to open at: any section or heading the page's code gives an `id`. The owner can also type a website, an email address or a phone number.
