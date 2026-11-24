import type { SitePage, User, Visibility } from "./api.ts";
import {
  ChevronDownIcon,
  DesktopIcon,
  EyeIcon,
  FolderIcon,
  MobileIcon,
  MoreIcon,
  PageIcon,
  RedoIcon,
  SettingsIcon,
  TabletIcon,
  TemplateIcon,
  UndoIcon,
} from "./icons.tsx";
import { Menu } from "./Menu.tsx";
import { type Theme, useTheme } from "./theme.ts";

export type Viewport = "desktop" | "tablet" | "mobile";

export interface LanguageChoice {
  current: string;
  options: { code: string; path: string; exists: boolean }[];
  /** Whether this page's text can be copied into the other languages: a page's can, an item's is its own. */
  copy: boolean;
}

export interface SaveStatus {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
}

const VIEWPORTS = [
  { value: "desktop", label: "Desktop · 992px and up", Icon: DesktopIcon },
  { value: "tablet", label: "Tablet · 480–991px", Icon: TabletIcon },
  { value: "mobile", label: "Mobile · 479px and below", Icon: MobileIcon },
] as const;

const STATUS_TEXT: Record<SaveStatus["state"], string> = {
  idle: "",
  saving: "",
  saved: "All changes saved",
  error: "Could not save",
};

/**
 * Changes wait in a draft only the editor shows until they are saved. `count` is how many there are on the whole
 * site; undo and redo step through the ones made in this window.
 */
