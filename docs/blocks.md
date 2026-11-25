---
title: Blocks
section: Build
order: 2
lead: Blocks are richer components. You set their starting content in code and style them in your CSS; the owner changes the content in the side panel.
---

## Props are starting values

```astro
---
import { Button } from "@brimsites/brimjs/components";
---
<Button
  nodeId="hero-cta"
  text="Book a free visit"
  url="/contact"
  variant="accent"
  size="lg"
  showIcon
  icon="arrow-right"
  class="hero__cta"
/>
```

Every prop is a starting value. Once the owner changes a setting, their value is used and the rest keep coming from code. Blocks keep their content, not a look: sizes, shapes and colors are the site's CSS, and Brim's own CSS is the least that makes a block work.

## Included blocks

| Block | What the owner changes |
| --- | --- |
| `Image` | The picture, description, caption, link and focal point |
| `Button` | Words, link, variant, size and icon |
| `Gallery` (`ImageGallery`) | Images the owner adds, orders and describes; a function child draws them in any shape |
| `Carousel` | Slides that move by themselves or on click; slides laid over each other fade |
| `Accordion` | Questions and answers, on the browser's own `<details>` |
| `Video` | A YouTube or Vimeo link, a video file, an HLS stream or an upload, with poster and playback options |
| `Map` | An OpenStreetMap embed of the first location, with every location listed beside it |
| `SocialMedia` | Share links, or links to the site's profiles, with icons |
| `Form`, `Newsletter` | Fields, steps and wording; responses are saved and emailed |
| `Divider` | A line between parts of a page |
| `Icon` | One of Brim's icons, or of an icon pack the site adds |
| `Listing` | Set in code: the items of a content type, with filters, search and pages for visitors |
| `Search` | A search of the whole site; the words are in the address |

Galleries and carousels have [their own page](./galleries-and-carousels.md), as do [forms](./forms.md), [listings and search](./listing-and-search.md). Icons and the icon picker are set up in [Site settings and identity](./site-settings.md).

## Social links

`SocialMedia` shares the page (`mode="share"`) or links to the site's profiles (`mode="profile"`). The owner turns networks on and off, orders them and types the profile links. The code starts them with `profiles`; an email address or phone number becomes a `mailto:` or `tel:` link.

Brim draws a plain row of icons in the text's color. A function child draws anything else, each link with its `network`, `label`, `href`, `icon` (an SVG drawing) and `newTab`:

```astro
---
import type { SocialMediaValue } from "@brimsites/brimjs";
import { SocialMedia } from "@brimsites/brimjs/components";
const profiles = { instagram: "https://instagram.com/acme", email: "hello@acme.com" };
---
<SocialMedia nodeId="footer-social" mode="profile" profiles={profiles}>
  {({ links }: SocialMediaValue) => links.map((link) => (
    <a href={link.href} target={link.newTab ? "_blank" : undefined} rel="noopener" aria-label={link.label}>
      <svg viewBox="0 0 24 24" fill="currentColor" set:html={link.icon} />
    </a>
  ))}
</SocialMedia>
```

## Video

`Video` is the video (YouTube, Vimeo, a file, an HLS stream), its poster and how it plays: `autoplay`, `loop`, `muted`, `controls`. Brim frames it 16:9 at the width it is given. `bare` draws only the player with the attributes the code gives it, for a background video the site styles:

```astro
<Video bare nodeId="hero-video" url="/hero.mp4" autoplay loop controls={false} class="hero__video" />
```

Uploading videos from the editor needs a video host; see [Media](./media.md).

## Free-form content

A content type field of type `blocks` lets the owner compose an item from text, images, galleries, carousels, videos, buttons, accordions, dividers and maps, adding, moving and removing them on the item's page. The template places the stack:

```astro
<Blocks nodeId="project-content" item={project} field="content" />
```

There no code of the site places each block, so the owner does. Every block has a Layout in its side panel: how wide it is (narrow, as the text, wide, full width), to which side when it is narrower than the column, and the space above it. Each is drawn in a `<div class="brim-block" data-width="…" data-align="…">` inside `.brim-blocks`, and the site sets the widths and the rhythm:

```css
.article-body {
  --brim-block-narrow: 28rem;
  --brim-block-content: 44rem; /* the width of the text */
  --brim-block-wide: 68rem;
  --brim-block-gap: 2rem; /* the space between two blocks */
}
```

The rhythm is the only space between blocks. The owner's Space above is a step of it (none, small, normal or large), marked `data-space` on the block. `blocks: ["richtext", "image"]` on the field narrows what it offers, and `blocksOf(item.data.body)` from `@brimsites/brimjs` reads a field's blocks, for a table of contents or a reading time.

The same image, button or video placed by the site's own code has no layout settings: there the code decides.

## JavaScript

Pages ship no JavaScript, except a small script on pages that use a `Carousel`, a `Form` or a `Newsletter`, a `Video` playing an HLS stream, or `Analytics` where statistics are on.

## For agents

The site MCP's `brim_block_schema` returns the settings a block accepts, so an agent can change it with `brim_set_element` without guessing. See [Site MCP](./mcp.md).
