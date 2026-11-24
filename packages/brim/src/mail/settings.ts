import type { Role } from "../auth/accounts.ts";
import { ROLES, permissionsOf } from "../auth/permissions.ts";
import type { Database } from "../db/database.ts";
import { ValidationError } from "../content/validation-error.ts";
import { isIP } from "node:net";
import { isPrivate } from "../server/fetch-image.ts";

/** The owner's own SMTP server, set in the editor. Its password is never sent back to the editor. */
export interface SmtpServer {
  host: string;
  port: number;
  /** TLS from the start (port 465). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean;
  user: string;
  password: string; // betterleaks:allow
  /** The address mail is sent from. */
  from: string;
}

/**
 * The roles whose users can be emailed form messages: those who may read them in the editor. A writer cannot, so
 * emailing them the messages would hand them what their role keeps from them.
 */
export const NOTIFIABLE_ROLES: readonly Role[] = ROLES.filter((role) => permissionsOf(role).includes("responses"));

/** The site's email settings, kept in the database and changed in the editor's Site Settings. */
export interface MailSettings {
  /** The roles whose users all get an email for every form message (owners, editors). */
  notifyRoles: Role[];
  /** More addresses that get every form message. */
  notify: string[];
  /** The name shown as the sender. Empty uses the site's address. */
  senderName: string;
  /** The owner's own server. Without it, the server's email setup sends. */
  smtp: SmtpServer | null;
}

/**
 * What the editor sees: the same, with the password replaced by whether one is saved, and `notifyOwners` for the
 * clients written before roles could be chosen.
 */
export type MailSettingsView = Omit<MailSettings, "smtp"> & {
  notifyOwners: boolean;
  smtp: (Omit<SmtpServer, "password"> & { hasPassword: boolean }) | null; // betterleaks:allow
};

const KEY = "mail_settings";
const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export const DEFAULT_MAIL_SETTINGS: MailSettings = { notifyRoles: ["owner"], notify: [], senderName: "", smtp: null };

/** Roles as saved or sent: only those that may be emailed, each once. */
function notifiable(roles: unknown[]): Role[] {
  return NOTIFIABLE_ROLES.filter((role) => roles.includes(role));
}

/** Settings saved before roles could be chosen said only whether owners were emailed (`notifyOwners`). */
function fromSaved(saved: Partial<MailSettings> & { notifyOwners?: unknown }): MailSettings {
  const { notifyOwners, ...rest } = saved;
  const notifyRoles = Array.isArray(saved.notifyRoles)
    ? notifiable(saved.notifyRoles)
    : notifyOwners === false
      ? []
      : ["owner" as const];
  return { ...DEFAULT_MAIL_SETTINGS, ...rest, notifyRoles };
}

export function isEmail(value: string): boolean {
  return EMAIL.test(value) && value.length <= 254;
}

export class MailSettingsStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async get(): Promise<MailSettings> {
    const rows = await this.#db.query("SELECT value FROM brim_meta WHERE key = ?", [KEY]);
    if (!rows[0]) return { ...DEFAULT_MAIL_SETTINGS };
    try {
      return fromSaved(JSON.parse(String(rows[0].value)) as Partial<MailSettings>);
    } catch {
      return { ...DEFAULT_MAIL_SETTINGS };
    }
  }

  async view(): Promise<MailSettingsView> {
    return toView(await this.get());
  }

  /** Checks and saves what the editor sent. An empty password keeps the saved one. */
  async update(input: Record<string, unknown>): Promise<MailSettingsView> {
    const current = await this.get();
    const next = parseSettings(input, current);
    await this.#db.query(
      "INSERT INTO brim_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [KEY, JSON.stringify(next)],
    );
    return toView(next);
  }
}

function toView(settings: MailSettings): MailSettingsView {
  const { smtp, ...settled } = settings;
  const rest = { ...settled, notifyOwners: settings.notifyRoles.includes("owner") };
  if (!smtp) return { ...rest, smtp: null };
  const { password, ...server } = smtp; // betterleaks:allow
  return { ...rest, smtp: { ...server, hasPassword: password !== "" } }; // betterleaks:allow
}

function parseSettings(input: Record<string, unknown>, current: MailSettings): MailSettings {
  const text = (value: unknown, max = 200): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const notify = splitAddresses(input.notify);
  for (const address of notify) {
    if (!isEmail(address)) throw new ValidationError(`"${address}" is not an email address.`);
  }
  if (notify.length > MAX_RECIPIENTS) throw new ValidationError(`At most ${MAX_RECIPIENTS} addresses.`);

  let smtp: SmtpServer | null = null;
  const server = input.smtp;
  if (server && typeof server === "object") {
    const given = server as Record<string, unknown>;
    const host = text(given.host, 253);
    const from = text(given.from, 254);
    const port = Number(given.port || 587);
    if (!host) throw new ValidationError("Write the address of your email server, e.g. smtp.example.com.");
    if (!/^[a-z0-9.-]+$/i.test(host)) throw new ValidationError("The email server's address is not valid.");
    // The site's server connects to it: an owner may not point it at the host's own network. A name is checked
    // again when an email is sent, once it is resolved (see Mailer).
    const lower = host.toLowerCase();
    if (lower === "localhost" || lower.endsWith(".localhost") || !lower.includes(".") || (isIP(lower) && isPrivate(lower))) {
      throw new ValidationError("The email server must be a public address, e.g. smtp.example.com.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError("The port is a number, e.g. 587.");
    if (!isEmail(from)) throw new ValidationError("Write the address emails are sent from.");
    const typed = typeof given.password === "string" ? given.password : ""; // betterleaks:allow
    // The saved password was given for the saved server. It is never sent to another one: whoever changes where
    // mail goes types the password of that place.
    const sameServer = current.smtp?.host.toLowerCase() === host.toLowerCase() && current.smtp.port === port;
    if (typed === "" && current.smtp?.password && !sameServer) {
      throw new ValidationError("Type the password again: the saved one was for the email server you had before.");
    }
    smtp = {
      host,
      port,
      secure: given.secure === true || (given.secure === undefined && port === 465),
      user: text(given.user, 254),
      password: typed !== "" ? typed : (current.smtp?.password ?? ""), // betterleaks:allow
      from,
    };
  }

  return {
    // The roles as chosen; a client from before roles sends only whether owners are emailed, which keeps the rest.
    notifyRoles: Array.isArray(input.notifyRoles)
      ? notifiable(input.notifyRoles)
      : notifiable([
          ...current.notifyRoles.filter((role) => role !== "owner"),
          ...(input.notifyOwners !== false ? ["owner"] : []),
        ]),
    notify,
    senderName: text(input.senderName, 80).replace(/[\r\n<>"]/g, ""),
    smtp,
  };
}

/** Addresses as a list, or written with commas, semicolons or on separate lines. */
export function splitAddresses(value: unknown): string[] {
  const parts = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[\s,;]+/) : [];
  return [...new Set(parts.map((part) => part.trim().toLowerCase()).filter(Boolean))];
}
