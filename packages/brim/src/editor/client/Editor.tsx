import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { ChangePassword } from "./Login.tsx";
import { type BlockLayout, layoutOf } from "../../content/block-layout.ts";
import { blocksOf } from "../../content/block-values.ts";
import { BLOCK_TYPES, type BlockEntry } from "../../content/content-types.ts";
import {
  type ContentType,
  type DraftChange,
  type Item,
  type ItemDraft,
  type NewPage,
  type NodeRef,
  type PageTemplateInfo,
  type SeoSettings,
  type SiteLocales,
  type SitePage,
  type User,
  type Visibility,
  api,
  loadSiteInfo,
} from "./api.ts";
import { type Binding, Chrome, type Lock, nodeLabel, type StackActions } from "./Chrome.tsx";
import { EditorProvider } from "./context.ts";
import { Inspector } from "./Inspector.tsx";
import { ListingPanel } from "./ListingPanel.tsx";
import { FrameHandles, SidebarHandle, storedSidebarWidth } from "./Resize.tsx";
import { ItemField } from "./ItemForm.tsx";
import { type FormValue, nodeKinds } from "./kinds.ts";
import { ContentBrowser } from "./ContentBrowser.tsx";
import { type MediaFolder, MediaFolderContext } from "./widgets.tsx";
import { SiteMap } from "./SiteMap.tsx";
import { type OwnSeo, PageSettings } from "./PageSettings.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { HistoryPanel } from "./HistoryPanel.tsx";
import { SiteSettings } from "./SiteSettings.tsx";
import { isComposing } from "./keys.ts";
import {
  alignOf,
  hasFormatting,
  dropTransferred,
  insertTransferred,
  readBlocks,
  readInlineText,
  readText,
  readTransfer,
} from "./rich-text.ts";
import { type DraftControls, type LanguageChoice, type SaveStatus, Toolbar, type Viewport } from "./Toolbar.tsx";
import { normalizePagePath } from "../../content/ids.ts";
import { itemPagePath, readItemPath } from "../../server/locales.ts";
import { itemLocale, localeOfPath, pathInLocale, translationsOf, useSiteLocales } from "./languages.ts";

const EDIT_PATH = "/admin/edit";
/** The content browser's folder of form responses. */
const RESPONSES_FOLDER = "form-responses";
const NODE_SELECTOR = "[data-brim-node]";
const STACK_SELECTOR = '[data-brim-kind="blocks"]';
/** Empty text, which would otherwise have no height to click on. Blocks such as a divider are empty on purpose. */
const TEXT_SELECTOR = ':is([data-brim-kind="text"], [data-brim-kind="richtext"]):empty';
/** An element showing an item's picked value (a date, a choice…); empty, it still needs a place to click. */
const FIELD_SELECTOR = '[data-brim-kind="field"]';
const PAGE_STYLE = `
  ${NODE_SELECTOR} { cursor: pointer; }
  [data-brim-setting] { cursor: pointer; }
  [data-brim-setting]:hover { outline: 1px dashed var(--brim-editor-selection, #6b6bff); outline-offset: 2px; }
  ${NODE_SELECTOR}[contenteditable] { cursor: text; outline: none; }
  /* An empty element still has a place to click: to write in it, or to add the first block. */
  ${TEXT_SELECTOR}, ${STACK_SELECTOR}:not(:has(${NODE_SELECTOR})) { min-height: 1.5em; }
  ${TEXT_SELECTOR}::before { content: "Empty: click to write"; opacity: 0.45; }
  ${STACK_SELECTOR}:not(:has(${NODE_SELECTOR}))::before { content: "No blocks yet: add one with +"; opacity: 0.45; }
  ${FIELD_SELECTOR}:empty { display: inline-block; min-width: 4em; min-height: 1.5em; }
  ${FIELD_SELECTOR}:empty::before { content: attr(data-brim-label) ": empty"; opacity: 0.45; }
  /* The hovered and the selected element, outlined on the page so the outline scrolls with it (see Chrome). */
  /* Drawn just outside the box, so it never covers text or images that reach the element's edge. */
  [data-brim-outline="hover"] { outline: 1px solid var(--brim-editor-selection, #1d4ed8) !important; outline-offset: 2px !important; }
  [data-brim-outline="selected"] { outline: 2px solid var(--brim-editor-selection, #1d4ed8) !important; outline-offset: 2px !important; }
  /* A phone or tablet preview shows no scrollbar, as on the device: it would take 15px of the width the page is
     laid out for, and show as a white bar beside it. The page still scrolls. */
  html[data-brim-viewport="mobile"], html[data-brim-viewport="tablet"] { scrollbar-width: none; }
  /* Astro's own dev toolbar would sit on top of the page being edited. */
  astro-dev-toolbar { display: none !important; }
`;

/** The page being edited is the part of the address after /admin/edit. */
function pagePathFromAddress(): string {
  const path = location.pathname.startsWith(EDIT_PATH) ? location.pathname.slice(EDIT_PATH.length) : "";
  return path === "" ? "/" : path;
}

/**
 * Elements of the page belong to the frame's own realm, so `instanceof Element`
 * from this document is always false for them; the node type is checked instead.
 */
function isElement(node: EventTarget | Node | null | undefined): node is HTMLElement {
  return (node as Node | null | undefined)?.nodeType === 1;
}

function nodeOf(target: EventTarget | null): HTMLElement | null {
  return isElement(target) ? target.closest<HTMLElement>(NODE_SELECTOR) : null;
}

function parentNodeOf(element: HTMLElement): HTMLElement | null {
  return element.parentElement?.closest<HTMLElement>(NODE_SELECTOR) ?? null;
}

/** Text and rich text are typed directly on the page; everything else is edited in the inspector. */
function isEditedInPlace(element: HTMLElement): boolean {
  return element.dataset.brimKind === "text" || element.dataset.brimKind === "richtext";
}

/** An element showing one of an item's fields: its content belongs to the item, how it looks to the template. */
function isField(element: HTMLElement): boolean {
  return element.dataset.brimItem !== undefined;
}

/** One block of an item's `blocks` field: the item's content, kept in the field under this id. */
function isEntry(element: HTMLElement): boolean {
  return element.dataset.brimEntry !== undefined;
}

/** An element showing an item's picked value: set in the side panel with the field's widget, never typed in place. */
function isPickedField(element: HTMLElement): boolean {
  return element.dataset.brimKind === "field";
}

/** A stack of blocks has nothing to set itself; the + under it adds blocks to it. */
function isStack(element: HTMLElement): boolean {
  return element.dataset.brimKind === "blocks";
}

/**
 * What an item's field takes from the element that shows it: an image's address and description, a gallery's or a
 * carousel's images. The rest of the element's settings are how the template shows it.
 */
const IMAGE_CONTENT = ["url", "alt", "images"];

/**
 * What the owner still changes on a gallery or carousel the site draws itself: the images and how they move. Its
 * columns, arrows and dots are the site's markup, so they are not offered.
 */
const DRAWN_SETTINGS = ["images", "start", "autoplay", "autoplaySpeed", "pauseOnHover", "loop", "continuousSpeed"];

/** The image block's settings without its image, which belongs to the item. */
function withoutImageContent(form: FormValue): FormValue {
  return Object.fromEntries(Object.entries(form).filter(([name]) => !IMAGE_CONTENT.includes(name)));
}

/**
 * The loaded page is the page of an item, drawn by its type's template, which the `count` items in its language
 * share; `translations` is the item in every language it is written in, itself included.
 */
interface ItemPage {
  type: ContentType;
  item: Item;
  count: number;
  translations: Item[];
}

/**
 * `/projects/lake-house` (or `/ro/projects/casa-de-la-lac`, or an address from the type's `path`) is the page of an
 * item when its type has a template. A translation keeps its original's slug, so the item is looked up in the page's language.
 */
async function findItemPage(types: ContentType[], path: string, locales: SiteLocales | null): Promise<ItemPage | null> {
  const address = readItemPath(
    types.filter((candidate) => candidate.hasPage),
    path,
    locales ?? undefined,
  );
  if (!address) return null;
  const { type } = address;
  const { items } = await api.items(type.key);
  const item = items.find((candidate) => candidate.slug === address.slug && candidate.locale === address.locale);
  // The page redirects to the item's own address when its other parts (a category) do not agree.
  if (!item || itemPagePath(type, item, locales ?? undefined) !== normalizePagePath(path)) return null;
  const count = items.filter((candidate) => candidate.locale === address.locale).length;
  return { type, item, count, translations: translationsOf(item, items) };
}

const THEME_COLOR_NAMES = ["background", "light1", "light2", "accent", "primary", "dark1", "dark2"];

