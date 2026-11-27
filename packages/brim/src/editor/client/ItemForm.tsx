import { type ReactNode, useEffect, useRef, useState } from "react";
import { optionValues, optionsOf } from "../../content/content-types.ts";
import { renderBlocks } from "../../content/rich-text.ts";
import { rankTags, tagsOf } from "../../content/tags.ts";
import type { RichTextValue } from "../../content/types.ts";
import { itemPathSegments, slugify } from "../../content/item-path.ts";
import { type ContentField, type ContentType, type Item, type ItemDraft, api } from "./api.ts";
import {
  CheckboxWidget,
  DateWidget,
  ImageWidget,
  type ReferenceTerm,
  ReferenceWidget,
  SelectWidget,
  SettingField,
  TagsWidget,
  TextWidget,
} from "./fields.tsx";
import type { Schema } from "./kinds.ts";
import { GalleryFieldWidget } from "./ImagesWidget.tsx";
import { LinkWidget } from "./LinkWidget.tsx";
import { dropTransferred, insertTransferred, readBlocks, readTransfer } from "./rich-text.ts";
import { MediaFolderContext } from "./widgets.tsx";
import { TextTools } from "./TextTools.tsx";

/** The item in the site's languages: which exist, which is this one, and how to open or add the others. */
export interface ItemLanguages {
  codes: string[];
  current: string;
  items: Record<string, Item | undefined>;
  onOpen: (item: Item) => void;
  onTranslate: (code: string) => void;
}

/**
 * The fields that say how an item is filed and shown rather than what it says: beside the content in the item form,
 * under it beside the page. The names are Brim's standard ones (see `content-types.ts`).
 */
const DETAIL_FIELDS = new Set(["image", "published", "modified", "author", "tags"]);

/** Which of an item's fields `ItemFields` draws: what it says, how it is filed, or all of them one after the other. */
export type ItemFieldsPart = "main" | "details" | "all";

/** The required fields left empty in a draft, with why: the server would refuse the item for the first of them. */
export function missingFields(type: ContentType, draft: ItemDraft): Record<string, string> {
  const missing: Record<string, string> = {};
  if (draft.title.trim() === "") missing.title = "Give it a title.";
  for (const field of type.fields) {
    if (!field.required || field.type === "blocks") continue;
    const value = draft.data[field.name];
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0) ||
      (field.type === "image" && !(value as { src?: unknown }).src);
    if (empty) missing[field.name] = `${field.label} is required.`;
  }
  return missing;
}

// Each row is two text boxes; rows left wholly empty are dropped when the item is saved.
const KEY_VALUE: Schema = {
  type: "list",
  label: "Rows",
  addLabel: "Add row",
  item: { type: "group", fields: { label: { type: "text", label: "Label" }, value: { type: "text", label: "Value" } } },
};

const LEAVE_UNSAVED = "Leave without saving? Your changes to this item will be lost.";

/**
 * The form for one item of a content type. What the item says is on the left; on the right, whether it is out and
 * how it is filed (address, picture, date, author, tags). Saving keeps it private or publishes it, said on the button.
 */
