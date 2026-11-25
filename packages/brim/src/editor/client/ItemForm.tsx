import { type ReactNode, useEffect, useRef, useState } from "react";
import { optionValues, optionsOf } from "../../content/content-types.ts";
import { renderBlocks } from "../../content/rich-text.ts";
import { rankTags, tagsOf } from "../../content/tags.ts";
import type { RichTextValue } from "../../content/types.ts";
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

const VISIBILITY_OPTIONS = [
  { value: "published", label: "Published" },
  { value: "private", label: "Private" },
];

// Each row is two text boxes; rows left wholly empty are dropped when the item is saved.
const KEY_VALUE: Schema = {
  type: "list",
  label: "Rows",
  addLabel: "Add row",
  item: { type: "group", fields: { label: { type: "text", label: "Label" }, value: { type: "text", label: "Value" } } },
};

const LEAVE_UNSAVED = "Leave without saving? Your changes to this item will be lost.";

/** The form for one item of a content type: its title, address, visibility and the fields the type declares. */
export function ItemForm({
  type,
  item,
  initialData,
  error,
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
  const [start] = useState(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => onDirty?.(dirty), [dirty]);
  // Gone (saved, or left after asking): it holds nothing unsaved any more.
  useEffect(() => () => onDirty?.(false), []);

  // Closing the tab or reloading with changes in the form would lose them.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** Runs `leave` once the owner agrees to lose what is not saved; at once when nothing is. */
  const leaving =
    (leave: () => void) =>
    (): void => {
      if (!dirtyRef.current || window.confirm(LEAVE_UNSAVED)) leave();
    };

  return (
    <MediaFolderContext.Provider
      value={item ? { key: `${type.key}/${item.id}`, label: item.title } : { label: type.singular.toLowerCase() }}
    >
      <form
        className="cb-item-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <header className="cb-item-form__header">
          <h2>{item ? item.title : `New ${type.singular.toLowerCase()}`}</h2>
          <div className="cb-item-form__actions">
            <button type="button" className="cb-toolbar-btn" onClick={leaving(onCancel)}>
              Cancel
            </button>
            {onDelete && (
              <button type="button" className="cb-toolbar-btn danger" onClick={onDelete}>
                Delete
              </button>
            )}
            <button type="submit" className="cb-new-btn">
              {item ? "Save" : `Create ${type.singular}`}
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
        {error && (
          <p className="field-error cb-item-form__error" role="alert">
            {error}
          </p>
        )}
        <ItemFields type={type} draft={draft} onChange={setDraft} />
        <SelectWidget
          label="Visibility"
          options={VISIBILITY_OPTIONS}
          value={draft.visibility}
          onChange={(visibility) => setDraft({ ...draft, visibility: visibility as ItemDraft["visibility"] })}
        />
      </form>
    </MediaFolderContext.Provider>
  );
}

/** An item's title, address and the fields its type declares: in the item form, and beside the item's page. */
export function ItemFields({
  type,
  draft,
  onChange,
  onDraft,
}: {
  type: ContentType;
  draft: ItemDraft;
  onChange: (draft: ItemDraft) => void;
  /** Each keystroke in a text field, before it is saved on blur: for a live preview of the page. */
  onDraft?: ((field: string, value: unknown) => void) | undefined;
}): ReactNode {
  return (
    <>
      <TextWidget
        label="Title"
        value={draft.title}
        onDraft={onDraft && ((title) => onDraft("title", title))}
        onChange={(title) => onChange({ ...draft, title })}
      />
      <TextWidget
        label="Address"
        description={`The item's own part of its link: ${(type.path ?? `/${type.slug}/[slug]`).replace("[slug]", "…")}  Empty makes it from the title.`}
        value={draft.slug}
        onChange={(slug) => onChange({ ...draft, slug })}
      />
      {type.fields.map((field) => (
        <ItemField
          key={field.name}
          type={type}
          field={field}
          value={draft.data[field.name]}
          onDraft={onDraft && ((value) => onDraft(field.name, value))}
          onChange={(value) => onChange({ ...draft, data: { ...draft.data, [field.name]: value } })}
        />
      ))}
    </>
  );
}

/** One field of an item with its widget: in the item form, the page settings, and beside an element showing it. */
export function ItemField({
  type,
  field,
  value,
  onDraft,
  onChange,
}: {
  type: ContentType;
  field: ContentField;
  value: unknown;
  /** Each keystroke in a text field, before it is saved on blur. */
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
