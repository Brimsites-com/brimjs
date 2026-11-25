import type { Accounts, Role } from "../auth/accounts.ts";
import type { FormAnswer } from "../forms/store.ts";
import { fileSize } from "../forms/files.ts";
import type { MailMessage } from "./mailer.ts";
import type { AccountEmail } from "./templates.ts";
import { type MailSettings, isEmail, splitAddresses } from "./settings.ts";

const MAX_RECIPIENTS = 10;

/**
 * Who hears about a form message: every user of the roles Site Settings chose (owners by default, editors too when
 * asked), Site Settings' addresses and the form's own.
 */
export async function formRecipients(
  settings: MailSettings,
  accounts: Accounts,
  formNotify: string | undefined,
): Promise<string[]> {
  const users =
    settings.notifyRoles.length > 0
      ? (await accounts.listUsers())
          .filter((user) => settings.notifyRoles.includes(user.role))
          .map((user) => user.email)
      : [];
  const all = [...users, ...settings.notify, ...splitAddresses(formNotify ?? "")];
  return [...new Set(all.map((address) => address.toLowerCase()))].filter(isEmail).slice(0, MAX_RECIPIENTS);
}

/** The email the owner gets for one form message: every answer, and "Reply" goes to the visitor. */
export function formNotice(input: {
  site: string;
  title: string;
  answers: FormAnswer[];
  /** Where the editor lists the messages; "" when the site's address is not known, as for the other addresses. */
  responsesUrl: string;
  /** Where the editor opens this message. */
  responseUrl?: string;
  /** The page the form was sent from, e.g. the product an order form is about. */
  page?: string;
  /**
   * The files the visitor attached, each with where a signed-in owner or editor downloads it. They are never
   * attached to the email: an inbox is not a place to open a stranger's file, and the link asks who is asking.
   */
  files?: NoticeFile[];
  settings: MailSettings;
  to: string[];
}): MailMessage {
  const { site, title, answers, responsesUrl, responseUrl, page, settings, to, files = [] } = input;
  const replyTo = answers.map((answer) => answer.value).find((value) => isEmail(value));
  const subject = `New message from ${title} on ${site}`.replace(/[\r\n]+/g, " ");
  const text = [
    `Someone wrote through "${title}" on ${site}.`,
    ...(page ? [`Sent from: ${page}`] : []),
    "",
    ...answers.flatMap((answer) => [`${answer.label}:`, answer.value, ""]),
    ...files.flatMap((file) => [
      `${file.label}:`,
      `${file.name} (${fileSize(file.size)})${file.url ? `: ${file.url}` : ""}`,
      "",
    ]),
    ...(files.length > 0 ? ["Files open only for someone signed in to the editor who may read messages.", ""] : []),
    replyTo ? `Reply to this email to answer ${replyTo}.` : "",
    ...(responseUrl ? [`Open it in the editor: ${responseUrl}`] : []),
    responsesUrl ? `All messages: ${responsesUrl}` : "Read it in the site's editor.",
  ].join("\n");
  const rows = answers
    .map(
      (answer) =>
        `<tr><td style="padding:8px 12px 8px 0;color:#666;vertical-align:top;white-space:nowrap">${escape(answer.label)}</td>` +
        `<td style="padding:8px 0;white-space:pre-wrap">${escape(answer.value)}</td></tr>`,
    )
    .join("");
  const fileRows = files
    .map(
      (file) =>
        `<tr><td style="padding:8px 12px 8px 0;color:#666;vertical-align:top;white-space:nowrap">${escape(file.label)}</td>` +
        `<td style="padding:8px 0">${file.url ? `<a href="${escape(file.url)}" style="color:#111">${escape(file.name)}</a>` : escape(file.name)} (${escape(fileSize(file.size))})</td></tr>`,
    )
    .join("");
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">` +
    `<p>Someone wrote through <strong>${escape(title)}</strong> on ${escape(site)}.</p>` +
    (page ? `<p>Sent from <a href="${escape(page)}" style="color:#111">${escape(page)}</a></p>` : "") +
    `<table style="border-collapse:collapse;margin:16px 0">${rows}${fileRows}</table>` +
    (files.length > 0
      ? `<p style="color:#666">Files open only for someone signed in to the editor who may read messages.</p>`
      : "") +
    (replyTo ? `<p style="color:#666">Reply to this email to answer ${escape(replyTo)}.</p>` : "") +
    (responseUrl
      ? `<p><a href="${escape(responseUrl)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#111;color:#fff;text-decoration:none">Open this message</a></p>`
      : "") +
    (responsesUrl
      ? `<p><a href="${escape(responsesUrl)}" style="color:#111">See all messages</a></p></div>`
      : `<p>Read it in the site's editor.</p></div>`);
  return { to, subject, text, html, replyTo, fromName: settings.senderName || site };
}

