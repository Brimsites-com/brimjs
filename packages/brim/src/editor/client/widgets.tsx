/** Sidebar controls carried over from BrimCMS. Each mirrors the control the grid editor had for the same setting. */
import { type ReactNode, createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Icon, IconSearch, IconSetInfo } from "../../icons/library.ts";
import { IMAGE_SHAPES, type ImageShape } from "../../blocks/data/image-shapes.ts";
import { SOCIAL_NETWORKS, orderSocialNetworks } from "../../blocks/data/social-networks.ts";
import { THEME_COLOR_DEFAULTS } from "../../blocks/theme.ts";
import type { ImageFocus } from "../../content/types.ts";
import { type MediaFile, api } from "./api.ts";
import { useBrandColors } from "./brand.ts";
import { ArrowLeftIcon, ChevronRightIcon, PlusIcon } from "./icons.tsx";
import { isComposing } from "./keys.ts";

interface Option {
  value: string;
  label: string;
}

/** A slider with a number box beside it. Double-click the slider to go back to the default. */
export function RangeWidget({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  value: number;
  min: number;
  max: number;
  step?: number | undefined;
  defaultValue?: number | undefined;
  onChange: (value: number) => void;
}) {
  const id = useId();
  /** Where the slider is while it is dragged: the change is saved once, when it is let go. */
  const [dragged, setDragged] = useState<number | null>(null);
  const shown = dragged ?? value;
  const release = (): void => {
    if (dragged === null) return;
    setDragged(null);
    if (dragged !== value) onChange(dragged);
  };
  const percent = ((shown - min) / (max - min)) * 100;
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {description && <p className="field-description">{description}</p>}
      <div className="field-range-control">
        <input
          id={id}
          className="field-range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          style={{ "--range-pct": `${percent}%` } as React.CSSProperties}
          onChange={(event) => setDragged(Number(event.target.value))}
          onPointerUp={release}
          onKeyUp={release}
          onBlur={release}
          onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        />
        <NumberBox
          className="field-input field-range-number"
          label={label}
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/**
 * A number box that keeps what is typed as it is and brings it within its bounds once done (on blur or Enter):
 * clamping each keystroke would turn the "1" of "12" into the minimum before the "2" is typed.
 */
function NumberBox({
  className,
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  className: string;
  label?: string | undefined;
  min: number;
  max: number;
  step?: number | undefined;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const next = clamp(Number(draft), min, max);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <input
      className={className}
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && !isComposing(event) && commit()}
    />
  );
}

