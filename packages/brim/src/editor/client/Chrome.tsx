import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronUpIcon, LinkIcon, PlusIcon, TrashIcon } from "./icons.tsx";
import { nodeKinds } from "./kinds.ts";
import { Menu } from "./Menu.tsx";
import { type TextKind, TextTools } from "./TextTools.tsx";
import { type Rect, useRect } from "./use-rect.ts";

const TOOLBAR_GAP = 44;
const EDGE = 8;
/** Half the + button (`.brim-inserter__button`), which is centred on the edge it adds after. */
const INSERTER_RADIUS = 14;

export function nodeLabel(element: HTMLElement): string {
  // An element showing an item's picked value is named after the field (Date, Year, Category…).
  const title = element.dataset.brimLabel ?? nodeKinds[element.dataset.brimKind ?? ""]?.title ?? "Element";
  if (element.dataset.brimScope === "site") return `${title} · Shared across site`;
  if (element.dataset.brimScope === "template" && element.dataset.brimItem === undefined) return `${title} · Template`;
  return title;
}

/**
 * The item field the selected element shows: the toolbar says so, since a change made on the page or in the page
 * settings changes both.
 */
export interface Binding {
  /** `Project · Summary` */
  label: string;
  /** The sentence shown on hover. */
  note: string;
}

/**
 * Why the selected element cannot be changed in this mode, and the button that switches to the mode where it can.
 * An element only the site's code can change has no button.
 */
export interface Lock {
  hint: string;
  action?: string;
  onAction?: () => void;
}

/**
 * What can be done on a stack of blocks, or on one block of it: the + adds a block after it, the element's toolbar
 * moves or deletes it. Moves and delete are set on a block only.
 */
