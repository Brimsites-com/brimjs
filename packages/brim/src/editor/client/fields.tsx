import { type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readFocus } from "../../content/image-focus.ts";
import { cleanTag, hasTag, sameTag } from "../../content/tags.ts";
import type { ImageFocus } from "../../content/types.ts";
import { CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons.tsx";
import { type FormValue, type Schema, emptyValue } from "./kinds.ts";
import { LinkWidget } from "./LinkWidget.tsx";
import { ImageUploadWidget } from "./widgets.tsx";
import { isComposing } from "./keys.ts";

interface FieldProps<Value = unknown> {
  schema: Schema;
  value: Value;
  onChange: (value: unknown) => void;
}

/** Renders the widget for one value. Groups and lists nest. */
export function SettingField({ schema, value, onChange }: FieldProps): ReactNode {
  switch (schema.type) {
    case "text":
      return (
        <TextWidget
          label={schema.label}
          value={asString(value)}
          multiline={schema.multiline ?? false}
          onChange={onChange}
        />
      );
    case "url":
      return <LinkWidget label={schema.label} value={asString(value)} onChange={onChange} />;
    case "image":
      return <ImageWidget label={schema.label} value={asRecord(value)} onChange={onChange} />;
    case "select":
      return <SelectWidget label={schema.label} options={schema.options} value={asString(value)} onChange={onChange} />;
    case "group":
      return <GroupWidget schema={schema} value={asRecord(value)} onChange={onChange} />;
    case "list":
      return <ListWidget schema={schema} value={Array.isArray(value) ? value : []} onChange={onChange} />;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): FormValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as FormValue) : {};
}

/** A text input that reports its value when the person leaves it or presses Enter, not on every key. */
export function TextWidget({
  label,
  value,
  placeholder,
  description,
  multiline = false,
  type = "text",
  limit,
  onDraft,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string | undefined;
  description?: string | undefined;
  multiline?: boolean;
  type?: "text" | "email" | "password" | "number";
  /** Shows how many characters are written against this recommended length; going over is allowed. */
  limit?: number | undefined;
  /** Each keystroke, before the value is saved on blur: for a live preview. */
  onDraft?: ((draft: string) => void) | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const edit = (next: string): void => {
    setDraft(next);
    onDraft?.(next);
  };

  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {description && <p className="field-description">{description}</p>}
      {multiline ? (
        <textarea
          id={id}
          className="field-input"
          rows={4}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => edit(event.target.value)}
          onBlur={() => draft !== value && onChange(draft)}
        />
      ) : (
        <input
          id={id}
          className="field-input"
          type={type}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => edit(event.target.value)}
          onBlur={() => draft !== value && onChange(draft)}
          onKeyDown={(event) => event.key === "Enter" && !isComposing(event) && event.currentTarget.blur()}
        />
      )}
      {limit !== undefined && (
        <p className="field-counter" data-over={draft.length > limit ? "" : undefined} aria-live="polite">
          {draft.length} / {limit}
        </p>
      )}
    </div>
  );
}

/** A day as `YYYY-MM-DD`, read and written in local time so the chosen day never shifts by a timezone. */
function parseDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day.getTime()) ? undefined : day;
}