/** Color swatches in the sidebar show the site's own theme colors, read from the page being edited. */
function adoptThemeColors(view: Window): void {
  const siteStyle = view.getComputedStyle(view.document.documentElement);
  for (const name of THEME_COLOR_NAMES) {
    const value = siteStyle.getPropertyValue(`--brim-theme-${name}`).trim();
    if (value) document.documentElement.style.setProperty(`--brim-theme-${name}`, value);
    else document.documentElement.style.removeProperty(`--brim-theme-${name}`);
  }
}

/** Where the content browser opens: all content, or one content type, optionally on its new item form. */
interface BrowseTarget {
  folder: string | null;
  create: boolean;
  /** What the new item starts with, e.g. the field a listing filters on. */
  data?: Record<string, unknown>;
  /** In Form responses, the form whose responses open first. */
  form?: string;
  /** A response to open straight away, e.g. from the email about it (`?response=<id>`). */
  response?: string;
}

/** Reads what `<Seo>` left in the head for the editor; `null` when the page's layout has no `<Seo>`. */
function readPageSeo(page: Document, path: string): { path: string; seo: SeoSettings; own: OwnSeo } | null {
  const content = page.querySelector('meta[name="brim-seo"]')?.getAttribute("content");
  if (!content) return null;
  try {
    const { seo, own } = JSON.parse(content) as { seo?: SeoSettings; own?: OwnSeo };
    return { path, seo: seo ?? {}, own: own ?? {} };
  } catch {
    return null;
  }
}

/** What the owner chose for a text besides its words. An empty alignment means the page's own. */
interface TextChoice {
  as?: string;
  align?: string;
  options?: FormValue;
}

interface TextEdit {
  element: HTMLElement;
  originalHtml: string;
  originalAlign: string;
}

/** One step of undo: the drafts it changed, each with how it was before and after. */
interface UndoStep {
  changes: DraftChange[];
  /** When it was last added to: quick changes of the same thing (typing in a field) are one step. */
  at: number;
}

/** Changes of the same thing this close together are undone as one. */
const SAME_STEP_MS = 1500;

function isDrafted(value: unknown): value is { change: DraftChange; drafts: number } {
  return typeof value === "object" && value !== null && "change" in value && "drafts" in value;
}

/** What each field held when it was focused: one not changed since has no typing of its own to undo. */
const valueOnFocus = new WeakMap<EventTarget, string>();

/** Where Cmd+Z belongs to the browser: a field with typing of its own to undo. */
function typesItself(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || element.nodeType !== 1) return false;
  if (element.isContentEditable) return true;
  if (element.tagName !== "INPUT" && element.tagName !== "TEXTAREA") return false;
  return (element as HTMLInputElement).value !== valueOnFocus.get(element);
}

type Shortcut = "undo" | "redo" | "save";

/** The key that moves the keyboard between the page and the side panel, as F6 moves between a browser's panes. */
const PANEL_KEY = "F6";

/** Cmd/Ctrl+Z undoes, Shift+Cmd+Z or Ctrl+Y redoes, Cmd/Ctrl+S saves. */
function shortcutOf(event: KeyboardEvent): Shortcut | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  if (key === "s" && !event.shiftKey) return "save";
  return undefined;
}