/** A file of a message as an email names it: never its bytes, only where the editor hands it over. */
export interface NoticeFile {
  label: string;
  name: string;
  size: number;
  url: string;
}

/** The most of the owner's message a confirmation carries, and of each answer when the owner asked for them. */
export const CONFIRMATION_MESSAGE_LENGTH = 5_000;
export const CONFIRMATION_SUBJECT_LENGTH = 150;
export const CONFIRMATION_ANSWER_LENGTH = 300;
export const CONFIRMATION_ANSWERS_LENGTH = 2_000;

/**
 * What the visitor answered, as a confirmation may repeat it: text only, each answer and all of them together cut
 * short. The address the confirmation goes to may be someone else's, so the less of a stranger's words it can
 * carry, the less the site is worth to someone who wants it to write to a victim.
 */
export function confirmationAnswers(answers: FormAnswer[]): FormAnswer[] {
  const kept: FormAnswer[] = [];
  let total = 0;
  for (const { label, value } of answers) {
    const text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
    const short = text.length > CONFIRMATION_ANSWER_LENGTH ? `${text.slice(0, CONFIRMATION_ANSWER_LENGTH)}…` : text;
    if (total + short.length > CONFIRMATION_ANSWERS_LENGTH) break;
    total += short.length;
    kept.push({ label, value: short });
  }
  return kept;
}

/**
 * The email a visitor gets once their message was kept: the subject and the words the owner wrote. It says nothing
 * the visitor typed unless the owner asked for the answers, and "Reply" goes to the site, never to an address a
 * visitor gave.
 */
export function confirmationNotice(input: {
  site: string;
  subject: string;
  message: string;
  /** Present only when the owner asked for them; already shortened (`confirmationAnswers`). */
  answers?: FormAnswer[] | undefined;
  replyTo?: string | undefined;
  settings: MailSettings;
  to: string;
}): MailMessage {
  const { site, answers = [], replyTo, settings, to } = input;
  const subject = input.subject.trim().slice(0, CONFIRMATION_SUBJECT_LENGTH) || `We received your message (${site})`;
  const message = input.message.trim().slice(0, CONFIRMATION_MESSAGE_LENGTH) || "Thank you. We received your message.";
  const text = [message, "", ...answers.flatMap((answer) => [`${answer.label}:`, answer.value, ""]), site].join("\n");
  const rows = answers
    .map(
      (answer) =>
        `<tr><td style="padding:8px 12px 8px 0;color:#666;vertical-align:top">${escape(answer.label)}</td>` +
        `<td style="padding:8px 0;white-space:pre-wrap">${escape(answer.value)}</td></tr>`,
    )
    .join("");
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">` +
    `<p style="white-space:pre-wrap">${escape(message)}</p>` +
    (rows ? `<table style="border-collapse:collapse;margin:16px 0">${rows}</table>` : "") +
    `<p style="color:#666">${escape(site)}</p></div>`;
  return { to: [to], subject, text, html, replyTo, fromName: settings.senderName || site };
}

/** A short email that shows the settings work. */
export function testNotice(site: string, settings: MailSettings, to: string): MailMessage {
  const text = `This is a test from ${site}. Emails from your site's forms will arrive like this one.`;
  return {
    to: [to],
    subject: `Test email from ${site}`,
    text,
    html: `<p style="font-family:system-ui,sans-serif;font-size:15px">${escape(text)}</p>`,
    fromName: settings.senderName || site,
  };
}