export interface DraftControls {
  count: number;
  /** Text typed on the page that is not in the drafts yet: Save saves it first. */
  typing: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

/** A page added from a template has its own title; otherwise `/about/team` → `Team`. */
export function pageTitle(path: string, title?: string): string {
  if (title) return title;
  const segment = path.split("/").filter(Boolean).at(-1);
  if (!segment) return "Home";
  return segment.charAt(0).toUpperCase() + segment.slice(1).replaceAll("-", " ");
}

/** The editor's top bar: where you are, who can see it, the preview size, and the page's own settings. */
export function Toolbar({
  user,
  page,
  viewport,
  status,
  drafts,
  siteMapOpen,
  pageSettingsOpen,
  onSiteMap,
  onContent,
  onViewport,
  onVisibility,
  onPageSettings,
  onSiteSettings,
  onChangePassword,
  onHistory,
  onSignOut,
  languages,
  onLanguage,
  template,
  onEditTemplate,
}: {
  user: User;
  page: SitePage;
  viewport: Viewport;
  status: SaveStatus;
  drafts: DraftControls;
  siteMapOpen: boolean;
  pageSettingsOpen: boolean;
  onSiteMap: () => void;
  /** Opens the content browser: the site's content types and their items. */
  onContent: () => void;
  onViewport: (viewport: Viewport) => void;
  onVisibility: (visibility: Visibility) => void;
  onPageSettings: () => void;
  /** Absent for editors: Site Settings are the owners'. */
  onSiteSettings?: (() => void) | undefined;
  /** Opens the form to change one's own password; absent when the user signed in another way (an access token). */
  onChangePassword?: (() => void) | undefined;
  /** Opens the site's history: what changed lately, and taking a change back. */
  onHistory: () => void;
  onSignOut: () => void;
  /** The page's language and the same page in the site's other languages; absent on a site with one language. */
  languages?: LanguageChoice | undefined;
  /** `fill`: copy this page's text into that language where it has none, then open it. */
  onLanguage?: (code: string, fill: boolean) => void;
  /** Set while a content type's template is edited: the bar names it and offers to go back to the item. */
  template?: { title: string; note: string; onDone: () => void } | undefined;
  /** Set on the page of an item whose type's template can be edited. */
  onEditTemplate?: (() => void) | undefined;
}) {
  const isPublic = page.visibility === "published";
  const canPublish = user.permissions.includes("publish");

  return (
    <header className="brim-editor-toolbar">
      <div className="toolbar-zone toolbar-zone-left">
        {template ? (
          <>
            <span className="toolbar-template">
              <strong>{template.title}</strong>
              {template.note}
            </span>
            <button type="button" className="brim-toolbar-btn brim-toolbar-btn--outline" onClick={template.onDone}>
              Done
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="breadcrumb-page-trigger"
              aria-expanded={siteMapOpen}
              aria-label="Site map"
              title="Site map"
              onClick={onSiteMap}
            >
              <span className="breadcrumb-page-icon">
                <PageIcon />
              </span>
              <span className="breadcrumb-page-title">{pageTitle(page.path, page.title)}</span>
              <ChevronDownIcon />
            </button>
            {languages && (
              <Menu
                label="Language of this page"
                className="brim-toolbar-btn brim-toolbar-btn--outline toolbar-language"
                trigger={
                  <>
                    {languages.current.toUpperCase()}
                    <ChevronDownIcon />
                  </>
                }
              >
                {(close) => (
                  <>
                    {languages.options.map((option) => (
                      <button
                        key={option.code}
                        type="button"
                        role="menuitem"
                        className="brim-editor-menu__item"
                        aria-current={option.code === languages.current ? "true" : undefined}
                        onClick={() => {
                          close();
                          if (option.code !== languages.current) onLanguage?.(option.code, false);
                        }}
                      >
                        <span>{option.code.toUpperCase()}</span>
                        <code>
                          {option.code === languages.current
                            ? "This page"
                            : option.exists
                              ? option.path
                              : `Translate into ${option.code.toUpperCase()}`}
                        </code>
                      </button>
                    ))}
                    {languages.copy &&
                      languages.options.some((option) => option.code !== languages.current && option.exists) && (
                        <div className="brim-editor-menu__separator" />
                      )}
                    {languages.options
                      .filter((option) => languages.copy && option.code !== languages.current && option.exists)
                      .map((option) => (
                        <button
                          key={`copy-${option.code}`}
                          type="button"
                          role="menuitem"
                          className="brim-editor-menu__item"
                          onClick={() => {
                            close();
                            onLanguage?.(option.code, true);
                          }}
                        >
                          <span>Copy this page's text to {option.code.toUpperCase()}</span>
                          <code>Only where {option.code.toUpperCase()} has none yet</code>
                        </button>
                      ))}
                  </>
                )}
              </Menu>
            )}
            <button
              type="button"
              className="brim-toolbar-btn brim-toolbar-btn--outline"
              title="Content: the site's content types and their items"
              aria-label="Content"
              onClick={onContent}
            >
              <FolderIcon />
              <span className="brim-toolbar-label">Content</span>
            </button>
            <span className="toolbar-zone-divider" />
            {!canPublish && (
              <span
                className="toolbar-status-pill"
                title={`${isPublic ? "Public" : "Private"}: your role cannot publish or unpublish`}
              >
                <span className="toolbar-status-dot" data-state={page.visibility} />
                <span className="toolbar-status-text">{isPublic ? "Public" : "Private"}</span>
              </span>
            )}
            {canPublish && (
              <Menu
                label="Who can see this page"
                className="toolbar-status-pill"
                trigger={
                  <>
                    <span className="toolbar-status-dot" data-state={page.visibility} />
                    <span className="toolbar-status-text">{isPublic ? "Public" : "Private"}</span>
                    <ChevronDownIcon />
                  </>
                }
              >
                {(close) => (
                  <button
                    type="button"
                    role="menuitem"
                    className="brim-editor-menu__item"
                    onClick={() => {
                      close();
                      onVisibility(isPublic ? "private" : "published");
                    }}
                  >
                    <span>{isPublic ? "Make Private" : "Make Public"}</span>
                    <code>{isPublic ? "Only in the editor" : "On the public site"}</code>
                  </button>
                )}
              </Menu>
            )}
            {onEditTemplate && (
              <button
                type="button"
                className="brim-toolbar-btn brim-toolbar-btn--outline"
                title="Edit template: change what every item of this type shows"
                aria-label="Edit template"
                onClick={onEditTemplate}
              >
                <TemplateIcon />
                <span className="brim-toolbar-label">Edit template</span>
              </button>
            )}
          </>
        )}
        <span className="brim-editor-autosave" role="status" data-state={status.state} title={status.message}>
          {status.state === "error"
            ? (status.message ?? STATUS_TEXT.error)
            : drafts.count > 0
              ? `${drafts.count} unsaved ${drafts.count === 1 ? "change" : "changes"}`
              : STATUS_TEXT[status.state]}
        </span>
      </div>

      <div className="toolbar-zone toolbar-zone-center">
        <div className="device-preview-pill" role="group" aria-label="Preview size">
          {VIEWPORTS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className="brim-toolbar-btn brim-toolbar-btn--icon"
              aria-pressed={viewport === value}
              aria-label={label}
              title={label}
              onClick={() => onViewport(value)}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-zone toolbar-zone-right">
        <button
          type="button"
          className="brim-toolbar-btn brim-toolbar-btn--icon"
          aria-label="Undo"
          title={`Undo (${MOD}Z)`}
          disabled={!drafts.onUndo}
          onClick={drafts.onUndo}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="brim-toolbar-btn brim-toolbar-btn--icon toolbar-redo"
          aria-label="Redo"
          title={`Redo (${isMac ? "⇧⌘Z" : "Ctrl+Y"})`}
          disabled={!drafts.onRedo}
          onClick={drafts.onRedo}
        >
          <RedoIcon />
        </button>
        {drafts.count > 0 && (
          <button
            type="button"
            className="brim-toolbar-btn brim-toolbar-btn--outline"
            title="Throw away every unsaved change"
            disabled={drafts.saving}
            onClick={drafts.onDiscard}
          >
            Discard
          </button>
        )}
        <button
          type="button"
          className="brim-toolbar-btn brim-toolbar-btn--action brim-toolbar-save"
          title={drafts.count > 0 || drafts.typing ? `Save, so visitors see the changes (${MOD}S)` : "Nothing to save"}
          disabled={(drafts.count === 0 && !drafts.typing) || drafts.saving}
          onClick={drafts.onSave}
        >
          {drafts.saving ? "Saving…" : "Save"}
        </button>
        <span className="toolbar-separator" />
        <a
          className="brim-toolbar-btn brim-toolbar-btn--icon toolbar-preview"
          href={page.path}
          target="_blank"
          rel="noreferrer"
          title="Preview page"
          aria-label="Preview page"
        >
          <EyeIcon />
        </a>
        <span className="toolbar-separator" />
        {!template && (
          <button
            type="button"
            className="brim-toolbar-btn brim-toolbar-btn--icon"
            aria-pressed={pageSettingsOpen}
            aria-label="Page settings"
            title="Page settings"
            onClick={onPageSettings}
          >
            <SettingsIcon />
          </button>
        )}
        <Menu label="Account" className="brim-toolbar-btn brim-toolbar-btn--icon" align="end" trigger={<MoreIcon />}>
          {(close) => (
            <>
              <p className="brim-editor-menu__note">{user.email}</p>
              <div className="brim-editor-menu__separator" />
              <button
                type="button"
                role="menuitem"
                className="brim-editor-menu__item"
                onClick={() => {
                  close();
                  onHistory();
                }}
              >
                History
              </button>
              {onSiteSettings && (
                <button
                  type="button"
                  role="menuitem"
                  className="brim-editor-menu__item"
                  onClick={() => {
                    close();
                    onSiteSettings();
                  }}
                >
                  Site settings
                </button>
              )}
              <ThemeChoice />
              <div className="brim-editor-menu__separator" />
              {onChangePassword && (
                <button
                  type="button"
                  role="menuitem"
                  className="brim-editor-menu__item"
                  onClick={() => {
                    close();
                    onChangePassword();
                  }}
                >
                  Change password
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="brim-editor-menu__item"
                onClick={() => {
                  close();
                  onSignOut();
                }}
              >
                Sign out
              </button>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Light, dark, or as the system is: the editor's own appearance, remembered in this browser. */
function ThemeChoice() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="brim-editor-menu__theme" role="group" aria-label="Appearance">
      <span className="brim-editor-menu__theme-label">Appearance</span>
      <div className="brim-editor-menu__theme-options">
        {THEMES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={theme === option.value}
            className="brim-editor-menu__theme-option"
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
