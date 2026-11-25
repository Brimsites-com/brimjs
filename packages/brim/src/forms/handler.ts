import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ValidationError } from "../content/validation-error.ts";
import type { Brim } from "../runtime/connect.ts";
import { HttpError, assertSameOrigin, json, readBytes, readJson, trustedOrigin } from "../server/http.ts";
import { formPage } from "./form-page.ts";
import { type ConfirmationEmail, type FormEmail, type SiteEmails, writtenBySite } from "../mail/templates.ts";
import { RateLimiter } from "../server/rate-limit.ts";
import type { Mailer } from "../mail/mailer.ts";
import {
  CONFIRMATION_MESSAGE_LENGTH,
  CONFIRMATION_SUBJECT_LENGTH,
  confirmationAnswers,
  confirmationNotice,
  formNotice,
  formRecipients,
} from "../mail/notify.ts";
import { MailSettingsStore, isEmail, splitAddresses } from "../mail/settings.ts";
import {
  FILE_TYPES,
  type FileType,
  type FormFile,
  FormFiles,
  MAX_FIELDS_BYTES,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_MESSAGE_BYTES,
  type PrivateFiles,
  fileSize,
  fileTypes,
  safeFileName,
  sniffFileType,
} from "./files.ts";
import type { FormAnswer } from "./store.ts";
import { CHOICE_TYPES, type FormChoice, type FormField, fieldShown } from "./fields.ts";
import { type CaptchaCheck, verifyCaptcha } from "./captcha.ts";
import { WORK_WINDOW_SECONDS, workBits, workDone } from "./work.ts";
import { type FormSpec, decodeSpec, isSigned, openAddress, sign } from "./spec.ts";

export const FORMS_PATH = "/_brim/forms";

/** A visitor needs at least this long to fill a form in; anything faster is a script. */
const MIN_FILL_MS = 2_000;
const TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000; // betterleaks:allow
const PER_VISITOR = { limit: 5, windowSeconds: 10 * 60 };
/**
 * Emails sent about messages, on the whole site, a day. Past it messages are still kept for the editor, only not
 * emailed: someone sending from many addresses can fill the owner's inbox, but cannot stop real visitors' messages.
 */
const EMAILS_PER_SITE = { limit: 300, windowSeconds: 24 * 60 * 60 };
/** Messages kept on the whole site a day, far above any real use: past it the database is being filled on purpose. */
const KEPT_PER_SITE = { limit: 5_000, windowSeconds: 24 * 60 * 60 };
const TOKENS_PER_VISITOR = { limit: 30, windowSeconds: 10 * 60 };
/**
 * Messages with files one visitor may start sending, counted before a byte of the body is read: reading costs
 * memory, so someone without a fresh token, or past this, is refused while the files are still on their side.
 */
const UPLOADS_PER_VISITOR = { limit: 20, windowSeconds: 10 * 60 };
/** Bytes of files kept a day: from one visitor (three full messages), and on the whole site. */
const FILE_BYTES_PER_VISITOR = { limit: 30 * 1024 * 1024, windowSeconds: 24 * 60 * 60 };
const FILE_BYTES_PER_SITE = { limit: 500 * 1024 * 1024, windowSeconds: 24 * 60 * 60 };
/**
 * Confirmations a day. Anyone can type someone else's address in a form, so these are what keeps the site from
 * being used to write to strangers: one address hears from the site three times a day at most, one visitor causes
 * ten, and the whole site sends two hundred. They are counted apart from the emails to the owners
 * (`EMAILS_PER_SITE`), so confirmations spent by an abuser never cost the owner a notification.
 */
const CONFIRMATIONS_PER_ADDRESS = { limit: 3, windowSeconds: 24 * 60 * 60 };
const CONFIRMATIONS_PER_VISITOR = { limit: 10, windowSeconds: 24 * 60 * 60 };
const CONFIRMATIONS_PER_SITE = { limit: 200, windowSeconds: 24 * 60 * 60 };
/** The header a message with files carries its token in, so it is checked before the body is read. */
export const TOKEN_HEADER = "x-brim-form-token"; // betterleaks:allow (a header's name)
/** The work done for that token, which the page's script found (./work.ts). */
export const WORK_HEADER = "x-brim-form-work";

