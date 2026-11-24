/**
 * A gallery's pictures over the whole screen, as a slideshow: buttons, keys (arrows, Home, End; Escape closes) and a
 * swipe go from one to the next. A gallery marks itself `data-lightbox-gallery` and its pictures `data-lightbox`
 * (`image.img` carries it, in the site's markup too); the slides are built from those <img>s when one is opened, so
 * the gallery's markup stays the site's. A picture inside a link or a button keeps doing what that does. Nothing opens
 * in the editor, where a click selects.
 */
import { inEditor } from "../in-editor.client.ts";

const GALLERY = "[data-lightbox-gallery]";
const PICTURE = "img[data-lightbox]";

const ICONS = {
  close: "M6 6l12 12M18 6L6 18",
  previous: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
};

const opens = (picture: Element): boolean => picture.closest("a[href], button") === null;

/** A gallery's pictures in order, each once: a thumbnail of one shown larger is the same picture. */
function picturesOf(gallery: Element): HTMLImageElement[] {
  const pictures = new Map<string, HTMLImageElement>();
  for (const picture of gallery.querySelectorAll<HTMLImageElement>(PICTURE)) {
    const position = picture.dataset.lightbox ?? "";
    if (opens(picture) && !pictures.has(position)) pictures.set(position, picture);
  }
  return [...pictures.values()];
}

function button(name: keyof typeof ICONS, label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `brim-lightbox__button brim-lightbox__${name}`;
  element.setAttribute("aria-label", label);
  element.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  return element;
}

function slideOf(picture: HTMLImageElement, shown: boolean): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "brim-lightbox__slide";
  const image = document.createElement("img");
  image.className = "brim-lightbox__image";
  image.alt = picture.alt;
  image.decoding = "async";
  // Before the address: a picture far from the one opened is downloaded only as the slideshow nears it.
  image.loading = shown ? "eager" : "lazy";
  image.sizes = "100vw";
  if (picture.srcset) image.srcset = picture.srcset;
  image.src = picture.src;
  figure.append(image);
  const caption = picture.dataset.caption;
  if (caption) {
    const text = document.createElement("figcaption");
    text.className = "brim-lightbox__caption";
    text.textContent = caption;
    figure.append(text);
  }
  return figure;
}

function open(gallery: HTMLElement, opened: HTMLImageElement): void {
  const pictures = picturesOf(gallery);
  const start = Math.max(
    0,
    pictures.findIndex((picture) => picture.dataset.lightbox === opened.dataset.lightbox),
  );
  const { lightboxLabel = "", lightboxClose = "", lightboxPrevious = "", lightboxNext = "" } = gallery.dataset;

  const dialog = document.createElement("dialog");
  dialog.className = "brim-lightbox";
  dialog.setAttribute("aria-label", lightboxLabel);
  const track = document.createElement("div");
  track.className = "brim-lightbox__track";
  const slides = pictures.map((picture, index) => slideOf(picture, index === start));
  track.append(...slides);
  const count = document.createElement("p");
  count.className = "brim-lightbox__count";
  count.setAttribute("aria-live", "polite");
  const previous = button("previous", lightboxPrevious);
  const next = button("next", lightboxNext);
  const close = button("close", lightboxClose);
  dialog.append(track, close);
  if (slides.length > 1) dialog.append(count, previous, next);

  let shown = start;
  const mark = (index: number): void => {
    shown = index;
    count.textContent = `${index + 1} / ${slides.length}`;
  };
  const goTo = (index: number, behavior: ScrollBehavior): void => {
    track.scrollTo({ left: slides[index]?.offsetLeft ?? 0, behavior });
    mark(index);
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const step = (by: 1 | -1): void => {
    const index = (shown + by + slides.length) % slides.length;
    // Round from the last picture to the first at once, not back past every one in between.
    const jumps = Math.abs(index - shown) > 1 || still.matches;
    goTo(index, jumps ? "instant" : "smooth");
  };
  const rightToLeft = getComputedStyle(gallery).direction === "rtl";

  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  close.addEventListener("click", () => dialog.close());
  // The room around a picture closes it.
  track.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLImageElement)) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") step(rightToLeft ? 1 : -1);
    else if (event.key === "ArrowRight") step(rightToLeft ? -1 : 1);
    else if (event.key === "Home") goTo(0, "instant");
    else if (event.key === "End") goTo(slides.length - 1, "instant");
    else return;
    event.preventDefault();
  });

  // A swipe is the track's own scrolling: which picture shows is read once it comes to rest.
  let settle: number | undefined;
  track.addEventListener(
    "scroll",
    () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        // The track scrolls the other way, below zero, on a page read from right to left.
        if (track.clientWidth > 0) mark(Math.round(Math.abs(track.scrollLeft) / track.clientWidth));
      }, 120);
    },
    { passive: true },
  );
  const onResize = (): void => goTo(shown, "instant");
  window.addEventListener("resize", onResize);

  dialog.addEventListener("close", () => {
    window.clearTimeout(settle);
    window.removeEventListener("resize", onResize);
    dialog.remove();
    opened.focus({ preventScroll: true });
  });

  document.body.append(dialog);
  dialog.showModal();
  goTo(start, "instant");
}

/** Opens the picture clicked or pressed; false when it is not one that opens. */
function openFrom(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLImageElement) || !target.matches(PICTURE) || !opens(target)) return false;
  const gallery = target.closest<HTMLElement>(GALLERY);
  if (!gallery) return false;
  open(gallery, target);
  return true;
}

/** The pictures are reached with Tab and said to be buttons, only where the script that opens them runs. */
function prepare(): void {
  for (const picture of document.querySelectorAll<HTMLImageElement>(`${GALLERY} ${PICTURE}`)) {
    if (!opens(picture) || picture.getAttribute("role") === "button") continue;
    picture.tabIndex = 0;
    picture.setAttribute("role", "button");
    picture.setAttribute("aria-haspopup", "dialog");
  }
}

if (!inEditor()) {
  prepare();
  // A site with Astro's client router draws its next page without loading this again.
  document.addEventListener("astro:page-load", prepare);
  document.addEventListener("click", (event) => {
    openFrom(event.target);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && openFrom(event.target)) event.preventDefault();
  });
}
