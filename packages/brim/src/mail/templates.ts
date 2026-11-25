import type { Role } from "../auth/accounts.ts";
import type { MailMessage } from "./mailer.ts";

const MARKUP = Symbol("brim-html");

/** Markup made with `html`: what it holds is HTML already, every value in it escaped. */
export interface Html {
  readonly [MARKUP]: string;
  toString(): string;
}

function markup(value: string): Html {
  return { [MARKUP]: value, toString: () => value };
}

function isHtml(value: unknown): value is Html {
  return typeof value === "object" && value !== null && MARKUP in value;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function piece(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (isHtml(value)) return value[MARKUP];
  if (Array.isArray(value)) return value.map(piece).join("");
  return escape(String(value));
}

/**
 * Writes an email's HTML: every value put in it is escaped (what a visitor typed can never become markup), and
 * markup made with `html` and lists of it go in as they are.
 *
 *   html`<p>${answer.label}: <strong>${answer.value}</strong></p>`
 *   html`<table>${email.answers.map((answer) => html`<tr><td>${answer.label}</td><td>${answer.value}</td></tr>`)}</table>`
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  return markup(
    strings.reduce((written, part, index) => written + part + (index < values.length ? piece(values[index]) : ""), ""),
  );
}

/** Markup of the site's own that is HTML already (a logo's `<svg>`, a shared footer), put in as it is. */
export function rawHtml(trusted: string): Html {
  return markup(trusted);
}

/** One message sent through a form, as an email template receives it. */
export interface FormEmail {
  /** The form's title, e.g. "Comandă produs". */
  form: string;
  /**
   * The site's host, e.g. `studionord.ro`, and its address. A site whose address is not set (`site` in the Astro
   * config, or `BRIM_SITE_URL`) has its name as `site`, and every address here is "".
   */
  site: string;
  siteUrl: string;
  /** The page it was sent from, when the form is on one (a product's order form says which product). */
  page?: string | undefined;
  /** Each field the visitor filled in, in the form's order. */
  answers: { label: string; value: string }[];
  /** The visitor's email, when the form asked for it: "Reply" goes there. */
  replyTo?: string | undefined;
  /**
   * The files the visitor attached: their names and where a signed-in owner or editor downloads each. Never the
   * files themselves.
   */
  files?: { label: string; name: string; size: number; url: string }[];
  /** Where the editor lists the messages. */
  responsesUrl: string;
  /** Where the editor opens this very message, its choices shown as the form asked them. */
  responseUrl: string;
  sentAt: Date;
}

/**
 * What happened to someone's access to the site, as an account email's template receives it:
 * - `added`: an owner added them (in a host's dashboard, or through `/admin/api/users`);
 * - `role`: their role changed, from `previousRole` to `role`;
 * - `reset`: an owner reset their access: their old password stopped working and they were signed out everywhere.
 */
export interface AccountEmail {
  kind: "added" | "role" | "reset";
  /** The site's host, e.g. `studionord.ro`, and its address. */
  site: string;
  siteUrl: string;
  /** Whose access it is: the email goes to them. */
  email: string;
  role: Role;
  /** What the role allows, in a few words ("change words and pictures"). */
  roleDescription: string;
  previousRole?: Role | undefined;
  /** Who did it, when known: the owner signed in, or whose token the host used. */
  by?: string | undefined;
  /** The editor's address: its sign-in form, with the host's own sign-in when there is one. */
  editorUrl: string;
  /**
   * A link to choose their own password, for `added` and `reset`. It works once, within `passwordLinkHours`. The
   * token is in its fragment, so link checkers that open every link in an email cannot use it up.
   */
  passwordUrl?: string | undefined;
  passwordLinkHours?: number | undefined;
  /** The host's own sign-in, when the site offers it beside the password (e.g. "Continue with Brimsites"). */
  hostSignIn?: { name: string; url: string } | undefined;
  sentAt: Date;
}

/** What the `confirmation` template receives: the email a visitor gets once their message was kept. */
export interface ConfirmationEmail {
  /** The form's title. */
  form: string;
  /** The site's host and its address; its name and "" when its address is not set, as in `FormEmail`. */
  site: string;
  siteUrl: string;
  /** The page the form was sent from, when it is on one. */
  page?: string | undefined;
  /** The subject and the message the owner wrote for this form, in the editor. */
  subject: string;
  message: string;
  /**
   * What the visitor answered, only when the owner turned "Include the answers" on: text, shortened. Empty
   * otherwise, so a template cannot repeat a stranger's words to someone else's address by accident.
   */
  answers: { label: string; value: string }[];
  sentAt: Date;
}

/** What a template gives; anything it leaves out is Brim's own (the text version is made from the answers). */
export interface EmailContent {
  subject?: string;
  html?: Html;
  text?: string;
  /** The sender's name; the address is whoever sends. */
  fromName?: string;
}

/**
 * The emails a site writes itself, in `src/emails.ts`: `export const emails = defineEmails({ form: (email) => … })`.
 * Without one, or when one fails, Brim sends its own, so no message is lost.
 */
export interface SiteEmails {
  /** The email the owner gets for a message sent through a form. */
  form?: (email: FormEmail) => EmailContent | Promise<EmailContent>;
  /** The email someone gets when an owner adds them to the site, with how to sign in. */
  userAdded?: AccountTemplate;
  /** The email someone gets when their role changes. */
  roleChanged?: AccountTemplate;
  /** The email someone gets when an owner resets their access, with a link to choose a new password. */
  accessReset?: AccountTemplate;
  /** The email a visitor gets once their message was kept, when the owner turned the form's confirmation on. */
  confirmation?: (email: ConfirmationEmail) => EmailContent | Promise<EmailContent>;
}

export type AccountTemplate = (email: AccountEmail) => EmailContent | Promise<EmailContent>;

export function defineEmails(emails: SiteEmails): SiteEmails {
  return emails;
}

/**
 * `message` (Brim's own) as the site's template writes it. A template that throws, or gives nothing usable, leaves
 * Brim's own: the message is sent either way, and the reason is logged.
 */
export async function writtenBySite<Email>(
  message: MailMessage,
  template: ((email: Email) => EmailContent | Promise<EmailContent>) | undefined,
  email: Email,
): Promise<MailMessage> {
  if (!template) return message;
  try {
    const written = await template(email);
    const subject = typeof written?.subject === "string" ? written.subject.replace(/[\r\n]+/g, " ").trim() : "";
    const body =
      written?.html === undefined ? "" : isHtml(written.html) ? written.html[MARKUP] : escape(String(written.html));
    const fromName = typeof written?.fromName === "string" ? written.fromName.replace(/[\r\n]+/g, " ").trim() : "";
    return {
      ...message,
      ...(subject && { subject }),
      ...(body && { html: body }),
      ...(typeof written?.text === "string" && written.text.trim() && { text: written.text }),
      ...(fromName && { fromName }),
    };
  } catch (error) {
    console.error(
      "[brim] The site's email template failed; Brim's own was sent:",
      error instanceof Error ? error.message : error,
    );
    return message;
  }
}
