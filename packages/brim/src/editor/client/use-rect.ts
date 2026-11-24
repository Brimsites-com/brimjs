import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(element: HTMLElement): Rect {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

/**
 * Position of an element inside the page frame, kept current while the page scrolls,
 * resizes or changes. The frame is not scaled, so these are also overlay coordinates.
 */
export function useRect(element: HTMLElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!element?.isConnected) return setRect(null);
    const view = element.ownerDocument.defaultView;
    if (!view) return setRect(null);

    const update = (): void => setRect(element.isConnected ? measure(element) : null);
    update();

    const resizes = new view.ResizeObserver(update);
    resizes.observe(element);
    resizes.observe(element.ownerDocument.documentElement);
    const mutations = new view.MutationObserver(update);
    mutations.observe(element.ownerDocument.body, { childList: true, subtree: true, characterData: true });
    // Drawn in the same frame as the scroll, not at React's next turn, so the toolbar keeps up with the page.
    const scrolled = (): void => flushSync(update);
    view.addEventListener("scroll", scrolled, { passive: true });
    view.addEventListener("resize", update);

    return () => {
      resizes.disconnect();
      mutations.disconnect();
      view.removeEventListener("scroll", scrolled);
      view.removeEventListener("resize", update);
    };
  }, [element]);

  return rect;
}