const MAX_LENGTH: Record<string, number> = { textarea: 10_000 };
const DEFAULT_MAX_LENGTH = 1_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FormsHandler = (request: Request, info: { clientAddress: string }) => Promise<Response | undefined>;

/**
 * The public side of forms: hands out a short-lived token and accepts submissions.
 * Resolves to `undefined` for any other path.
 *
 * A submission is accepted only when all of these hold:
 * - it comes from a page of the site itself;
 * - the form description it carries was signed by the site, so its fields are the author's;
 * - it carries a token issued a little while ago and not used before, and the work its browser did for it;
 * - the hidden trap field is empty;
 * - when the site's forms have a challenge (Turnstile or hCaptcha), its provider says it was passed;
 * - the visitor is within their limit, and the site within the messages it keeps a day;
 * - every value fits the field it answers;
 * - every file is one of the kinds its field takes by its own bytes, and within the sizes and counts allowed.
 *
 * Files are stored only once all of that held, so a refused message leaves nothing behind.
 */
export interface FormsOptions {
  /** Sends the email about each message. Without one, messages are only kept for the editor. */
  mailer?: Mailer | undefined;
  /**
   * Given the sending of each email, which runs after the visitor has their answer. Tests wait on it; a server
   * that may stop between requests can keep itself alive with it.
   */
  background?: (work: Promise<void>) => void;
  /** The emails the site writes itself (`src/emails.ts`), asked for at each message so a change shows at once. */
  emails?: () => SiteEmails | null | undefined | Promise<SiteEmails | null | undefined>;
  /** The challenge every submission must pass, when the config sets one (`forms.captcha`). */
  captcha?: CaptchaCheck | undefined;
  /** How the provider is asked about a challenge; tests give their own. */
  fetch?: typeof fetch;
  /**
   * Where visitors' files are kept (`resolveFormFiles`). Without it the site has no private place for them, and a
   * message that carries files is refused.
   */
  files?: PrivateFiles | undefined;
  /** The site's name (`identity.name`), the sender's name of a confirmation when Site Settings gives none. */
  siteName?: string | undefined;
  /**
   * The site's public address (Astro's `site`), for the links in emails. Never taken from the request alone: whoever
   * sends a message writes its Host header, and the email goes to someone else.
   */
  siteUrl?: string | undefined;
}

