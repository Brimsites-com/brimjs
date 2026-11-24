/** Kinds of field a form can contain, carried over unchanged from BrimCMS. */
export const FORM_FIELD_TYPES = [
  "text",
  "email",
  "tel",
  "textarea",
  "checkbox",
  "radio",
  "checkboxes",
  "select",
  "number",
  "date",
  "date-range",
  "time",
  "range",
  "url",
  "file",
  "hidden",
  "address",
  "name",
  "divider",
  "currency",
  "survey",
  "display",
  // Not a question: starts a step of a form asked in steps.
  "step",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