export function Editor({ user, onSignedOut }: { user: User; onSignedOut: () => void }) {
  /** The frame showing the page. A second one draws the page again out of sight, then takes its place. */
  const frame = useRef<HTMLIFrameElement | null>(null);
  const slots = useRef<(HTMLIFrameElement | null)[]>([null, null]);
  const [shown, setShown] = useState(0);
  /** The frame drawing the page out of sight, and where to scroll it before it is shown. */
  const incoming = useRef<{ slot: number; x: number; y: number } | null>(null);
  /** Counts the pages asked of the frames: a page asked for before the latest one is never shown. */
  const requests = useRef(0);
  /** Set while the frame in view opens another page: drawing the old page again would bring it back. */
  const opening = useRef(false);
  const [initialPath] = useState(pagePathFromAddress);
  const [path, setPath] = useState(initialPath);
  const locales = useSiteLocales();
  const [pages, setPages] = useState<SitePage[]>([]);
  const [templates, setTemplates] = useState<PageTemplateInfo[]>([]);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  /** The page preview's width dragged by its handles; `null` is the device's own. Settings still follow `viewport`. */
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const [frameDragging, setFrameDragging] = useState(false);
  /** The side panel's width dragged by its edge, kept in this browser; `null` is the editor's own. */
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(storedSidebarWidth);
  const [workspaceElement, setWorkspaceElement] = useState<HTMLDivElement | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLElement | null>(null);
  const [frameElement, setFrameElement] = useState<HTMLDivElement | null>(null);
  // Read by attachToPage, which runs once per load; the effect keeps the pages already loaded current.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    for (const slot of slots.current) {
      const root = slot?.contentDocument?.documentElement;
      if (root) root.dataset.brimViewport = viewport;
    }
  }, [viewport]);
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  /** How many changes on the whole site nobody has saved yet: visitors do not see them. */
  const [draftCount, setDraftCount] = useState(0);
  const [savingDrafts, setSavingDrafts] = useState(false);
  /** The changes made in this window, to undo and redo; both empty once the drafts are saved or discarded. */
  const undoSteps = useRef<UndoStep[]>([]);
  const redoSteps = useRef<UndoStep[]>([]);
  const [, setStepsChanged] = useState(0);
  /** Set while an undo or redo runs, so another waits its turn. */
  const replaying = useRef(false);
  /** Changed by undo and redo, so the panels read their element or page again. */
  const [revision, setRevision] = useState(0);
  /** Set by undo, redo and discard: the panels are read again once the page drawn again is in place. */
  const reread = useRef(false);
  const [hovered, setHovered] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<HTMLElement | null>(null);
  // The step of a form that the sidebar has open: shown on the page, and again each time the page is drawn anew.
  const formStep = useRef<{ node: string; step: number } | null>(null);
  useEffect(() => {
    const showStep = (element: HTMLElement | null) => {
      const step = formStep.current;
      if (!step || !element || element.dataset.brimKind !== "form" || step.node !== element.dataset.brimNode) return;
      void element.ownerDocument.defaultView?.customElements
        .whenDefined("brim-form")
        .then(() => element.dispatchEvent(new CustomEvent("brim:show-step", { detail: step.step })));
    };
    const listener = (event: Event) => {
      if (!selected) return;
      formStep.current = { node: selected.dataset.brimNode ?? "", step: Number((event as CustomEvent).detail) };
      showStep(selected);
    };
    window.addEventListener("brim-editor:form-step", listener);
    showStep(selected);
    return () => window.removeEventListener("brim-editor:form-step", listener);
  }, [selected]);
  const [textEdit, setTextEditState] = useState<TextEdit | null>(null);
  /** The text being typed, read at once: two changes in a row must not both save it, or one miss it. */
  const textEditRef = useRef<TextEdit | null>(null);
  /** Whether something was typed in the text being edited, for the Save button. */
  const [typed, setTyped] = useState(false);
  /** The saves still on their way: Save waits for them, so the drafts it saves have every change in them. */
  const writes = useRef(new Set<Promise<unknown>>());
  /** Set while Save runs, read at once so a second Cmd+S does not start another. */
  const savingNow = useRef(false);
  /** What is being typed on the page into one of the item's fields, shown in the page settings before it is saved. */
  const [liveField, setLiveField] = useState<{ field: string; value: unknown } | null>(null);
  const [siteSettingsOpen, setSiteSettingsOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [settingFocus, setSettingFocus] = useState<string | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Page settings opened with the toolbar's button. Beside the page they show whenever nothing else does; on a phone,
   * where the panel covers the page, only when asked for, like any panel.
   */
  const [pageSettingsAsked, setPageSettingsAsked] = useState(false);
  /**
   * What the loaded page says about its SEO (see Seo.astro). It also covers pages the site map does not list,
   * such as the page of a content item.
   */
  const [loadedSeo, setLoadedSeo] = useState<{ path: string; seo: SeoSettings; own: OwnSeo } | null>(null);
  /** Set while the content browser covers the page: the folder it opened on, and whether to start a new item. */
  // `/admin/edit?response=<id>`, the link in the email about a message, opens that message.
  const [browsing, setBrowsing] = useState<BrowseTarget | null>(() => {
    const response = new URLSearchParams(location.search).get("response");
    return response ? { folder: "form-responses", create: false, response } : null;
  });
  const [siteMapOpen, setSiteMapOpen] = useState(false);
  const [types, setTypes] = useState<ContentType[]>([]);
  const [itemPage, setItemPage] = useState<ItemPage | null>(null);
  /** On an item's page: true while its type's template is edited, false while the item itself is. */
  const [templateMode, setTemplateMode] = useState(() => new URLSearchParams(location.search).has("template"));
  /** The stacks of blocks on the loaded page, each with a + to add to it. */
  const [stacks, setStacks] = useState<HTMLElement[]>([]);
  /** The item whose page is open, as last saved: a change starts from it even before the page has drawn it. */
  const latestItem = useRef<Item | null>(null);
  /** Counts closings of the content browser, where items may have changed: the item is then read again. */
  const [browsed, setBrowsed] = useState(0);
  /** Node to select again once the page has been drawn again with a saved change. */
  const reselect = useRef<string | null>(null);
  const typeName = (itemPage?.type.singular ?? "item").toLowerCase();

  function setTextEdit(next: TextEdit | null): void {
    textEditRef.current = next;
    setTextEditState(next);
    setTyped(false);
  }

  /** Whether the text being typed differs from what it was when typing started. */
  function textEditChanged(): boolean {
    const edit = textEditRef.current;
    if (!edit) return false;
    return edit.element.innerHTML !== edit.originalHtml || edit.element.style.textAlign !== edit.originalAlign;
  }

  /**
   * Runs one save, reporting progress and failure in the toolbar. A session that ran out does not end up here: the
   * request waits for the owner to sign in again and is sent again (see `whenSignedOut`).
   */
  const run = useCallback(async (work: Promise<unknown>): Promise<boolean> => {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    writes.current.add(settled);
    void settled.then(() => writes.current.delete(settled));
    setStatus({ state: "saving" });
    try {
      const result = await work;
      if (isDrafted(result)) remember(result.change, result.drafts);
      setStatus({ state: "idle" });
      return true;
    } catch (failure) {
      setStatus({ state: "error", message: failure instanceof Error ? failure.message : "Could not save." });
      return false;
    }
  }, []);

  /**
   * Waits until no save is on its way. A change can start a moment after what caused it (a field saves on blur, then
   * waits for the text being typed), so it looks again after each wait.
   */
  async function settle(): Promise<void> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (writes.current.size === 0) return;
      await Promise.all([...writes.current]);
    }
  }

  /** A change now in the draft: one more step to undo, or part of the last one when it changes the same thing. */
  function remember(change: DraftChange, count: number): void {
    setDraftCount(count);
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) return;
    const last = undoSteps.current.at(-1);
    const only = last?.changes.length === 1 ? last.changes[0] : undefined;
    if (
      last &&
      only &&
      only.target === change.target &&
      only.key === change.key &&
      Date.now() - last.at < SAME_STEP_MS
    ) {
      last.changes[0] = { ...only, after: change.after };
      last.at = Date.now();
    } else {
      undoSteps.current.push({ changes: [change], at: Date.now() });
    }
    redoSteps.current = [];
    setStepsChanged((count) => count + 1);
  }

  /** Undo (`back`) or redo: the step's drafts are put back, then the page shows them. */
  async function replay(back: boolean): Promise<void> {
    if (replaying.current || savingDrafts) return;
    replaying.current = true;
    try {
      // What is being typed is a change of its own, so it is the one undone.
      await finishTextEdit();
      const step = (back ? undoSteps.current : redoSteps.current).pop();
      if (!step) return;
      setStepsChanged((count) => count + 1);
      let item: Item | undefined;
      const changes = back ? [...step.changes].reverse() : step.changes;
      const done = await run(
        (async () => {
          for (const change of changes) {
            const answer = await api.putDraft(change, back ? change.before : change.after);
            setDraftCount(answer.drafts);
            if (answer.item) item = answer.item;
          }
        })(),
      );
      if (!done) {
        // Not taken back: it stays where it was, to try again.
        (back ? undoSteps.current : redoSteps.current).push(step);
        return;
      }
      step.at = 0;
      (back ? redoSteps.current : undoSteps.current).push(step);
      setStepsChanged((count) => count + 1);
      showReplayed(step.changes[0]!, item);
    } finally {
      replaying.current = false;
    }
  }

  /** The page shows what an undo or redo changed: drawn again, or opened when the change was made elsewhere. */
  function showReplayed(change: DraftChange, item: Item | undefined): void {
    reread.current = true;
    setRevision((count) => count + 1);
    void refreshPages();
    const keep = selected?.dataset.brimNode;
    if (item) {
      itemSaved(item);
      if (itemPage?.item.id === item.id) {
        const address = itemPagePath(itemPage.type, item, locales ?? undefined);
        if (address === path) redraw(keep);
        else open(address);
        return;
      }
    }
    if (change.page && change.page !== path) navigate(change.page);
    else redraw(keep);
  }

  /** Save: everything drafted becomes what visitors see. */
  async function saveDrafts(): Promise<void> {
    if (savingNow.current) return;
    savingNow.current = true;
    setSavingDrafts(true);
    try {
      // A field in the side panel saves what was typed in it when it loses focus: it is let go of, so that is saved
      // too. The page's frame keeps its focus: the text typed there is saved just after.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.tagName !== "IFRAME") focused.blur();
      // Typed text that could not be saved stays open with the reason in the toolbar, and nothing is saved.
      if (!(await finishTextEdit())) return;
      // Every change made so far reaches the drafts before they are saved.
      await settle();
      setStatus({ state: "saving" });
      const result = await api.saveDrafts();
      setDraftCount(result.drafts);
      undoSteps.current = [];
      redoSteps.current = [];
      setStepsChanged((count) => count + 1);
      const failure = result.failed[0];
      setStatus(
        failure
          ? {
              state: "error",
              message: `${result.failed.length} ${result.failed.length === 1 ? "change was" : "changes were"} not saved: ${failure.error}`,
            }
          : { state: "saved" },
      );
      void refreshPages();
    } catch (failure) {
      setStatus({ state: "error", message: failure instanceof Error ? failure.message : "Could not save." });
    } finally {
      savingNow.current = false;
      setSavingDrafts(false);
    }
  }

  /** Discard: every unsaved change is thrown away, and the page shows what visitors see. */
  async function discardDrafts(): Promise<void> {
    const count = draftCount;
    const what = count === 1 ? "the unsaved change" : `all ${count} unsaved changes`;
    if (!window.confirm(`Throw away ${what}? The site goes back to what was last saved. This cannot be undone.`))
      return;
    if (textEditRef.current) {
      textEditRef.current.element.removeAttribute("contenteditable");
      setTextEdit(null);
    }
    let answer: { drafts: number } | undefined;
    if (!(await run(api.discardDrafts().then((result) => (answer = result))))) return;
    setDraftCount(answer?.drafts ?? 0);
    undoSteps.current = [];
    redoSteps.current = [];
    setStepsChanged((value) => value + 1);
    reread.current = true;
    setRevision((value) => value + 1);
    // The item is read again, as saved.
    setBrowsed((value) => value + 1);
    void refreshPages();
    redraw(selected?.dataset.brimNode);
  }

  function shortcut(name: Shortcut): void {
    if (name === "save") void saveDrafts();
    else void replay(name === "undo");
  }

  function refOf(element: HTMLElement): NodeRef {
    const { brimItem: item, brimField: field, brimScope: scope } = element.dataset;
    return {
      path,
      scope: scope === "site" || scope === "template" ? scope : "page",
      nodeId: element.dataset.brimNode ?? "",
      // In the template, a field's element saves how it looks, never the content of the item shown as a sample.
      ...(item && field && !templateMode && { item, field }),
    };
  }

  /** Why an element cannot be changed in the current mode, with the switch to the mode where it can. */
  function lockOf(element: HTMLElement): Lock | undefined {
    // The server found markup in the code's default text that a saved text cannot hold: typing would lose it.
    if (element.dataset.brimUnkept !== undefined) return { hint: "Only the site's code can change this text" };
    if (!templateMode && element.dataset.brimScope === "template" && !isField(element)) {
      return { hint: `Part of the ${typeName} template`, action: "Edit template", onAction: () => switchMode(true) };
    }
    // Rich text, picked values and blocks are nothing but the item's content: the template has nothing to change.
    // How a picked value is written (its date format, its element) is the site's code.
    if (
      templateMode &&
      isField(element) &&
      (element.dataset.brimKind === "richtext" || isPickedField(element) || isEntry(element) || isStack(element))
    ) {
      return { hint: `Content of this ${typeName}`, action: `Edit ${typeName}`, onAction: () => switchMode(false) };
    }
    return undefined;
  }

  function switchMode(template: boolean): void {
    select(null);
    setTemplateMode(template);
  }

  /** Whether the side panel has settings of the element's own to show; the text of an item is only typed. */
  function hasSettings(element: HTMLElement): boolean {
    if (lockOf(element) || isStack(element)) return false;
    if (isPickedField(element)) return itemPage !== null;
    if (!nodeKinds[element.dataset.brimKind ?? ""]) return false;
    return !(isField(element) && !templateMode && isEditedInPlace(element));
  }

  function itemSaved(item: Item | undefined): void {
    if (!item) return;
    if (latestItem.current?.id === item.id) latestItem.current = item;
    setItemPage((page) => (page?.item.id === item.id ? { ...page, item } : page));
  }

  /**
   * Draws the page again in the frame out of sight, and shows it once it has loaded, scrolled where the owner was:
   * the page in view stays until then, so nothing flashes. `keep` is the node to select again on it.
   */
  function redraw(keep?: string): void {
    // Another page is opening: it is drawn afresh anyway, and the one in view now would take its place.
    if (opening.current) return;
    const request = ++requests.current;
    // What is being typed is saved first, or the page drawn again would show the text without it.
    void finishTextEdit().then((saved) => {
      if (!saved || request !== requests.current || opening.current) return;
      reselect.current = keep ?? null;
      const view = frame.current?.contentWindow;
      // The frame not in view, read from the frames themselves: a caller's `shown` may be from before the last swap.
      const slot = slots.current[0] === frame.current ? 1 : 0;
      const next = slots.current[slot]?.contentWindow;
      if (!view || !next) return;
      incoming.current = { slot, x: view.scrollX, y: view.scrollY };
      next.location.replace(view.location.href);
    });
  }

  /**
   * Opens another address in the frame in view, once what is being typed is saved. A page still being drawn again
   * out of sight was asked for before, so it is dropped: it would cover the page just opened.
   */
  function open(address: string): void {
    const request = ++requests.current;
    incoming.current = null;
    reselect.current = null;
    opening.current = true;
    void finishTextEdit().then((saved) => {
      if (request !== requests.current) return;
      // Typed text that could not be saved stays open on this page, with the reason in the toolbar.
      if (!saved) {
        opening.current = false;
        return;
      }
      frame.current?.contentWindow?.location.assign(address);
    });
  }

  /** A frame finished loading: the page drawn out of sight takes the place of the one in view. */
  function frameLoaded(slot: number): void {
    const pending = incoming.current;
    if (pending?.slot === slot) {
      incoming.current = null;
      const previous = frame.current;
      frame.current = slots.current[slot] ?? null;
      frame.current?.contentWindow?.scrollTo(pending.x, pending.y);
      setShown(slot);
      attachToPage();
      // Emptied, ready to draw the page the next time.
      previous?.contentWindow?.location.replace("about:blank");
    } else if (slots.current[slot] === frame.current) {
      // The page in view opened another address: a page drawn again out of sight would be the one before it.
      opening.current = false;
      incoming.current = null;
      attachToPage();
    }
  }

  /** What the owner chose for this text besides its words: the element, its alignment and its presentation. */
  function chosenForText(element: HTMLElement): TextChoice {
    return JSON.parse(element.dataset.brimValue ?? "{}") as TextChoice;
  }

  function textValue(element: HTMLElement, chosen = chosenForText(element)): unknown {
    if (element.dataset.brimKind === "richtext") return { blocks: readBlocks(element) };
    // In the template a field's element keeps only how it looks: its words are the item's.
    const lookOnly = templateMode && isField(element);
    const rich = readInlineText(element);
    // Chosen in the side panel ("" for none), or else as the text tools left it on the element.
    const align = chosen.align ?? alignOf(element);
    return {
      text: lookOnly ? "" : readText(element),
      ...(!lookOnly && hasFormatting(rich) && { rich }),
      ...(chosen.as && { as: chosen.as }),
      ...(align && { align }),
      ...(chosen.options && Object.keys(chosen.options).length > 0 && { options: chosen.options }),
    };
  }

  /**
   * Ends typing in place and saves what was typed; a change that follows waits for it, so nothing typed is lost.
   * False when it could not be saved: the text is then open again with what was typed, to try again.
   */
  async function finishTextEdit(): Promise<boolean> {
    const edit = textEditRef.current;
    if (!edit) return true;
    const changed = textEditChanged();
    const { element } = edit;
    element.removeAttribute("contenteditable");
    setTextEdit(null);
    if (!changed) {
      setLiveField(null);
      return true;
    }
    const saved = isEntry(element)
      ? await saveEntry(element, textValue(element), false)
      : await run(
          api.saveNode(refOf(element), element.dataset.brimKind ?? "text", textValue(element)).then((answer) => {
            itemSaved(answer.item);
            return answer;
          }),
        );
    if (!saved) {
      // Still on the page in view and nothing else being typed: it stays open, so leaving the page still warns.
      if (!textEditRef.current && element.isConnected && element.ownerDocument === frame.current?.contentDocument) {
        element.contentEditable = "true";
        setTextEdit(edit);
        setTyped(true);
      }
      return false;
    }
    // The page settings show the item as saved from now on; until then they kept showing what was typed.
    setLiveField(null);
    return true;
  }

  /**
   * Shows a value of the item being typed (on the page or in the page settings) in every other element of the page
   * that shows the same field as text, so they all agree before it is saved. Other kinds are drawn again on save.
   */
  function previewField(field: string, value: unknown, except?: HTMLElement): void {
    const item = itemPage?.item;
    const page = frame.current?.contentDocument;
    if (!item || !page || typeof value !== "string") return;
    const selector = `[data-brim-kind="text"][data-brim-item="${CSS.escape(item.id)}"][data-brim-field="${CSS.escape(field)}"]`;
    for (const element of page.querySelectorAll<HTMLElement>(selector)) {
      if (element !== except && element !== textEditRef.current?.element && !isEntry(element)) {
        element.textContent = value;
      }
    }
  }

  /** The item field an element shows, for its toolbar: a change on the page or in the page settings changes both. */
  function bindingOf(element: HTMLElement): Binding | undefined {
    if (!itemPage || !isField(element) || isEntry(element)) return undefined;
    const name = element.dataset.brimField ?? "";
    const field = name === "title" ? "Title" : (itemPage.type.fields.find((one) => one.name === name)?.label ?? name);
    return {
      label: `${itemPage.type.singular} · ${field}`,
      note: templateMode
        ? `Shows each ${typeName}'s ${field}: how it looks is set here, the ${field} itself on each ${typeName}.`
        : `Shows this ${typeName}'s ${field}: a change here or in Page Settings changes both.`,
    };
  }

  /** The element and the presentation are drawn by the page's own markup, so the page is rendered again. */
  async function changeTextPresentation(element: HTMLElement, chosen: TextChoice): Promise<void> {
    if (await run(api.saveNode(refOf(element), "text", textValue(element, { ...chosenForText(element), ...chosen })))) {
      element.removeAttribute("contenteditable");
      setTextEdit(null);
      redraw(element.dataset.brimNode);
    }
  }

  /** Selects an element: the side panel shows its settings, and text starts being typed in place. */
  function select(element: HTMLElement | null): void {
    if (textEditRef.current && textEditRef.current.element !== element) void finishTextEdit();
    setSelected(element);
    if (!element) return;
    setSiteSettingsOpen(false);
    setHistoryOpen(false);
    setPageSettingsAsked(false);

    const typed = isEditedInPlace(element) && !(templateMode && isField(element));
    if (typed && !lockOf(element) && textEditRef.current?.element !== element) {
      setTextEdit({ element, originalHtml: element.innerHTML, originalAlign: element.style.textAlign });
      element.contentEditable = "true";
      element.focus();
      // Formatting is written as elements (<b>, <font>), which the saved model can describe.
      element.ownerDocument.execCommand("styleWithCSS", false, "false");
      element.ownerDocument.execCommand("defaultParagraphSeparator", false, "p");
    }
  }

  async function changeFromInspector(element: HTMLElement, form: FormValue): Promise<void> {
    const kindName = element.dataset.brimKind ?? "";
    const kind = nodeKinds[kindName];
    if (!kind) return;

    if (isEntry(element)) {
      await saveEntry(element, kind.toValue(form), true);
      return;
    }
    // The text panel holds the element, the alignment and the presentation, nothing else.
    if (kindName === "text") return changeTextPresentation(element, form as TextChoice);
    // The template keeps how a field's image is shown; the image itself stays the sample item's.
    const value = templateMode && isField(element) ? withoutImageContent(form) : form;
    const saving = api.saveNode(refOf(element), kindName, kind.toValue(value)).then((answer) => {
      // A gallery or image showing an item's field saved into the item: the page settings, and any change made
      // after, work on the item as it is now, never on the one from before (which would bring a removed image back).
      itemSaved(answer.item);
      return answer;
    });
    if (await run(saving)) {
      if (kind.apply) kind.apply(element, form);
      else redraw(element.dataset.brimNode);
    }
  }

  async function reset(element: HTMLElement): Promise<void> {
    setTextEdit(null);
    if (await run(api.resetNode(refOf(element)))) redraw(element.dataset.brimNode);
  }

  async function changeVisibility(visibility: Visibility): Promise<void> {
    if (itemPage) {
      await finishTextEdit();
      // Who can see the item changes at once; its unsaved content stays in the draft.
      let saved: Item | undefined;
      const id = itemPage.item.id;
      if (await run(api.setItemVisibility(id, visibility).then((answer) => (saved = answer.item)))) itemSaved(saved);
    } else if (await run(api.setVisibility(path, visibility))) setPages((await api.pages()).pages);
  }

  /**
   * Saves the item whose page is open, then draws its page again, at its new address if that changed, with `keep`
   * selected. A change the page already shows, such as text typed in place, passes `refresh` false.
   */
  async function saveItem(draft: ItemDraft, refresh = true, keep?: string): Promise<boolean> {
    if (!itemPage) return false;
    let saved: Item | undefined;
    const work = api.draftItem(itemPage.item.id, draft, path).then((answer) => {
      saved = answer.item;
      return answer;
    });
    if (!(await run(work)) || !saved) return false;
    itemSaved(saved);
    if (!refresh) return true;
    // The same page is drawn again out of sight and keeps its scroll; only a new address is opened afresh.
    const address = itemPagePath(itemPage.type, saved, locales ?? undefined);
    if (address === path) redraw(keep);
    else open(address);
    return true;
  }

  /**
   * A change made in the page settings, applied to the item as last saved once the text being typed is saved: the
   * panel's copy of the item may not have the words just typed on the page yet. `keep` is the node to select again.
   */
  async function changeItemFields(before: ItemDraft, after: ItemDraft, keep?: string): Promise<void> {
    await finishTextEdit();
    const item = latestItem.current;
    if (!item) return;
    const data = { ...item.data };
    for (const key of new Set([...Object.keys(before.data), ...Object.keys(after.data)])) {
      if (after.data[key] !== before.data[key]) data[key] = after.data[key];
    }
    const pick = <K extends "title" | "slug">(key: K) => (after[key] !== before[key] ? after[key] : item[key]);
    if (after.visibility !== before.visibility) await changeVisibility(after.visibility);
    const changed =
      after.title !== before.title ||
      after.slug !== before.slug ||
      JSON.stringify(after.data) !== JSON.stringify(before.data);
    if (!changed) return;
    await saveItem({ title: pick("title"), slug: pick("slug"), visibility: item.visibility, data }, true, keep);
  }

  /** The blocks stacked in a field of the item whose page is open, as last saved. */
  function entriesOf(field: string): BlockEntry[] {
    return blocksOf(latestItem.current?.data[field]);
  }

  /** Saves a field's blocks into the item; `keep` is the block to select once the page is drawn again. */
  async function saveBlocks(field: string, entries: BlockEntry[], keep?: string, refresh = true): Promise<boolean> {
    const item = latestItem.current;
    if (!item) return false;
    return saveItem({ ...item, data: { ...item.data, [field]: entries } }, refresh, keep);
  }

  /** Adds, moves or deletes blocks once the text being typed is saved, working on the blocks as last saved. */
  async function changeBlocks(field: string, change: (entries: BlockEntry[]) => BlockEntry[], keep?: string) {
    if (!(await finishTextEdit())) return;
    await saveBlocks(field, change(entriesOf(field)), keep);
  }

  /** Saves one block with the item: its settings from the inspector, or its text typed in place. */
  async function saveEntry(element: HTMLElement, value: unknown, refresh: boolean): Promise<boolean> {
    const field = element.dataset.brimField ?? "";
    const id = element.dataset.brimEntry;
    const entries = entriesOf(field).map((entry) =>
      entry.id === id ? { ...entry, value: value as Record<string, unknown> } : entry,
    );
    return saveBlocks(field, entries, id, refresh);
  }

  /** A block's width and side in its field, and saving a change of them with the item. */
  function entryLayout(element: HTMLElement): { value: BlockLayout; onChange: (layout: BlockLayout) => void } {
    const field = element.dataset.brimField ?? "";
    const id = element.dataset.brimEntry;
    const entry = entriesOf(field).find((candidate) => candidate.id === id);
    return {
      value: layoutOf(entry?.type ?? "", entry?.layout, entry?.value),
      onChange: (layout) =>
        void changeBlocks(field, (list) => list.map((other) => (other.id === id ? { ...other, layout } : other)), id),
    };
  }

  /** On a stack of blocks or one of its blocks, while the item is edited: add a block after it, move it, delete it. */
  function stackOf(element: HTMLElement): StackActions | undefined {
    const stack = isStack(element) ? element : isEntry(element) ? element.closest<HTMLElement>(STACK_SELECTOR) : null;
    const field = stack?.dataset.brimField ?? "";
    const declared = itemPage?.type.fields.find((candidate) => candidate.name === field);
    if (templateMode || declared?.type !== "blocks") return undefined;

    const id = isEntry(element) ? element.dataset.brimEntry : undefined;
    const entries = entriesOf(field);
    const index = entries.findIndex((entry) => entry.id === id);
    // Each change is worked out on the blocks as they are when it runs, after any typing has been saved.
    const without = (list: BlockEntry[]) => list.filter((entry) => entry.id !== id);
    const move = (by: -1 | 1) => () =>
      void changeBlocks(
        field,
        (list) => {
          const from = list.findIndex((entry) => entry.id === id);
          if (from === -1) return list;
          const others = without(list);
          return [...others.slice(0, from + by), list[from]!, ...others.slice(from + by)];
        },
        id,
      );
    return {
      types: (declared.blocks ?? BLOCK_TYPES).map((type) => ({
        type,
        label: type === "richtext" ? "Text" : (nodeKinds[type]?.title ?? type),
      })),
      onAdd: (type) => {
        const entry = {
          id: `b${crypto.randomUUID().slice(0, 8)}`,
          type,
          value: type === "richtext" ? { blocks: [] } : {},
        };
        void changeBlocks(
          field,
          (list) => {
            const after = list.findIndex((other) => other.id === id);
            const at = after === -1 ? list.length : after + 1;
            return [...list.slice(0, at), entry as BlockEntry, ...list.slice(at)];
          },
          entry.id,
        );
      },
      onMoveUp: index > 0 ? move(-1) : undefined,
      onMoveDown: index !== -1 && index < entries.length - 1 ? move(1) : undefined,
      onDelete: index === -1 ? undefined : () => void changeBlocks(field, without),
    };
  }

  /** The template is edited on the page of one of the type's items, shown as a sample. */
  function editTemplate(samplePath: string): void {
    setTemplateMode(true);
    navigate(samplePath);
  }

  async function changeSeo(seo: SeoSettings): Promise<void> {
    let saved: SitePage | undefined;
    if (!(await run(api.setSeo(path, seo).then((page) => (saved = page))))) return;
    if (saved) setLoadedSeo((loaded) => (loaded?.path === path ? { ...loaded, seo: saved?.seo ?? {} } : loaded));
    setPages((await api.pages()).pages);
  }

  /** A new page opens at once, so the owner fills it in where it will be seen. */
  async function createPage(page: NewPage): Promise<boolean> {
    let created: SitePage | undefined;
    const done = await run(api.createPage(page).then((answer) => (created = answer.page)));
    if (!done || !created) return false;
    await refreshPages();
    navigate(created.path);
    return true;
  }

  async function deletePage(page: SitePage): Promise<boolean> {
    if (!(await run(api.deletePage(page.path)))) return false;
    await refreshPages();
    if (page.path === path) navigate("/");
    return true;
  }

  /** A page added from a template moves to its new address and opens there; the old one redirects to it. */
  async function movePage(to: string): Promise<boolean> {
    // The text being typed is saved at the page's present address, before the page moves.
    if (!(await finishTextEdit())) return false;
    let moved: SitePage | undefined;
    if (!(await run(api.movePage(path, to).then(({ page }) => (moved = page))))) return false;
    await refreshPages();
    if (moved && moved.path !== path) navigate(moved.path);
    return true;
  }

  /** `null` removes the page's password. */
  async function setPagePassword(secret: string | null): Promise<boolean> {
    if (!(await run(api.setPagePassword(path, secret)))) return false;
    await refreshPages();
    return true;
  }

  function navigate(next: string): void {
    setSiteMapOpen(false);
    setBrowsing(null);
    open(next);
  }

  function browse(folder: string | null = null, create = false, data?: Record<string, unknown>, form?: string): void {
    select(null);
    setSiteMapOpen(false);
    setBrowsing({ folder, create, ...(data && { data }), ...(form !== undefined && { form }) });
  }

  function leaveBrowser(): void {
    setBrowsing(null);
    setBrowsed((count) => count + 1);
    // An item saved from its form takes its drafted content with it.
    api.drafts().then(
      (answer) => setDraftCount(answer.drafts),
      () => undefined,
    );
    // Items changed in the browser show up on the page once it is rendered again.
    redraw();
  }

  async function refreshPages(): Promise<void> {
    setPages((await api.pages()).pages);
  }

  /** The same page in another of the site's languages: opened when it exists, else made from this one. */
  async function switchLanguage(code: string, fill: boolean): Promise<void> {
    if (!locales) return;
    // A translation is made from the page as saved, so the words being typed are saved first.
    if (!(await finishTextEdit())) return;
    if (itemPage) return switchItemLanguage(itemPage, code, locales);
    const target = pathInLocale(path, code, locales);
    if (!fill && pages.some((page) => page.path === target)) return navigate(target);
    let made: { path: string } | undefined;
    if (await run(api.translatePage(path, code).then((answer) => (made = answer)))) {
      await refreshPages();
      if (made) navigate(made.path);
    }
  }

  /** The item's page in another language: its translation's page, or a new translation made from this item. */
  async function switchItemLanguage(page: ItemPage, code: string, locales: SiteLocales): Promise<void> {
    const translation = page.translations.find((item) => itemLocale(item, locales) === code);
    if (translation) return navigate(itemPagePath(page.type, translation, locales));
    let made: Item | undefined;
    if ((await run(api.translateItem(page.item.id, code).then((answer) => (made = answer.item)))) && made) {
      navigate(itemPagePath(page.type, made, locales));
    }
  }

  // A page written in code or added from a template, or the page of an item: its translations are the item's.
  const languageChoice: LanguageChoice | undefined = !locales
    ? undefined
    : itemPage
      ? {
          current: itemLocale(itemPage.item, locales),
          copy: false,
          options: locales.locales.map((code) => {
            const translation = itemPage.translations.find((item) => itemLocale(item, locales) === code);
            const target = translation ? itemPagePath(itemPage.type, translation, locales) : "";
            return { code, path: target, exists: Boolean(translation) };
          }),
        }
      : pages.some((page) => page.path === path)
        ? {
            current: localeOfPath(path, locales) ?? locales.defaultLocale,
            copy: true,
            options: locales.locales.map((code) => {
              const target = pathInLocale(path, code, locales);
              return { code, path: target, exists: pages.some((page) => page.path === target) };
            }),
          }
        : undefined;

  // The page's listeners are attached once per load; this keeps them calling the current handlers.
  /** Site Settings opened at one of the site's own settings, clicked on the page. */
  function openSetting(name: string): void {
    select(null);
    setHistoryOpen(false);
    setSettingFocus(name);
    setSiteSettingsOpen(true);
  }
  /** Whether leaving now would lose something: unsaved drafts, typed text, or a save still on its way. */
  const unsaved = (): boolean => draftCount > 0 || textEditChanged() || writes.current.size > 0;
  /** Moves the keyboard to the side panel, for the selected element's settings. */
  function focusPanel(): void {
    document.querySelector<HTMLElement>(".brim-editor-panel .brim-sidebar")?.focus();
  }
  /** Moves the keyboard back from the side panel to the page: to the selected element, else to the page itself. */
  function focusPage(): void {
    frame.current?.contentWindow?.focus();
    if (selected?.isConnected) selected.focus({ preventScroll: true });
  }
  const handlers = useRef({
    select,
    selected,
    textEdit,
    openSetting,
    shortcut,
    browsing,
    unsaved,
    focusPanel,
    focusPage,
  });
  handlers.current = { select, selected, textEdit, openSetting, shortcut, browsing, unsaved, focusPanel, focusPage };

  function attachToPage(): void {
    const page = frame.current?.contentDocument;
    const view = frame.current?.contentWindow;
    if (!page || !view) return;

    const loadedPath = view.location.pathname;
    setPath(loadedPath);
    setStacks([...page.querySelectorAll<HTMLElement>(STACK_SELECTOR)]);
    setLoadedSeo(readPageSeo(page, loadedPath));
    setHovered(null);
    // Text still being typed on the page before belongs to that page: it is saved there, never dropped.
    if (textEditRef.current) void finishTextEdit();

    const style = page.createElement("style");
    style.textContent = PAGE_STYLE;
    page.head.append(style);
    page.documentElement.dataset.brimViewport = viewportRef.current;
    // The outline drawn on the page takes the editor's selection color.
    const selection = getComputedStyle(document.documentElement).getPropertyValue("--brim-canvas-selection").trim();
    if (selection) page.documentElement.style.setProperty("--brim-editor-selection", selection);
    adoptThemeColors(view);

    page.addEventListener(
      "click",
      (event) => {
        // One of the site's own settings: it is changed in Site Settings, for every page that shows it.
        const setting = isElement(event.target) ? event.target.closest<HTMLElement>("[data-brim-setting]") : null;
        if (setting?.dataset.brimSetting) {
          event.preventDefault();
          event.stopPropagation();
          handlers.current.openSetting(setting.dataset.brimSetting);
          return;
        }
        const node = nodeOf(event.target);
        // A click inside the text being edited only moves the caret.
        if (node && node === handlers.current.textEdit?.element) return;
        if (node) {
          event.preventDefault();
          event.stopPropagation();
        }
        handlers.current.select(node);
      },
      true,
    );
    // Every element that can be selected is reached with Tab, as it is clicked. Only here, in the editor's frame:
    // the page visitors get has none of it. An element that is focusable already (a link, a button) stays as it is.
    for (const node of page.querySelectorAll<HTMLElement>(NODE_SELECTOR)) {
      if (!node.hasAttribute("tabindex") && node.tabIndex < 0) node.tabIndex = 0;
    }
    page.addEventListener("pointerover", (event) => setHovered(nodeOf(event.target)));
    page.documentElement.addEventListener("pointerleave", () => setHovered(null));
    // The element reached with Tab is outlined and named, as one under the pointer is.
    page.addEventListener("focusin", (event) => {
      const node = nodeOf(event.target);
      if (node && node === event.target) setHovered(node);
    });
    page.addEventListener("keydown", (event) => {
      // Enter or Escape that picks or cancels a word being composed (Japanese, Chinese) belongs to the input method:
      // it must not break the line, leave the text or save half a word.
      if (isComposing(event)) return;
      const name = shortcutOf(event);
      if (name) {
        const typing = handlers.current.textEdit;
        // While typing, Cmd+Z undoes the typing; once nothing typed is left, it goes on to the changes before.
        if (name !== "save" && typing && typing.element.innerHTML !== typing.originalHtml) return;
        event.preventDefault();
        if (typing && name !== "save") handlers.current.select(null);
        handlers.current.shortcut(name);
        return;
      }
      if (event.key === PANEL_KEY) {
        event.preventDefault();
        handlers.current.focusPanel();
        return;
      }
      const typing = handlers.current.textEdit;
      if (event.key === "Escape") {
        const left = handlers.current.selected;
        handlers.current.select(null);
        // The keyboard stays on the element just left, to go on from there with Tab.
        if (left?.isConnected) left.focus({ preventScroll: true });
        return;
      }
      // An element reached with Tab is selected with Enter or Space, as a click selects it. A link inside it is
      // clicked by Enter, which selects it the same way without leaving the page.
      const node = nodeOf(event.target);
      if ((event.key === "Enter" || event.key === " ") && node && node === event.target && node !== typing?.element) {
        event.preventDefault();
        handlers.current.select(node);
        return;
      }
      // One text is one element, so Enter makes a line break; rich text starts a new paragraph.
      if (event.key === "Enter" && typing?.element.dataset.brimKind === "text") {
        event.preventDefault();
        page.execCommand("insertLineBreak");
      }
    });
    /** Whether what is pasted or dropped goes into a text kept on one line, which takes its words alone. */
    const oneLine = (element: HTMLElement): boolean => element.dataset.brimKind !== "richtext";
    page.addEventListener("paste", (event) => {
      const typing = handlers.current.textEdit;
      if (!typing) return;
      // Pasted content brings foreign markup: a text keeps its words, rich text the formatting the editor knows.
      event.preventDefault();
      insertTransferred(page, readTransfer(event.clipboardData, !oneLine(typing.element)));
    });
    // Words selected on the page and dragged: moved within the text being typed, copied from elsewhere.
    let dragged: Range | null = null;
    page.addEventListener("dragstart", () => {
      const selection = page.getSelection();
      dragged = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    });
    page.addEventListener("dragend", () => (dragged = null));
    page.addEventListener("dragover", (event) => {
      const typing = handlers.current.textEdit;
      const into = typing && isElement(event.target) && typing.element.contains(event.target);
      // Only the text being typed takes a drop; a file dropped anywhere else would open in place of the page.
      if (!into || event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      }
    });
    page.addEventListener("drop", (event) => {
      // Never the browser's own drop: it would put the dropped markup in as it is, or open a dropped file.
      event.preventDefault();
      const typing = handlers.current.textEdit;
      const from = dragged;
      dragged = null;
      if (typing) dropTransferred(typing.element, event, from, !oneLine(typing.element));
    });

    const pending = reselect.current;
    reselect.current = null;
    const again = pending ? page.querySelector<HTMLElement>(`[data-brim-node="${pending}"]`) : null;
    // A block just added below the fold is brought into view, so the owner sees what was made.
    const box = again?.getBoundingClientRect();
    if (again && box && (box.top < 0 || box.bottom > view.innerHeight)) again.scrollIntoView({ block: "center" });
    setSelected(again);
    if (reread.current) {
      reread.current = false;
      setRevision((count) => count + 1);
    }
  }

  // Changes left unsaved last time are still in the draft.
  useEffect(() => {
    api.drafts().then(
      (answer) => setDraftCount(answer.drafts),
      () => undefined,
    );
  }, []);

  // The same shortcuts outside the page: in the toolbar and the side panel, except in a field being typed in.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // From the side panel back to the page, and from anywhere else in the editor to the side panel.
      if (event.key === PANEL_KEY && !handlers.current.browsing) {
        event.preventDefault();
        const panel = document.querySelector(".brim-editor-panel");
        if (panel?.contains(document.activeElement)) handlers.current.focusPage();
        else handlers.current.focusPanel();
        return;
      }
      const name = shortcutOf(event);
      if (!name) return;
      // The content browser covers the page: undo or save there would change what is out of sight.
      if (handlers.current.browsing) return;
      if (name !== "save" && typesItself(event.target)) return;
      event.preventDefault();
      handlers.current.shortcut(name);
    };
    const onFocusIn = (event: FocusEvent): void => {
      const field = event.target as HTMLInputElement | null;
      if (field && (field.tagName === "INPUT" || field.tagName === "TEXTAREA")) valueOnFocus.set(field, field.value);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  // Leaving with unsaved changes: drafts stay in the draft, but visitors do not see them until someone saves; text
  // being typed, or a save still on its way, would be lost.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (handlers.current.unsaved()) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // The Save button is offered from the first word typed, before the text is saved into the drafts.
  useEffect(() => {
    const element = textEdit?.element;
    if (!element) return;
    const onInput = (): void => setTyped(textEditChanged());
    element.addEventListener("input", onInput);
    return () => element.removeEventListener("input", onInput);
  }, [textEdit]);

  // Read again when the site map opens: templates just added to the code, pages just added through the MCP.
  useEffect(() => {
    if (!siteMapOpen) return;
    api.templates().then(
      ({ templates: list }) => setTemplates(list),
      () => undefined,
    );
    api.pages().then(
      ({ pages: list }) => setPages(list),
      () => undefined,
    );
  }, [siteMapOpen]);

  useEffect(() => {
    api.pages().then(
      ({ pages: list }) => setPages(list),
      () => undefined,
    );
  }, [path]);

  useEffect(() => {
    api.types().then(
      ({ types: list }) => setTypes(list),
      () => undefined,
    );
  }, []);

  // Whether the loaded page is an item's page; a page that is not has no template to edit.
  useEffect(() => {
    if (types.length === 0) return;
    let current = true;
    // The site's languages are waited for: until then a page under a language's prefix would not be recognised.
    loadSiteInfo()
      .then((info) => findItemPage(types, path, info.locales ?? null))
      .then(
        (found) => {
          if (!current) return;
          latestItem.current = found?.item ?? null;
          setItemPage(found);
          if (!found) setTemplateMode(false);
        },
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [types, path, browsed]);

  // What was being typed belongs to the page it was typed on.
  useEffect(() => setLiveField(null), [path]);

  // Typing into an element that shows one of the item's fields: the page settings and the field's other elements
  // on the page follow each keystroke.
  useEffect(() => {
    const element = textEdit?.element;
    if (!element || !isField(element) || isEntry(element) || templateMode) return;
    const field = element.dataset.brimField ?? "";
    const onInput = (): void => {
      const value =
        element.dataset.brimKind === "richtext" ? { blocks: readBlocks(element) } : element.innerText.trim();
      setLiveField({ field, value });
      previewField(field, value, element);
    };
    element.addEventListener("input", onInput);
    return () => element.removeEventListener("input", onInput);
  }, [textEdit, templateMode]);

  useEffect(() => {
    const address = path === "/" ? EDIT_PATH : `${EDIT_PATH}${path}`;
    history.replaceState(null, "", templateMode ? `${address}?template` : address);
  }, [path, templateMode]);

  const selectedKind = selected ? nodeKinds[selected.dataset.brimKind ?? ""] : undefined;
  const parent = selected ? parentNodeOf(selected) : null;
  const pageSeo = loadedSeo?.path === path ? loadedSeo : null;
  const sitePage = pages.find((page) => page.path === path) ?? {
    path,
    visibility: "published" as const,
    seo: pageSeo?.seo ?? {},
  };
  // The page of an item has the item's title, and is public when the item is.
  const currentPage = itemPage
    ? { ...sitePage, title: itemPage.item.title, visibility: itemPage.item.visibility }
    : sitePage;
  const editingContent = selected !== null && isField(selected) && !templateMode;
  // The item with what is being typed on the page, which the page settings show before it is saved.
  const shownItem =
    itemPage && liveField
      ? liveField.field === "title"
        ? { ...itemPage.item, title: String(liveField.value) }
        : { ...itemPage.item, data: { ...itemPage.item.data, [liveField.field]: liveField.value } }
      : itemPage?.item;

  // An element showing an item's field uploads like the item form does: to the item's folder, if the owner wants.
  const itemFolder: MediaFolder | undefined =
    selected?.dataset.brimItem && selected.dataset.brimItemType
      ? {
          key: `${selected.dataset.brimItemType}/${selected.dataset.brimItem}`,
          label: selected.dataset.brimItemTitle ?? selected.dataset.brimItemType,
        }
      : undefined;

  // Something the owner opened, as opposed to the page's settings shown when nothing else is: a phone shows only that.
  // Typing in a text is not asking for its panel: on a phone the panel would cover the text and its toolbar, which
  // has the same choices (element, alignment).
  const typingInPlace = textEdit !== null && textEdit.element === selected;
  const panelAsked =
    siteSettingsOpen ||
    historyOpen ||
    pageSettingsAsked ||
    Boolean(selected && hasSettings(selected) && !typingInPlace);
  // The side panel is always there: the selected element's settings, or else the page's, with its item's fields.
  const sidebar = historyOpen ? (
    <HistoryPanel
      path={path}
      onRestored={() => {
        // The page is drawn again with what came back; the lists of pages may have a page more.
        redraw();
        void refreshPages();
      }}
      onClose={() => setHistoryOpen(false)}
    />
  ) : siteSettingsOpen ? (
    <SiteSettings
      onClose={() => {
        setSiteSettingsOpen(false);
        setSettingFocus(undefined);
      }}
      focus={settingFocus}
      onSaved={() => redraw()}
      canManage={user.role === "owner"}
      locale={locales ? (localeOfPath(path, locales) ?? locales.defaultLocale) : undefined}
      onOpenResponses={
        user.permissions.includes("responses") ? (form) => browse(RESPONSES_FOLDER, false, undefined, form) : undefined
      }
    />
  ) : selected && selected.dataset.brimKind === "listing" ? (
    <ListingPanel
      key={`${path} ${selected.dataset.brimNode}`}
      element={selected}
      onOpen={(type) => browse(type)}
      onNew={(type, prefill) => browse(type, true, prefill)}
      onClose={() => select(null)}
    />
  ) : selected && isPickedField(selected) && itemPage && hasSettings(selected) ? (
    <PickedFieldPanel
      key={`${path} ${selected.dataset.brimNode} ${revision}`}
      element={selected}
      page={itemPage}
      // The element stays selected once the page is drawn again with the new value.
      onChange={(before, after) => void changeItemFields(before, after, selected.dataset.brimNode)}
      onClose={() => select(null)}
    />
  ) : selected && selectedKind && hasSettings(selected) ? (
    <MediaFolderContext.Provider value={itemFolder}>
      <Inspector
        key={`${path} ${templateMode} ${selected.dataset.brimNode} ${revision}`}
        element={selected}
        kind={selectedKind}
        note={
          selected.dataset.brimScope === "site"
            ? "Shared across the site: a change here shows on every page."
            : templateMode
              ? `Part of the ${typeName} template: a change here shows on every ${typeName}.`
              : undefined
        }
        only={
          isField(selected) && !isEntry(selected)
            ? (name) => IMAGE_CONTENT.includes(name) !== templateMode
            : // A bare image is only a picture and its description: there is no frame to shape, size or caption.
              selected.dataset.brimBare !== undefined
              ? (name) => IMAGE_CONTENT.includes(name)
              : selected.dataset.brimDrawn !== undefined
                ? (name) => DRAWN_SETTINGS.includes(name)
                : undefined
        }
        onChange={(form) => void changeFromInspector(selected, form)}
        layout={isEntry(selected) ? entryLayout(selected) : undefined}
        onReset={editingContent ? undefined : () => void reset(selected)}
        resetNote={
          selected.dataset.brimScope === "site"
            ? "This element is shared across the site, so it changes back on every page."
            : templateMode
              ? `This is part of the ${typeName} template, so it changes back on every ${typeName}.`
              : "Only this page changes back."
        }
        onClose={() => select(null)}
      />
    </MediaFolderContext.Provider>
  ) : templateMode && itemPage ? (
    <Sidebar title={`${itemPage.type.singular} template`}>
      <p className="brim-sidebar-note">
        Select a part of the page to change it on every {typeName}. The {typeName}'s own content stays locked here.
      </p>
    </Sidebar>
  ) : (
    <PageSettings
      // Drawn afresh once the page turns out to be an item's, so the item's fields start open.
      key={`${itemPage?.item.id ?? path} ${revision}`}
      page={currentPage}
      own={pageSeo?.own}
      item={
        itemPage && shownItem
          ? {
              ...itemPage,
              item: shownItem,
              onChange: (draft) => void changeItemFields(shownItem, draft),
              onDraft: (field, value) => previewField(field, value),
            }
          : undefined
      }
      isOwner={user.role === "owner"}
      onChange={(seo) => void changeSeo(seo)}
      onMove={movePage}
      onPassword={setPagePassword}
      onClose={() => setPageSettingsAsked(false)}
    />
  );

  const draftControls: DraftControls = {
    count: draftCount,
    typing: typed,
    saving: savingDrafts,
    onSave: () => void saveDrafts(),
    onDiscard: () => void discardDrafts(),
    onUndo: undoSteps.current.length > 0 ? () => void replay(true) : undefined,
    onRedo: redoSteps.current.length > 0 ? () => void replay(false) : undefined,
  };

  return (
    <EditorProvider value={{ pages, viewport }}>
      {browsing && (
        <ContentBrowser
          pages={pages}
          initialFolder={browsing.folder}
          initialCreate={browsing.create}
          initialData={browsing.data}
          initialForm={browsing.form}
          initialResponse={browsing.response}
          run={run}
          onBack={leaveBrowser}
          onEditPage={navigate}
          onEditTemplate={editTemplate}
          onPagesChanged={() => void refreshPages()}
        />
      )}
      {/* The page stays loaded behind the browser, so coming back is instant. */}
      <div className="brim-editor" hidden={browsing !== null}>
        <Toolbar
          user={user}
          page={currentPage}
          viewport={viewport}
          status={status}
          drafts={draftControls}
          siteMapOpen={siteMapOpen}
          pageSettingsOpen={!siteSettingsOpen && !historyOpen && !(selected && hasSettings(selected))}
          onSiteMap={() => setSiteMapOpen(!siteMapOpen)}
          onContent={() => browse()}
          onViewport={(next) => {
            // A device gives the page its own width again, also the one already chosen.
            setViewport(next);
            setFrameWidth(null);
          }}
          onVisibility={(visibility) => void changeVisibility(visibility)}
          onPageSettings={() => {
            select(null);
            setSiteSettingsOpen(false);
            setHistoryOpen(false);
            setPageSettingsAsked(!pageSettingsAsked);
          }}
          onHistory={() => {
            select(null);
            setSiteSettingsOpen(false);
            setHistoryOpen(true);
          }}
          onSiteSettings={
            // The site's own settings (phone, email…) are content; owners also get the form emails and redirects.
            user.permissions.includes("content")
              ? () => {
                  select(null);
                  setHistoryOpen(false);
                  setSiteSettingsOpen(true);
                }
              : undefined
          }
          onChangePassword={() => setChangingPassword(true)}
          onSignOut={() =>
            void finishTextEdit()
              .then(() => api.signOut())
              .then(onSignedOut)
          }
          languages={languageChoice}
          onLanguage={(code, fill) => void switchLanguage(code, fill)}
          template={
            itemPage && templateMode
              ? {
                  title: `${itemPage.type.singular} template`,
                  note:
                    itemPage.count === 1
                      ? `Changes show on every ${typeName}`
                      : `Changes show on all ${itemPage.count} ${itemPage.type.label.toLowerCase()}`,
                  onDone: () => switchMode(false),
                }
              : undefined
          }
          onEditTemplate={
            itemPage && !templateMode && user.permissions.includes("templates") ? () => switchMode(true) : undefined
          }
        />
        {siteMapOpen && (
          <SiteMap
            pages={pages}
            templates={templates}
            currentPath={path}
            onNavigate={navigate}
            onBrowse={browse}
            onCreate={createPage}
            onDelete={deletePage}
            onClose={() => setSiteMapOpen(false)}
          />
        )}
        <div
          ref={setWorkspaceElement}
          className="brim-editor-workspace"
          style={
            sidebarWidth === null ? undefined : ({ "--brim-sidebar-chosen": `${sidebarWidth}px` } as CSSProperties)
          }
        >
          <main ref={setCanvasElement} className="brim-editor-canvas" data-viewport={viewport}>
            <div
              ref={setFrameElement}
              className="brim-editor-frame"
              style={frameWidth === null ? undefined : { width: frameWidth, flex: "none" }}
            >
              {[0, 1].map((slot) => (
                <iframe
                  key={slot}
                  ref={(element) => {
                    slots.current[slot] = element;
                    if (slot === shown) frame.current = element;
                  }}
                  title={slot === shown ? "Page being edited" : "Page being drawn again"}
                  src={slot === 0 ? initialPath : "about:blank"}
                  data-hidden={slot === shown ? undefined : ""}
                  aria-hidden={slot === shown ? undefined : true}
                  tabIndex={slot === shown ? undefined : -1}
                  onLoad={() => frameLoaded(slot)}
                />
              ))}
              <Chrome
                hovered={hovered}
                selected={selected}
                editing={textEdit?.element ?? null}
                // A plain text field keeps its words only; rich text fields and everything else take formatting.
                formatting={!(textEdit && isField(textEdit.element) && textEdit.element.dataset.brimKind === "text")}
                locked={selected ? lockOf(selected) : undefined}
                binding={selected ? bindingOf(selected) : undefined}
                stack={selected ? stackOf(selected) : undefined}
                inserters={stacks.flatMap((stack) => {
                  // A selected block of the stack gets the +, to add after it; otherwise the stack's end does.
                  const anchor = selected && isEntry(selected) && stack.contains(selected) ? selected : stack;
                  const actions = stackOf(anchor);
                  return actions ? [{ anchor, actions }] : [];
                })}
                onTextElement={(tag) => textEdit && void changeTextPresentation(textEdit.element, { as: tag })}
                onSelectParent={parent ? () => select(parent) : undefined}
              />
              <FrameHandles
                canvas={canvasElement}
                frame={frameElement}
                width={frameWidth}
                dragging={frameDragging}
                onWidth={setFrameWidth}
                onDragging={setFrameDragging}
              />
            </div>
          </main>
          {/* Says which element is selected, for those who cannot see the outline; the panel is one key away. */}
          <div className="brim-visually-hidden" role="status" aria-live="polite">
            {selected
              ? `${nodeLabel(selected)} selected.${hasSettings(selected) ? " Press F6 for its settings." : ""}`
              : ""}
          </div>
          <div className="brim-editor-panel" data-asked={panelAsked ? "" : undefined}>
            <SidebarHandle workspace={workspaceElement} width={sidebarWidth} onWidth={setSidebarWidth} />
            {sidebar}
          </div>
        </div>
      </div>
      {changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
    </EditorProvider>
  );
}

/**
 * Beside an element showing one of the item's picked values: the field's widget, the same as in the item form. The
 * page is drawn again with the new value once it is saved.
 */
function PickedFieldPanel({
  element,
  page,
  onChange,
  onClose,
}: {
  element: HTMLElement;
  page: ItemPage;
  onChange: (before: ItemDraft, after: ItemDraft) => void;
  onClose: () => void;
}) {
  const name = element.dataset.brimField ?? "";
  const field = page.type.fields.find((candidate) => candidate.name === name);
  const { item } = page;
  return (
    <Sidebar title={field?.label ?? name} onClose={onClose}>
      {field ? (
        <ItemField
          type={page.type}
          field={field}
          value={item.data[name]}
          onChange={(value) => onChange(item, { ...item, data: { ...item.data, [name]: value } })}
        />
      ) : (
        <p className="brim-sidebar-note">
          {page.type.singular} has no field "{name}" any more. Its element on the page can be removed from the code.
        </p>
      )}
      <p className="brim-sidebar-note">Saved into this {page.type.singular.toLowerCase()}, like in its form.</p>
    </Sidebar>
  );
}
