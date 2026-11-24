import { type ReactNode, useEffect, useRef, useState } from "react";
import { isComposing } from "./keys.ts";

/**
 * A toolbar button that opens a menu below it, or above it with `side="above"`. Closes on outside click, Escape, or
 * after a choice.
 */
export function Menu({
  label,
  className,
  align = "start",
  side = "below",
  trigger,
  children,
}: {
  label: string;
  className: string;
  align?: "start" | "end";
  side?: "below" | "above";
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isComposing(event)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // A click inside the page frame never reaches this document.
    window.addEventListener("blur", () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="brim-editor-menu-anchor" ref={root}>
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div className="brim-editor-menu" data-align={align} data-side={side} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
