import type { KeyboardEvent, PointerEvent } from "react";

/** The narrowest and widest the side panel can be dragged to; the page always keeps `PAGE_ROOM` beside it. */
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 800;
const PAGE_ROOM = 360;
/** The narrowest the page preview can be dragged to: a small phone. */
const FRAME_MIN = 320;
/** One press of an arrow key on a handle. */
const KEY_STEP = 16;
const SIDEBAR_KEY = "brim-editor-sidebar-width";

/** The side panel's width the owner chose last time, in this browser; `null` for the editor's own. */
export function storedSidebarWidth(): number | null {
  try {
    const width = Number(localStorage.getItem(SIDEBAR_KEY));
    return Number.isFinite(width) && width >= SIDEBAR_MIN ? width : null;
  } catch {
    return null;
  }
}

function storeSidebarWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(SIDEBAR_KEY);
    else localStorage.setItem(SIDEBAR_KEY, String(Math.round(width)));
  } catch {
    // Without storage the width lasts until the editor is closed.
  }
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Follows the pointer from a press on a handle until it is let go, telling how far it moved. The page in the frame
 * would take the pointer as it passes over it: while dragging, frames ignore it (`data-brim-resizing`).
 */
function drag(event: PointerEvent<HTMLElement>, onMove: (dx: number) => void, onEnd?: () => void): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  const startX = event.clientX;
  const root = document.documentElement;
  handle.setPointerCapture(event.pointerId);
  root.dataset.brimResizing = "";
  const move = (moved: globalThis.PointerEvent): void => onMove(moved.clientX - startX);
  const end = (): void => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    delete root.dataset.brimResizing;
    onEnd?.();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

/**
 * The edge between the page and the side panel: dragged, it makes the panel wider or narrower, and the width is
 * kept in this browser for next time. A double click, or Home, gives the panel its own width back.
 */
export function SidebarHandle({
  workspace,
  width,
  onWidth,
}: {
  /** The page and the panel side by side; the panel is the `.brim-sidebar` in it. */
  workspace: HTMLElement | null;
  width: number | null;
  onWidth: (width: number | null) => void;
}) {
  const panelWidth = (): number => workspace?.querySelector<HTMLElement>(".brim-sidebar")?.offsetWidth ?? 0;
  const limit = (next: number): number =>
    clamp(next, SIDEBAR_MIN, Math.min(SIDEBAR_MAX, (workspace?.clientWidth ?? Infinity) - PAGE_ROOM));
  const choose = (next: number | null): void => {
    const chosen = next === null ? null : limit(next);
    onWidth(chosen);
    storeSidebarWidth(chosen);
  };

  return (
    <div
      className="brim-sidebar-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Side panel width: drag, or use the arrow keys"
      aria-valuenow={Math.round(width ?? panelWidth())}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      title="Drag to make the side panel wider or narrower; double-click for its own width"
      onPointerDown={(event) => {
        const start = panelWidth();
        let last = start;
        drag(
          event,
          (dx) => {
            // The panel is on the right: moving left widens it.
            last = limit(start - dx);
            onWidth(last);
          },
          () => storeSidebarWidth(last),
        );
      }}
      onDoubleClick={() => choose(null)}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "ArrowLeft") choose(panelWidth() + KEY_STEP);
        else if (event.key === "ArrowRight") choose(panelWidth() - KEY_STEP);
        else if (event.key === "Home") choose(null);
        else return;
        event.preventDefault();
      }}
    />
  );
}

/**
 * Handles on both sides of the page preview: dragged, they make the page narrower or wider around its middle, to see
 * it at any width between a phone and the whole window. `null` is the width the chosen device gives it.
 */
export function FrameHandles({
  canvas,
  frame,
  width,
  dragging,
  onWidth,
  onDragging,
}: {
  /** The area the preview sits in, which bounds how wide it can get. */
  canvas: HTMLElement | null;
  frame: HTMLElement | null;
  width: number | null;
  dragging: boolean;
  onWidth: (width: number | null) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const room = (): number => {
    if (!canvas) return Infinity;
    const style = getComputedStyle(canvas);
    return canvas.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  };
  // As wide as the canvas allows is no chosen width at all: the device's own (the whole width on a desktop).
  const choose = (next: number): void => {
    const max = room();
    onWidth(next >= max - 1 ? null : clamp(Math.round(next), FRAME_MIN, max));
  };

  const handle = (side: "left" | "right") => (
    <div
      key={side}
      className="brim-frame-handle"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label="Page width: drag, or use the arrow keys"
      aria-valuenow={Math.round(width ?? frame?.offsetWidth ?? 0)}
      aria-valuemin={FRAME_MIN}
      tabIndex={0}
      title="Drag to see the page narrower or wider; double-click for the device's own width"
      onPointerDown={(event) => {
        const start = frame?.offsetWidth ?? 0;
        onDragging(true);
        // The page stays centred, so it grows by both sides: twice what the pointer moved.
        drag(
          event,
          (dx) => choose(start + (side === "right" ? dx : -dx) * 2),
          () => onDragging(false),
        );
      }}
      onDoubleClick={() => onWidth(null)}
      onKeyDown={(event: KeyboardEvent) => {
        const current = frame?.offsetWidth ?? 0;
        const wider = side === "right" ? "ArrowRight" : "ArrowLeft";
        const narrower = side === "right" ? "ArrowLeft" : "ArrowRight";
        if (event.key === wider) choose(current + KEY_STEP * 2);
        else if (event.key === narrower) choose(current - KEY_STEP * 2);
        else if (event.key === "Home") onWidth(null);
        else return;
        event.preventDefault();
      }}
    >
      <span className="brim-frame-handle__grip" />
    </div>
  );

  const shown = width ?? (dragging ? frame?.offsetWidth : undefined);
  return (
    <>
      {handle("left")}
      {handle("right")}
      {shown !== undefined && (
        <div className="brim-frame-size" data-dragging={dragging ? "" : undefined}>
          <span>{Math.round(shown)} px</span>
          {width !== null && !dragging && (
            <button type="button" onClick={() => onWidth(null)} title="Back to the device's own width">
              Reset
            </button>
          )}
        </div>
      )}
    </>
  );
}
