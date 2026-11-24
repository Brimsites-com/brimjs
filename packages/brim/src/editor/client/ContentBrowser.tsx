import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { formPage } from "../../forms/form-page.ts";
import { fileSize } from "../../forms/file-types.ts";
import { formsOf } from "./responses.ts";
import {
  type ContentType,
  type FormResponse,
  type Item,
  type ItemDraft,
  type SitePage,
  type Visibility,
  api,
} from "./api.ts";
import {
  ArrowLeftIcon,
  DragIcon,
  EyeIcon,
  FolderIcon,
  GridViewIcon,
  HomeIcon,
  PageIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TableViewIcon,
  TrashIcon,
} from "./icons.tsx";
import { ItemForm, type ItemLanguages } from "./ItemForm.tsx";
import { hasTag, rankTags, sameTag, tagsOf } from "../../content/tags.ts";
import { itemPagePath } from "../../server/locales.ts";
import { itemLocale, translationsOf, useSiteLocales } from "./languages.ts";
import { Menu } from "./Menu.tsx";
import { pageTitle } from "./Toolbar.tsx";
import { isComposing } from "./keys.ts";

/** One row of the browser: a folder of a content type, a page of the site, or an item. */
interface Entry {
  id: string;
  kind: "folder" | "page" | "item" | "response";
  title: string;
  /** For a folder: how many items it holds. */
  count?: number;
  /** Name of the type, shown in the Type column and the filter chips. */
  typeLabel: string;
  /** The same name for many, on the filter chips: written out, since adding an "s" makes "Vocabularys". */
  typePlural: string;
  /** Public address, for View. Folders have none. */
  path?: string;
  visibility?: Visibility;
  modified?: string;
  item?: Item;
  type?: ContentType;
  response?: FormResponse;
  page?: SitePage;
  /** An item's tags: what its `tags` field holds. */
  tags?: string[];
}

/** The folder that holds what visitors sent through the site's forms. */
const RESPONSES = "form-responses";

type View = "table" | "grid";

const MINUTE = 60_000;

