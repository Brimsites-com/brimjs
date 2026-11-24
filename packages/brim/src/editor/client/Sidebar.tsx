import type { ReactNode } from "react";
import { ChevronDownIcon, CloseIcon } from "./icons.tsx";

/**
 * The settings column on the right, always there beside the page: the selected element's settings, or the page's.
 * A panel that can be left has a close button.
 */
export function Sidebar({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    // Focusable by the editor itself (F6 from the page), so the keyboard reaches the settings of what is selected.
    <aside className="brim-sidebar" aria-label={title} tabIndex={-1}>
      <header className="brim-sidebar-header">
        <h2 className="brim-sidebar-title">{title}</h2>
        {onClose && (
          <button type="button" className="brim-sidebar-close-btn" aria-label="Close" title="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </header>
      <div className="brim-sidebar-content">{children}</div>
    </aside>
  );
}

/**
 * One collapsible group of settings. Fieldsets in the same sidebar share a name,
 * so opening one closes the others, as the browser's own exclusive accordion does.
 */
export function Fieldset({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="schema-fieldset" name="brim-sidebar-fieldsets" open={open}>
      <summary className="fieldset-title">
        <span className="fieldset-title-text">{title}</span>
        <span className="fieldset-chevron">
          <ChevronDownIcon />
        </span>
      </summary>
      <div className="fieldset-fields">
        <div className="fieldset-fields-inner">{children}</div>
      </div>
    </details>
  );
}