function formatDay(day: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function sameDay(a: Date | undefined, b: Date): boolean {
  return a !== undefined && formatDay(a) === formatDay(b);
}

function addDays(day: Date, offset: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
}

/** The 6 weeks shown for a month, starting on Monday. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
);

/** A day picked from a calendar. Stores `YYYY-MM-DD`; empty when cleared. */
export function DateWidget({
  label,
  value,
  description,
  onChange,
}: {
  label: string;
  value: string;
  description?: string | undefined;
  onChange: (value: string) => void;
}) {
  const selected = parseDay(value);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<Date>(() => selected ?? new Date());
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const today = new Date();

  const show = (): void => {
    setFocused(selected ?? new Date());
    setOpen(true);
  };

  const pick = (day: Date | undefined): void => {
    setOpen(false);
    trigger.current?.focus();
    const next = day ? formatDay(day) : "";
    if (next !== value) onChange(next);
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !popover.current) return;
    const bounds = trigger.current.getBoundingClientRect();
    const height = popover.current.offsetHeight;
    const below = bounds.bottom + 4 + height <= window.innerHeight;
    setPosition({ top: below ? bounds.bottom + 4 : Math.max(4, bounds.top - 4 - height), left: bounds.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !popover.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // Keeps keyboard focus on the focused day as it moves.
  useEffect(() => {
    if (!open) return;
    popover.current?.querySelector<HTMLButtonElement>(`[data-day="${formatDay(focused)}"]`)?.focus();
  }, [open, focused]);

  const moveMonth = (offset: number): void =>
    setFocused(new Date(focused.getFullYear(), focused.getMonth() + offset, 1));

  const onKey = (event: KeyboardEvent): void => {
    if (isComposing(event)) return;
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      setFocused(addDays(focused, moves[event.key]!));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const offset = event.key === "PageUp" ? -1 : 1;
      setFocused(new Date(focused.getFullYear(), focused.getMonth() + offset, focused.getDate()));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <button
        ref={trigger}
        type="button"
        className="field-select field-date"
        data-open={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${selected ? selected.toLocaleDateString() : "no date"}`}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span className="field-select-label" data-empty={selected ? undefined : ""}>
          {selected
            ? selected.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
            : "Pick a date"}
        </span>
        <span className="field-select-chevron">
          <CalendarIcon />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popover}
            className="field-calendar"
            role="dialog"
            aria-label={label}
            style={position}
            onKeyDown={onKey}
          >
            <div className="field-calendar-header">
              <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>
                <ChevronLeftIcon />
              </button>
              <span aria-live="polite">
                {focused.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </span>
              <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>
                <ChevronRightIcon />
              </button>
            </div>
            <div className="field-calendar-grid" role="grid">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday} className="field-calendar-weekday" role="columnheader">
                  {weekday}
                </span>
              ))}
              {monthGrid(focused).map((day) => {
                const key = formatDay(day);
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    data-day={key}
                    tabIndex={sameDay(focused, day) ? 0 : -1}
                    className="field-calendar-day"
                    data-outside={day.getMonth() !== focused.getMonth() ? "" : undefined}
                    data-today={sameDay(today, day) ? "" : undefined}
                    aria-selected={sameDay(selected, day)}
                    aria-label={day.toLocaleDateString(undefined, { dateStyle: "full" })}
                    onClick={() => pick(day)}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="field-calendar-footer">
              <button type="button" onClick={() => pick(undefined)} disabled={!selected}>
                Clear
              </button>
              <button type="button" onClick={() => pick(new Date())}>
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * An image with its description and focus, as content items and the site's logo keep it: `{ src, alt, focus? }`.
 * A new picture starts with its focus in the middle.
 */
export function ImageWidget({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FormValue;
  onChange: (value: unknown) => void;
}) {
  const src = asString(value.src);
  const alt = asString(value.alt);
  const focus = readFocus(value.focus);
  const image = (next: { src?: string; alt?: string; focus?: ImageFocus | undefined }): void => {
    const kept = readFocus("focus" in next ? next.focus : focus);
    onChange({ src: next.src ?? src, alt: next.alt ?? alt, ...(kept && { focus: kept }) });
  };

  return (
    <fieldset className="brim-setting-group">
      <legend>{label}</legend>
      <ImageUploadWidget
        label="Image"
        value={src}
        focus={focus}
        onChange={(next) => image({ src: next, focus: undefined })}
        onFocus={(next) => image({ focus: next })}
      />
      <TextWidget
        label="Alt Text (SEO)"
        value={alt}
        placeholder="Describe the image"
        onChange={(next) => image({ alt: next })}
      />
    </fieldset>
  );
}

function GroupWidget({
  schema,
  value,
  onChange,
}: FieldProps<FormValue> & { schema: Extract<Schema, { type: "group" }> }) {
  const fields = Object.entries(schema.fields).map(([name, field]) => (
    <SettingField
      key={name}
      schema={field}
      value={value[name]}
      onChange={(next) => onChange({ ...value, [name]: next })}
    />
  ));
  if (!schema.label) return fields;
  return (
    <fieldset className="brim-setting-group">
      <legend>{schema.label}</legend>
      {fields}
    </fieldset>
  );
}

function ListWidget({
  schema,
  value,
  onChange,
}: FieldProps<unknown[]> & { schema: Extract<Schema, { type: "list" }> }) {
  function move(index: number, offset: number): void {
    const next = [...value];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  }

  return (
    <fieldset className="brim-setting-group">
      <legend>
        {schema.label} · {value.length}
      </legend>
      {value.map((item, index) => (
        <div className="brim-array-item" key={index}>
          <div className="brim-actions">
            <span>Item {index + 1}</span>
            <button
              type="button"
              disabled={index === 0}
              aria-label={`Move item ${index + 1} up`}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === value.length - 1}
              aria-label={`Move item ${index + 1} down`}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove item ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <SettingField
            schema={schema.item}
            value={item}
            onChange={(next) => onChange(value.map((current, i) => (i === index ? next : current)))}
          />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, emptyValue(schema.item)])}>
        {schema.addLabel}
      </button>
    </fieldset>
  );
}

export function CheckboxWidget({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field-group">
      <label className="field-label-checkbox" htmlFor={id}>
        <input
          id={id}
          className="field-checkbox"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="checkbox-label-text">{label}</span>
      </label>
      {description && <p className="field-description">{description}</p>}
    </div>
  );
}

/** Custom dropdown, so the options follow the editor's theme. Rendered on <body> to escape clipping. */
export function SelectWidget({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const bounds = trigger.current.getBoundingClientRect();
    // Under the field, unless the window ends before the list does and there is more room above it.
    const height = dropdown.current?.offsetHeight ?? 0;
    const below = window.innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const top = height > below && above > below ? Math.max(8, bounds.top - 4 - height) : bounds.bottom + 4;
    setPosition({ top, left: bounds.left, width: bounds.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !dropdown.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {description && <p className="field-description">{description}</p>}
      <button
        ref={trigger}
        type="button"
        className="field-select"
        data-open={open}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => event.key === "Escape" && !isComposing(event) && setOpen(false)}
      >
        <span className="field-select-label" data-empty={selected || value ? undefined : ""}>
          {selected?.label ?? (value || "Choose…")}
        </span>
        <span className="field-select-chevron">
          <ChevronDownIcon />
        </span>
      </button>
      {open &&
        createPortal(
          <div ref={dropdown} className="field-select-dropdown" role="listbox" style={position}>
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`field-select-option${option.value === value ? " field-select-option--selected" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (option.value !== value) onChange(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * A list of tags, each a chip with a × to remove it. Typing and Enter (or a comma) adds one; Backspace in the empty
 * box removes the last. `suggestions` are offered while typing: the tags already used, so the same word is spelled
 * the same way, or with `fixed`, the only tags the field takes.
 */
export function TagsWidget({
  label,
  description,
  value,
  suggestions = [],
  fixed = false,
  onChange,
}: {
  label: string;
  description?: string | undefined;
  value: string[];
  suggestions?: string[] | undefined;
  /** Only `suggestions` can be chosen. */
  fixed?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const offered = suggestions.filter((tag) => !hasTag(value, tag));

  function add(text: string): void {
    const next = [...value];
    for (const typed of text.split(",")) {
      const tag = cleanTag(typed);
      // A tag already used keeps its spelling: "Garden" typed as "garden" is still the same tag.
      const chosen = suggestions.find((known) => sameTag(known, tag)) ?? (fixed ? undefined : tag);
      if (chosen && !hasTag(next, chosen)) next.push(chosen);
    }
    setDraft("");
    if (next.length !== value.length) onChange(next);
  }

  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {description && <p className="field-description">{description}</p>}
      <div className="field-tags" onClick={() => input.current?.focus()}>
        {value.map((tag) => (
          <span key={tag} className="field-tag">
            {tag}
            <button
              type="button"
              className="field-tag__remove"
              aria-label={`Remove ${tag}`}
              title="Remove"
              onClick={() => onChange(value.filter((existing) => existing !== tag))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          className="field-tags__input"
          list={offered.length > 0 ? `${id}-tags` : undefined}
          value={draft}
          placeholder={value.length === 0 ? (fixed ? "Choose a tag" : "Add a tag") : ""}
          onChange={(event) => {
            const text = event.target.value;
            // A suggestion picked from the list comes as one replacement, not as letters typed.
            const native = event.nativeEvent as Partial<InputEvent>;
            const picked = native.inputType === undefined || native.inputType === "insertReplacementText";
            if (text.includes(",") || (picked && offered.includes(text))) add(text);
            else setDraft(text);
          }}
          onKeyDown={(event) => {
            // Enter or Escape that picks or cancels a word being composed belongs to the input method.
            if (isComposing(event)) return;
            if (event.key === "Enter") {
              // Inside a form, Enter adds the tag instead of saving the form.
              event.preventDefault();
              if (draft.trim()) add(draft);
            } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
        {offered.length > 0 && (
          <datalist id={`${id}-tags`}>
            {offered.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        )}
      </div>
    </div>
  );
}

/** A term of a vocabulary as a reference widget offers it: the slug it saves and the title it shows. */
export interface ReferenceTerm {
  value: string;
  label: string;
}

/**
 * The editor's one widget for references to a vocabulary's terms, wherever an item's fields are edited (the item
 * form, Page Settings, a new item). Typing filters the terms by title, whatever the case and accents; when no term
 * has that title, "Add … to <vocabulary>" creates it and picks it. One term, or several shown as chips.
 */
export function ReferenceWidget({
  label,
  description,
  vocabulary,
  terms,
  value,
  multiple = false,
  required = false,
  onChange,
  onAdd,
}: {
  label: string;
  description?: string | undefined;
  /** The vocabulary's name, as the "Add" option says it: "Categories". */
  vocabulary: string;
  terms: ReferenceTerm[];
  value: string[];
  multiple?: boolean;
  required?: boolean;
  onChange: (slugs: string[]) => void;
  /** Creates a term with this title; answers it, or nothing when it could not be made. */
  onAdd?: (title: string) => Promise<ReferenceTerm | undefined>;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().trim();
  const chosen = value.map((slug) => terms.find((term) => term.value === slug) ?? { value: slug, label: slug });
  const typed = fold(draft);
  const offered = terms
    .filter((term) => !value.includes(term.value) || !multiple)
    .filter((term) => typed === "" || fold(term.label).includes(typed));
  const exact = terms.some((term) => fold(term.label) === typed);
  const canAdd = onAdd !== undefined && typed !== "" && !exact;

  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const bounds = box.current.getBoundingClientRect();
    setPosition({ top: bounds.bottom + 4, left: bounds.left, width: bounds.width });
  }, [open, draft, value.length]);

  function pick(term: ReferenceTerm): void {
    setDraft("");
    setOpen(multiple);
    if (multiple) {
      if (!value.includes(term.value)) onChange([...value, term.value]);
      input.current?.focus();
    } else if (value[0] !== term.value) {
      onChange([term.value]);
    }
  }

  async function add(): Promise<void> {
    if (!onAdd || adding) return;
    setAdding(true);
    try {
      const term = await onAdd(draft.trim());
      if (term) pick(term);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {description && <p className="field-description">{description}</p>}
      <div ref={box} className="field-tags" onClick={() => input.current?.focus()}>
        {multiple &&
          chosen.map((term) => (
            <span key={term.value} className="field-tag">
              {term.label}
              <button
                type="button"
                className="field-tag__remove"
                aria-label={`Remove ${term.label}`}
                title="Remove"
                onClick={() => onChange(value.filter((slug) => slug !== term.value))}
              >
                ×
              </button>
            </span>
          ))}
        <input
          ref={input}
          id={id}
          className="field-tags__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-terms`}
          autoComplete="off"
          value={draft}
          placeholder={multiple ? (value.length === 0 ? `Choose or add` : "") : (chosen[0]?.label ?? `Choose or add`)}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            // Enter or Escape that picks or cancels a word being composed belongs to the input method.
            if (isComposing(event)) return;
            if (event.key === "Enter") {
              // Inside a form, Enter picks the first term (or adds the typed one) instead of saving the form.
              event.preventDefault();
              const first = offered[0];
              if (first && (typed === "" || fold(first.label) === typed || !canAdd)) pick(first);
              else if (canAdd) void add();
            } else if (event.key === "Escape") {
              setOpen(false);
            } else if (event.key === "Backspace" && draft === "" && multiple && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {!multiple && !required && value.length > 0 && (
          <button
            type="button"
            className="field-tag__remove"
            aria-label={`Clear ${label}`}
            title="Clear"
            onClick={() => onChange([])}
          >
            ×
          </button>
        )}
      </div>
      {open &&
        (offered.length > 0 || canAdd) &&
        createPortal(
          <div id={`${id}-terms`} className="field-select-dropdown" role="listbox" style={position}>
            {offered.map((term) => (
              <button
                key={term.value}
                type="button"
                role="option"
                aria-selected={value.includes(term.value)}
                className={`field-select-option${value.includes(term.value) ? " field-select-option--selected" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(term)}
              >
                {term.label}
              </button>
            ))}
            {canAdd && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="field-select-option field-select-option--add"
                disabled={adding}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void add()}
              >
                {adding ? "Adding…" : `Add “${draft.trim()}” to ${vocabulary}`}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