/** A row of named sizes. When the schema names a custom-value setting, "custom" reveals a number box for it. */
export function SizeWidget({
  label,
  description,
  options,
  value,
  custom,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  options: Option[];
  value: string;
  custom?:
    | { title: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }
    | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <div className="size-picker" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="size-btn"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {custom && value === "custom" && (
        <label className="size-custom">
          <span className="field-description">{custom.title}</span>
          <NumberBox
            className="field-input"
            min={custom.min}
            max={custom.max}
            step={custom.step}
            value={custom.value}
            onChange={custom.onChange}
          />
        </label>
      )}
    </div>
  );
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Round swatches of the site's theme colors, then a custom color. Stores a theme key or a hex color. */
export function ColorSelectWidget({
  label,
  description,
  options,
  value,
  allowCustom,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  options: Option[];
  value: string;
  allowCustom: boolean;
  onChange: (value: string) => void;
}) {
  const brand = useBrandColors();
  const isBrand = brand.some((color) => color.value === value.toLowerCase());
  const isCustom = HEX.test(value) && !isBrand;
  /**
   * The color being picked: shown on the swatch as the picker moves, saved once when the picker closes (the
   * browser's "change"), not on every step of the drag.
   */
  const [picking, setPicking] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const done = (): void => {
      setPicking(null);
      changeRef.current(input.value);
    };
    input.addEventListener("change", done);
    return () => input.removeEventListener("change", done);
  }, [allowCustom]);
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <div className="rwcs-inline-colors" role="group" aria-label={label}>
        {allowCustom &&
          brand.map((color) => (
            <button
              key={`brand-${color.value}-${color.name}`}
              type="button"
              className="rwcs-swatch rwcs-swatch--brand"
              aria-pressed={color.value === value.toLowerCase()}
              aria-label={`${color.name} (brand)`}
              title={`${color.name} · brand color`}
              style={{ "--swatch": color.value } as React.CSSProperties}
              onClick={() => onChange(color.value)}
            />
          ))}
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="rwcs-swatch"
            data-empty={option.value === "" || option.value === "auto" || option.value === "none"}
            aria-pressed={option.value === value}
            aria-label={option.label}
            title={option.label}
            style={
              {
                "--swatch": `var(--brim-theme-${option.value}, ${THEME_COLOR_DEFAULTS[option.value] ?? "transparent"})`,
              } as React.CSSProperties
            }
            onClick={() => onChange(option.value)}
          />
        ))}
        {allowCustom && (
          <label
            className="rwcs-swatch rwcs-inline-custom-btn"
            data-active={isCustom}
            title="Custom color"
            style={isCustom || picking ? ({ "--swatch": picking ?? value } as React.CSSProperties) : undefined}
          >
            {!isCustom && !picking && <PlusIcon />}
            <input
              ref={picker}
              type="color"
              aria-label="Custom color"
              value={picking ?? (isCustom ? value : "#000000")}
              onChange={(event) => setPicking(event.target.value)}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function IconPreview({ icon }: { icon: Icon | null | undefined }): ReactNode {
  if (!icon) return <span className="ipw-none">∅</span>;
  // Brim's own icons are outlines; a pack's icons carry their own fill and stroke.
  const outline = icon.outline
    ? ({
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      } as const)
    : { fill: "currentColor" };
  return (
    <svg
      width="18"
      height="18"
      viewBox={icon.viewBox}
      {...outline}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

/** Icons already shown once, by their saved value, so a settings panel does not ask again for each. */
const knownIcons = new Map<string, Icon | null>();

/**
 * Shows the chosen icon; opens a searchable grid of the site's icons, laid over the sidebar. The site decides
 * which sets there are: Brim's own, part of it, and packs it added. A set is searched on the server, as a pack
 * can hold thousands of icons.
 */
export function IconPickerWidget({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sets, setSets] = useState<IconSetInfo[]>([]);
  const [set, setSet] = useState<string>();
  const [found, setFound] = useState<IconSearch>({ icons: [], total: 0 });
  const [current, setCurrent] = useState<Icon | null | undefined>(knownIcons.get(value));
  const [problem, setProblem] = useState("");

  // The sets, and how the chosen icon looks.
  useEffect(() => {
    let stale = false;
    api
      .icons(value)
      .then((answer) => {
        if (stale) return;
        knownIcons.set(value, answer.icon ?? null);
        setCurrent(answer.icon ?? null);
        setSets(answer.sets);
        // Open on the set the chosen icon is from.
        setSet((now) => now ?? answer.sets.find((one) => value.startsWith(`${one.id}:`))?.id ?? answer.sets[0]?.id);
      })
      .catch(
        (error: unknown) => !stale && setProblem(error instanceof Error ? error.message : "Could not load icons."),
      );
    return () => {
      stale = true;
    };
  }, [value]);

  // The icons of the open set, asked again shortly after the search stops changing.
  useEffect(() => {
    if (!open || !set) return;
    let stale = false;
    const wait = setTimeout(
      () => {
        api
          .searchIcons(set, search)
          .then((answer) => {
            if (stale) return;
            for (const icon of answer.icons) knownIcons.set(icon.value, icon);
            setFound(answer);
            setProblem("");
          })
          .catch(
            (error: unknown) => !stale && setProblem(error instanceof Error ? error.message : "Could not load icons."),
          );
      },
      search ? 200 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(wait);
    };
  }, [open, set, search]);

  const choose = (name: string): void => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      <button type="button" className="ipw-trigger" onClick={() => setOpen(true)}>
        <IconPreview icon={current} />
        <span className="ipw-name">{current ? current.name : "Choose icon..."}</span>
        <ChevronRightIcon />
      </button>
      {open &&
        createPortal(
          <div
            className="ipw-panel"
            role="dialog"
            aria-label="Choose Icon"
            onKeyDown={(event) => event.key === "Escape" && !isComposing(event) && setOpen(false)}
          >
            <header className="ipw-header">
              <button type="button" className="brim-sidebar-close-btn" aria-label="Back" onClick={() => setOpen(false)}>
                <ArrowLeftIcon />
              </button>
              <h2>Choose Icon</h2>
            </header>
            {sets.length > 1 && (
              <div className="ipw-sets" role="tablist" aria-label="Icon sets">
                {sets.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    role="tab"
                    className="ipw-set"
                    aria-selected={one.id === set}
                    title={`${one.name} · ${one.total} icons`}
                    onClick={() => {
                      setFound({ icons: [], total: 0 });
                      setSet(one.id);
                    }}
                  >
                    {one.name}
                  </button>
                ))}
              </div>
            )}
            <input
              className="field-input ipw-search"
              type="search"
              placeholder="Search icons..."
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {problem && (
              <p className="field-description" role="alert">
                {problem}
              </p>
            )}
            {sets.length === 0 && !problem && <p className="field-description">This site offers no icons.</p>}
            <div className="ipw-grid">
              <button
                type="button"
                className="ipw-cell"
                aria-pressed={!current}
                title="None"
                onClick={() => choose("none")}
              >
                <IconPreview icon={null} />
              </button>
              {found.icons.map((icon) => (
                <button
                  key={icon.value}
                  type="button"
                  className="ipw-cell"
                  aria-pressed={icon.value === value}
                  title={icon.name}
                  onClick={() => choose(icon.value)}
                >
                  <IconPreview icon={icon} />
                </button>
              ))}
            </div>
            {found.total > found.icons.length && (
              <p className="field-description">
                Showing {found.icons.length} of {found.total}. Search to find the others.
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

const BREAKPOINTS = ["Desktop", "Tablet", "Mobile"] as const;

/** One number per preview size, each stored in its own setting. */
export function BreakpointNumberWidget({
  label,
  description,
  values,
}: {
  label: string;
  description?: string | undefined;
  /** Desktop, tablet and mobile, in that order. A breakpoint without its own setting is left out. */
  values: ({ value: number; min: number; max: number; onChange: (value: number) => void } | undefined)[];
}) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <div className="breakpoint-number">
        {values.map(
          (entry, index) =>
            entry && (
              <label key={BREAKPOINTS[index]}>
                <span>{BREAKPOINTS[index]}</span>
                <NumberBox
                  className="field-input"
                  min={entry.min}
                  max={entry.max}
                  value={entry.value}
                  onChange={entry.onChange}
                />
              </label>
            ),
        )}
      </div>
    </div>
  );
}

/** The image folder of the item being edited: one folder per item, e.g. one project's photos. */
export interface MediaFolder {
  /** `<type>/<item id>`; absent while the item is new and not saved yet. */
  key?: string | undefined;
  /** How the item is named to the owner: its title, or e.g. "project" while it is new. */
  label: string;
}

/**
 * Provided by the item form. Inside it, uploads ask whether the image goes to the gallery or to the
 * item's own folder; everywhere else (a page's blocks) they go to the gallery without asking.
 */
export const MediaFolderContext = createContext<MediaFolder | undefined>(undefined);

/**
 * The image picker: upload a file (or drop one on the box), choose one already uploaded,
 * or paste an address. Stores the image's address.
 *
 * With `onFocus`, the picture is also where the owner chooses its focus: the part that stays in sight when the site
 * crops it. A click or a drag on the picture moves the point; a new picture starts at its middle (the caller resets
 * the focus with the address) and asks for it at once.
 */
export function ImageUploadWidget({
  label,
  description,
  value,
  onChange,
  focus,
  onFocus,
}: {
  label: string;
  description?: string | undefined;
  value: string;
  onChange: (url: string, file?: MediaFile) => void;
  /** The image's focus, the middle when absent. */
  focus?: ImageFocus | undefined;
  onFocus?: ((focus: ImageFocus) => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  /** A picture just chosen: the widget asks where its focus is. */
  const [chosen, setChosen] = useState(false);
  const choose = (url: string, file?: MediaFile): void => {
    setChosen(url !== "");
    onChange(url, file);
  };
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [address, setAddress] = useState("");
  const [pending, setPending] = useState<File>();
  const [note, setNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const folder = useContext(MediaFolderContext);

  /** In a saved item the owner chooses where the image goes; elsewhere it goes to the gallery. */
  function receive(file: File | undefined): void {
    if (!file) return;
    if (folder?.key) return setPending(file);
    // A new item has no folder yet: its id only exists once it is saved.
    setNote(folder ? `Saved to the gallery. Save this ${folder.label} once to give it its own image folder.` : "");
    void upload(file, "");
  }

  async function upload(file: File, destination: string): Promise<void> {
    setPending(undefined);
    setBusy(true);
    setError("");
    try {
      const uploaded = await api.upload(file, destination);
      choose(uploaded.url, uploaded);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not upload the image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <div
        className="image-widget-container"
        data-busy={busy}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          receive(event.dataTransfer.files[0]);
        }}
      >
        {value ? (
          <>
            {onFocus ? (
              <ImageFocusPicker image={value} focus={focus} prompt={chosen} onChange={onFocus} />
            ) : (
              <img className="preview-img" src={value} alt="" />
            )}
            <div className="image-widget-actions">
              <button type="button" className="btn-upload" onClick={() => fileInput.current?.click()}>
                Replace
              </button>
              <button type="button" className="btn-gallery" onClick={() => setChoosing(true)}>
                Choose from site
              </button>
              <button type="button" className="btn-remove" onClick={() => choose("")}>
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="image-widget-empty">No image selected</p>
            <div className="image-widget-actions">
              <button type="button" className="btn-upload" onClick={() => fileInput.current?.click()}>
                Upload
              </button>
              <button type="button" className="btn-gallery" onClick={() => setChoosing(true)}>
                Choose from site
              </button>
            </div>
            <form
              className="external-url-panel"
              onSubmit={(event) => {
                event.preventDefault();
                if (address.trim()) choose(address.trim());
              }}
            >
              <input
                className="field-input"
                type="text"
                aria-label="Image address"
                placeholder="https://example.com"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <button type="submit" className="btn-apply-url" aria-label="Use this address">
                <ChevronRightIcon />
              </button>
            </form>
            <p className="field-description">Paste image URL or use the options above</p>
          </>
        )}
        {busy && <p className="image-widget-overlay">Uploading…</p>}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
          hidden
          onChange={(event) => {
            receive(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {pending && folder?.key && (
          <div className="image-destination" role="group" aria-label="Where to save the image">
            <p>Where should this image go?</p>
            <button type="button" className="btn-upload" onClick={() => void upload(pending, folder.key ?? "")}>
              Folder of “{folder.label}”
            </button>
            <button type="button" className="btn-gallery" onClick={() => void upload(pending, "")}>
              Gallery
            </button>
            <button type="button" className="btn-remove" onClick={() => setPending(undefined)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {note && !error && <p className="field-description">{note}</p>}
      {choosing && (
        <MediaPicker
          folder={folder}
          onPick={(file) => {
            setChoosing(false);
            choose(file.url, file);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </div>
  );
}

/**
 * The images already uploaded to the site, to pick one from: all of them, the gallery, and, when opened
 * from a saved item, that item's own folder, where it starts.
 */
function MediaPicker({
  folder,
  onPick,
  onClose,
}: {
  folder: MediaFolder | undefined;
  onPick: (file: MediaFile) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<MediaFile[]>();
  /** Where the next page starts; absent once the last one is shown. */
  const [next, setNext] = useState<string>();
  const [search, setSearch] = useState("");
  /** The search as asked of the server: once typing pauses. */
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string>(folder?.key ?? "all");
  const loadingMore = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const tabs = [
    { key: "all", label: "All images" },
    { key: "gallery", label: "Gallery" },
    ...(folder?.key ? [{ key: folder.key, label: `Folder of “${folder.label}”` }] : []),
  ];
  // The server searches and filters the whole library and answers a page at a time: thousands of images stay
  // reachable, and the picker never holds them all.
  const asked = { search: query, ...(tab !== "all" && { folder: tab === "gallery" ? "" : tab }) };
  useEffect(() => {
    const pause = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(pause);
  }, [search]);
  useEffect(() => {
    let current = true;
    setFiles(undefined);
    setNext(undefined);
    void api.media(asked).then((page) => {
      if (!current) return;
      setFiles(page.files);
      setNext(page.next);
    });
    return () => {
      current = false;
    };
  }, [tab, query]);
  // The next page comes as the end of the grid scrolls into view.
  useEffect(() => {
    const marker = end.current;
    if (!marker || !next) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || loadingMore.current) return;
        loadingMore.current = true;
        void api
          .media({ ...asked, after: next })
          .then((page) => {
            setFiles((shown) => [...(shown ?? []), ...page.files]);
            setNext(page.next);
          })
          .finally(() => {
            loadingMore.current = false;
          });
      },
      { root: marker.parentElement, rootMargin: "600px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [next, files]);
  const shown = files;

  return createPortal(
    <div className="cb-modal-overlay" onClick={onClose}>
      <div
        className="media-picker"
        role="dialog"
        aria-label="Choose from site"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3>Gallery</h3>
          <input
            className="field-input"
            type="search"
            placeholder="Search images..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" className="cb-toolbar-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <nav className="media-picker-tabs" aria-label="Folders">
          {tabs.map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        {!shown ? (
          <p className="cb-state">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="cb-state">{query ? "No image has that name." : "No images here yet. Upload one first."}</p>
        ) : (
          <div className="media-picker-grid">
            {shown.map((file) => (
              <button key={file.id} type="button" title={file.name} onClick={() => onPick(file)}>
                <img src={file.thumbnail ?? file.url} alt={file.name} loading="lazy" decoding="async" />
              </button>
            ))}
            {next && <div ref={end} className="media-picker-more" aria-hidden="true" />}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The whole picture with a point on it: a click or a drag puts the point where the picture must stay in sight when
 * it is cropped; the arrow keys move it too (Shift for larger steps). Values are percentages from the left and top.
 */
function FocusFrame({
  image,
  x,
  y,
  onChange,
}: {
  image: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // The frame takes the picture's shape once it has loaded, so a point on the frame is that point of the picture.
  const [ratio, setRatio] = useState(16 / 9);

  function moveTo(clientX: number, clientY: number): void {
    const bounds = frame.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    onChange(
      Math.round(clamp(((clientX - bounds.left) / bounds.width) * 100, 0, 100)),
      Math.round(clamp(((clientY - bounds.top) / bounds.height) * 100, 0, 100)),
    );
  }

  return (
    <div
      ref={frame}
      className="focus-frame"
      style={{ "--focus-x": `${x}%`, "--focus-y": `${y}%`, "--focus-ratio": ratio } as React.CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => event.buttons === 1 && moveTo(event.clientX, event.clientY)}
    >
      {image && (
        <img
          src={image}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
          }}
        />
      )}
      <button
        type="button"
        className="focus-point"
        aria-label={`Focus point, ${x}% from the left and ${y}% from the top. Use the arrow keys to move it.`}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1;
          const move: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const delta = move[event.key];
          if (!delta) return;
          event.preventDefault();
          onChange(clamp(x + delta[0], 0, 100), clamp(y + delta[1], 0, 100));
        }}
      />
    </div>
  );
}

/**
 * The image widget's picture when it keeps a focus: the picture to click, how a wide and a square crop show it,
 * and a way back to the middle. Right after a picture is chosen it says what the click does.
 */
function ImageFocusPicker({
  image,
  focus,
  prompt,
  onChange,
}: {
  image: string;
  focus: ImageFocus | undefined;
  prompt: boolean;
  onChange: (focus: ImageFocus) => void;
}) {
  const x = focus?.x ?? 50;
  const y = focus?.y ?? 50;
  const position = `${x}% ${y}%`;
  return (
    <div className="image-focus">
      <FocusFrame image={image} x={x} y={y} onChange={(nextX, nextY) => onChange({ x: nextX, y: nextY })} />
      <p className="field-description" data-prompt={prompt || undefined}>
        {prompt
          ? "Click the part of the picture that must stay in sight when the site crops it."
          : "Click the picture to choose the part that stays in sight when it is cropped."}
      </p>
      <div className="focus-footer">
        <span className="focus-crops" aria-hidden="true">
          <img src={image} alt="" style={{ objectPosition: position }} />
          <img src={image} alt="" style={{ objectPosition: position }} />
        </span>
        <button
          type="button"
          className="focus-reset"
          disabled={x === 50 && y === 50}
          onClick={() => onChange({ x: 50, y: 50 })}
        >
          Center
        </button>
      </div>
    </div>
  );
}

/** Drag the dot to say which part of the image must stay visible when it is cropped. */
export function FocusWidget({
  label,
  image,
  x,
  y,
  inherited,
  onChange,
}: {
  label: string;
  image: string;
  /** Percentages from the left and the top; `undefined` means not set for this preview size. */
  x: number | undefined;
  y: number | undefined;
  /** What applies while this preview size has no value of its own. */
  inherited: { x: number | undefined; y: number | undefined };
  onChange: (x: number, y: number) => void;
}) {
  const currentX = x ?? inherited.x ?? 50;
  const currentY = y ?? inherited.y ?? 50;

  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      <FocusFrame image={image} x={currentX} y={currentY} onChange={onChange} />
      <div className="focus-footer">
        <span className="focus-value">
          {currentX}% {currentY}%{x === undefined ? " inherited" : ""}
        </span>
        <button type="button" className="focus-reset" onClick={() => onChange(50, 50)}>
          Center
        </button>
      </div>
    </div>
  );
}

function shapeStyle(shape: ImageShape): React.CSSProperties {
  if (shape.radius) return { borderRadius: shape.radius };
  if (shape.polygon) return { clipPath: `polygon(${shape.polygon})` };
  return {};
}

/** A grid of the shapes an image can be cut to. */
export function ShapeWidget({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      <div className="shape-grid" role="group" aria-label={label}>
        {IMAGE_SHAPES.map((shape) => (
          <button
            key={shape.key}
            type="button"
            className="shape-option"
            aria-pressed={shape.key === value}
            aria-label={shape.label}
            title={shape.label}
            onClick={() => onChange(shape.key)}
          >
            {shape.path ? (
              <svg className="shape-swatch" viewBox={shape.path.viewBox} aria-hidden="true">
                <path d={shape.path.d} fill="currentColor" />
              </svg>
            ) : (
              <span className="shape-swatch" style={shapeStyle(shape)} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A list of collapsible cards, one per entry, with move and remove controls.
 * BrimCMS used it for gallery images and accordion items.
 */
export function CardList<Entry>({
  label,
  addLabel,
  entries,
  title,
  thumbnail,
  create,
  render,
  onChange,
}: {
  label: string;
  addLabel: string;
  entries: Entry[];
  title: (entry: Entry, index: number) => string;
  thumbnail?: (entry: Entry) => string | undefined;
  create: (index: number) => Entry;
  render: (entry: Entry, change: (entry: Entry) => void) => ReactNode;
  onChange: (entries: Entry[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);

  function move(index: number, offset: number): void {
    const next = [...entries];
    const [entry] = next.splice(index, 1);
    if (entry === undefined) return;
    next.splice(index + offset, 0, entry);
    setOpen(null);
    onChange(next);
  }

  return (
    <div className="field-group card-list">
      <div className="card-list-header">
        <span className="field-label">{label}</span>
        <span className="card-list-count">{entries.length}</span>
      </div>
      {entries.map((entry, index) => {
        const image = thumbnail?.(entry);
        return (
          <div key={index} className="card-list-item" data-open={open === index}>
            <div className="card-list-row">
              <button
                type="button"
                className="card-list-toggle"
                aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}
              >
                {image && <img src={image} alt="" />}
                <span>{title(entry, index)}</span>
              </button>
              <button
                type="button"
                className="card-list-btn"
                disabled={index === 0}
                aria-label="Move up"
                title="Move up"
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="card-list-btn"
                disabled={index === entries.length - 1}
                aria-label="Move down"
                title="Move down"
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="card-list-btn"
                aria-label="Remove"
                title="Remove"
                onClick={() => onChange(entries.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
            {open === index && (
              <div className="card-list-body">
                {render(entry, (next) => onChange(entries.map((current, i) => (i === index ? next : current))))}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="card-list-add"
        onClick={() => {
          setOpen(entries.length);
          onChange([...entries, create(entries.length)]);
        }}
      >
        + {addLabel}
      </button>
    </div>
  );
}

const FIT_OPTIONS = [
  { value: "contain", label: "Fit", description: "Shows the whole picture" },
  { value: "cover", label: "Fill", description: "Crops to cover the area" },
];

/** Fit shows the whole picture; Fill crops it to cover its area. */
export function FitWidget({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <div className="size-picker" role="group" aria-label={label}>
        {FIT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="size-btn fit-option"
            aria-pressed={option.value === value}
            title={option.description}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The networks of a social block, in the order they are shown. Each can be switched off;
 * in profile mode each also takes the address of the site's own profile.
 */
export function SocialNetworksWidget({
  label,
  description,
  order,
  settings,
  withProfiles,
  onPatch,
}: {
  label: string;
  description?: string | undefined;
  order: unknown;
  settings: Record<string, unknown>;
  withProfiles: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const networks = orderSocialNetworks(SOCIAL_NETWORKS, order);

  function move(index: number, offset: number): void {
    const keys = networks.map((network) => network.key);
    const [key] = keys.splice(index, 1);
    if (key === undefined) return;
    keys.splice(index + offset, 0, key);
    onPatch({ networkOrder: keys });
  }

  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      {networks.map((network, index) => {
        const enabled = settings[`${network.key}Enabled`] !== false;
        return (
          <div key={network.key} className="card-list-item">
            <div className="card-list-row">
              <label className="card-list-toggle">
                <input
                  className="field-checkbox"
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => onPatch({ [`${network.key}Enabled`]: event.target.checked })}
                />
                <span>{network.label}</span>
              </label>
              <button
                type="button"
                className="card-list-btn"
                disabled={index === 0}
                aria-label={`Move ${network.label} up`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="card-list-btn"
                disabled={index === networks.length - 1}
                aria-label={`Move ${network.label} down`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
            {withProfiles && enabled && (
              <div className="card-list-body">
                <DraftInput
                  label={`${network.label} address`}
                  value={
                    typeof settings[network.profileField] === "string" ? (settings[network.profileField] as string) : ""
                  }
                  placeholder={
                    network.key === "email"
                      ? "name@example.com"
                      : network.key === "phone"
                        ? "+40 700 000 000"
                        : "https://…"
                  }
                  onChange={(value) => onPatch({ [network.profileField]: value })}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A plain input that reports its value when the person leaves it or presses Enter. */
function DraftInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="field-input"
      type="text"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onChange(draft.trim())}
      onKeyDown={(event) => event.key === "Enter" && !isComposing(event) && event.currentTarget.blur()}
    />
  );
}

interface FoundPlace {
  lat: string;
  lon: string;
  display_name: string;
}

/**
 * Looks an address up on OpenStreetMap and reports where it is.
 * The address is sent to OpenStreetMap's search service only when the person presses Find.
 */
export function LocationSearch({ address, onFound }: { address: string; onFound: (lat: number, lng: number) => void }) {
  const [state, setState] = useState<"idle" | "searching" | "missing" | "failed">("idle");

  async function find(): Promise<void> {
    setState("searching");
    try {
      const query = new URLSearchParams({ format: "json", limit: "1", q: address });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`);
      const [place] = (await response.json()) as FoundPlace[];
      if (!place) return setState("missing");
      onFound(Number(Number(place.lat).toFixed(6)), Number(Number(place.lon).toFixed(6)));
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="location-search">
      <button type="button" disabled={address.trim() === "" || state === "searching"} onClick={() => void find()}>
        {state === "searching" ? "Finding…" : "Find on map"}
      </button>
      {state === "missing" && <span className="field-error">No place found for this address.</span>}
      {state === "failed" && <span className="field-error">Could not reach the map search.</span>}
    </div>
  );
}
