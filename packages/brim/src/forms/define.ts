import { FILE_TYPES } from "./file-types.ts";
import {
  CHOICE_TYPES,
  FIELD_TYPES,
  type FieldDisplay,
  type FieldType,
  type FieldWidth,
  type FormChoice,
  STEP,
} from "./fields.ts";

/**
 * A form declared once and placed wherever the site needs it: the contact form of the footer, of the contact page
 * and of a product's enquiry box are one form, instead of copies that drift apart.
 *
 *   // src/forms.ts
 *   export const contact = defineForm({
 *     key: "contact",
 *     name: "Contact",
 *     fields: [
 *       { name: "name", label: "Nume", type: "text", required: true },
 *       { name: "email", label: "E-mail", type: "email", required: true },
 *       { name: "message", label: "Mesaj", type: "textarea", required: true },
 *     ],
 *     buttonText: "Trimite",
 *     successMessage: "Mulțumim! Revenim în curând.",
 *   });
 *
 *   <Form form={contact} />
 *
 * A long form is asked in steps: an entry `{ type: "step", label: "Your home", help: "…" }` starts a step, with the
 * fields written after it. Form draws the steps' tabs, the Back and Continue buttons, and checks each step before the
 * next.
 *
 * Every place shows the same form and the owner edits it once (its fields, button, messages): it is the site's
 * shared content, under the node id `form-<key>`. Its responses are listed under its name. A mistake in the
 * declaration (an unknown field type, a name used twice) stops the site when it starts.
 */
export interface FormFieldInput {
  /** Letters, digits and `_`, starting with a letter: the key of the answer in each response. */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** Choices of a `select`, `radio` or `checkboxes` field: text, or `{ label, image, icon, description }` for a card. */
  options?: (string | FormChoice)[];
  /** `cards` shows a `radio` or `checkboxes` field's choices as boxes to click. */
  display?: FieldDisplay;
  /** `half` puts the field next to another half on a wide screen. */
  width?: FieldWidth;
  /** A line under the question. */
  help?: string;
  /** Asked only when another field has one of these answers: `{ field: "city", equals: "Other" }`. */
  showWhen?: { field: string; equals: string | string[] };
  /**
   * Of a `file` field: the kinds of file it takes, out of `pdf`, `jpg`, `png`, `webp` and `gif`. Without it: PDF,
   * JPEG, PNG and WebP. A file is recognised by its bytes, never by its name.
   */
  accept?: (keyof typeof FILE_TYPES)[];
  /** Of a `file` field: several files (five at most) instead of one. */
  multiple?: boolean;
}

/** Starts a step: the fields written after it, up to the next step, are asked together. */
export interface FormStepInput {
  type: typeof STEP;
  /** The step's title, on its tab. */
  label: string;
  /** A line under the title. */
  help?: string;
}

export interface FormInput {
  /** Lowercase letters, digits and dashes: names the form for good, so it never changes. */
  key: string;
  /** What the owner reads in the list of responses, and the form's heading unless `heading` is false. */
  name: string;
  /** `false` keeps `name` out of the page, for a form whose section already has a heading. */
  heading?: boolean;
  infoText?: string;
  fields: (FormFieldInput | FormStepInput)[];
  buttonText?: string;
  /** The buttons between steps, in the site's language. */
  nextText?: string;
  backText?: string;
  showConsent?: boolean;
  consentText?: string;
  consentLinkText?: string;
  consentLinkUrl?: string;
  consentRequired?: boolean;
  successMessage?: string;
  /**
   * Starts the form with its confirmation on: once a message is kept, the visitor is emailed `confirmationSubject`
   * and `confirmationMessage` at the address they wrote in the email field `confirmationField` (the form's first
   * email field without it). The owner can turn it off, or change the words, in the editor.
   */
  confirmationEmail?: boolean;
  confirmationField?: string;
  confirmationSubject?: string;
  confirmationMessage?: string;
  /** The confirmation also lists the visitor's answers (text, shortened). Off by default: see the README. */
  confirmationAnswers?: boolean;
}

export interface FormDefinition {
  key: string;
  /** The node the form's content is kept as, in the site's shared content. */
  nodeId: string;
  /** What the Form component starts from: the declaration, in the settings the owner edits. */
  settings: Record<string, unknown>;
}

const KEY = /^[a-z][a-z0-9-]{0,40}$/;
const NAME = /^[a-z][a-z0-9_]{0,40}$/i;

export function defineForm(input: FormInput): FormDefinition {
  const fail = (why: string): never => {
    throw new Error(`Form "${input.key}" ${why}`);
  };
  if (!KEY.test(input.key)) fail("needs a key of lowercase letters, digits and dashes, starting with a letter.");
  if (!input.name?.trim()) fail("needs a name: what the owner reads in the list of responses.");
  if (!Array.isArray(input.fields) || !input.fields.some((field) => field.type !== STEP)) {
    fail("needs at least one field.");
  }
  const names = new Set<string>();
  for (const field of input.fields) {
    if (field.type === STEP) {
      if (!field.label?.trim()) fail("has a step without a label: the title on its tab.");
      continue;
    }
    if (!NAME.test(field.name)) fail(`has a field named "${field.name}": use letters, digits and _ only.`);
    if (names.has(field.name)) fail(`has two fields named "${field.name}".`);
    names.add(field.name);
    if (!FIELD_TYPES.includes(field.type)) {
      fail(`has the field "${field.name}" of type "${field.type}": use one of ${FIELD_TYPES.join(", ")}.`);
    }
    if (CHOICE_TYPES.includes(field.type) && !field.options?.length) {
      fail(`has the ${field.type} field "${field.name}" without options.`);
    }
    const unknown = field.type === "file" ? field.accept?.find((type) => !Object.hasOwn(FILE_TYPES, type)) : undefined;
    if (unknown) {
      fail(`has the file field "${field.name}" taking "${unknown}": use ${Object.keys(FILE_TYPES).join(", ")}.`);
    }
  }
  if (input.confirmationEmail) {
    const emails = input.fields
      .filter((field) => field.type === "email")
      .map((field) => (field as FormFieldInput).name);
    if (emails.length === 0) fail("sends a confirmation but has no email field to send it to.");
    if (input.confirmationField && !emails.includes(input.confirmationField)) {
      fail(`sends its confirmation to "${input.confirmationField}", which is not one of its email fields.`);
    }
  }
  const { key, name, heading, ...rest } = input;
  return {
    key,
    nodeId: `form-${key}`,
    settings: {
      ...rest,
      // The heading is the form's name unless the site leaves it out; responses keep the name either way.
      formName: heading === false ? "" : name,
      responsesName: name,
    },
  };
}