export function ItemForm({
  type,
  item,
  initialData,
  error,
  canPublish = true,
  onSave,
  onDelete,
  onCancel,
  onDirty,
  languages,
}: {
  type: ContentType;
  item: Item | undefined;
  /** What a new item's fields start with. */
  initialData?: Record<string, unknown> | undefined;
  /** Why the last save was refused. */
  error: string | undefined;
  /** Whether the user's role may publish; without it, only private items are saved. */
  canPublish?: boolean | undefined;
  onSave: (draft: ItemDraft) => void;
  onDelete: (() => void) | undefined;
  onCancel: () => void;
  /** Told whether the form has changes not saved yet, so leaving it another way can ask first. */
  onDirty?: ((dirty: boolean) => void) | undefined;
  /** On a site with languages: the item in each of them, and how to open or add one. */
  languages?: ItemLanguages | undefined;
}) {
  // A new item stays out of sight until it is published, like a new page.
  const [draft, setDraft] = useState<ItemDraft>(
    () => item ?? { title: "", slug: "", visibility: "private", data: { ...initialData } },
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [start] = useState(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => onDirty?.(dirty), [dirty]);
  // Gone (saved, or left after asking): it holds nothing unsaved any more.
  useEffect(() => () => onDirty?.(false), []);
  /** Required fields found empty when saving was tried: each says so under itself until it is filled. */
  const [missing, setMissing] = useState<Record<string, string>>({});
  const formElement = useRef<HTMLFormElement>(null);
  /** The title as it is typed, before its box saves it: the heading and the address follow each keystroke. */
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  useEffect(() => setTypedTitle(null), [draft.title]);
  useEffect(() => {
    if (missing.title && typedTitle?.trim()) setMissing(({ title: _, ...rest }) => rest);
  }, [typedTitle]);

  // Closing the tab or reloading with changes in the form would lose them.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Once a missing field is filled, its message goes.
  useEffect(() => {
    if (Object.keys(missing).length === 0) return;
    const still = missingFields(type, draft);
    const kept = Object.fromEntries(Object.entries(missing).filter(([name]) => name in still));
    if (Object.keys(kept).length !== Object.keys(missing).length) setMissing(kept);
  }, [draft]);

  /** Runs `leave` once the owner agrees to lose what is not saved; at once when nothing is. */
  const leaving = (leave: () => void) => (): void => {
    if (!dirtyRef.current || window.confirm(LEAVE_UNSAVED)) leave();
  };

  /**
   * Saves the item as private or published. A text box being typed in saves its words when it loses focus, so focus
   * leaves it first and the save reads the draft after that.
   */
  function save(visibility: ItemDraft["visibility"]): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(() => {
      const next = { ...draftRef.current, visibility };
      const empty = missingFields(type, next);
      setMissing(empty);
      if (Object.keys(empty).length > 0) {
        // The first field to fill in comes into view.
        requestAnimationFrame(() =>
          formElement.current
            ?.querySelector(".cb-item-form__missing")
            ?.closest(".field-group, .brim-setting-group, .cb-item-form__field")
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        );
        return;
      }
      onSave(next);
    });
  }

  const published = draft.visibility === "published";
  const isNew = !item;
  const singular = type.singular.toLowerCase();
  const publishedOn = typeof draft.data.published === "string" ? draft.data.published : "";

  return (
    <MediaFolderContext.Provider
      value={item ? { key: `${type.key}/${item.id}`, label: item.title } : { label: singular }}
    >
      <form
        ref={formElement}
        className="cb-item-form cb-item-form--split"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save(draft.visibility);
        }}
        onKeyDown={(event) => {
          // Cmd+S / Ctrl+S saves as it is, never the browser's "save page".
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            save(draft.visibility);
          }
        }}
      >
        <header className="cb-item-form__header">
          <div className="cb-item-form__heading">
            <span className="cb-item-form__kind">{isNew ? `New ${singular}` : type.singular}</span>
            <h2>{(typedTitle ?? draft.title).trim() || (isNew ? `Untitled ${singular}` : item.title)}</h2>
          </div>
          <div className="cb-item-form__actions">
            <button type="button" className="cb-toolbar-btn" onClick={leaving(onCancel)}>
              {dirty ? "Cancel" : "Close"}
            </button>
          </div>
        </header>
        {languages && (
          <div className="cb-item-languages" role="group" aria-label="Languages">
            <span className="cb-item-languages__label">Language</span>
            {languages.codes.map((code) => {
              const translation = languages.items[code];
              const current = code === languages.current;
              return translation ? (
                <button
                  key={code}
                  type="button"
                  className="cb-language-chip"
                  aria-current={current ? "true" : undefined}
                  title={current ? "This item" : `Open the ${code.toUpperCase()} version`}
                  disabled={current}
                  onClick={leaving(() => languages.onOpen(translation))}
                >
                  {code.toUpperCase()}
                </button>
              ) : (
                <button
                  key={code}
                  type="button"
                  className="cb-language-chip cb-language-chip--missing"
                  disabled={!item}
                  title={item ? `Translate into ${code.toUpperCase()}: a private copy to translate` : "Save first"}
                  onClick={leaving(() => languages.onTranslate(code))}
                >
                  + {code.toUpperCase()}
                </button>
              );
            })}
          </div>
        )}
        <div className="cb-item-form__body">
          <div className="cb-item-form__main">
            <ItemFields
              type={type}
              draft={draft}
              onChange={setDraft}
              onDraft={(field, value) => field === "title" && setTypedTitle(String(value))}
              part="main"
              missing={missing}
            />
          </div>
          <aside className="cb-item-form__aside" aria-label="Status and details">
            <section className="cb-item-form__card">
              <div className="cb-item-form__status">
                <span className={`cb-badge cb-badge-status ${draft.visibility}`}>
                  {published ? "Published" : isNew ? "Draft" : "Private"}
                </span>
                <span className="field-description">
                  {published
                    ? type.article && publishedOn
                      ? `Out since ${formatDate(publishedOn)}.`
                      : "Visitors see it."
                    : "Only people signed in to the editor see it."}
                </span>
              </div>
              {error && (
                <p className="field-error cb-item-form__error" role="alert">
                  {error}
                </p>
              )}
              {Object.keys(missing).length > 0 && (
                <p className="field-error cb-item-form__error" role="alert">
                  {Object.keys(missing).length === 1
                    ? "One field still needs filling in."
                    : `${Object.keys(missing).length} fields still need filling in.`}
                </p>
              )}
              <div className="cb-item-form__buttons">
                {published ? (
                  <>
                    <button type="button" className="cb-new-btn" onClick={() => save("published")}>
                      {dirty ? "Save changes" : "Saved"}
                    </button>
                    {canPublish && (
                      <button type="button" className="cb-toolbar-btn" onClick={() => save("private")}>
                        Unpublish
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {canPublish && (
                      <button type="button" className="cb-new-btn" onClick={() => save("published")}>
                        Publish
                      </button>
                    )}
                    <button
                      type="button"
                      className={canPublish ? "cb-toolbar-btn" : "cb-new-btn"}
                      onClick={() => save("private")}
                    >
                      {isNew ? "Save as draft" : "Save"}
                    </button>
                  </>
                )}
              </div>
              <p className="cb-item-form__hint">
                <kbd>{navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl"}</kbd> <kbd>S</kbd> saves without changing who
                sees it
              </p>
            </section>
            <section className="cb-item-form__card">
              <h3 className="cb-item-form__card-title">{type.article ? "Article" : "Details"}</h3>
              <ItemFields
                type={type}
                draft={draft}
                onChange={setDraft}
                part="details"
                missing={missing}
                liveTitle={typedTitle ?? undefined}
              />
            </section>
            {onDelete && (
              <button type="button" className="cb-toolbar-btn danger cb-item-form__delete" onClick={onDelete}>
                Delete {singular}
              </button>
            )}
          </aside>
        </div>
      </form>
    </MediaFolderContext.Provider>
  );
}

/** `2026-11-26` as the browser's language writes a day. */
function formatDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!match) return day;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * An item's title, address and the fields its type declares: in the item form (`part` splits them between its two
 * columns) and beside the item's page (all of them, what it says first and how it is filed under it).
 */
