import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { type ContentType, type Item, type NewPage, type PageTemplateInfo, type SitePage, api } from "./api.ts";
import { slugify } from "../../content/content-types.ts";
import { SelectWidget } from "./fields.tsx";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "./icons.tsx";
import { useSiteLocales } from "./languages.ts";
import {
  type GroupField,
  ITEMS_SHOWN,
  type TreeBranch,
  type TreeGroup,
  type TreeItem,
  buildSiteTree,
} from "./site-tree.ts";
import { pageTitle } from "./Toolbar.tsx";

const indent = (depth: number) => 12 + depth * 20;
const trimPath = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
const countLabel = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
const branchKey = (branch: TreeBranch) => `type:${branch.type.key}`;
const groupKey = (group: TreeGroup) => `group:${group.key}`;

function Chevron({ open }: { open: boolean }) {
  return <span className="breadcrumb-navigation-chevron">{open ? <ChevronDownIcon /> : <ChevronRightIcon />}</span>;
}

function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="brim-toolbar-btn brim-toolbar-btn--outline"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <PlusIcon />
      New
    </button>
  );
}

/**
 * The drawer that lists the site as one tree, by address. Pages written in code are only opened here; pages added
 * from one of the site's templates can also be created and deleted. The items of a content type hang under the page
 * their address starts with, split by the field after it (products under their category); clicking one opens its
 * page, and each branch and group has its + to add an item there. Types without pages are listed after the pages,
 * and opened in the content browser.
 */
