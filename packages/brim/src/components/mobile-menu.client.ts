/**
 * What the browser's popover does not do by itself for a `MobileMenu`: it closes once one of its links is followed
 * (a link to a part of the same page would leave it open over that part), and when the screen grows wide enough
 * for the site to hide its button, which would leave the page unable to scroll with nothing to close.
 */

const OPEN = ".brim-mobile-menu__panel:popover-open";

if ("popover" in HTMLElement.prototype) {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
    event.target.closest<HTMLElement>(OPEN)?.hidePopover();
  });

  window.addEventListener("resize", () => {
    for (const panel of document.querySelectorAll<HTMLElement>(OPEN)) {
      const toggle = panel.parentElement?.querySelector(".brim-mobile-menu__toggle");
      if (toggle?.getClientRects().length === 0) panel.hidePopover();
    }
  });
}