export function createFormsHandler(brim: Brim, options: FormsOptions = {}): FormsHandler {
  const limiter = new RateLimiter(brim.db);
  const mailSettings = new MailSettingsStore(brim.db);
  const fileStore = options.files && new FormFiles(options.files, () => brim.forms.secret());

  let missingAddressLogged = false;

  /** The site's address and name for an email. Without an address the email has no links (see `trustedOrigin`). */
  function sender(request: Request): { origin: string | undefined; site: string } {
    const origin = trustedOrigin(request, options.siteUrl);
    if (!origin && !missingAddressLogged) {
      missingAddressLogged = true;
      console.warn("[brim] Emails about forms have no links: set `site` in astro.config.mjs to the site's address.");
    }
    return { origin, site: origin ? new URL(origin).host : options.siteName || "the site" };
  }

  /** Emails the message to whoever should hear about it. A failure is logged: the message is saved either way. */
  async function notify(
    request: Request,
    spec: FormSpec,
    answers: FormAnswer[],
    id: string,
    kept: FormFile[],
  ): Promise<void> {
    const { mailer } = options;
    if (!mailer) return;
    const settings = await mailSettings.get();
    if (mailer.delivery(settings) === "none") return;
    const notifyAlso = spec.notify ? openAddress(await brim.forms.secret(), spec.notify) : undefined;
    const to = await formRecipients(settings, brim.accounts, notifyAlso);
    if (to.length === 0) return;
    const { origin, site } = sender(request);
    const page = origin && formPage(spec.form);
    // Where the editor's API hands each file to a signed-in owner or editor; the email never carries the file.
    const files = kept.map(({ id: fileId, label, name, size }) => ({
      label,
      name,
      size,
      url: origin ? `${origin}/admin/api/responses/${id}/files/${fileId}` : "",
    }));
    const email: FormEmail = {
      form: spec.title,
      site,
      siteUrl: origin ?? "",
      ...(page && { page: `${origin}${page}` }),
      answers: answers.map(({ label, value }) => ({ label, value })),
      ...(files.length > 0 && { files }),
      responsesUrl: origin ? `${origin}/admin/edit` : "",
      responseUrl: origin ? `${origin}/admin/edit?response=${encodeURIComponent(id)}` : "",
      sentAt: new Date(),
    };
    const message = formNotice({
      site: email.site,
      title: email.form,
      answers,
      ...(email.page && { page: email.page }),
      responsesUrl: email.responsesUrl,
      responseUrl: email.responseUrl,
      files,
      settings,
      to,
    });
    const template = (await Promise.resolve(options.emails?.()).catch(() => undefined))?.form;
    await mailer.send(settings, await writtenBySite(message, template, { ...email, replyTo: message.replyTo }));
  }

  /**
   * Emails the visitor that their message arrived, when the form's owner turned that on. Called only for a message
   * that passed every check and was kept. One email, to the one address the form's chosen email field holds, in the
   * words the owner wrote; within the limits above, or not at all. Nothing here can fail the visitor's sending.
   */
  async function confirm(request: Request, spec: FormSpec, given: Given[], clientAddress: string): Promise<void> {
    const { mailer } = options;
    const wanted = spec.confirm;
    if (!mailer || !wanted) return;
    // Only a field the form's author made an email field, whose value was checked as one address, names a recipient.
    const field = spec.fields.find((candidate) => candidate.name === wanted.field && candidate.type === "email");
    const to = field && given.find((answer) => answer.name === field.name)?.value.toLowerCase();
    if (!to || !isEmail(to)) return;
    const settings = await mailSettings.get();
    if (mailer.delivery(settings) === "none") return;

    // The address is counted by its hash: the table of limits never holds visitors' addresses.
    const address = createHash("sha256").update(to).digest("hex").slice(0, 32);
    const within = async (key: string, { limit, windowSeconds }: { limit: number; windowSeconds: number }) =>
      limiter.allow(key, limit, windowSeconds);
    if (
      !(await within(`form-confirm:visitor:${clientAddress}`, CONFIRMATIONS_PER_VISITOR)) ||
      !(await within(`form-confirm:to:${address}`, CONFIRMATIONS_PER_ADDRESS)) ||
      !(await within("form-confirm:site", CONFIRMATIONS_PER_SITE))
    ) {
      console.warn("[brim] A confirmation email was not sent: its daily limit was reached.");
      return;
    }

    const { origin, site } = sender(request);
    const page = origin && formPage(spec.form);
    const answers =
      wanted.answers === true ? confirmationAnswers(given.map(({ label, value }) => ({ label, value }))) : [];
    // "Reply" goes to the site: the form's own notification address, else the first of Site Settings'. Never to
    // anything a visitor wrote.
    const notifyAlso = spec.notify ? openAddress(await brim.forms.secret(), spec.notify) : undefined;
    const replyTo = [...splitAddresses(notifyAlso ?? ""), ...settings.notify].find(isEmail);
    const email: ConfirmationEmail = {
      form: spec.title,
      site,
      siteUrl: origin ?? "",
      ...(page && { page: `${origin}${page}` }),
      subject: String(wanted.subject ?? "").slice(0, CONFIRMATION_SUBJECT_LENGTH),
      message: String(wanted.message ?? "").slice(0, CONFIRMATION_MESSAGE_LENGTH),
      answers,
      sentAt: new Date(),
    };
    const message = confirmationNotice({
      site,
      subject: email.subject,
      message: email.message,
      answers,
      replyTo,
      // The email is the site's: its sender is the site's name, whichever server carries it.
      settings: { ...settings, senderName: settings.senderName || options.siteName || "" },
      to,
    });
    const template = (await Promise.resolve(options.emails?.()).catch(() => undefined))?.confirmation;
    const written = await writtenBySite(message, template, email);
    // A template writes the words and the look; who it goes to and where replies go are not its to change.
    await mailer.send(settings, { ...written, to: [to], replyTo });
  }

  async function token(info: { clientAddress: string }): Promise<Response> {
    const { limit, windowSeconds } = TOKENS_PER_VISITOR;
    if (!(await limiter.allow(`form-token:${info.clientAddress}`, limit, windowSeconds))) {
      throw new HttpError(429, "Too many requests. Try again in a few minutes.");
    }
    // `work`: how many zero bits the page's script finds after the token before it sends (./work.ts). It is part of
    // what the token signs, so a script cannot ask for less.
    const work = workBits(await recentAttempts());
    const payload = `${Date.now()}.${randomBytes(12).toString("base64url")}.${work}`;
    return json({ token: `${payload}.${sign(await brim.forms.secret(), payload)}`, work });
  }

  /** The ten-minute window a message tried now counts in; each has its own key, so the one before stays readable. */
  const attemptsKey = (offset = 0) => `form:attempts:${Math.floor(Date.now() / 1000 / WORK_WINDOW_SECONDS) - offset}`;

  /**
   * A message tried counts towards the work new tokens ask for, sent or refused, once its token is good, and only so
   * many from one address: otherwise one person, at no cost, could have every visitor's browser work harder.
   */
  async function countAttempt(clientAddress: string): Promise<void> {
    const { limit, windowSeconds } = PER_VISITOR;
    if (!(await limiter.allow(`form-attempts:${clientAddress}`, limit, windowSeconds))) return;
    await limiter.allow(attemptsKey(), Number.MAX_SAFE_INTEGER, WORK_WINDOW_SECONDS);
  }

  /** Messages tried on the whole site lately: this window or the one before, whichever saw more. */
  async function recentAttempts(): Promise<number> {
    return Math.max(await limiter.count(attemptsKey()), await limiter.count(attemptsKey(1)));
  }

  /** Whether the token is the site's, of the right age and its work done, without using it up; its single-use part. */
  async function readToken(input: unknown, work: unknown): Promise<string> {
    const [issuedAt, nonce, bits, signature] = typeof input === "string" ? input.split(".") : [];
    const secret = await brim.forms.secret();
    if (!issuedAt || !nonce || !bits || !signature || !isSigned(secret, `${issuedAt}.${nonce}.${bits}`, signature)) {
      throw new HttpError(400, "This form has expired. Reload the page and try again.");
    }
    const age = Date.now() - Number(issuedAt);
    if (age > TOKEN_LIFETIME_MS) throw new HttpError(400, "This form has expired. Reload the page and try again.");
    if (age < MIN_FILL_MS) throw new HttpError(429, "That was very fast. Wait a moment and send again.");
    if (!workDone(input as string, work, Number(bits)))
      throw new HttpError(400, "This form has expired. Reload the page and try again.");
    return nonce;
  }

  async function checkToken(input: unknown, work: unknown): Promise<void> {
    const nonce = await readToken(input, work);
    // Counting the token as a rate-limit key makes it usable exactly once.
    if (!(await limiter.allow(`form-used:${nonce}`, 1, TOKEN_LIFETIME_MS / 1000))) {
      throw new HttpError(400, "This form was already sent. Reload the page to send another.");
    }
  }

  let missingSecretLogged = false;

  /** The challenge's answer, checked with its provider. Without the secret key nothing is sent unchecked. */
  async function checkCaptcha(check: CaptchaCheck, answer: unknown, clientAddress: string): Promise<void> {
    if (!check.secret) {
      if (!missingSecretLogged) {
        missingSecretLogged = true;
        console.error(
          `[brim] Forms ask for ${check.provider}, but BRIM_CAPTCHA_SECRET is not set: no form can be sent.`,
        );
      }
      throw new HttpError(503, "This form cannot be sent right now. Please try again later.");
    }
    if (typeof answer !== "string" || answer === "" || answer.length > 4096) {
      throw new HttpError(400, "Please complete the check before sending.");
    }
    if (!(await verifyCaptcha({ ...check, secret: check.secret }, answer, clientAddress, options.fetch))) {
      throw new HttpError(400, "The check did not pass. Please try again.");
    }
  }

  /**
   * A message that carries files, sent as `multipart/form-data`. Its token comes in a header and is checked first,
   * with the visitor's limit on such messages, so nothing is read from someone who could not send anyway; then the
   * body is read up to the most a message may weigh and refused the moment it is larger.
   */
  async function readMultipart(request: Request, clientAddress: string): Promise<Submission> {
    const token = request.headers.get(TOKEN_HEADER);
    const work = Number(request.headers.get(WORK_HEADER) ?? Number.NaN);
    await readToken(token, work);
    const { limit, windowSeconds } = UPLOADS_PER_VISITOR;
    if (!(await limiter.allow(`form-upload:${clientAddress}`, limit, windowSeconds))) {
      throw new HttpError(429, "Too many messages. Try again later.");
    }
    const bytes = await readBytes(
      request,
      MAX_MESSAGE_BYTES + MAX_FIELDS_BYTES,
      `The files are too large: at most ${fileSize(MAX_MESSAGE_BYTES)} in one message.`,
    );
    let data: FormData;
    try {
      data = await new Response(bytes, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      throw new HttpError(400, "The form could not be read.");
    }
    const text = (name: string): string | undefined => {
      const value = data.getAll(name).find((entry) => typeof entry === "string");
      return typeof value === "string" ? value : undefined;
    };
    let values: unknown;
    try {
      values = JSON.parse(text("values") ?? "{}");
    } catch {
      throw new HttpError(400, "The form could not be read.");
    }
    return {
      body: {
        spec: text("spec"),
        signature: text("signature"),
        token,
        work,
        trap: text("trap"),
        consent: text("consent") === "true",
        captcha: text("captcha"),
        values,
      },
      // A file input left empty still sends a part, with no name and no bytes.
      files: (name) =>
        data
          .getAll(name)
          .filter((entry): entry is File => typeof entry !== "string" && (entry.size > 0 || entry.name !== "")),
    };
  }

  /**
   * The files of a message, checked against the form's file fields: how many, how large, and what each one is by
   * its own bytes. Files sent under any other name are never looked at, and nothing is stored here.
   */
  async function attached(spec: FormSpec, sent: Submission["files"], input: unknown): Promise<Attached[]> {
    const values = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
    const all: Attached[] = [];
    for (const field of spec.fields) {
      // A file field asked only after another answer is not checked, nor are its files kept, when it was not asked.
      if (field.type !== "file" || !fieldShown(field, values)) continue;
      const files = sent(field.name);
      if (files.length === 0) {
        if (field.required) throw new ValidationError(`"${field.label}" is required.`);
        continue;
      }
      if (files.length > (field.multiple ? MAX_FILES : 1)) {
        throw new ValidationError(
          field.multiple ? `"${field.label}" takes at most ${MAX_FILES} files.` : `"${field.label}" takes one file.`,
        );
      }
      // What the field takes is read again from the signed form, so only Brim's own kinds can ever be named.
      const accept = fileTypes(field.accept);
      for (const file of files) {
        if (file.size === 0) throw new ValidationError(`"${field.label}": the file is empty.`);
        if (file.size > MAX_FILE_BYTES) {
          throw new ValidationError(`"${field.label}": a file is larger than ${fileSize(MAX_FILE_BYTES)}.`);
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const type = sniffFileType(bytes);
        if (!type || !accept.includes(type)) {
          throw new ValidationError(
            `"${field.label}" takes only ${accept.map((key) => FILE_TYPES[key].label).join(", ")} files.`,
          );
        }
        all.push({ label: field.label, name: safeFileName(file.name, type), type, bytes });
      }
    }
    if (all.length > MAX_FILES) throw new ValidationError(`A message takes at most ${MAX_FILES} files.`);
    if (all.reduce((sum, file) => sum + file.bytes.byteLength, 0) > MAX_MESSAGE_BYTES) {
      throw new ValidationError(`The files are too large: at most ${fileSize(MAX_MESSAGE_BYTES)} in one message.`);
    }
    return all;
  }

  /** Stores the files of an accepted message under its id. If one cannot be kept, none is. */
  async function keep(id: string, files: Attached[]): Promise<FormFile[]> {
    if (files.length === 0) return [];
    if (!fileStore) throw new HttpError(501, "Files cannot be sent through this form.");
    const kept: FormFile[] = [];
    try {
      for (const file of files) {
        const fileId = randomUUID();
        await fileStore.write(id, fileId, file.bytes);
        kept.push({
          id: fileId,
          label: file.label,
          name: file.name,
          mime: FILE_TYPES[file.type].mime,
          size: file.bytes.byteLength,
        });
      }
    } catch (error) {
      console.error("[brim] A form's files were not kept:", error instanceof Error ? error.message : error);
      await fileStore.remove(id, kept);
      throw new HttpError(503, "The files could not be kept. Please try again later.");
    }
    return kept;
  }

  async function submit(request: Request, info: { clientAddress: string }): Promise<Response> {
    assertSameOrigin(request);
    const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data") === true;
    const { body, files: sent }: Submission = multipart
      ? await readMultipart(request, info.clientAddress)
      : { body: await readJson(request), files: () => [] };

    const secret = await brim.forms.secret();
    if (
      typeof body.spec !== "string" ||
      typeof body.signature !== "string" ||
      !isSigned(secret, body.spec, body.signature)
    ) {
      throw new HttpError(400, "This form is not one of this site's forms.");
    }
    const spec = decodeSpec(body.spec);

    // A filled trap field means a script. It is told all went well, so it learns nothing: nothing is kept (no
    // message, no file) and no email leaves, to the owner or to the address it wrote.
    if (typeof body.trap === "string" && body.trap !== "") return json({ ok: true });

    await checkToken(body.token, body.work);
    await countAttempt(info.clientAddress);
    if (options.captcha) await checkCaptcha(options.captcha, body.captcha, info.clientAddress);
    const allowed =
      (await limiter.allow(`form:${spec.form}:${info.clientAddress}`, PER_VISITOR.limit, PER_VISITOR.windowSeconds)) &&
      (await limiter.allow("form:site-kept", KEPT_PER_SITE.limit, KEPT_PER_SITE.windowSeconds));
    if (!allowed) throw new HttpError(429, "Too many messages. Try again later.");

    if (spec.consentRequired && body.consent !== true) throw new ValidationError("Please agree before sending.");
    const given = answers(spec, body.values);
    const files = await attached(spec, sent, body.values);
    const size = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    if (size > 0) {
      if (!fileStore) throw new HttpError(501, "Files cannot be sent through this form.");
      const within =
        (await limiter.add(
          `form-files:${info.clientAddress}`,
          size,
          FILE_BYTES_PER_VISITOR.limit,
          FILE_BYTES_PER_VISITOR.windowSeconds,
        )) &&
        (await limiter.add("form-files:site", size, FILE_BYTES_PER_SITE.limit, FILE_BYTES_PER_SITE.windowSeconds));
      if (!within) throw new HttpError(429, "Too many files today. Try again tomorrow.");
    }

    // Everything held: only now is anything written. The files first, under the message's id, then the message
    // that lists them; if the message cannot be kept, its files go again.
    const id = randomUUID();
    const kept = await keep(id, files);
    const saved = given.map(({ name: _name, ...answer }): FormAnswer => answer);
    try {
      await brim.forms.save(spec.form, spec.title, saved, kept, id);
    } catch (error) {
      await fileStore?.remove(id, kept);
      throw error;
    }

    if (await limiter.allow("form:site-emails", EMAILS_PER_SITE.limit, EMAILS_PER_SITE.windowSeconds)) {
      const sending = notify(request, spec, saved, id, kept).catch((error: unknown) => {
        console.error(
          "[brim] The email about a form message was not sent:",
          error instanceof Error ? error.message : error,
        );
      });
      options.background?.(sending);
    } else {
      console.warn("[brim] A form message was kept but not emailed: the site sent its emails for today.");
    }
    if (spec.confirm) {
      const confirming = confirm(request, spec, given, info.clientAddress).catch((error: unknown) => {
        console.error("[brim] A confirmation email was not sent:", error instanceof Error ? error.message : error);
      });
      options.background?.(confirming);
    }
    return json({ ok: true });
  }

  return async (request, info) => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(`${FORMS_PATH}/`)) return undefined;
    try {
      if (request.method === "GET" && pathname === `${FORMS_PATH}/token`) return await token(info);
      if (request.method === "POST" && pathname === `${FORMS_PATH}/submit`) return await submit(request, info);
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
      if (error instanceof ValidationError) return json({ error: error.message }, { status: 422 });
      throw error;
    }
  };
}

