import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  BulletListIcon,
  ChevronDownIcon,
  ClearFormatIcon,
  HighlightIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  StrikeIcon,
  SubscriptIcon,
  SuperscriptIcon,
  TextColorIcon,
  UnderlineIcon,
} from "./icons.tsx";
import { useBrandColors } from "./brand.ts";
import { type TextAlign, alignOf } from "./rich-text.ts";
import { LinkWidget } from "./LinkWidget.tsx";
import { isComposing } from "./keys.ts";

/** Room kept between a popover and the edge of the page being edited. */
const EDGE = 8;

/** `text` is one element (a heading, a paragraph); `richtext` is flowing content with several blocks. */
export type TextKind = "text" | "richtext";

const MARKS = [
  { command: "bold", label: "Bold", Icon: BoldIcon },
  { command: "italic", label: "Italic", Icon: ItalicIcon },
  { command: "underline", label: "Underline", Icon: UnderlineIcon },
  { command: "strikeThrough", label: "Strikethrough", Icon: StrikeIcon },
  { command: "subscript", label: "Subscript", Icon: SubscriptIcon },
  { command: "superscript", label: "Superscript", Icon: SuperscriptIcon },
] as const;

const ALIGNMENTS = [
  { align: "left", command: "justifyLeft", label: "Align left", Icon: AlignLeftIcon },
  { align: "center", command: "justifyCenter", label: "Align center", Icon: AlignCenterIcon },
  { align: "right", command: "justifyRight", label: "Align right", Icon: AlignRightIcon },
  { align: "justify", command: "justifyFull", label: "Justify", Icon: AlignJustifyIcon },
] as const;

const TEXT_STYLES = [
  { tag: "p", label: "Paragraph" },
  { tag: "h1", label: "Heading 1" },
  { tag: "h2", label: "Heading 2" },
  { tag: "h3", label: "Heading 3" },
  { tag: "h4", label: "Heading 4" },
  { tag: "h5", label: "Heading 5" },
  { tag: "h6", label: "Heading 6" },
  { tag: "blockquote", label: "Quote" },
];

/** Content colors offered to the owner. These are choices for the site's text, not editor colors. */
const PALETTE = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#cccccc",
  "#ffffff",
  "#d92d20",
  "#f79009",
  "#fdb022",
  "#12b76a",
  "#1570ef",
  "#7a5af8",
  "#b42318",
  "#b54708",
  "#93370d",
  "#027a48",
  "#175cd3",
  "#5925dc",
];

type Popover = "style" | "color" | "highlight" | "link" | null;