export function ItemFields({
  type,
  draft,
  onChange,
  onDraft,
  part = "all",
  missing = {},
  liveTitle,
}: {
  type: ContentType;
  draft: ItemDraft;
  onChange: (draft: ItemDraft) => void;
  /** Each keystroke in a text field, before it is saved on blur: for a live preview of the page. */
  onDraft?: ((field: string, value: unknown) => void) | undefined;
  part?: ItemFieldsPart;
  /** Required fields left empty, by name (`title` for the title), with what to tell the owner under each. */
  missing?: Record<string, string>;
  /** The title as typed in another part of the form, for the address made from it. */
  liveTitle?: string | undefined;
}): ReactNode {
  // The title as it is typed, so the address made from it follows each keystroke.
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  useEffect(() => setTypedTitle(null), [draft.title]);
  // Blocks are added and arranged on the item's page, where they are seen: no place for them in a form.
  const shown = type.fields.filter((field) => field.type !== "blocks");
  const main = shown.filter((field) => !DETAIL_FIELDS.has(field.name));
  const details = shown.filter((field) => DETAIL_FIELDS.has(field.name));
  const field = (field: ContentField) => (
    <ItemField
      key={field.name}
      type={type}
      field={field}
      value={draft.data[field.name]}
      missing={missing[field.name]}
      onDraft={onDraft && ((value) => onDraft(field.name, value))}
      onChange={(value) => onChange({ ...draft, data: { ...draft.data, [field.name]: value } })}
    />
  );

  const title = (
    <div className="cb-item-form__field" key="title">
      <TextWidget
        label="Title *"
        value={draft.title}
        onDraft={(next) => {
          setTypedTitle(next);
          onDraft?.("title", next);
        }}
        onChange={(next) => onChange({ ...draft, title: next })}
      />
      {missing.title && <Missing text={missing.title} />}
    </div>
  );
  const address = (
    <AddressField
      key="address"
      type={type}
      title={typedTitle ?? liveTitle ?? draft.title}
      slug={draft.slug}
      data={draft.data}
      onChange={(slug) => onChange({ ...draft, slug })}
    />
  );

  if (part === "main") return [title, ...main.map(field)];
  if (part === "details") return [address, ...details.map(field)];
  return (
    <>
      {title}
      {main.map(field)}
      <h4 className="brim-item-fields__heading">{type.article ? "Article" : "Details"}</h4>
      {address}
      {details.map(field)}
    </>
  );
}

