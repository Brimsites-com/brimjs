---
title: Galleries and carousels
section: Build
order: 3
lead: Gallery and Carousel keep a list of images the owner manages. Your markup and CSS decide what they look like.
---

## What they do

`Gallery` (also exported as `ImageGallery`) and `Carousel` keep a list of images the owner adds, drags into order and describes in the side panel: address, description, caption and link. They take care of what the site should not have to: the sizes visitors download (a `srcset`, see [Media](./media.md)), editing, and for a carousel the script that moves it.

Their look is the site's. Give them a function child and draw any shape. Each image comes with `img`, the attributes of its `<img>`.

## A gallery in your own markup

```astro
---
import type { GalleryValue } from "@brimsites/brimjs";
import { Gallery } from "@brimsites/brimjs/components";
const photos = [
  { src: "/images/work-1.jpg", alt: "A kitchen in oak" },
  { src: "/images/work-2.jpg", alt: "A tiled bathroom" },
];
---
<!-- A masonry wall: the gallery gives the images, the site's CSS the columns -->
<Gallery nodeId="projects" images={photos} class="masonry" sizes="(max-width: 600px) 100vw, 33vw">
  {({ images }: GalleryValue) => images.map((image) => <img {...image.img} loading="lazy" />)}
</Gallery>
```

Without a function, Brim draws a plain grid of `columns` with a `gap`.

## Pictures that open full screen

A click on a gallery's picture opens it over the whole screen, as a slideshow of the gallery. Buttons, the arrow keys and a swipe go from one picture to the next; Escape, the button or a click beside the picture closes it. It works in your own markup too, because `image.img` carries what makes a picture open.

```astro
<Gallery
  nodeId="projects"
  images={photos}
  labels={{ gallery: "Galerie", close: "Închide", previous: "Imaginea anterioară", next: "Imaginea următoare" }}
/>
```

| Prop | What it does |
| --- | --- |
| `lightbox={false}` | Leaves it out; the owner can also switch **Open full screen** off in the side panel |
| `labels` | What its buttons are called for a screen reader, in the page's language |

A picture with a link, or one your markup puts in a link or a button, keeps doing what that does. Style it through `.brim-lightbox` (with `--brim-lightbox-background` and `--brim-lightbox-color`), `.brim-lightbox__button`, `.brim-lightbox__caption` and `.brim-lightbox__count`.

## A carousel in your own markup

```astro
---
import type { CarouselValue } from "@brimsites/brimjs";
import { Carousel } from "@brimsites/brimjs/components";
const { product } = Astro.props;
---
<!-- A product's photos with thumbnails, from its gallery field, edited on the page -->
<Carousel nodeId="product-photos" item={product} field="gallery" sizes="(max-width: 860px) 100vw, 50vw">
  {({ slides }: CarouselValue) => <>
    <div class="photos" data-track>{slides.map((slide) => <img {...slide.img} />)}</div>
    <div class="thumbs">{slides.map((slide, index) => (
      <button type="button" data-go={index}><img {...slide.img} sizes="120px" alt="" /></button>
    ))}</div>
    <button type="button" data-previous aria-label="Previous">‹</button>
    <button type="button" data-next aria-label="Next">›</button>
  </>}
</Carousel>
```

The carousel's script works with what the markup marks:

| Attribute | What it does |
| --- | --- |
| `data-track` | Holds the slides and scrolls sideways |
| `data-previous`, `data-next` | Step back and forward |
| `data-go="2"` | Goes to a slide; marked `data-current` while that slide shows |
| `data-active` | Set by the script on the slide that shows |

And the props that set how it moves:

| Prop | What it does |
| --- | --- |
| `start={2}` | Opens on the second slide (and is the slide shown in the editor) |
| `autoplay`, `autoplaySpeed` | Moves by itself, pausing under the pointer |
| `pauseOnHover={false}` | Keeps autoplay going under the pointer, for a backdrop |
| `loop` | Goes round |
| `variant="center-peek"` | Centers a slide between its neighbors |
| `variant="continuous"` | Rolls the strip by itself, for logos at their own widths (`--brim-carousel-height` sets their height) |

In the editor a carousel never plays by itself, so the slide the owner sees is the one they click.

Without a function, Brim draws a slider (`slidesPerView`, `gap`, `showArrows`, `showDots`); a carousel that peeks takes its middle slide's width from `--brim-carousel-peek`.

## A hero whose pictures fade

Slides your CSS lays one over the other work too: the track does not scroll, the script still marks the shown slide `data-active` in turn, and your CSS draws the change. A hero whose pictures change is one carousel the owner orders in the side panel, never several `Image`s stacked and animated by hand.

```astro
<Carousel nodeId="hero-slides" images={heroes} autoplay autoplaySpeed={5000} pauseOnHover={false} sizes="100vw">
  {({ slides }) => (
    <div class="hero__slides" data-track>{slides.map((slide) => <img {...slide.img} class="hero__slide" />)}</div>
  )}
</Carousel>

<style>
  .hero__slides { display: grid; }
  .hero__slide { grid-area: 1 / 1; opacity: 0; transition: opacity 0s 1.5s; }
  .hero__slide[data-active] { z-index: 1; opacity: 1; transition: opacity 1.5s; }
  .hero__slides:not(:has([data-active])) > :first-child { opacity: 1; } /* before the script runs */
</style>
```

## Bound to an item

With `item` and `field`, either shows an item's `gallery` field, and what the owner changes in the side panel is saved into the item. The side panel of a gallery or carousel the site draws offers the images and how it moves, not the layout.
