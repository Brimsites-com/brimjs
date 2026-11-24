import { type FileType, fileTypes } from "./file-types.ts";

/** Kinds of field a form can show. BrimCMS had more; these are the ones that work without extra services. */
export const FIELD_TYPES = [
  "text",
  "name",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
  "select",
  "radio",
  "checkboxes",
  "checkbox",
  // Files the visitor attaches: see `forms/files.ts` for what is taken and where it is kept.
  "file",
] as const;

/** Kinds of field whose answer is picked among `options`: one (`select`, `radio`) or several (`checkboxes`). */
export const CHOICE_TYPES: readonly FieldType[] = ["select", "radio", "checkboxes"];

export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * An entry of a form's fields that is not a question: it starts a step of a form asked in steps. Its `label` is the
 * step's title and its `help` the line under it. Fields before the first step are the first step, untitled.
 */
export const STEP = "step";

/** How much of the form's row a field takes: all of it, or half, next to another half. */
export const FIELD_WIDTHS = ["full", "half"] as const;
export type FieldWidth = (typeof FIELD_WIDTHS)[number];

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  /** Choices of a `select`, `radio` or `checkboxes` field. */
  options?: string[];
  /**
   * The same choices with what a card shows besides the words: an `image` (a photo filling the card's top), an `icon`
   * (a picture's address, or a short text such as an emoji) and a `description`. As long as `options`, in order.
   */
  choices?: FormChoice[];
  /** How a `radio` or `checkboxes` field shows its choices: a plain list, or `cards` (boxes to click). */
  display?: FieldDisplay;
  /** `half` puts the field next to another half on a wide screen; on a phone every field takes the whole row. */
  width?: FieldWidth;
  /** A line under the question, telling what to write or why it is asked. */
  help?: string;
  /**
   * Asked only when another field of the form has one of these answers (`{ field: "city", equals: ["Other"] }`):
   * hidden, not checked and not sent otherwise. For a field of several choices, one of them ticked is enough.
   */
  showWhen?: FieldCondition;
  /** Of a `file` field: the kinds of file it takes (`pdf`, `jpg`, `png`, `webp`, `gif`). Always set on one. */
  accept?: FileType[];
  /** Of a `file` field: it takes several files (five at most) instead of one. */
  multiple?: boolean;
}

/** When a field is asked: another field's name and the answers that bring it. */
export interface FieldCondition {
  field: string;
  equals: string[];
}

/** Whether a field is asked, given the answers sent (a field of several choices answers with a list). */
export function fieldShown(field: Pick<FormField, "showWhen">, values: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const answer = values[field.showWhen.field];
  const given = (Array.isArray(answer) ? answer : [answer]).filter((item): item is string => typeof item === "string");
  return given.some((item) => field.showWhen?.equals.includes(item.trim()));
}

/** How a field with choices shows them. */
export const FIELD_DISPLAYS = ["list", "cards"] as const;
export type FieldDisplay = (typeof FIELD_DISPLAYS)[number];

/** One choice of a field, with what a card shows besides its words. */
export interface FormChoice {
  label: string;
  image?: string;
  icon?: string;
  description?: string;
}

/** A step of a form asked in steps: its title and line, and the fields it asks. */
export interface FormStep {
  title: string;
  intro?: string;
  fields: FormField[];
}

/** A field as a site's own form markup gets it: with the `id` its input takes. */
export type ShownField = FormField & { id: string };

/** What a Form's function child gets: the steps and the fields, and `Field`, the component that draws one. */
export interface FormValue<FieldComponent = unknown> {
  steps: (Omit<FormStep, "fields"> & { fields: ShownField[] })[];
  fields: ShownField[];
  Field: FieldComponent;
}

const NAME = /^[a-z][a-z0-9_]{0,40}$/i;

/** Keeps the fields this version can render and gives each a safe, unique name. */
export function formFields(input: unknown): FormField[] {
  const fields: FormField[] = [];
  const names = new Set<string>();

  for (const entry of Array.isArray(input) ? input : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const type = FIELD_TYPES.find((candidate) => candidate === raw.type);
    const name = typeof raw.name === "string" && NAME.test(raw.name) ? raw.name : undefined;
    if (!type || !name || names.has(name)) continue;
    names.add(name);

    const showWhen = condition(raw.showWhen, name);
    const choices = Array.isArray(raw.options)
      ? raw.options.map((option) => formChoice(option)).filter((choice) => choice !== undefined)
      : undefined;
    fields.push({
      name,
      type,
      label: typeof raw.label === "string" && raw.label ? raw.label : name,
      required: raw.required === true,
      ...(typeof raw.placeholder === "string" && raw.placeholder && { placeholder: raw.placeholder }),
      ...(choices?.length && { options: choices.map((choice) => choice.label), choices }),
      ...(raw.display === "cards" && (type === "radio" || type === "checkboxes") && { display: "cards" as const }),
      ...(raw.width === "half" && { width: "half" as const }),
      ...(typeof raw.help === "string" && raw.help.trim() && { help: raw.help.trim() }),
      ...(showWhen && { showWhen }),
      ...(type === "file" && { accept: fileTypes(raw.accept), ...(raw.multiple === true && { multiple: true }) }),
    });
  }
  return fields;
}

/**
 * The form's fields in their steps. A form without step entries is one untitled step; a step without fields is
 * left out, so a step the owner has just added does not show an empty page.
 */
export function formSteps(input: unknown): FormStep[] {
  const steps: FormStep[] = [];
  let current: FormStep = { title: "", fields: [] };
  const names = new Set<string>();
  for (const entry of Array.isArray(input) ? input : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (raw.type === STEP) {
      if (current.fields.length > 0) steps.push(current);
      const intro = typeof raw.help === "string" ? raw.help.trim() : "";
      current = { title: typeof raw.label === "string" ? raw.label.trim() : "", ...(intro && { intro }), fields: [] };
      continue;
    }
    // Each field once, as formFields keeps it, in the step it is written under.
    const [field] = formFields([raw]);
    if (!field || names.has(field.name)) continue;
    names.add(field.name);
    current.fields.push(field);
  }
  if (current.fields.length > 0) steps.push(current);
  return steps;
}

/** `{ field, equals }` with a field name other than the field's own, and one answer or several. */
function condition(input: unknown, own: string): FieldCondition | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const { field, equals } = input as Record<string, unknown>;
  if (typeof field !== "string" || !NAME.test(field) || field === own) return undefined;
  const answers = (Array.isArray(equals) ? equals : [equals])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return answers.length ? { field, equals: answers } : undefined;
}

/** A choice is text, or `{ label, image?, icon?, description? }` (BrimCMS stored `{ value, label }`). */
function formChoice(option: unknown): FormChoice | undefined {
  if (typeof option === "string") return option.trim() ? { label: option.trim() } : undefined;
  if (typeof option !== "object" || option === null) return undefined;
  const { label, value, image, icon, description } = option as Record<string, unknown>;
  const text = String(label ?? value ?? "").trim();
  if (!text) return undefined;
  return {
    label: text,
    ...(typeof image === "string" && image.trim() && { image: image.trim() }),
    ...(typeof icon === "string" && icon.trim() && { icon: icon.trim() }),
    ...(typeof description === "string" && description.trim() && { description: description.trim() }),
  };
}