export function SiteMap({
  pages,
  templates,
  currentPath,
  onNavigate,
  onBrowse,
  onCreate,
  onDelete,
  onClose,
}: {
  pages: SitePage[];
  templates: PageTemplateInfo[];
  currentPath: string;
  onNavigate: (path: string) => void;
  /**
   * Opens the content browser: on everything, on one content type, or on that type's new item form, which starts
   * with `data` (the category of the group it was added from).
   */
  onBrowse: (folder?: string, create?: boolean, data?: Record<string, unknown>) => void;
  /** Resolves to false when the page could not be created; the reason is shown in the toolbar. */
  onCreate: (page: NewPage) => Promise<boolean>;
  onDelete: (page: SitePage) => Promise<boolean>;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<SitePage | null>(null);
  const [types, setTypes] = useState<ContentType[]>([]);
  const [itemsByType, setItemsByType] = useState<Record<string, Item[]>>({});
  const [loaded, setLoaded] = useState(false);
  /** The branches and groups shown open, by key. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const locales = useSiteLocales();

  useEffect(() => {
    let current = true;
    void (async () => {
      const { types: list } = await api.types();
      const lists = await Promise.all(list.map((type) => api.items(type.key)));
      if (!current) return;
      setTypes(list);
      setItemsByType(Object.fromEntries(list.map((type, index) => [type.key, lists[index]?.items ?? []])));
      setLoaded(true);
    })();
    return () => {
      current = false;
    };
  }, []);

  const tree = useMemo(
    () => buildSiteTree(pages, types, itemsByType, locales ?? undefined),
    [pages, types, itemsByType, locales],
  );
  /** The pages of terms some branch hangs under: those branches are listed in the term's group, not at the top. */
  const termPageParents = useMemo(() => {
    const paths = new Set<string>();
    const visit = (group: TreeGroup) => {
      if (group.page) paths.add(trimPath(group.page));
      group.groups.forEach(visit);
    };
    for (const branch of tree.branches) branch.groups.forEach(visit);
    return paths;
  }, [tree]);

  // The branches and groups that lead to the item being edited start open, so it shows where it sits.
  useEffect(() => {
    if (!loaded) return;
    const branchPath = (branch: TreeBranch): string[] | null => {
      for (const group of branch.groups) {
        const inner = groupPath(group);
        if (inner) return [branchKey(branch), ...inner];
      }
      return branch.items.some((entry) => entry.path === currentPath) ? [branchKey(branch)] : null;
    };
    const groupPath = (group: TreeGroup): string[] | null => {
      if (group.page === currentPath) return [];
      for (const branch of nestedIn(group)) {
        const inner = branchPath(branch);
        if (inner) return [groupKey(group), ...inner];
      }
      for (const sub of group.groups) {
        const inner = groupPath(sub);
        if (inner) return [groupKey(group), ...inner];
      }
      return group.items.some((entry) => entry.path === currentPath) ? [groupKey(group)] : null;
    };
    setOpen(new Set(tree.branches.flatMap((branch) => branchPath(branch) ?? [])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /** The branches whose items hang under the page of a group's term (the catalogs of the ceramics). */
  function nestedIn(group: TreeGroup): TreeBranch[] {
    return group.page ? tree.branches.filter((branch) => branch.parent === trimPath(group.page!)) : [];
  }

  const needle = query.trim().toLocaleLowerCase();
  const matches = (...texts: string[]) =>
    needle === "" || texts.some((text) => text.toLocaleLowerCase().includes(needle));
  const isOpen = (key: string) => needle !== "" || open.has(key);
  const toggle = (key: string) =>
    setOpen((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const shownPages = pages.filter(
    (page) =>
      matches(pageTitle(page.path, page.title), page.path) ||
      tree.branches.some((branch) => branch.parent === trimPath(page.path) && branchShown(branch)),
  );

  function branchShown(branch: TreeBranch): boolean {
    return (
      matches(branch.type.label) ||
      branch.items.some((entry) => matches(entry.item.title, entry.path)) ||
      branch.groups.some(groupShown)
    );
  }

  function groupShown(group: TreeGroup): boolean {
    return (
      matches(group.label) ||
      group.items.some((entry) => matches(entry.item.title, entry.path)) ||
      nestedIn(group).some(branchShown)
    );
  }

  function itemRows(branch: TreeBranch, entries: TreeItem[], depth: number) {
    const found = entries.filter((entry) => matches(entry.item.title, entry.path));
    const shown = needle === "" ? found.slice(0, ITEMS_SHOWN) : found;
    return (
      <>
        {shown.map((entry) => (
          <div key={entry.item.id} className="breadcrumb-navigation-row">
            <button
              type="button"
              className="breadcrumb-navigation-item"
              aria-current={entry.path === currentPath ? "page" : undefined}
              style={{ paddingInlineStart: indent(depth) }}
              onClick={() => onNavigate(entry.path)}
            >
              <PageIcon />
              <span className="breadcrumb-navigation-item__title">{entry.item.title}</span>
              <code>{entry.path}</code>
              {entry.item.visibility === "private" && <span className="cb-badge cb-badge-status private">private</span>}
            </button>
          </div>
        ))}
        {shown.length < found.length && (
          <button
            type="button"
            className="breadcrumb-navigation-more"
            style={{ paddingInlineStart: indent(depth) }}
            onClick={() => onBrowse(branch.type.key)}
          >
            Show all {found.length} {branch.type.label.toLowerCase()}
          </button>
        )}
      </>
    );
  }

  function branchRows(branch: TreeBranch, depth: number) {
    if (!branchShown(branch)) return null;
    const { type, groupBy } = branch;
    const key = branchKey(branch);
    const vocabulary = groupBy?.to ? types.find((candidate) => candidate.key === groupBy.to) : undefined;
    return (
      <div key={key} role="group" aria-label={type.label}>
        <div className="breadcrumb-navigation-row">
          <button
            type="button"
            className="breadcrumb-navigation-item"
            aria-expanded={isOpen(key)}
            title={isOpen(key) ? `Hide ${type.label}` : `Show ${type.label}`}
            style={{ paddingInlineStart: indent(depth) }}
            onClick={() => toggle(key)}
          >
            <Chevron open={isOpen(key)} />
            <FolderIcon />
            <span className="breadcrumb-navigation-item__title">{type.label}</span>
            <code>{countLabel(branch.items.length)}</code>
          </button>
          <NewButton label={`New ${type.singular}`} onClick={() => onBrowse(type.key, true)} />
        </div>
        {isOpen(key) &&
          (groupBy ? (
            <>
              {branch.groups.map((group) => groupRows(branch, group, groupBy, depth + 1))}
              {vocabulary && needle === "" && (
                <button
                  type="button"
                  className="breadcrumb-navigation-more"
                  style={{ paddingInlineStart: indent(depth + 1) }}
                  onClick={() => onBrowse(vocabulary.key, true)}
                >
                  <PlusIcon /> New {vocabulary.singular.toLowerCase()}
                </button>
              )}
            </>
          ) : (
            itemRows(branch, branch.items, depth + 1)
          ))}
      </div>
    );
  }

  /**
   * A group and, when open, what it holds: the types whose items hang under its term's page, its subgroups, then
   * its items in no subgroup.
   */
  function groupRows(branch: TreeBranch, group: TreeGroup, field: GroupField, depth: number) {
    if (!groupShown(group)) return null;
    const { type } = branch;
    const key = groupKey(group);
    return (
      <div key={key} role="group" aria-label={group.label}>
        <div className="breadcrumb-navigation-row">
          {group.page ? (
            // The term has its own page: its name opens it, the chevron shows its items.
            <>
              <button
                type="button"
                className="breadcrumb-navigation-toggle"
                aria-expanded={isOpen(key)}
                aria-label={`${isOpen(key) ? "Hide" : "Show"} the ${type.label.toLowerCase()} in ${group.label}`}
                style={{ marginInlineStart: indent(depth) - 8 }}
                onClick={() => toggle(key)}
              >
                <Chevron open={isOpen(key)} />
              </button>
              <button
                type="button"
                className="breadcrumb-navigation-item breadcrumb-navigation-item--after-toggle"
                aria-current={group.page === currentPath ? "page" : undefined}
                title={`Open the page of ${group.label}`}
                onClick={() => onNavigate(group.page!)}
              >
                <PageIcon />
                <span className="breadcrumb-navigation-item__title">{group.label}</span>
                <code>
                  {group.page} · {countLabel(group.items.length)}
                </code>
                {group.term?.visibility === "private" && (
                  <span className="cb-badge cb-badge-status private">private</span>
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="breadcrumb-navigation-item"
              aria-expanded={isOpen(key)}
              title={`${field.label}: ${group.label}`}
              style={{ paddingInlineStart: indent(depth) }}
              onClick={() => toggle(key)}
            >
              <Chevron open={isOpen(key)} />
              <FolderIcon />
              <span className="breadcrumb-navigation-item__title">{group.label}</span>
              <code>{countLabel(group.items.length)}</code>
            </button>
          )}
          <NewButton
            label={`New ${type.singular} in ${group.label}`}
            onClick={() => onBrowse(type.key, true, Object.keys(group.data).length > 0 ? group.data : undefined)}
          />
        </div>
        {isOpen(key) && (
          <>
            {nestedIn(group).map((nested) => branchRows(nested, depth + 1))}
            {group.subgroupBy && group.groups.map((sub) => groupRows(branch, sub, group.subgroupBy!, depth + 1))}
            {itemRows(branch, group.rest, depth + 1)}
          </>
        )}
      </div>
    );
  }

  const homeless = tree.branches.filter(
    (branch) =>
      branch.parent === null ||
      (!pages.some((page) => trimPath(page.path) === branch.parent) && !termPageParents.has(branch.parent)),
  );
  const unplaced = tree.unplaced.filter((type) => matches(type.label));

  return (
    <div className="breadcrumb-navigation-layer" onClick={onClose}>
      <aside
        className="breadcrumb-navigation-drawer"
        aria-label="Site map"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="breadcrumb-navigation-header">
          <div>
            <small>Site map</small>
            <h2>Pages and content</h2>
          </div>
          <button type="button" className="brim-sidebar-close-btn" aria-label="Close site map" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {adding && <NewPageForm templates={templates} onCancel={() => setAdding(false)} onCreate={onCreate} />}
        <div className="breadcrumb-navigation-search">
          <SearchIcon />
          <input
            type="search"
            className="field-input"
            aria-label="Find a page or an item"
            placeholder="Find a page or an item"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <nav className="breadcrumb-navigation-list">
          {shownPages.map((page) => {
            const depth = page.path.split("/").filter(Boolean).length - 1;
            return (
              <div key={page.path}>
                <div className="breadcrumb-navigation-row">
                  <button
                    type="button"
                    className="breadcrumb-navigation-item"
                    aria-current={page.path === currentPath ? "page" : undefined}
                    // Nested pages are indented under their parent.
                    style={{ paddingInlineStart: indent(Math.max(depth, 0)) }}
                    onClick={() => onNavigate(page.path)}
                  >
                    <PageIcon />
                    <span className="breadcrumb-navigation-item__title">{pageTitle(page.path, page.title)}</span>
                    <code>{page.path}</code>
                    {page.visibility === "private" && <span className="cb-badge cb-badge-status private">private</span>}
                  </button>
                  {page.template && (
                    <button
                      type="button"
                      className="brim-toolbar-btn brim-toolbar-btn--icon"
                      aria-label={`Delete ${pageTitle(page.path, page.title)}`}
                      title="Delete page"
                      onClick={() => setDeleting(page)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
                {tree.branches
                  .filter((branch) => branch.parent === trimPath(page.path))
                  .map((branch) => branchRows(branch, Math.max(depth, 0) + 1))}
              </div>
            );
          })}
          {homeless.map((branch) => branchRows(branch, 0))}
          {unplaced.length > 0 && (
            <>
              <h3 className="breadcrumb-navigation-heading">Without a page</h3>
              {unplaced.map((type) => (
                <div key={type.key} className="breadcrumb-navigation-row">
                  <button
                    type="button"
                    className="breadcrumb-navigation-item"
                    title={`Open ${type.label}`}
                    onClick={() => onBrowse(type.key)}
                  >
                    <FolderIcon />
                    <span className="breadcrumb-navigation-item__title">{type.label}</span>
                    <code>{countLabel((itemsByType[type.key] ?? []).filter((item) => item.locale === "").length)}</code>
                  </button>
                  <NewButton label={`New ${type.singular}`} onClick={() => onBrowse(type.key, true)} />
                </div>
              ))}
            </>
          )}
          {needle !== "" &&
            shownPages.length === 0 &&
            homeless.every((branch) => !branchShown(branch)) &&
            unplaced.length === 0 && <p className="brim-sidebar-note">Nothing matches "{query.trim()}".</p>}
        </nav>
        <footer className="breadcrumb-navigation-footer">
          {templates.length > 0 && !adding && (
            <button type="button" className="cb-new-btn" onClick={() => setAdding(true)}>
              <PlusIcon />
              New page
            </button>
          )}
          <button type="button" className="brim-toolbar-btn brim-toolbar-btn--action" onClick={() => onBrowse()}>
            All content
          </button>
        </footer>
      </aside>

      {deleting && (
        <div
          className="cb-modal-overlay"
          onClick={(event) => {
            event.stopPropagation();
            setDeleting(null);
          }}
        >
          <div
            className="cb-modal"
            role="alertdialog"
            aria-label="Delete page"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Delete Page</h3>
            <p>
              Are you sure you want to delete "{pageTitle(deleting.path, deleting.title)}" ({deleting.path}) and
              everything written on it? This action cannot be undone.
            </p>
            <div className="cb-modal-actions">
              <button type="button" className="cb-toolbar-btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cb-new-btn danger"
                onClick={() => void onDelete(deleting).then((done) => done && setDeleting(null))}
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

/** Template, title and address of a new page. The address follows the title until the owner edits it. */
function NewPageForm({
  templates,
  onCreate,
  onCancel,
}: {
  templates: PageTemplateInfo[];
  onCreate: (page: NewPage) => Promise<boolean>;
  onCancel: () => void;
}) {
  const id = useId();
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [pathEdited, setPathEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const template = templates.find((candidate) => candidate.key === templateKey);

  useEffect(() => {
    if (pathEdited) return;
    const slug = slugify(title);
    setPath(slug ? `/${template?.folder ? `${template.folder}/` : ""}${slug}` : "");
  }, [title, template, pathEdited]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const created = await onCreate({ template: templateKey, title, ...(path && { path }) });
    setBusy(false);
    if (created) onCancel();
  }

  return (
    <form className="breadcrumb-navigation-new" onSubmit={(event) => void submit(event)}>
      <SelectWidget
        label="Template"
        description={template?.description}
        options={templates.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
        value={templateKey}
        onChange={setTemplateKey}
      />
      <div className="field-group">
        <label className="field-label" htmlFor={`${id}-title`}>
          Title
        </label>
        <input
          id={`${id}-title`}
          className="field-input"
          value={title}
          required
          autoFocus
          placeholder="e.g. Lawn care"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor={`${id}-path`}>
          Address
        </label>
        <p className="field-description">The page starts private: only you see it until you make it public.</p>
        <input
          id={`${id}-path`}
          className="field-input"
          value={path}
          placeholder="/services/lawn-care"
          onChange={(event) => {
            setPathEdited(true);
            setPath(event.target.value);
          }}
        />
      </div>
      <div className="cb-modal-actions">
        <button type="button" className="cb-toolbar-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="cb-new-btn" disabled={busy || title.trim() === ""}>
          Create page
        </button>
      </div>
    </form>
  );
}
