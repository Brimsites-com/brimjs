import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { itemPagePath } from "../../server/locales.ts";
import { type ContentType, type Item, type SitePage, api } from "./api.ts";
import { useEditor } from "./context.ts";
import { ArrowLeftIcon, ChevronRightIcon, CloseIcon, FolderIcon, LinkIcon, PageIcon, SearchIcon } from "./icons.tsx";
import { useSiteLocales } from "./languages.ts";
import { pageTitle } from "./Toolbar.tsx";
import { isComposing } from "./keys.ts";

/**
 * The editor's one widget for a link, wherever a link is edited: block settings, the navbar and link primitives,
 * the item form. Type or paste an address, or browse: the site's pages and items, a part of a page, a website, an
 * email address or a phone number. Optionally with "Open in new tab".
 */
export function LinkWidget({
  label,
  description,
  value,
  placeholder = "Paste a link or browse the site",
  newTab,
  autoFocus = false,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  value: string;
  placeholder?: string | undefined;
  newTab?: { checked: boolean; onChange: (checked: boolean) => void } | undefined;
  /** In a popover opened for it, such as the text toolbar's link. */
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="field-group brim-url-widget">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <div className="url-input-box">
        <LinkIcon />
        <input
          ref={input}
          type="text"
          aria-label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft !== value && onChange(draft.trim())}
          onKeyDown={(event) => event.key === "Enter" && !isComposing(event) && event.currentTarget.blur()}
        />
        <button type="button" className="url-browse-btn" aria-haspopup="dialog" onClick={() => setPicking(true)}>
          Browse
        </button>
      </div>
      {value && (
        <div className="url-actions">
          <span className="url-actions__label">{describeLink(value)}</span>
          <button type="button" className="url-action" onClick={() => input.current?.select()}>
            Change
          </button>
          <a className="url-action" href={value} target="_blank" rel="noreferrer">
            Open
          </a>
          <button type="button" className="url-action" onClick={() => onChange("")}>
            Clear
          </button>
        </div>
      )}
      {newTab && (
        <label className="url-newtab-row field-label-checkbox">
          <input
            className="field-checkbox"
            type="checkbox"
            checked={newTab.checked}
            onChange={(event) => newTab.onChange(event.target.checked)}
          />
          <span className="checkbox-label-text">Open in new tab</span>
        </label>
      )}
      {picking && (
        <LinkPicker
          current={value}
          onPick={(link) => {
            setPicking(false);
            onChange(link);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/** What a link points to, in words: "Email", "Phone", "Website", or the part of the site. */
function describeLink(link: string): string {
  if (link.startsWith("mailto:")) return "Email";
  if (link.startsWith("tel:")) return "Phone";
  if (/^https?:\/\//.test(link)) return "Website";
  if (link.includes("#")) return "Part of a page";
  return "Page of the site";
}

type Tab = "site" | "external";
type ExternalKind = "url" | "email" | "phone";

const EXTERNAL_KINDS: { key: ExternalKind; label: string; placeholder: string; prefix: string }[] = [
  { key: "url", label: "Website", placeholder: "https://example.com", prefix: "" },
  { key: "email", label: "Email", placeholder: "name@example.com", prefix: "mailto:" },
  { key: "phone", label: "Phone", placeholder: "+40 123 456 789", prefix: "tel:" },
];

/** A page or item the site has, as the picker lists it. */
interface Destination {
  path: string;
  title: string;
  /** "Page", or the item's type ("Project"). */
  kind: string;
  private: boolean;
}

/** A part of a page a link can open at: an element of the page with an `id`. */
interface Target {
  id: string;
  title: string;
  kind: string;
}

/**
 * The picker behind every link widget, and the text toolbar's link: the site's pages and items (search, private ones
 * marked), then the whole page or a part of it; or a website, an email address, a phone number.
 */
export function LinkPicker({
  current,
  onPick,
  onClose,
}: {
  /** The link being changed, to open on its tab and mark it. */
  current: string;
  onPick: (link: string) => void;
  onClose: () => void;
}) {
  const external = /^(https?:\/\/|mailto:|tel:)/.test(current);
  const [tab, setTab] = useState<Tab>(external ? "external" : "site");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isComposing(event)) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="cb-modal-overlay" onClick={onClose}>
      <div
        className="brim-link-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a link"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="brim-link-picker__header">
          <h3>Choose a link</h3>
          <button type="button" className="brim-sidebar-close-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="brim-link-picker__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "site"} onClick={() => setTab("site")}>
            <PageIcon />
            Site
          </button>
          <button type="button" role="tab" aria-selected={tab === "external"} onClick={() => setTab("external")}>
            <LinkIcon />
            Website, email or phone
          </button>
        </div>
        {tab === "site" ? (
          <SiteTab current={current} onPick={onPick} />
        ) : (
          <ExternalTab current={external ? current : ""} onPick={onPick} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function ExternalTab({ current, onPick }: { current: string; onPick: (link: string) => void }) {
  const initial = EXTERNAL_KINDS.find((kind) => kind.prefix && current.startsWith(kind.prefix)) ?? EXTERNAL_KINDS[0]!;
  const [kind, setKind] = useState(initial);
  const [value, setValue] = useState(current.slice(initial.prefix.length));

  function apply(event: FormEvent): void {
    event.preventDefault();
    const typed = value.trim();
    if (!typed) return;
    if (kind.key === "url") return onPick(/^https?:\/\//.test(typed) ? typed : `https://${typed}`);
    onPick(kind.prefix + (kind.key === "phone" ? typed.replace(/[^\d+]/g, "") : typed));
  }

  return (
    <form className="brim-link-picker__body" onSubmit={apply}>
      <div className="brim-link-picker__kinds" role="radiogroup" aria-label="Kind of link">
        {EXTERNAL_KINDS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={option.key === kind.key}
            onClick={() => setKind(option)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <input
        className="field-input"
        type={kind.key === "email" ? "email" : kind.key === "phone" ? "tel" : "text"}
        aria-label={kind.label}
        placeholder={kind.placeholder}
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="cb-modal-actions">
        <button type="submit" className="cb-new-btn" disabled={value.trim() === ""}>
          Use this link
        </button>
      </div>
    </form>
  );
}

function SiteTab({ current, onPick }: { current: string; onPick: (link: string) => void }) {
  const { pages } = useEditor();
  const locales = useSiteLocales();
  const [types, setTypes] = useState<ContentType[]>([]);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Destination | null>(null);

  useEffect(() => {
    void (async () => {
      const { types: list } = await api.types();
      const withPages = list.filter((type) => type.hasPage);
      const lists = await Promise.all(withPages.map((type) => api.items(type.key)));
      setTypes(withPages);
      setItems(Object.fromEntries(withPages.map((type, index) => [type.key, lists[index]?.items ?? []])));
    })().catch(() => undefined);
  }, []);

  const groups = useMemo(() => {
    const pageDestinations = pages.map((page: SitePage): Destination => ({
      path: page.path,
      title: pageTitle(page.path, page.title),
      kind: "Page",
      private: page.visibility === "private",
    }));
    const all = [
      { title: "Pages", destinations: pageDestinations },
      ...types.map((type) => ({
        title: type.label,
        destinations: (items[type.key] ?? []).map((item): Destination => ({
          path: itemPagePath(type, item, locales ?? undefined),
          title: item.title,
          kind: type.singular,
          private: item.visibility === "private",
        })),
      })),
    ];
    const words = query.trim().toLowerCase();
    return all
      .map((group) => ({
        ...group,
        destinations: words
          ? group.destinations.filter((one) => `${one.title} ${one.path}`.toLowerCase().includes(words))
          : group.destinations,
      }))
      .filter((group) => group.destinations.length > 0);
  }, [pages, types, items, locales, query]);

  if (chosen) return <TargetStep destination={chosen} onBack={() => setChosen(null)} onPick={onPick} />;

  const currentPath = current.split("#")[0];
  return (
    <div className="brim-link-picker__body">
      <label className="brim-link-picker__search">
        <SearchIcon />
        <input
          type="search"
          aria-label="Search the site"
          placeholder="Search pages and content…"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="brim-link-picker__list">
        {groups.length === 0 && <p className="brim-sidebar-note">Nothing matches "{query}".</p>}
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h4 className="brim-link-picker__group">{group.title}</h4>
            {group.destinations.map((destination) => (
              <div
                key={destination.path}
                className="brim-link-picker__row"
                aria-current={destination.path === currentPath ? "true" : undefined}
              >
                <button type="button" className="brim-link-picker__choose" onClick={() => onPick(destination.path)}>
                  {destination.kind === "Page" ? <PageIcon /> : <FolderIcon />}
                  <span className="brim-link-picker__text">
                    <span className="brim-link-picker__title">{destination.title}</span>
                    <code>{destination.path}</code>
                  </span>
                  {destination.private && <span className="cb-badge cb-badge-status private">private</span>}
                </button>
                <button
                  type="button"
                  className="brim-link-picker__parts"
                  title="Link to a part of this page"
                  aria-label={`Link to a part of ${destination.title}`}
                  onClick={() => setChosen(destination)}
                >
                  <ChevronRightIcon />
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Elements that make sense to open a page at; a script's or an input's id does not. */
const TARGET_TAGS: Record<string, string> = {
  SECTION: "Section",
  HEADER: "Section",
  FOOTER: "Section",
  MAIN: "Section",
  ARTICLE: "Section",
  ASIDE: "Section",
  NAV: "Section",
  DIV: "Section",
  FIGURE: "Section",
  FORM: "Form",
  H1: "Heading",
  H2: "Heading",
  H3: "Heading",
  H4: "Heading",
  H5: "Heading",
  H6: "Heading",
};

/** The page as visitors get it, read for the elements with an `id`: the parts a link can open at. */
async function targetsOf(path: string): Promise<Target[]> {
  const html = await (await fetch(path, { credentials: "same-origin" })).text();
  const page = new DOMParser().parseFromString(html, "text/html");
  const seen = new Set<string>();
  return [...page.body.querySelectorAll<HTMLElement>("[id]")].flatMap((element) => {
    const kind = TARGET_TAGS[element.tagName];
    const id = element.id;
    // A tab's panel or a hidden element only shows once something on the page opens it.
    const hidden = element.closest('[hidden], [aria-hidden="true"], [role="tabpanel"], template');
    if (!kind || !id || seen.has(id) || hidden || /^(astro|brim)/.test(id)) return [];
    seen.add(id);
    const heading = kind === "Heading" ? element : element.querySelector("h1, h2, h3, h4, h5, h6");
    const words = (heading?.textContent ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
    return [{ id, kind, title: words.length > 70 ? `${words.slice(0, 69)}…` : words || id }];
  });
}

function TargetStep({
  destination,
  onBack,
  onPick,
}: {
  destination: Destination;
  onBack: () => void;
  onPick: (link: string) => void;
}) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    targetsOf(destination.path).then(setTargets, () => setError(true));
  }, [destination.path]);

  return (
    <div className="brim-link-picker__body">
      <div className="brim-link-picker__step">
        <button type="button" className="brim-sidebar-close-btn" aria-label="Back to the site" onClick={onBack}>
          <ArrowLeftIcon />
        </button>
        <span>
          <span className="brim-link-picker__kicker">Link to a part of</span>
          <span className="brim-link-picker__title">{destination.title}</span>
        </span>
      </div>
      <div className="brim-link-picker__list">
        <div className="brim-link-picker__row">
          <button type="button" className="brim-link-picker__choose" onClick={() => onPick(destination.path)}>
            <PageIcon />
            <span className="brim-link-picker__text">
              <span className="brim-link-picker__title">Whole page</span>
              <code>{destination.path}</code>
            </span>
          </button>
        </div>
        {error && <p className="field-error">This page could not be read.</p>}
        {!error && targets === null && <p className="brim-sidebar-note">Reading the page…</p>}
        {targets?.length === 0 && (
          <p className="brim-sidebar-note">
            This page has no parts to link to: its code gives none of its sections an id.
          </p>
        )}
        {targets?.map((target) => (
          <div key={target.id} className="brim-link-picker__row">
            <button
              type="button"
              className="brim-link-picker__choose"
              onClick={() => onPick(`${destination.path}#${target.id}`)}
            >
              <span className="brim-link-picker__kind">{target.kind}</span>
              <span className="brim-link-picker__text">
                <span className="brim-link-picker__title">{target.title}</span>
                <code>#{target.id}</code>
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