export interface StackActions {
  types: { type: string; label: string }[];
  /** Adds a block after the selected one, or at the end of the stack. */
  onAdd: (type: string) => void;
  /** Each is absent where there is no room to move. */
  onMoveUp?: (() => void) | undefined;
  onMoveDown?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

/**
 * Marks the element's outline on the page itself (`data-brim-outline`, styled by the editor's page style), so it
 * moves with the page as it scrolls, with no delay, also on a sticky or fixed element. Drawn over the frame from
 * outside, it could only follow each scroll event a frame later.
 */
function usePageOutline(element: HTMLElement | null, state: "hover" | "selected"): void {
  useEffect(() => {
    if (!element) return;
    element.setAttribute("data-brim-outline", state);
    return () => {
      if (element.getAttribute("data-brim-outline") === state) element.removeAttribute("data-brim-outline");
    };
  }, [element, state]);
}

/** Outlines, the hover label and the element toolbar of the page being edited. */
export function Chrome({
  hovered,
  selected,
  editing,
  formatting,
  locked,
  binding,
  stack,
  inserters,
  onTextElement,
  onSelectParent,
}: {
  hovered: HTMLElement | null;
  selected: HTMLElement | null;
  /** The text element being edited in place, if any. */
  editing: HTMLElement | null;
  /** Whether the text being edited takes formatting; a plain text field of an item does not. */
  formatting: boolean;
  /** Set when the selected element belongs to the other mode: the toolbar then only says so. */
  locked: Lock | undefined;
  /** Set when the selected element shows a field of the item. */
  binding?: Binding | undefined;
  /** Set when the selected element is a stack of blocks or one of its blocks: its moves and delete. */
  stack: StackActions | undefined;
  /** Where a + adds a block: under each stack of blocks, or under its selected block. */
  inserters: { anchor: HTMLElement; actions: StackActions }[];
  onTextElement: (tag: string) => void;
  /** Absent when the selected node has no editable parent. */
  onSelectParent: (() => void) | undefined;
}) {
  const shownHover = hovered !== selected && !editing ? hovered : null;
  const hoverRect = useRect(shownHover);
  const selectedRect = useRect(selected);
  usePageOutline(shownHover, "hover");
  usePageOutline(selected, "selected");

  return (
    <div className="brim-chrome">
      {inserters.map(({ anchor, actions }) => (
        <Inserter key={anchor.dataset.brimNode} anchor={anchor} actions={actions} />
      ))}
      {hovered && hoverRect && (
        <>
          <div
            className="brim-hover-label"
            style={{ top: Math.max(EDGE, hoverRect.top - 26), left: Math.max(EDGE, hoverRect.left) }}
          >
            {nodeLabel(hovered)}
          </div>
        </>
      )}
      {selected && selectedRect && (
        <>
          <ElementToolbar rect={selectedRect} label={nodeLabel(selected)}>
            {binding && (
              <span className="brim-element__toolbar-binding" title={binding.note} aria-label={binding.note}>
                <LinkIcon />
                {binding.label}
              </span>
            )}
            {locked && (
              <>
                <span className="brim-element__toolbar-hint">{locked.hint}</span>
                {locked.action && (
                  <button
                    type="button"
                    className="brim-element__toolbar-btn brim-element__toolbar-btn--label"
                    onClick={locked.onAction}
                  >
                    {locked.action}
                  </button>
                )}
              </>
            )}
            {editing && formatting && (
              <TextTools element={editing} kind={editing.dataset.brimKind as TextKind} onElement={onTextElement} />
            )}
            {!locked && stack && (
              <>
                {stack.onMoveUp && (
                  <button
                    type="button"
                    className="brim-element__toolbar-btn"
                    title="Move up"
                    aria-label="Move up"
                    onClick={stack.onMoveUp}
                  >
                    <ArrowUpIcon />
                  </button>
                )}
                {stack.onMoveDown && (
                  <button
                    type="button"
                    className="brim-element__toolbar-btn"
                    title="Move down"
                    aria-label="Move down"
                    onClick={stack.onMoveDown}
                  >
                    <ArrowDownIcon />
                  </button>
                )}
                {stack.onDelete && (
                  <button
                    type="button"
                    className="brim-element__toolbar-btn"
                    title="Delete block"
                    aria-label="Delete block"
                    onClick={stack.onDelete}
                  >
                    <TrashIcon />
                  </button>
                )}
              </>
            )}
            {!locked && onSelectParent && (
              <button
                type="button"
                className="brim-element__toolbar-btn"
                title="Select parent"
                aria-label="Select parent"
                onClick={onSelectParent}
              >
                <ChevronUpIcon />
              </button>
            )}
          </ElementToolbar>
        </>
      )}
    </div>
  );
}

/**
 * A round + on the bottom edge of a stack of blocks or of one block, offering the blocks to add there. It shows only
 * while the whole button is inside the frame: drawn past the frame's edge it would make the canvas scroll, and the
 * scrollbar narrows the page, which moves the edge, which takes the scrollbar away again, over and over.
 */
function Inserter({ anchor, actions }: { anchor: HTMLElement; actions: StackActions }) {
  const rect = useRect(anchor);
  if (!rect) return null;
  const edge = rect.top + rect.height;
  const frameHeight = anchor.ownerDocument.documentElement.clientHeight;
  if (edge - INSERTER_RADIUS < 0 || edge + INSERTER_RADIUS > frameHeight) return null;
  return (
    <div className="brim-inserter" style={{ top: edge, left: rect.left + rect.width / 2 }}>
      <Menu
        label="Add a block"
        className="brim-inserter__button"
        trigger={<PlusIcon />}
        // Low on the page, the list opens upwards, so it stays inside the frame too.
        side={edge > frameHeight / 2 ? "above" : "below"}
      >
        {(close) =>
          actions.types.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="brim-editor-menu__item"
              onClick={() => {
                close();
                actions.onAdd(type);
              }}
            >
              {label}
            </button>
          ))
        }
      </Menu>
    </div>
  );
}

/**
 * Sits just above the element, kept inside the frame: at its top edge when the element is scrolled up out of
 * sight, at its bottom edge when it is below. Past the frame it would make the canvas scroll.
 */
function ElementToolbar({ rect, label, children }: { rect: Rect; label: string; children: React.ReactNode }) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(rect.left);
  /** On a narrow screen the bar wraps onto more rows: it then sits higher, so it does not cover the element. */
  const [height, setHeight] = useState(TOOLBAR_GAP);
  /** The lowest the bar can sit and still be inside the frame. */
  const [lowest, setLowest] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const bar = toolbar.current;
    const area = bar?.parentElement;
    if (!bar || !area) return;
    setLeft(Math.max(EDGE, Math.min(rect.left, area.clientWidth - bar.offsetWidth - EDGE)));
    setHeight(Math.max(TOOLBAR_GAP, bar.offsetHeight + 6));
    setLowest(area.clientHeight - bar.offsetHeight - EDGE);
  });

  return (
    <div
      ref={toolbar}
      className="brim-element__toolbar-cluster"
      style={{ top: Math.max(EDGE, Math.min(rect.top - height, lowest)), left }}
    >
      <div
        className="brim-element__toolbar brim-element__toolbar--visible"
        role="toolbar"
        aria-label={`${label} actions`}
      >
        <span className="brim-element__toolbar-scope" title={label}>
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}