/** Says under a field that it is required and empty. */
function Missing({ text }: { text: string }) {
  return (
    <p className="field-error cb-item-form__missing" role="alert">
      {text}
    </p>
  );
}

/**
 * The item's own part of its link, shown as the link it makes. It follows the title until the owner changes it;
 * emptied, it follows the title again.
 */
function AddressField({
  type,
  title,
  slug,
  data,
  onChange,
}: {
  type: ContentType;
  title: string;
  slug: string;
  data: Record<string, unknown>;
  onChange: (slug: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const own = slug || slugify(title);
  const link = itemPathSegments(type)
    .map((segment) => {
      if ("fixed" in segment) return segment.fixed;
      if (segment.field === "slug") return own || "…";
      const value = data[segment.field];
      return typeof value === "string" && value ? slugify(value) : `[${segment.field}]`;
    })
    .join("/");

  if (editing) {
    return (
      <div className="cb-item-form__field">
        <TextWidget
          label="Address"
          description="Lowercase letters, digits and dashes. Empty makes it from the title."
          value={slug}
          placeholder={slugify(title)}
          onChange={(next) => {
            onChange(slugify(next));
            setEditing(false);
          }}
        />
      </div>
    );
  }
  return (
    <div className="field-group cb-item-address">
      <span className="field-label">Address</span>
      <div className="cb-item-address__row">
        <code className="cb-item-address__link" title={`/${link}`}>
          /{link}
        </code>
        <button type="button" className="cb-item-address__edit" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>
      {!slug && <p className="field-description">Made from the title.</p>}
    </div>
  );
}

/** One field of an item with its widget: in the item form, the page settings, and beside an element showing it. */
export function ItemField({
  missing,
  ...props
}: {
  type: ContentType;
  field: ContentField;
  value: unknown;
  /** Set when the field is required and was left empty: said under it. */
  missing?: string | undefined;
  /** Each keystroke in a text field, before it is saved on blur. */
  onDraft?: ((value: string) => void) | undefined;
  onChange: (value: unknown) => void;
}): ReactNode {
  if (!missing) return <FieldWidget {...props} />;
  return (
    <div className="cb-item-form__field" data-missing="">
      <FieldWidget {...props} />
      <Missing text={missing} />
    </div>
  );
}

function FieldWidget({
  type,
  field,
  value,
  onDraft,
  onChange,
}: {
  type: ContentType;
  field: ContentField;
  value: unknown;
  onDraft?: ((value: string) => void) | undefined;
  onChange: (value: unknown) => void;
}): ReactNode {
  const label = field.required ? `${field.label} *` : field.label;
  const text = typeof value === "string" ? value : "";

  switch (field.type) {
    case "text":
      return <TextWidget label={label} description={field.help} value={text} onDraft={onDraft} onChange={onChange} />;
    case "url":
      return <LinkWidget label={label} description={field.help} value={text} onChange={onChange} />;
    case "email":
      return <TextWidget label={label} description={field.help} type="email" value={text} onChange={onChange} />;
    case "date":
      return <DateWidget label={label} description={field.help} value={text} onChange={onChange} />;
    case "textarea":
      return (
        <TextWidget
          label={label}
          description={field.help}
          value={text}
          multiline
          onDraft={onDraft}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <TextWidget
          label={label}
          description={field.help}
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(next) => onChange(next.trim() === "" ? undefined : Number(next))}
        />
      );
    case "boolean":
      return <CheckboxWidget label={label} description={field.help} checked={value === true} onChange={onChange} />;
    case "select":
      return (
        <SelectWidget
          label={label}
          description={field.help}
          options={optionsOf(field)}
          value={text}
          onChange={onChange}
        />
      );
    case "image":
      return <ImageWidget label={label} value={(value ?? {}) as Record<string, unknown>} onChange={onChange} />;
    case "gallery":
      return <GalleryFieldWidget label={label} value={value} onChange={onChange} />;
    case "richtext":
      return <RichTextField label={label} value={value as RichTextValue | undefined} onChange={onChange} />;
    case "keyvalue":
      return <KeyValueField label={label} value={value} onChange={onChange} />;
    case "reference":
      return <ReferenceField field={field} label={label} value={value} onChange={onChange} />;
    case "tags":
      return <TagsField type={type} field={field} label={label} value={tagsOf(value)} onChange={onChange} />;
    case "blocks":
      // Blocks are added and arranged on the item's page, where they are seen.
      return (
        <div className="field-group">
          <span className="field-label">{label}</span>
          <p className="field-description">{field.help ?? "Added and arranged on the page itself."}</p>
        </div>
      );
  }
}

/** An item's tags, offering its field's own list, or else the tags the type's other items already have. */
function TagsField({
  type,
  field,
  label,
  value,
  onChange,
}: {
  type: ContentType;
  field: ContentField;
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const fixed = field.options !== undefined && field.options.length > 0;
  const [used, setUsed] = useState<string[]>([]);
  useEffect(() => {
    if (fixed) return;
    let current = true;
    api.items(type.key).then(
      ({ items }) => current && setUsed(rankTags(items.map((item) => item.data[field.name])).map(({ tag }) => tag)),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [type.key, field.name, fixed]);

  return (
    <TagsWidget
      label={label}
      description={field.help}
      value={value}
      suggestions={fixed ? optionValues(field) : used}
      fixed={fixed}
      onChange={onChange}
    />
  );
}

/**
 * A reference field: the vocabulary's terms in the one reference widget, and new terms added to the vocabulary from
 * here (published when the user may publish, else private, as any new item).
 */
function ReferenceField({
  field,
  label,
  value,
  onChange,
}: {
  field: ContentField;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [target, setTarget] = useState<ContentType | undefined>(undefined);
  useEffect(() => {
    let current = true;
    contentTypes().then(
      (types) => current && setTarget(types.find((candidate) => candidate.key === field.to)),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [field.to]);
  const [terms, setTerms] = useState<ReferenceTerm[]>([]);
  useEffect(() => {
    let current = true;
    api.items(field.to ?? "").then(
      ({ items }) => current && setTerms(termsOf(items)),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [field.to]);

  const slugs = Array.isArray(value) ? (value as string[]) : typeof value === "string" && value ? [value] : [];
  const vocabulary = target?.label ?? field.to ?? "";
  const description = field.help ?? (target ? `From the vocabulary ${target.label}.` : undefined);

  async function add(title: string): Promise<ReferenceTerm | undefined> {
    if (!field.to) return undefined;
    const made = await api.createItem(field.to, { title, slug: "", visibility: "published", data: {} });
    const term = { value: made.item.slug, label: made.item.title };
    setTerms((known) => [...known, term].sort((a, b) => a.label.localeCompare(b.label)));
    return term;
  }

  return (
    <ReferenceWidget
      label={label}
      description={description}
      vocabulary={vocabulary}
      terms={terms}
      value={slugs}
      multiple={field.multiple === true}
      required={field.required === true}
      onChange={(next) => onChange(field.multiple ? next : (next[0] ?? undefined))}
      onAdd={add}
    />
  );
}

/** The site's content types, asked once: a form with several reference fields needs their names, not new requests. */
let typesRequest: Promise<ContentType[]> | undefined;
function contentTypes(): Promise<ContentType[]> {
  typesRequest ??= api.types().then(({ types }) => types);
  typesRequest.catch(() => (typesRequest = undefined));
  return typesRequest;
}

/** A vocabulary's terms by title; a translated term shares its slug, so it is listed once, by its default title. */
function termsOf(items: Item[]): ReferenceTerm[] {
  const bySlug = new Map<string, string>();
  for (const item of [...items].sort((a, b) => Number(a.locale !== "") - Number(b.locale !== ""))) {
    if (!bySlug.has(item.slug)) bySlug.set(item.slug, item.title);
  }
  return [...bySlug]
    .map(([slug, title]) => ({ value: slug, label: title }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Rows of a key–value field. The item is saved as soon as it changes and the server drops rows left empty, so a row
 * just added is kept here, shown and typed into, and only rows with something in them are sent.
 */
function KeyValueField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const saved = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const [rows, setRows] = useState<Record<string, unknown>[]>(saved);
  const filled = (list: Record<string, unknown>[]) =>
    list.filter((row) => String(row.label ?? "").trim() !== "" || String(row.value ?? "").trim() !== "");
  // The item changed elsewhere (another field's save, history, another tab): show what it holds now.
  useEffect(() => {
    if (JSON.stringify(filled(rows)) !== JSON.stringify(saved)) setRows(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(saved)]);

  return (
    <SettingField
      schema={{ ...KEY_VALUE, label }}
      value={rows}
      onChange={(next) => {
        const list = Array.isArray(next) ? (next as Record<string, unknown>[]) : [];
        setRows(list);
        if (JSON.stringify(filled(list)) !== JSON.stringify(saved)) onChange(filled(list));
      }}
    />
  );
}

/** Flowing text with the same formatting toolbar as text on the page. */
function RichTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: RichTextValue | undefined;
  onChange: (value: RichTextValue) => void;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  /** The words being dragged within the field, which move rather than copy when dropped in it. */
  const dragged = useRef<Range | null>(null);
  // The starting markup is set once; afterwards the browser owns the edited content.
  const [initialHtml] = useState(() => renderBlocks(value?.blocks ?? []) || "<p><br></p>");
  // Written elsewhere (on the page), the field follows; never while the owner is writing in it.
  useEffect(() => {
    if (!element || element.ownerDocument.activeElement === element) return;
    const html = renderBlocks(value?.blocks ?? []) || "<p><br></p>";
    if (element.innerHTML !== html) element.innerHTML = html;
  }, [element, value]);

  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      <div className="brim-richtext-field">
        <div
          className="brim-element__toolbar brim-richtext-field__toolbar"
          role="toolbar"
          aria-label={`${label} formatting`}
        >
          {element && <TextTools element={element} kind="richtext" onElement={() => undefined} />}
        </div>
        <div
          ref={setElement}
          className="brim-richtext-field__content"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          dangerouslySetInnerHTML={{ __html: initialHtml }}
          onFocus={(event) => {
            event.currentTarget.ownerDocument.execCommand("styleWithCSS", false, "false");
            event.currentTarget.ownerDocument.execCommand("defaultParagraphSeparator", false, "p");
          }}
          onBlur={(event) => onChange({ blocks: readBlocks(event.currentTarget) })}
          // Pasted or dropped content brings foreign markup: only the formatting the editor knows is kept.
          onPaste={(event) => {
            event.preventDefault();
            insertTransferred(event.currentTarget.ownerDocument, readTransfer(event.clipboardData, true));
          }}
          onDragStart={() => {
            const selection = document.getSelection();
            dragged.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
          }}
          onDragEnd={() => (dragged.current = null)}
          onDragOver={(event) => {
            // A dropped file has no place in the text, and would open in place of the editor.
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "none";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            dropTransferred(event.currentTarget, event.nativeEvent, dragged.current, true);
            dragged.current = null;
          }}
        />
      </div>
    </div>
  );
}
