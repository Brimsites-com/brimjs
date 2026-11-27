import { useEffect, useRef, useState } from "react";
import { itemPathFields, itemPathSegments, slugify } from "../../content/item-path.ts";
import { type ContentType, type Item, type ItemDraft, api } from "./api.ts";
import { ItemField, missingFields } from "./ItemForm.tsx";
import { isComposing } from "./keys.ts";
import { MediaFolderContext } from "./widgets.tsx";

/**
 * A new item of a type with a page, asked for in a few words: its title, and the fields it cannot be saved without.
 * It is made private and opens on its page, where the rest is filled in and it is published, where it is seen.
 */
export function QuickCreate({
  type,
  initialData,
  onCreated,
  onCancel,
}: {
  type: ContentType;
  /** What the item starts with, e.g. the value the listing it was added from filters on. */
  initialData?: Record<string, unknown> | undefined;
  onCreated: (item: Item) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [data, setData] = useState<Record<string, unknown>>(() => ({ ...initialData }));
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Only what the server would refuse the item without is asked here, and not what a listing already gave.
  const required = type.fields.filter(
    (field) => field.required && field.type !== "blocks" && initialData?.[field.name] === undefined,
  );
  // The fields its address is made of come first, in the address's order: the category, then the name in it.
  const pathNames = itemPathFields(type);
  const before = pathNames.flatMap((name) => required.filter((field) => field.name === name));
  const after = required.filter((field) => !pathNames.includes(field.name));
  // With nothing to choose first, the title is typed straight away.
  useEffect(() => {
    if (before.length === 0) input.current?.focus();
  }, []);
  const singular = type.singular.toLowerCase();
  const link = `/${itemPathSegments(type)
    .map((segment) => {
      if ("fixed" in segment) return segment.fixed;
      if (segment.field === "slug") return slugify(title) || "…";
      const value = data[segment.field];
      return (typeof value === "string" || typeof value === "number") && slugify(String(value))
        ? slugify(String(value))
        : "…";
    })
    .join("/")}`;
  const field = (field: (typeof required)[number]) => (
    <ItemField
      key={field.name}
      type={type}
      field={field}
      value={data[field.name]}
      missing={missing[field.name]}
      onChange={(value) => setData((current) => ({ ...current, [field.name]: value }))}
    />
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isComposing(event)) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function create(): Promise<void> {
    (document.activeElement as HTMLElement | null)?.blur?.();
    // A field being typed in hands its words over when it loses focus, just before.
    await new Promise((resolve) => setTimeout(resolve));
    const draft: ItemDraft = { title, slug: "", visibility: "private", data };
    const empty = missingFields(type, draft);
    setMissing(empty);
    if (Object.keys(empty).length > 0) {
      if (empty.title) input.current?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const { item } = await api.createItem(type.key, draft);
      onCreated(item);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create it.");
      setBusy(false);
    }
  }

  return (
    <div className="cb-modal-overlay" onClick={onCancel}>
      <MediaFolderContext.Provider value={{ label: singular }}>
        <form
          className="cb-modal cb-quick-create"
          role="dialog"
          aria-label={`New ${singular}`}
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <header className="cb-quick-create__header">
            <h3>New {singular}</h3>
            <button type="button" className="cb-quick-create__close" aria-label="Cancel" onClick={onCancel}>
              ×
            </button>
          </header>
          {before.map(field)}
          <div className="field-group">
            <label className="field-label" htmlFor="brim-quick-title">
              Title *
            </label>
            <input
              id="brim-quick-title"
              ref={input}
              className="field-input cb-quick-create__title"
              value={title}
              placeholder={type.article ? "What is it about?" : `Name of the ${singular}`}
              onChange={(event) => setTitle(event.target.value)}
            />
            {missing.title && <p className="field-error">{missing.title}</p>}
            <p className="field-description">
              <code>{link}</code>
            </p>
          </div>
          {after.map(field)}
          <p className="cb-quick-create__note">
            It starts private and opens on its page, where you write the rest and publish it.
          </p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="cb-modal-actions">
            <button type="submit" className="cb-new-btn" disabled={busy}>
              {busy ? "Creating…" : "Create and open"}
            </button>
          </div>
        </form>
      </MediaFolderContext.Provider>
    </div>
  );
}
