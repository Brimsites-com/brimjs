/**
 * What makes a carousel move, in the site's markup or Brim's: `[data-track]` holds the slides and scrolls;
 * `[data-previous]` and `[data-next]` step; `[data-go]` (or `[data-dot]`) goes to a slide and is marked
 * `data-current` while it shows, as the slide is marked `data-active`. `data-start` is the slide it opens on,
 * `data-autoplay` the time per slide, and `data-variant="continuous"` rolls the track by itself, seamlessly.
 * A track that does not scroll (slides the site's CSS lays one over the other) keeps the slide shown itself, so
 * how one slide gives way to the next (a fade, a zoom) is the site's CSS on `[data-active]`. Autoplay stops under
 * the pointer unless `data-pause-on-hover` is absent, and never plays in the editor, where the owner clicks what
 * they see.
 */

import { inEditor } from "../in-editor.client.ts";

class BrimCarousel extends HTMLElement {
  #track: HTMLElement | null = null;
  #timer: number | undefined;
  /** The slide shown, for a track that does not scroll and so cannot say. */
  #shown = 0;

  connectedCallback(): void {
    this.#track = this.querySelector<HTMLElement>("[data-track]");
    if (!this.#track) return;

    if (this.dataset.variant === "continuous") {
      // A copy of the slides follows them, so the strip rolls round without a seam. It is only seen, never read.
      for (const slide of [...this.#track.children]) {
        const copy = slide.cloneNode(true) as HTMLElement;
        copy.setAttribute("aria-hidden", "true");
        copy.setAttribute("inert", "");
        this.#track.append(copy);
      }
      return;
    }

    this.querySelector("[data-previous]")?.addEventListener("click", () => this.#step(-1));
    this.querySelector("[data-next]")?.addEventListener("click", () => this.#step(1));
    for (const button of this.querySelectorAll<HTMLElement>("[data-go], [data-dot]")) {
      button.addEventListener("click", () => this.#goTo(Number(button.dataset.go ?? button.dataset.dot), "smooth"));
    }
    // Marked when the scroll comes to rest, so a smooth scroll to a slide does not mark the ones it passes.
    let settle: number | undefined;
    this.#track.addEventListener(
      "scroll",
      () => {
        window.clearTimeout(settle);
        settle = window.setTimeout(() => this.#markCurrent(), 80);
      },
      { passive: true },
    );
    const start = Number(this.dataset.start);
    if (start > 0) this.#goTo(start, "instant");
    this.#markCurrent();

    const interval = Number(this.dataset.autoplay);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (interval > 0 && !reducedMotion && !inEditor()) {
      this.#play(interval);
      if (this.dataset.pauseOnHover !== undefined) {
        this.addEventListener("pointerenter", () => this.#pause());
        this.addEventListener("pointerleave", () => this.#play(interval));
      }
      this.addEventListener("focusin", () => this.#pause());
      this.addEventListener("focusout", () => this.#play(interval));
    }
  }

  disconnectedCallback(): void {
    this.#pause();
  }

  /** Whether the slides sit side by side and the track scrolls, rather than lie where the site's CSS puts them. */
  get #scrolls(): boolean {
    const track = this.#track;
    if (!track) return false;
    // Slides the site lays one over the other in a track that does not scroll (a fading hero) are wider than it
    // only when a picture's own width widens their cell: that is not a track to scroll.
    if (["hidden", "clip", "visible"].includes(getComputedStyle(track).overflowX)) return false;
    return track.scrollWidth > track.clientWidth + 1;
  }

  get #slides(): HTMLElement[] {
    return [...(this.#track?.children ?? [])] as HTMLElement[];
  }

  /** Where the track scrolls to show a slide: at its start, or in its middle for a carousel that peeks. */
  #leftOf(slide: HTMLElement): number {
    const track = this.#track as HTMLElement;
    const left = slide.offsetLeft - track.offsetLeft;
    return this.dataset.variant === "center-peek" ? left - (track.clientWidth - slide.clientWidth) / 2 : left;
  }

  /** The slide nearest where the track has scrolled to. */
  get #current(): number {
    const track = this.#track;
    if (!track) return 0;
    if (!this.#scrolls) return this.#shown;
    const distances = this.#slides.map((slide) => Math.abs(this.#leftOf(slide) - track.scrollLeft));
    return distances.indexOf(Math.min(...distances));
  }

  #goTo(index: number, behavior: ScrollBehavior): void {
    const slide = this.#slides[index];
    if (!this.#track || !slide) return;
    if (this.#scrolls) this.#track.scrollTo({ left: this.#leftOf(slide), behavior });
    // The slide asked for is marked at once; the scroll that follows confirms it.
    this.#markCurrent(index);
  }

  #step(direction: 1 | -1): void {
    const last = this.#slides.length - 1;
    const next = this.#current + direction;
    const loops = this.dataset.loop !== undefined;
    const track = this.#track;
    const atEnd = track && this.#scrolls ? track.scrollLeft + track.clientWidth >= track.scrollWidth - 1 : false;
    if (direction === 1 && (next > last || atEnd)) return loops ? this.#goTo(0, "smooth") : undefined;
    if (next < 0) return loops ? this.#goTo(last, "smooth") : undefined;
    this.#goTo(next, "smooth");
  }

  #markCurrent(current = this.#current): void {
    this.#shown = current;
    this.#slides.forEach((slide, index) => slide.toggleAttribute("data-active", index === current));
    for (const button of this.querySelectorAll<HTMLElement>("[data-go], [data-dot]")) {
      const shows = Number(button.dataset.go ?? button.dataset.dot) === current;
      button.toggleAttribute("data-current", shows);
      if (shows) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
      if (shows) this.#reveal(button);
    }
  }

  /** Keeps the current thumbnail in sight when the thumbnails scroll sideways themselves. */
  #reveal(button: HTMLElement): void {
    const strip = button.parentElement;
    if (!strip || strip === this.#track || strip.scrollWidth <= strip.clientWidth) return;
    const left = button.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollTo({ left, behavior: "smooth" });
    else if (left + button.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: left + button.offsetWidth - strip.clientWidth, behavior: "smooth" });
    }
  }

  #play(interval: number): void {
    this.#pause();
    this.#timer = window.setInterval(() => this.#step(1), interval);
  }

  #pause(): void {
    window.clearInterval(this.#timer);
  }
}

if (!customElements.get("brim-carousel")) customElements.define("brim-carousel", BrimCarousel);