/** A message as it was sent: its fields, and the files sent under a field's name (none in a JSON message). */
interface Submission {
  body: Record<string, unknown>;
  files: (name: string) => File[];
}

/** An answer with the name of its field, which says whether it is the one a confirmation goes to. */
type Given = FormAnswer & { name: string };

/** A file that passed its checks, not stored yet. */
interface Attached {
  label: string;
  name: string;
  type: FileType;
  bytes: Uint8Array;
}

/** Checks each value against its field and keeps only values of fields the form has. Files are checked apart. */
function answers(spec: FormSpec, input: unknown): Given[] {
  const values = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  return spec.fields.flatMap((field) => {
    if (field.type === "file") return [];
    // A field asked only after another answer is not checked, nor kept, when that answer was not given.
    if (!fieldShown(field, values)) return [];
    const value = answer(field, values[field.name]);
    if (value === "") return [];
    if (!field.options?.length || !CHOICE_TYPES.includes(field.type)) return [{ name: field.name, label: field.label, value }];
    // Taken from what was sent, never from the joined text: a choice's own words may hold a comma.
    const sent = values[field.name];
    const picked =
      field.type === "checkboxes" && Array.isArray(sent)
        ? [...new Set(sent.filter((item): item is string => typeof item === "string").map((item) => item.trim()))]
        : [value];
    const offered: FormChoice[] = field.choices ?? field.options.map((label) => ({ label }));
    const choices = offered.map(({ label, icon, image }) => ({
      label,
      ...(icon && { icon }),
      ...(image && { image }),
    }));
    return [{ name: field.name, label: field.label, value, choices, picked }];
  });
}