/** The "forgot password" email: one link, what it does, how long it works, and what to do if it was not you. */
export function passwordResetNotice(site: string, settings: MailSettings, to: string, link: string): MailMessage {
  const lines = [
    `Someone asked to set a new password for ${to} on ${site}.`,
    "Open this link within an hour to choose a new one. It works once:",
    link,
    "If it was not you, ignore this email: your password stays as it is.",
  ];
  return {
    to: [to],
    subject: `Set a new password for ${site}`,
    text: lines.join("\n\n"),
    html:
      `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">` +
      `<p>${escape(lines[0]!)}</p><p>${escape(lines[1]!)}</p>` +
      `<p><a href="${escape(link)}">Set a new password</a></p>` +
      `<p style="color:#666">${escape(lines[3]!)}</p></div>`,
    fromName: settings.senderName || site,
  };
}

/** What each role allows, in the words the account emails use (see `auth/permissions.ts`). */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "manage everything: content, pages, settings and users",
  editor: "write, publish, add pages and read the messages sent through the forms",
};

/**
 * Brim's own email for a change to someone's access (`added`, `role`, `reset`): what happened, what they may do now,
 * and how to get in — a link to choose their password, and the host's own sign-in when the site offers it. A site
 * writes its own in `src/emails.ts` (`userAdded`, `roleChanged`, `accessReset`).
 */
export function accountNotice(email: AccountEmail, settings: MailSettings): MailMessage {
  const { site, role, roleDescription, by, editorUrl, passwordUrl, passwordLinkHours, hostSignIn } = email;
  const who = by && by !== email.email ? by : "An owner of the site";
  const within = passwordLinkHours
    ? passwordLinkHours % 24 === 0
      ? `${passwordLinkHours / 24} day${passwordLinkHours === 24 ? "" : "s"}` // betterleaks:allow
      : `${passwordLinkHours} hour${passwordLinkHours === 1 ? "" : "s"}` // betterleaks:allow
    : "";
  const passwordLine = passwordUrl // betterleaks:allow
    ? `Choose your password to open the editor. The link works once, within ${within}:`
    : "";
  const hostLine = hostSignIn
    ? `You can also sign in with ${hostSignIn.name}: open the editor and choose "Continue with ${hostSignIn.name}", with this same email.`
    : "";
  const content = {
    added: {
      subject: `You can now edit ${site}`,
      intro: `${who} added you to ${site} as ${article(role)} ${role}: you can ${roleDescription}.`,
      button: "Choose your password",
    },
    role: {
      subject: `Your role on ${site} is now ${role}`,
      intro:
        `${who} changed your role on ${site}` +
        (email.previousRole ? ` from ${email.previousRole} to ${role}` : ` to ${role}`) +
        `: you can now ${roleDescription}.`,
      button: "",
    },
    reset: {
      subject: `Your access to ${site} was reset`,
      intro: `${who} reset your access to ${site}: you were signed out everywhere and your old password no longer works.`,
      button: "Choose a new password",
    },
  }[email.kind];
  const subject = content.subject.replace(/[\r\n]+/g, " ");
  const text = [
    content.intro,
    ...(passwordUrl ? [`${passwordLine}\n${passwordUrl}`] : []),
    ...(hostLine ? [hostLine] : []),
    `The editor: ${editorUrl}`,
    ...(email.kind === "reset" ? ["If you did not expect this, reply to whoever runs the site."] : []),
  ].join("\n\n");
  const button = (href: string, label: string) =>
    `<p><a href="${escape(href)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#111;color:#fff;text-decoration:none">${escape(label)}</a></p>`;
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">` +
    `<p>${escape(content.intro)}</p>` +
    (passwordUrl
      ? `<p>${escape(passwordLine)}</p>${button(passwordUrl, content.button)}`
      : button(editorUrl, "Open the editor")) +
    (hostLine ? `<p>${escape(hostLine)}</p>` : "") +
    (passwordUrl
      ? `<p style="color:#666">The editor: <a href="${escape(editorUrl)}" style="color:#111">${escape(editorUrl)}</a></p>`
      : "") +
    `</div>`;
  return { to: [email.email], subject, text, html, fromName: settings.senderName || site };
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
