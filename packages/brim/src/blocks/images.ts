import { focusStyle, readFocus } from "../content/image-focus.ts";
import type { ImageFocus } from "../content/types.ts";
import type { ImageSources } from "../runtime/media.ts";
/**
 * The images of a `Gallery` or a `Carousel`: what the owner adds, orders and describes in the side panel. The
 * primitive keeps them and the sizes visitors download; how they are laid out is the site's markup.
 */
export interface ShownImage {
  src: string;
  alt: string;
  caption?: string;
  link?: string;
  /** The part that stays in sight where the site crops the picture; absent while it is the middle. */
  focus?: ImageFocus;
  /**
   * Everything an `<img>` needs, a `srcset` included when the site's media can be resized and its `width` and
   * `height` when the media library measured it, and the `style` that anchors it at its focus when it has one:
   * `<img {...image.img} />`.
   * In a `Gallery` whose pictures open over the whole screen, also what makes this one open (`data-lightbox`).
   */
  img: ImageSources & {
    alt: string;
    style?: string;
    "data-lightbox"?: number;
    "data-caption"?: string | undefined;
  };
}

/** What a `Gallery`'s function gets: `{({ images }) => …}`. */
export interface GalleryValue {
  images: ShownImage[];
}

/** What a `Carousel`'s function gets: `{({ slides }) => …}`. */
export interface CarouselValue {
  slides: ShownImage[];
}

/** An image as the code starts it: `src` (or `url`, as BrimCMS named it), with an optional caption and link. */
export interface StartingImage {
  src?: string;
  url?: string;
  alt?: string;
  caption?: string;
  link?: string;
  focus?: ImageFocus;
}

const SAFE_LINK = /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i;

/**
 * Reads a list of images, whichever way it was saved: `{ url }` by the side panel, `{ src }` by an item's gallery
 * field and the code; `title` was a gallery image's caption before. Entries without an address are left out.
 * `sources` gives an image's `<img>` attributes: `imageSources` with the sizes it is drawn at.
 */
export function readImages(value: unknown, sources: (src: string) => ImageSources): ShownImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ShownImage[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const image = entry as Record<string, unknown>;
    const src = typeof image.src === "string" ? image.src : typeof image.url === "string" ? image.url : "";
    if (src === "") return [];
    const alt = typeof image.alt === "string" ? image.alt : "";
    const caption = [image.caption, image.title].find(
      (text): text is string => typeof text === "string" && text !== "",
    );
    const link = typeof image.link === "string" && SAFE_LINK.test(image.link) ? image.link : undefined;
    const focus = readFocus(image.focus);
    const style = focusStyle(focus);
    return [
      {
        src,
        alt,
        ...(caption && { caption }),
        ...(link && { link }),
        ...(focus && { focus }),
        img: { ...sources(src), alt, ...(style && { style }) },
      },
    ];
  });
}

/** Starting images from the code, in the shape the side panel saves (`url`), so the owner edits the same list. */
export function toSaved(images: StartingImage[] | undefined): Record<string, unknown>[] | undefined {
  return images?.map(({ src, url, ...rest }) => ({ ...rest, url: src ?? url ?? "" }));
}