/** Formatting controls for the text being edited in place. They act on the selection inside the page frame. */
export function TextTools({
  element,
  kind,
  onElement,
}: {
  element: HTMLElement;
  kind: TextKind;
  /** Changes which element a single text is (paragraph, heading…). */
  onElement: (tag: string) => void;
}): ReactNode {
  const page = element.ownerDocument;
  const [, refresh] = useState(0);
  const [popover, setPopover] = useState<Popover>(null);
  const [href, setHref] = useState("");
  // The link popover is wider than the button it opens from: it is moved back inside the page being edited.
  const linkPopover = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = linkPopover.current;
    const area = box?.closest(".brim-chrome")?.getBoundingClientRect();
    if (!box || !area) return;
    box.style.transform = "";
    const rect = box.getBoundingClientRect();
    const overflow = Math.max(0, rect.right - (area.right - EDGE)) - Math.max(0, area.left + EDGE - rect.left);
    if (overflow !== 0) box.style.transform = `translateX(${-overflow}px)`;
  }, [popover]);
  // Popovers with inputs move focus out of the page, so the selection is remembered and put back.
  const selection = useRef<Range | null>(null);

  useEffect(() => {
    const update = (): void => refresh((count) => count + 1);
    page.addEventListener("selectionchange", update);
    return () => page.removeEventListener("selectionchange", update);
  }, [page]);

  function run(command: string, value?: string): void {
    element.focus();
    if (selection.current) {
      const current = page.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection.current);
      selection.current = null;
    }
    page.execCommand(command, false, value);
    setPopover(null);
    refresh((count) => count + 1);
  }

  function toggle(next: Popover): void {
    const current = page.getSelection();
    selection.current = current && current.rangeCount > 0 ? current.getRangeAt(0).cloneRange() : null;
    if (next === "link") setHref(currentLink(page)?.getAttribute("href") ?? "");
    setPopover(popover === next ? null : next);
  }

  function align(next: TextAlign, command: string): void {
    if (kind === "richtext") return run(command);
    // A single text has no blocks to align; the alignment belongs to the element itself.
    element.style.textAlign = alignOf(element) === next ? "" : next;
    refresh((count) => count + 1);
  }

  function chooseStyle(tag: string): void {
    setPopover(null);
    if (kind === "richtext") run("formatBlock", tag);
    else if (tag !== element.tagName.toLowerCase()) onElement(tag);
  }

  /** From the link widget: a link for the selected words, or none when it is cleared. */
  function applyLink(link: string): void {
    if (link.trim() === "") run("unlink");
    else run("createLink", link.trim());
  }

  const currentTag =
    kind === "richtext" ? page.queryCommandValue("formatBlock").toLowerCase() : element.tagName.toLowerCase();
  const currentStyle = TEXT_STYLES.find((style) => style.tag === currentTag)?.label ?? "Text";
  const currentAlign = kind === "richtext" ? undefined : alignOf(element);

  return (
    <>
      <div className="brim-toolbar-anchor">
        <button
          type="button"
          className="brim-element__toolbar-btn brim-element__toolbar-btn--label"
          title="Text style"
          aria-haspopup="menu"
          aria-expanded={popover === "style"}
          onMouseDown={keepSelection}
          onClick={() => toggle("style")}
        >
          {currentStyle}
          <ChevronDownIcon />
        </button>
        {popover === "style" && (
          <div className="brim-toolbar-popover brim-toolbar-menu" role="menu">
            {TEXT_STYLES.map((style) => (
              <button
                key={style.tag}
                type="button"
                role="menuitemradio"
                aria-checked={style.tag === currentTag}
                className="field-select-option"
                onMouseDown={keepSelection}
                onClick={() => chooseStyle(style.tag)}
              >
                {style.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <Divider />

      {MARKS.map(({ command, label, Icon }) => (
        <ToolButton key={command} label={label} active={page.queryCommandState(command)} onClick={() => run(command)}>
          <Icon />
        </ToolButton>
      ))}
      <Divider />

      <ColorTool
        label="Text color"
        open={popover === "color"}
        onToggle={() => toggle("color")}
        onPick={(color) => run("foreColor", color)}
        icon={<TextColorIcon />}
      />
      <ColorTool
        label="Text background color"
        open={popover === "highlight"}
        onToggle={() => toggle("highlight")}
        onPick={(color) => run("hiliteColor", color)}
        onClear={() => run("hiliteColor", "transparent")}
        icon={<HighlightIcon />}
      />
      <Divider />

      {ALIGNMENTS.map(({ align: value, command, label, Icon }) => (
        <ToolButton
          key={value}
          label={label}
          active={kind === "richtext" ? page.queryCommandState(command) : currentAlign === value}
          onClick={() => align(value, command)}
        >
          <Icon />
        </ToolButton>
      ))}
      {kind === "richtext" && (
        <>
          <Divider />
          <ToolButton
            label="Bulleted list"
            active={page.queryCommandState("insertUnorderedList")}
            onClick={() => run("insertUnorderedList")}
          >
            <BulletListIcon />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={page.queryCommandState("insertOrderedList")}
            onClick={() => run("insertOrderedList")}
          >
            <NumberedListIcon />
          </ToolButton>
        </>
      )}
      <Divider />

      <div className="brim-toolbar-anchor">
        <ToolButton
          label="Link"
          active={currentLink(page) !== null || popover === "link"}
          onClick={() => toggle("link")}
        >
          <LinkIcon />
        </ToolButton>
        {popover === "link" && (
          // The editor's one link widget: type a link, or browse the site, a part of a page, an email or a phone.
          <div
            ref={linkPopover}
            className="brim-toolbar-popover toolbar-link-popover"
            onKeyDown={(event) => event.key === "Escape" && !isComposing(event) && setPopover(null)}
          >
            <LinkWidget label="Link" value={href} autoFocus onChange={applyLink} />
          </div>
        )}
      </div>
      <ToolButton label="Remove formatting" active={false} onClick={() => run("removeFormat")}>
        <ClearFormatIcon />
      </ToolButton>
      <Divider />
    </>
  );
}

function ColorTool({
  label,
  icon,
  open,
  onToggle,
  onPick,
  onClear,
}: {
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  onPick: (color: string) => void;
  onClear?: () => void;
}) {
  const brand = useBrandColors();
  return (
    <div className="brim-toolbar-anchor">
      <ToolButton label={label} active={open} onClick={onToggle}>
        {icon}
      </ToolButton>
      {open && (
        <div className="brim-toolbar-popover brim-color-popover">
          {brand.length > 0 && (
            <>
              <p className="brim-color-group">Brand</p>
              <div className="brim-color-swatches brim-color-swatches--brand">
                {brand.map((color) => (
                  <button
                    key={color.value + color.name}
                    type="button"
                    className="brim-color-swatch"
                    title={`${color.name} · ${color.value}`}
                    aria-label={`${color.name} (${color.value})`}
                    style={{ background: color.value }}
                    onMouseDown={keepSelection}
                    onClick={() => onPick(color.value)}
                  />
                ))}
              </div>
              <p className="brim-color-group">Other colors</p>
            </>
          )}
          <div className="brim-color-swatches">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className="brim-color-swatch"
                title={color}
                aria-label={color}
                style={{ background: color }}
                onMouseDown={keepSelection}
                onClick={() => onPick(color)}
              />
            ))}
          </div>
          <label className="brim-color-custom">
            <span>Custom color</span>
            <input type="color" onChange={(event) => onPick(event.target.value)} />
          </label>
          {onClear && (
            <button type="button" className="field-select-option" onMouseDown={keepSelection} onClick={onClear}>
              None (remove background)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function currentLink(page: Document): HTMLAnchorElement | null {
  const node = page.getSelection()?.anchorNode;
  // Not `instanceof`: the selection lives in the page frame's realm.
  const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  return element?.closest("a") ?? null;
}

/** Keeps focus, and so the text selection, inside the page frame. */
function keepSelection(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

function Divider() {
  return <span className="brim-element__toolbar-divider" aria-hidden="true" />;
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`brim-element__toolbar-btn${active ? " brim-element__toolbar-btn--active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={keepSelection}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
