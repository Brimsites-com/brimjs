import { createTransport } from "nodemailer";
import type { MailOptions } from "../config.ts";
import { HttpError, isLocalHost } from "../server/http.ts";
import { assertPublicHost } from "../server/fetch-image.ts";
import { type MailSettings, type SmtpServer, isEmail } from "./settings.ts";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** Where "Reply" goes: the visitor who wrote, when the form asked for their email. */
  replyTo?: string | undefined;
  /** The sender's name. The address comes from whoever sends. */
  fromName: string;
}

/**
 * Who sends the site's email, as the editor may know it. The server's own setup is never described further:
 * its addresses and passwords stay on the server.
 * - `site`: the owner's own SMTP server, from Site Settings;
 * - `server`: an SMTP server set where the site runs (`BRIM_SMTP_URL`);
 * - `service`: a mail service set where the site runs (`BRIM_MAIL_URL`), e.g. the site's host;
 * - `none`: nothing; form messages are only kept in the editor.
 */
export type MailDelivery = "site" | "server" | "service" | "none";

type Send = (message: MailMessage) => Promise<void>;

/**
 * A value on its way into an email's headers (the subject, the sender's name): one line, with no control character.
 * A line end there would start a header of the writer's choosing (`Bcc:`), so none ever gets that far.
 */
export function headerText(value: string, max = 200): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * The message as it may leave, whoever wrote it: every address is one plain address (no name, no list, no line
 * end), and the subject and sender's name are one clean line. Every email of the site passes here, so no caller
 * can forget.
 */
export function safeMessage(message: MailMessage): MailMessage {
  const to = message.to.filter((address) => isEmail(address));
  if (to.length === 0) throw new HttpError(400, "The email has no valid recipient.");
  const replyTo = message.replyTo && isEmail(message.replyTo) ? message.replyTo : undefined;
  // Quotes and angle brackets are what a display name could close itself with.
  const fromName = headerText(message.fromName, 80).replace(/["<>]/g, "");
  return { ...message, to, replyTo, subject: headerText(message.subject), fromName };
}

/** Sends one message the way the settings and the server's setup say. */
export class Mailer {
  readonly #options: MailOptions;
  readonly #fetch: typeof fetch;
  /** Tests replace SMTP with this. */
  readonly #smtp: (server: SmtpServer, from: string, message: MailMessage) => Promise<void>;
  /** Refuses an owner's email server that resolves inside the host's network; tests that replace SMTP skip it. */
  readonly #checkHost: (host: string) => Promise<void>;

  constructor(
    options: MailOptions = {},
    deps: { fetch?: typeof fetch; smtp?: (server: SmtpServer, from: string, message: MailMessage) => Promise<void> } = {},
  ) {
    this.#options = options;
    this.#fetch = deps.fetch ?? fetch;
    this.#smtp = deps.smtp ?? sendSmtp;
    this.#checkHost = deps.smtp ? async () => {} : (host) => assertPublicHost(host);
  }

  delivery(settings: MailSettings): MailDelivery {
    if (settings.smtp) return "site";
    if (this.#options.smtp && parseSmtpUrl(this.#options.smtp) && this.#options.from) return "server";
    if (serviceUrl(this.#options.url)) return "service";
    return "none";
  }

  async send(settings: MailSettings, written: MailMessage): Promise<void> {
    // Cleaned here, before any of the ways of sending sees it.
    const message = safeMessage(written);
    const via = this.delivery(settings);
    const send: Send | undefined = {
      site: async () => {
        if (!settings.smtp) return;
        const server = settings.smtp;
        await this.#checkHost(server.host).catch(() => {
          throw new HttpError(502, "The email server must be a public address, e.g. smtp.example.com.");
        });
        await this.#smtp(server, server.from, message);
      },
      // The server's own setup is not the owner's to see, so its errors are not passed on.
      server: () =>
        this.#smtp(parseSmtpUrl(this.#options.smtp ?? "") as SmtpServer, this.#options.from ?? "", message).catch(
          (error: unknown) => {
            console.error("[brim] Sending email failed:", error instanceof Error ? error.message : error);
            throw new HttpError(502, "The site's email server did not send the email.");
          },
        ),
      service: () => this.#service(message),
      none: undefined,
    }[via] as Send | undefined;
    if (!send) throw new HttpError(501, "Email is not set up for this site. Add your email server in Site Settings.");
    await send(message);
  }

  async #service(message: MailMessage): Promise<void> {
    const url = serviceUrl(this.#options.url) as string;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(this.#options.token && { authorization: `Bearer ${this.#options.token}` }),
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HttpError(502, "The mail service could not be reached.");
    }
    if (!response.ok) {
      const answer = (await response.json().catch(() => ({}))) as { error?: unknown };
      throw new HttpError(
        502,
        typeof answer.error === "string" ? answer.error : `The mail service refused the email (${response.status}).`,
      );
    }
  }
}

/** HTTPS, or plain HTTP on this machine for development. */
function serviceUrl(value: string | undefined): string | undefined {
  const url = value?.trim();
  if (!url || !URL.canParse(url)) return undefined;
  const { protocol, hostname } = new URL(url);
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return protocol === "https:" || (protocol === "http:" && local) ? url : undefined;
}

/** `smtps://user:password@host:465` or `smtp://user:password@host:587`; user and password may be absent. */ // betterleaks:allow
export function parseSmtpUrl(value: string): Omit<SmtpServer, "from"> | undefined {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return undefined;
  const secure = url.protocol === "smtps:";
  return {
    host: url.hostname,
    port: Number(url.port) || (secure ? 465 : 587),
    secure,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), // betterleaks:allow
  };
}

/**
 * How a mail server is reached. With a password the connection is encrypted before it is sent, from the start or with
 * STARTTLS, or nothing is sent: a server that offers no STARTTLS, or someone on the way who hides that it does, would
 * otherwise be given the password as it is. A server on this computer may do without.
 */
export function smtpOptions(server: Omit<SmtpServer, "from">) {
  return {
    host: server.host,
    port: server.port,
    secure: server.secure,
    ...(server.user && { auth: { user: server.user, pass: server.password } }), // betterleaks:allow
    requireTLS: !server.secure && server.user !== "" && !isLocalHost(server.host),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

async function sendSmtp(server: SmtpServer, from: string, message: MailMessage): Promise<void> {
  const transport = createTransport(smtpOptions(server));
  const address = from.match(/<([^<>]+)>\s*$/)?.[1] ?? from;
  try {
    await transport.sendMail({
      from: { name: message.fromName, address: address.trim() },
      to: message.to,
      ...(message.replyTo && { replyTo: message.replyTo }),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, `The email server refused the email: ${reason.slice(0, 200)}`);
  } finally {
    transport.close();
  }
}