function answer(field: FormField, input: unknown): string {
  if (field.type === "checkbox") {
    if (field.required && input !== true) throw new ValidationError(`"${field.label}" is required.`);
    return input === true ? "Yes" : "";
  }

  if (field.type === "checkboxes") {
    // Several choices, each one of the options, kept as one answer.
    const picked = (Array.isArray(input) ? input : []).filter((item): item is string => typeof item === "string");
    const unique = [...new Set(picked.map((item) => item.trim()).filter(Boolean))];
    if (unique.some((item) => !field.options?.includes(item)))
      throw new ValidationError(`"${field.label}" is not one of the choices.`);
    if (unique.length === 0 && field.required) throw new ValidationError(`"${field.label}" is required.`);
    return unique.join(", ");
  }

  const value = typeof input === "string" ? input.trim() : "";
  if (value === "") {
    if (field.required) throw new ValidationError(`"${field.label}" is required.`);
    return "";
  }
  if (value.length > (MAX_LENGTH[field.type] ?? DEFAULT_MAX_LENGTH))
    throw new ValidationError(`"${field.label}" is too long.`);
  if (field.type === "email" && !EMAIL.test(value))
    throw new ValidationError(`"${field.label}" must be an email address.`);
  if (field.type === "number" && !Number.isFinite(Number(value)))
    throw new ValidationError(`"${field.label}" must be a number.`);
  if (field.type === "url" && !/^https?:\/\//i.test(value))
    throw new ValidationError(`"${field.label}" must be a web address.`);
  if ((field.type === "select" || field.type === "radio") && !field.options?.includes(value)) {
    throw new ValidationError(`"${field.label}" is not one of the choices.`);
  }
  return value;
}