/** `Just now`, `5m ago`, `3h ago`, `2d ago`, then a date. */
function relativeDate(iso: string | undefined): string {
  if (!iso) return "—";
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < 60 * MINUTE) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < 24 * 60 * MINUTE) return `${Math.floor(elapsed / (60 * MINUTE))}h ago`;
  if (elapsed < 7 * 24 * 60 * MINUTE) return `${Math.floor(elapsed / (24 * 60 * MINUTE))}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Browses everything the owner can manage: the site's pages and the items of each content type.
 * Content types are declared in the site's code, so none is created here; pages are added from the site map.
 */
export function ContentBrowser({
  pages,
  initialFolder = null,
  initialCreate = false,
  initialData,
  initialForm,
  initialResponse,
  run,
  onBack,
  onEditPage,
  onEditTemplate,
  onPagesChanged,
}: {
  pages: SitePage[];
  /** Key of the content type to open on; all content when absent. */
  initialFolder?: string | null;
  /** Opens straight on the form of a new item of `initialFolder`. */
  initialCreate?: boolean;
  /** What that new item starts with, e.g. the field the listing it was added from filters on. */
  initialData?: Record<string, unknown> | undefined;
  /** In Form responses, the form whose responses to show first (its name); all of them when absent. */
  initialForm?: string | undefined;
  /** A response to open as soon as the responses are read. */
  initialResponse?: string | undefined;
  run: (work: Promise<unknown>) => Promise<boolean>;
  onBack: () => void;
  onEditPage: (path: string) => void;
  /** Opens a content type's template on the page of one of its items, given as a sample. */
  onEditTemplate: (samplePath: string) => void;
  onPagesChanged: () => void;
}) {
  const [types, setTypes] = useState<ContentType[]>([]);
  const [itemsByType, setItemsByType] = useState<Record<string, Item[]>>({});
  const [loading, setLoading] = useState(true);
  /** Key of the content type being browsed; `null` at the root. */
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [view, setView] = useState<View>("table");
  const [filter, setFilter] = useState<string | null>(null);
  /** Only what has this tag, whatever its case; `null` shows everything. */
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ type: ContentType; item?: Item; data?: Record<string, unknown> } | null>(null);
  /** Whether the open item form has changes not saved yet: leaving the browser or the folder asks first. */
  const formDirty = useRef(false);
  /** Why the item form could not be saved, e.g. a required field left empty. */
  const [formError, setFormError] = useState<string>();
  const [deleting, setDeleting] = useState<Entry[] | null>(null);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  /** In Form responses, only the responses of this form (by its name); `null` shows them all. */
  const [responseForm, setResponseForm] = useState<string | null>(initialForm ?? null);
  const [reading, setReading] = useState<FormResponse | null>(null);
  const offered = useOfferedChoices(reading);
  const locales = useSiteLocales();
  /** The item being dragged to a new place, and the row it would land before. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  /**
   * The types show at once and each type's items as they arrive: a type with a thousand items no longer holds back
   * the list of types, nor the others' items. Resolves once everything is read.
   */
  async function load(): Promise<ContentType[]> {
    const { types: list } = await api.types();
    setTypes(list);
    setLoading(false);
    await Promise.all([
      api.responses().then(({ responses }) => {
        setResponses(responses);
        const opened = initialResponse && responses.find((response) => response.id === initialResponse);
        if (opened) setReading(opened);
      }),
      ...list.map(async (type) => {
        const { items } = await api.items(type.key);
        setItemsByType((current) => ({ ...current, [type.key]: items }));
      }),
    ]);
    return list;
  }
  useEffect(() => {
    void load().then((list) => {
      const type = initialCreate ? list.find((candidate) => candidate.key === initialFolder) : undefined;
      if (type) setForm({ type, ...(initialData && { data: initialData }) });
    });
  }, []);

  const folderType = types.find((type) => type.key === folder);
  // The newest item in the default language shows the template as a sample: the template in that language.
  const listed = folderType ? (itemsByType[folderType.key] ?? []) : [];
  const newest = listed.find((item) => item.locale === "") ?? listed[0];
  const sample = folderType && newest ? itemPagePath(folderType, newest, locales ?? undefined) : undefined;

  const entries = useMemo((): Entry[] => {
    const itemEntries = (type: ContentType): Entry[] =>
      (itemsByType[type.key] ?? []).map((item) => ({
        id: item.id,
        kind: "item",
        title: item.title,
        typeLabel: type.singular,
        typePlural: type.label,
        path: itemPagePath(type, item, locales ?? undefined),
        visibility: item.visibility,
        modified: item.updatedAt,
        item,
        type,
        tags: tagsOf(item.data.tags),
      }));
    const pageEntries: Entry[] = pages.map((page) => ({
      id: `page:${page.path}`,
      kind: "page",
      title: pageTitle(page.path, page.title),
      typeLabel: "Page",
      typePlural: "Pages",
      path: page.path,
      visibility: page.visibility,
      page,
    }));
    const folders: Entry[] = [
      // Vocabularies (lists of terms other types point at) come after the content they describe.
      ...[...types.filter((type) => !type.vocabulary), ...types.filter((type) => type.vocabulary)].map(
        (type): Entry => ({
          id: `folder:${type.key}`,
          kind: "folder",
          title: type.label,
          typeLabel: type.vocabulary ? "Vocabulary" : "Content type",
          typePlural: type.vocabulary ? "Vocabularies" : "Content types",
          // No count until its items arrive.
          ...(itemsByType[type.key] && { count: itemsByType[type.key]!.length }),
          type,
        }),
      ),
      {
        id: `folder:${RESPONSES}`,
        kind: "folder",
        title: "Form responses",
        typeLabel: "Folder",
        typePlural: "Folders",
        count: responses.length,
      },
    ];
    const responseEntries: Entry[] = responses
      .filter((response) => responseForm === null || response.title === responseForm)
      .map((response) => ({
        id: response.id,
        kind: "response",
        // The first answer tells responses of the same form apart, and the page which item a template's form is about.
        title: `${response.title}${formPage(response.form) ? ` (${formPage(response.form)})` : ""}: ${response.answers[0]?.value ?? "empty"}`,
        typeLabel: "Response",
        typePlural: "Responses",
        modified: response.createdAt,
        response,
      }));

    // Searching looks through everything; otherwise only the current folder is listed.
    const searching = query.trim().length >= 2;
    const all = searching
      ? [...pageEntries, ...types.flatMap(itemEntries)]
      : folderType
        ? itemEntries(folderType)
        : folder === RESPONSES
          ? responseEntries
          : [...folders, ...pageEntries];
    const needle = query.trim().toLowerCase();
    // A search finds an entry by its title or by one of its tags.
    const found = (entry: Entry): boolean =>
      entry.title.toLowerCase().includes(needle) ||
      (entry.tags ?? []).some((name) => name.toLowerCase().includes(needle));
    return searching ? all.filter(found) : all;
  }, [types, itemsByType, pages, folderType, folder, responses, responseForm, query, locales]);

  /** The forms that have responses, for the filters of Form responses. */
  const responseForms = useMemo(() => formsOf(responses), [responses]);
  // Another folder forgets which form was being read.
  useEffect(() => {
    if (folder !== RESPONSES) setResponseForm(null);
  }, [folder]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, { plural: string; count: number }>();
    for (const entry of entries) {
      const count = (counts.get(entry.typeLabel)?.count ?? 0) + 1;
      counts.set(entry.typeLabel, { plural: entry.typePlural, count });
    }
    return [...counts];
  }, [entries]);

  const ofType = filter ? entries.filter((entry) => entry.typeLabel === filter) : entries;
  // The tags of what is listed, most used first; the chosen one stays offered, to be cleared, even if none has it.
  const tagCounts = useMemo(() => {
    const counts = rankTags(ofType.map((entry) => entry.tags));
    return tag && !counts.some((entry) => sameTag(entry.tag, tag)) ? [...counts, { tag, count: 0 }] : counts;
  }, [ofType, tag]);
  const shown = tag ? ofType.filter((entry) => hasTag(entry.tags ?? [], tag)) : ofType;
  const selectable = shown.filter((entry) => entry.kind !== "folder");
  const chosen = selectable.filter((entry) => selected.has(entry.id));

  // The items of an `ordered` type are put in order by dragging them, while the whole folder is listed: in a
  // search or a filtered list, a place among the rows shown is not a place among all of them.
  const reorderable =
    Boolean(folderType?.ordered) && query.trim().length < 2 && filter === null && tag === null && view === "table";

  /** Moves an item (written first: its translations follow it) to `index` among the type's items written first. */
  async function moveItem(id: string, index: number): Promise<void> {
    if (!folderType) return;
    const all = itemsByType[folderType.key] ?? [];
    const ids = all.filter((item) => item.translationOf === null).map((item) => item.id);
    const from = ids.indexOf(id);
    if (from === -1) return;
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    if (
      ids.join() ===
      all
        .filter((item) => item.translationOf === null)
        .map((item) => item.id)
        .join()
    )
      return;
    const place = new Map(ids.map((itemId, position) => [itemId, position + 1]));
    const placeOf = (item: Item): number => place.get(item.translationOf ?? item.id) ?? Number.MAX_SAFE_INTEGER;
    // The list shows the new order at once; a refusal puts back the order the site has.
    setItemsByType({
      ...itemsByType,
      [folderType.key]: [...all]
        .sort((a, b) => placeOf(a) - placeOf(b))
        .map((item) => ({ ...item, position: placeOf(item) })),
    });
    if (!(await run(api.reorderItems(folderType.key, ids)))) await load();
  }

  /** The items written first, in their order: where up and down move an item. */
  const ordered = (): string[] =>
    (itemsByType[folderType?.key ?? ""] ?? []).filter((item) => item.translationOf === null).map((item) => item.id);
  const orderIndex = (id: string): number => ordered().indexOf(id);
  const orderCount = (): number => ordered().length;

  /** The place among the items written first that dropping on the row of `targetId` gives. */
  function placeBefore(targetId: string): number {
    const target = (itemsByType[folderType?.key ?? ""] ?? []).find((item) => item.id === targetId);
    const ids = (itemsByType[folderType?.key ?? ""] ?? [])
      .filter((item) => item.translationOf === null)
      .map((item) => item.id);
    // Dropped on a row, the item takes that row's place: above it when it came from below, below it when it came
    // from above (the rows between move up one).
    return ids.indexOf(target?.translationOf ?? targetId);
  }

  /** Runs `leave` once the owner agrees to lose the item form's unsaved changes; at once when it has none. */
  function leaveForm(leave: () => void): void {
    if (form && formDirty.current && !window.confirm("Leave without saving? Your changes to this item will be lost.")) {
      return;
    }
    leave();
  }

  function openFolder(key: string | null): void {
    // Going somewhere leaves what is open: an item's form or a form message would otherwise stay over the folder.
    setForm(null);
    setFormError(undefined);
    setReading(null);
    setFolder(key);
    setFilter(null);
    setTag(null);
    setQuery("");
    setSelected(new Set());
  }

  function toggle(id: string): void {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  }

  function open(entry: Entry): void {
    if (entry.kind === "folder") openFolder(entry.type?.key ?? RESPONSES);
    else edit(entry);
  }

  function edit(entry: Entry): void {
    if (entry.response) setReading(entry.response);
    else if (entry.kind === "page" && entry.path) onEditPage(entry.path);
    // An item with a page of its own is edited there; one without in its form.
    else if (entry.item && entry.type?.hasPage && entry.path) onEditPage(entry.path);
    else if (entry.item && entry.type) setForm({ type: entry.type, item: entry.item });
  }

  async function setVisibility(targets: Entry[], visibility: Visibility): Promise<void> {
    const work = Promise.all(
      targets.map((entry) =>
        entry.item
          ? api.setItemVisibility(entry.item.id, visibility)
          : entry.path
            ? api.setVisibility(entry.path, visibility)
            : undefined,
      ),
    );
    if (await run(work)) {
      setSelected(new Set());
      onPagesChanged();
      await load();
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const work = Promise.all(
      deleting.map((entry) =>
        entry.item
          ? api.deleteItem(entry.item.id)
          : entry.response
            ? api.deleteResponse(entry.response.id)
            : entry.page?.template
              ? api.deletePage(entry.page.path)
              : undefined,
      ),
    );
    if (await run(work)) {
      if (deleting.some((entry) => entry.page)) onPagesChanged();
      setDeleting(null);
      setReading(null);
      setSelected(new Set());
      await load();
    }
  }

  /** The open item in each of the site's languages, from the items already loaded. */
  const formLanguages: ItemLanguages | undefined = (() => {
    if (!locales || !form) return undefined;
    const { type, item } = form;
    const current = item ? itemLocale(item, locales) : locales.defaultLocale;
    const family = item ? translationsOf(item, itemsByType[type.key] ?? []) : [];
    return {
      codes: locales.locales,
      current,
      items: Object.fromEntries(family.map((candidate) => [itemLocale(candidate, locales), candidate])),
      onOpen: (next) => {
        setFormError(undefined);
        setForm({ type, item: next });
      },
      onTranslate: (code) => {
        if (!item) return;
        let made: Item | undefined;
        void run(api.translateItem(item.id, code).then((answer) => (made = answer.item))).then(async (done) => {
          if (!done || !made) return;
          await load();
          setForm({ type, item: made });
        });
      },
    };
  })();

  async function save(draft: ItemDraft): Promise<void> {
    if (!form) return;
    const { type, item } = form;
    let created: Item | undefined;
    const work = item
      ? api.updateItem(item.id, draft)
      : api.createItem(type.key, draft).then((answer) => (created = answer.item));
    setFormError(undefined);
    // The toolbar that reports failures is behind the browser, so the form says it itself.
    work.catch((failure: unknown) => setFormError(failure instanceof Error ? failure.message : "Could not save."));
    if (await run(work)) {
      // A new item with a page opens there, to be filled in where it will be seen.
      if (created && type.hasPage) return onEditPage(itemPagePath(type, created, locales ?? undefined));
      // Otherwise it stays open, inside its type's folder: the owner sees it was made and where it is listed.
      if (created) setFolder(type.key);
      setForm(created ? { type, item: created } : null);
      await load();
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Shortcuts act on the list, never while someone is typing in a field.
      if (form || (event.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (event.key === "Escape" && !isComposing(event)) setSelected(new Set());
      if ((event.metaKey || event.ctrlKey) && event.key === "a") {
        event.preventDefault();
        setSelected(new Set(selectable.map((entry) => entry.id)));
      }
      const deletable = chosen.filter(isDeletable);
      if ((event.key === "Delete" || event.key === "Backspace") && deletable.length > 0) setDeleting(deletable);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const deletable = chosen.filter(isDeletable);
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;

  return (
    <div className="cb-container">
      <header className="cb-header">
        <div className="cb-header-inner">
          <div className="cb-header-left">
            <button type="button" className="cb-back-btn" onClick={() => leaveForm(onBack)}>
              <ArrowLeftIcon />
              Back
            </button>
            <nav className="cb-breadcrumbs" aria-label="Location">
              <button type="button" className="cb-breadcrumb" aria-label="All content" onClick={() => openFolder(null)}>
                <HomeIcon />
              </button>
              {(folderType || folder === RESPONSES) && (
                <>
                  <span className="cb-breadcrumb-separator">/</span>
                  <span className="cb-breadcrumb current">{folderType?.label ?? "Form responses"}</span>
                </>
              )}
            </nav>
          </div>
          <label className="cb-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search all content..."
              aria-label="Search all content"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="cb-header-right">
            <span className="cb-item-count">
              {shown.length} {shown.length === 1 ? "item" : "items"}
            </span>
            {folderType?.hasPage && (
              <button
                type="button"
                className="cb-toolbar-btn"
                disabled={!sample}
                title={
                  sample ? "Change what every item's page shows" : `Add a ${folderType.singular.toLowerCase()} first`
                }
                onClick={() => sample && onEditTemplate(sample)}
              >
                Edit template
              </button>
            )}
            {/* Not while a new item is being written: the form's own buttons create it or leave it. */}
            {!(form && !form.item) && (
              <NewButton types={types} folderType={folderType} onNew={(type) => setForm({ type })} />
            )}
          </div>
        </div>
      </header>

      {reading ? (
        <div className="cb-table-container">
          <article className="cb-item-form">
            <header className="cb-item-form__header">
              <h2>{reading.title}</h2>
              <div className="cb-item-form__actions">
                <button type="button" className="cb-toolbar-btn" onClick={() => setReading(null)}>
                  Back
                </button>
                <button
                  type="button"
                  className="cb-toolbar-btn danger"
                  onClick={() => setDeleting(entries.filter((entry) => entry.id === reading.id))}
                >
                  Delete
                </button>
              </div>
            </header>
            <p className="field-description">
              Sent {new Date(reading.createdAt).toLocaleString()}
              {formPage(reading.form) ? (
                <>
                  {" "}
                  from{" "}
                  <a href={formPage(reading.form)} target="_blank" rel="noreferrer">
                    {formPage(reading.form)}
                  </a>
                </>
              ) : (
                ` from ${reading.form}`
              )}
            </p>
            <dl className="cb-response">
              {reading.answers.map(withOffered(offered)).map((answer) => (
                <div key={answer.label}>
                  <dt>{answer.label}</dt>
                  {answer.choices?.length ? (
                    // As the form asked it: every choice it offered, the picked ones marked.
                    <dd className="cb-response-choices">
                      {answer.choices.map((choice) => {
                        const picked = wasPicked(answer, choice.label);
                        return (
                          <span
                            key={choice.label}
                            className="cb-response-choice"
                            data-picked={picked ? "" : undefined}
                            data-image={choice.image ? "" : undefined}
                          >
                            {choice.image && <img src={choice.image} alt="" loading="lazy" />}
                            {!choice.image && choice.icon && /^(\/|https?:)/.test(choice.icon) && (
                              <img className="cb-response-choice-icon" src={choice.icon} alt="" />
                            )}
                            {!choice.image && choice.icon && !/^(\/|https?:)/.test(choice.icon) && (
                              <span className="cb-response-choice-icon">{choice.icon}</span>
                            )}
                            <span>{choice.label}</span>
                            {picked && (
                              <span className="cb-response-tick" aria-label="picked">
                                ✓
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </dd>
                  ) : (
                    <dd>{answer.value}</dd>
                  )}
                </div>
              ))}
              {/* A visitor's file is only ever downloaded, never opened in the editor's page. */}
              {(reading.files ?? []).map((file) => (
                <div key={file.id}>
                  <dt>{file.label}</dt>
                  <dd>
                    <a href={`/admin/api/responses/${reading.id}/files/${file.id}`} download={file.name}>
                      {file.name}
                    </a>{" "}
                    ({fileSize(file.size)})
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        </div>
      ) : form ? (
        <div className="cb-table-container">
          <ItemForm
            key={form.item?.id ?? "new"}
            type={form.type}
            item={form.item}
            initialData={form.data}
            error={formError}
            onSave={(draft) => void save(draft)}
            onDelete={
              form.item
                ? () => setDeleting([entries.find((entry) => entry.id === form.item?.id)].filter(isEntry))
                : undefined
            }
            onCancel={() => {
              setFormError(undefined);
              setForm(null);
            }}
            onDirty={(dirty) => {
              formDirty.current = dirty;
            }}
            languages={formLanguages}
          />
        </div>
      ) : (
        <>
          <div className="cb-toolbar">
            <div className="cb-toolbar-inner">
              <label className="cb-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = chosen.length > 0 && !allSelected;
                  }}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((entry) => entry.id)))}
                />
                {chosen.length > 0 ? `${chosen.length} selected` : "Select all"}
              </label>
              <span className="cb-toolbar-divider" />
              {folder === RESPONSES && query.trim().length < 2 ? (
                // In Form responses the filters are the site's forms.
                <div className="cb-type-filters" role="group" aria-label="Forms">
                  <button
                    type="button"
                    className={`cb-type-filter${responseForm === null ? " active" : ""}`}
                    onClick={() => setResponseForm(null)}
                  >
                    All <span>{responses.length}</span>
                  </button>
                  {responseForms.map(({ title, count }) => (
                    <button
                      key={title}
                      type="button"
                      className={`cb-type-filter${responseForm === title ? " active" : ""}`}
                      onClick={() => setResponseForm(responseForm === title ? null : title)}
                    >
                      {title} <span>{count}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="cb-type-filters">
                  <button
                    type="button"
                    className={`cb-type-filter${filter === null ? " active" : ""}`}
                    onClick={() => setFilter(null)}
                  >
                    All <span>{entries.length}</span>
                  </button>
                  {typeCounts.map(([label, { plural, count }]) => (
                    <button
                      key={label}
                      type="button"
                      className={`cb-type-filter${filter === label ? " active" : ""}`}
                      data-type={typeKind(label)}
                      onClick={() => setFilter(filter === label ? null : label)}
                    >
                      {plural} <span>{count}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="cb-toolbar-right">
                <div className="cb-view-toggle" role="group" aria-label="View">
                  <button
                    type="button"
                    className={`cb-view-btn${view === "table" ? " active" : ""}`}
                    aria-label="Table view"
                    title="Table view"
                    onClick={() => setView("table")}
                  >
                    <TableViewIcon />
                  </button>
                  <button
                    type="button"
                    className={`cb-view-btn${view === "grid" ? " active" : ""}`}
                    aria-label="Grid view"
                    title="Grid view"
                    onClick={() => setView("grid")}
                  >
                    <GridViewIcon />
                  </button>
                </div>
                <span className="cb-toolbar-divider" />
                <button
                  type="button"
                  className="cb-toolbar-btn"
                  disabled={chosen.length === 0}
                  onClick={() => void setVisibility(chosen, "published")}
                >
                  Publish
                </button>
                <button
                  type="button"
                  className="cb-toolbar-btn"
                  disabled={chosen.length === 0}
                  onClick={() => void setVisibility(chosen, "private")}
                >
                  Retract
                </button>
                <span className="cb-toolbar-divider" />
                <button
                  type="button"
                  className="cb-toolbar-btn danger"
                  disabled={deletable.length === 0}
                  onClick={() => setDeleting(deletable)}
                >
                  <TrashIcon />
                  Delete
                </button>
              </div>
            </div>
            {tagCounts.length > 0 && (
              <div className="cb-toolbar-inner cb-tag-filters" role="group" aria-label="Filter by tag">
                <span className="cb-tag-filters__label">Tags</span>
                {tagCounts.map(({ tag: name, count }) => {
                  const active = tag !== null && sameTag(name, tag);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`cb-type-filter${active ? " active" : ""}`}
                      data-type="tag"
                      aria-pressed={active}
                      onClick={() => setTag(active ? null : name)}
                    >
                      {name} <span>{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {loading || (folderType && !(folderType.key in itemsByType)) ? (
            <p className="cb-state">Loading...</p>
          ) : shown.length === 0 ? (
            <EmptyState
              searching={query.trim().length >= 2}
              folderType={folderType}
              onCreate={(type) => setForm({ type })}
            />
          ) : view === "table" ? (
            <div className="cb-table-container">
              <table className="cb-table">
                <thead className="cb-table-header">
                  <tr>
                    <th className="cb-col-check" />
                    <th>Name</th>
                    <th className="cb-col-type">Type</th>
                    <th className="cb-col-status">Status</th>
                    <th className="cb-col-modified">Modified</th>
                    <th className="cb-col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry) => {
                    const movable = reorderable && entry.item?.translationOf === null;
                    return (
                      <tr
                        key={entry.id}
                        className={`cb-row${selected.has(entry.id) ? " selected" : ""}${
                          dropTarget === entry.id && dragging !== entry.id ? " cb-row-drop" : ""
                        }${dragging === entry.id ? " cb-row-dragging" : ""}`}
                        data-type={typeKind(entry.typeLabel)}
                        onClick={() => open(entry)}
                        draggable={movable}
                        onDragStart={
                          movable
                            ? (event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", entry.id);
                                setDragging(entry.id);
                              }
                            : undefined
                        }
                        onDragOver={
                          reorderable && dragging
                            ? (event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDropTarget(entry.id);
                              }
                            : undefined
                        }
                        onDrop={
                          reorderable && dragging
                            ? (event) => {
                                event.preventDefault();
                                const moved = dragging;
                                setDragging(null);
                                setDropTarget(null);
                                if (moved !== entry.id) void moveItem(moved, placeBefore(entry.id));
                              }
                            : undefined
                        }
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                      >
                        <td className="cb-col-check" onClick={(event) => event.stopPropagation()}>
                          {entry.kind !== "folder" && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${entry.title}`}
                              checked={selected.has(entry.id)}
                              onChange={() => toggle(entry.id)}
                            />
                          )}
                        </td>
                        <td>
                          <div className="cb-name">
                            {reorderable && (
                              <button
                                type="button"
                                className="cb-drag-handle"
                                disabled={!movable}
                                aria-label={`Move ${entry.title || "Untitled"}: drag, or use the up and down arrows`}
                                title="Drag to change the order"
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                                  event.preventDefault();
                                  const ids = (itemsByType[folderType?.key ?? ""] ?? [])
                                    .filter((item) => item.translationOf === null)
                                    .map((item) => item.id);
                                  const index = ids.indexOf(entry.id);
                                  void moveItem(entry.id, index + (event.key === "ArrowUp" ? -1 : 1));
                                }}
                              >
                                <DragIcon />
                              </button>
                            )}
                            {reorderable && movable && (
                              // The same move as dragging, one place at a time, for a click or a touch screen.
                              <span className="cb-move" onClick={(event) => event.stopPropagation()}>
                                <button
                                  type="button"
                                  className="cb-move-btn"
                                  aria-label={`Move ${entry.title || "Untitled"} up`}
                                  title="Move up"
                                  disabled={orderIndex(entry.id) <= 0}
                                  onClick={() => void moveItem(entry.id, orderIndex(entry.id) - 1)}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="cb-move-btn"
                                  aria-label={`Move ${entry.title || "Untitled"} down`}
                                  title="Move down"
                                  disabled={orderIndex(entry.id) >= orderCount() - 1}
                                  onClick={() => void moveItem(entry.id, orderIndex(entry.id) + 1)}
                                >
                                  ↓
                                </button>
                              </span>
                            )}
                            <TypeIcon entry={entry} />
                            <span className="cb-name-title">{entry.title || "Untitled"}</span>
                            {locales && entry.item && (
                              <span className="cb-badge cb-badge-language">
                                {itemLocale(entry.item, locales).toUpperCase()}
                              </span>
                            )}
                            {entry.path && <code>{entry.path}</code>}
                            {entry.tags && entry.tags.length > 0 && (
                              <EntryTags tags={entry.tags} active={tag} onPick={setTag} />
                            )}
                            {entry.count !== undefined && (
                              <code>
                                {entry.count} {entry.count === 1 ? "item" : "items"}
                              </code>
                            )}
                          </div>
                        </td>
                        <td className="cb-col-type">
                          <span className="cb-badge cb-badge-type">{entry.typeLabel}</span>
                        </td>
                        <td className="cb-col-status" onClick={(event) => event.stopPropagation()}>
                          {entry.visibility && (
                            <StatusDropdown
                              visibility={entry.visibility}
                              onChange={(next) => void setVisibility([entry], next)}
                            />
                          )}
                        </td>
                        <td className="cb-col-modified">{relativeDate(entry.modified)}</td>
                        <td className="cb-col-actions" onClick={(event) => event.stopPropagation()}>
                          <EntryActions
                            entry={entry}
                            onEdit={() => edit(entry)}
                            onDelete={() => setDeleting([entry])}
                            onNew={(type) => setForm({ type })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="cb-grid-container">
              <div className="cb-grid">
                {shown.map((entry) => (
                  <article
                    key={entry.id}
                    className={`cb-card${selected.has(entry.id) ? " selected" : ""}`}
                    data-type={typeKind(entry.typeLabel)}
                    onClick={(event) => (event.metaKey || event.ctrlKey ? toggle(entry.id) : open(entry))}
                  >
                    <div className="cb-card-preview">
                      {coverOf(entry) ? <img src={coverOf(entry)} alt="" /> : <TypeIcon entry={entry} />}
                    </div>
                    <div className="cb-card-info">
                      <span className="cb-card-title">{entry.title || "Untitled"}</span>
                      <span className="cb-card-type">
                        {entry.typeLabel}
                        {entry.count !== undefined && ` · ${entry.count} ${entry.count === 1 ? "item" : "items"}`}
                      </span>
                      {entry.tags && entry.tags.length > 0 && (
                        <EntryTags tags={entry.tags} active={tag} onPick={setTag} />
                      )}
                    </div>
                    <div className="cb-card-actions" onClick={(event) => event.stopPropagation()}>
                      <EntryActions
                        entry={entry}
                        onEdit={() => edit(entry)}
                        onDelete={() => setDeleting([entry])}
                        onNew={(type) => setForm({ type })}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {deleting && (
        <div className="cb-modal-overlay" onClick={() => setDeleting(null)}>
          <div className="cb-modal" role="alertdialog" aria-label="Delete" onClick={(event) => event.stopPropagation()}>
            <h3>Delete {deleting.length === 1 ? "Item" : "Items"}</h3>
            <p>
              Are you sure you want to delete{" "}
              {deleting.length === 1 ? `"${deleting[0]?.title}"` : `${deleting.length} items`}? This action cannot be
              undone.
            </p>
            {deleting.length > 1 && (
              <ul>
                {deleting.slice(0, 5).map((entry) => (
                  <li key={entry.id}>{entry.title}</li>
                ))}
                {deleting.length > 5 && <li>...and {deleting.length - 5} more</li>}
              </ul>
            )}
            <div className="cb-modal-actions">
              <button type="button" className="cb-toolbar-btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cb-new-btn danger"
                onClick={() => void confirmDelete().then(() => setForm(null))}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Folders and pages written in code stay; items, responses and pages added from a template can go. */
function isDeletable(entry: Entry): boolean {
  return entry.kind === "item" || entry.kind === "response" || Boolean(entry.page?.template);
}

function isEntry(entry: Entry | undefined): entry is Entry {
  return entry !== undefined;
}

/** Pages, folders and items each have their own color; all item types share one. */
function typeKind(typeLabel: string): "folder" | "page" | "custom" {
  if (typeLabel === "Folder" || typeLabel === "Content type") return "folder";
  return typeLabel === "Page" ? "page" : "custom";
}

/** The first image an item has, for its card. */
function coverOf(entry: Entry): string | undefined {
  const field = entry.type?.fields.find((candidate) => candidate.type === "image");
  const image = field && entry.item ? (entry.item.data[field.name] as { src?: string } | undefined) : undefined;
  return image?.src;
}

function TypeIcon({ entry }: { entry: Entry }): ReactNode {
  return <span className="cb-type-icon">{entry.kind === "folder" ? <FolderIcon /> : <PageIcon />}</span>;
}

function NewButton({
  types,
  folderType,
  onNew,
}: {
  types: ContentType[];
  folderType: ContentType | undefined;
  onNew: (type: ContentType) => void;
}): ReactNode {
  const label = (
    <>
      <PlusIcon />
      New
    </>
  );
  if (folderType) {
    return (
      <button type="button" className="cb-new-btn" onClick={() => onNew(folderType)}>
        <PlusIcon />
        New {folderType.singular}
      </button>
    );
  }
  if (types.length === 0) return null;
  return (
    <Menu label="New content" className="cb-new-btn" align="end" trigger={label}>
      {(close) =>
        types.map((type) => (
          <button
            key={type.key}
            type="button"
            role="menuitem"
            className="brim-editor-menu__item"
            onClick={() => {
              close();
              onNew(type);
            }}
          >
            {type.singular}
          </button>
        ))
      }
    </Menu>
  );
}

function EntryActions({
  entry,
  onEdit,
  onDelete,
  onNew,
}: {
  entry: Entry;
  onEdit: () => void;
  onDelete: () => void;
  onNew: (type: ContentType) => void;
}): ReactNode {
  if (entry.kind === "folder") {
    const type = entry.type;
    if (!type) return null;
    return (
      <div className="cb-actions">
        <button type="button" className="cb-toolbar-btn cb-folder-new" onClick={() => onNew(type)}>
          <PlusIcon />
          New {type.singular}
        </button>
      </div>
    );
  }
  return (
    <div className="cb-actions">
      {entry.path && (
        <a
          className="cb-action-btn"
          href={entry.path}
          target="_blank"
          rel="noreferrer"
          title="View"
          aria-label={`View ${entry.title}`}
        >
          <EyeIcon />
        </a>
      )}
      <button type="button" className="cb-action-btn" title="Edit" aria-label={`Edit ${entry.title}`} onClick={onEdit}>
        <PencilIcon />
      </button>
      {entry.kind === "item" && (
        <button
          type="button"
          className="cb-action-btn danger"
          title="Delete"
          aria-label={`Delete ${entry.title}`}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

const PUBLICATION = [
  { value: "published", label: "Published", description: "Visible on the public site" },
  { value: "private", label: "Private", description: "Only visible in the editor" },
] as const;

function StatusDropdown({
  visibility,
  onChange,
}: {
  visibility: Visibility;
  onChange: (visibility: Visibility) => void;
}) {
  return (
    <Menu label="Change status" className={`cb-badge cb-badge-status ${visibility}`} trigger={visibility}>
      {(close) => (
        <>
          <p className="cb-status-heading">Publication</p>
          {PUBLICATION.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === visibility}
              className="cb-status-option"
              onClick={() => {
                close();
                if (option.value !== visibility) onChange(option.value);
              }}
            >
              <span className={`cb-status-dot ${option.value}`} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.value === visibility && <span className="cb-status-check">✓</span>}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}

function EmptyState({
  searching,
  folderType,
  onCreate,
}: {
  searching: boolean;
  folderType: ContentType | undefined;
  onCreate: (type: ContentType) => void;
}) {
  if (searching) return <p className="cb-state">No results found</p>;
  return (
    <div className="cb-empty">
      <FolderIcon />
      <h3>This folder is empty</h3>
      <p>Get started by creating your first piece of content</p>
      {folderType && (
        <button type="button" className="cb-new-btn" onClick={() => onCreate(folderType)}>
          Create {folderType.singular}
        </button>
      )}
    </div>
  );
}

/** The first tags of an entry; one clicked lists only what has it. */
function EntryTags({ tags, active, onPick }: { tags: string[]; active: string | null; onPick: (tag: string) => void }) {
  const SHOWN = 3;
  return (
    <span className="cb-tags">
      {tags.slice(0, SHOWN).map((name) => (
        <button
          key={name}
          type="button"
          className={`cb-tag${active !== null && sameTag(name, active) ? " active" : ""}`}
          title={`Only what is tagged ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onPick(name);
          }}
        >
          {name}
        </button>
      ))}
      {tags.length > SHOWN && <span className="cb-tags__more">+{tags.length - SHOWN}</span>}
    </span>
  );
}

type Answer = FormResponse["answers"][number];
type Offered = Map<string, { type: string; choices: { label: string; icon?: string; image?: string }[] }>;

/**
 * The choices of the form a response came from, as its page offers them now: for responses sent before answers kept
 * their choices, read from the form's spec on its page. Empty when the page or the form is gone.
 */
function useOfferedChoices(response: FormResponse | null): Offered {
  const [offered, setOffered] = useState<Offered>(new Map());
  const page = response && response.answers.some((answer) => !answer.choices) ? formPage(response.form) : undefined;
  const form = response?.form;
  useEffect(() => {
    setOffered(new Map());
    if (!page || !form) return;
    let current = true;
    fetch(page)
      .then((reply) => (reply.ok ? reply.text() : ""))
      .then((html) => {
        const document = new DOMParser().parseFromString(html, "text/html");
        for (const element of document.querySelectorAll<HTMLElement>("brim-form[data-spec]")) {
          const spec = JSON.parse(
            new TextDecoder().decode(
              Uint8Array.from(atob((element.dataset.spec ?? "").replace(/-/g, "+").replace(/_/g, "/")), (c) =>
                c.charCodeAt(0),
              ),
            ),
          ) as {
            form?: string;
            fields?: { label: string; type: string; options?: string[]; choices?: Answer["choices"] }[];
          };
          if (spec.form !== form) continue;
          const found: Offered = new Map();
          for (const field of spec.fields ?? []) {
            const choices = field.choices ?? field.options?.map((label) => ({ label }));
            if (choices?.length) found.set(field.label, { type: field.type, choices });
          }
          if (current) setOffered(found);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [page, form]);
  return offered;
}

/** An answer without its choices takes them from the form as it is now, when the question is still asked. */
function withOffered(offered: Offered): (answer: Answer) => Answer {
  return (answer) => {
    const known = answer.choices ? undefined : offered.get(answer.label);
    if (!known) return answer;
    return {
      ...answer,
      choices: known.choices,
      picked: known.choices.map((choice) => choice.label).filter((label) => containsChoice(answer.value, label)),
    };
  };
}

/**
 * Whether a choice was picked. The answer's text joins the picked choices with ", ", and a choice's own words may
 * hold a comma ("Cald, cu materiale naturale"), so the text is searched for each whole choice; `picked` lists that
 * were cut at such a comma are not trusted alone.
 */
function wasPicked(answer: Answer, label: string): boolean {
  return (answer.picked?.includes(label) ?? false) || containsChoice(answer.value, label);
}

function containsChoice(value: string, label: string): boolean {
  return value === label || `, ${value}, `.includes(`, ${label}, `);
}
