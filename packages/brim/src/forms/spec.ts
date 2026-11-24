import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FormField } from "./fields.ts";

/**
 * What a form on a page asks for. The page signs it when it is rendered, so the server can check a
 * submission against the form as its author made it, without trusting anything the visitor sends.
 */
export interface FormSpec {
  /** Which form this is: the page it is on and its node id. */
  form: string;
  /** Name shown to the owner in the list of responses. */
  title: string;
  fields: FormField[];
  consentRequired: boolean;
  /**
   * More addresses the form's author wants told about each message (the form's Notification Email). In the page it
   * is sealed (`sealAddress`): the spec is only signed, so anything else in it can be read in the page's source.
   */
  notify?: string;
  /**
   * The confirmation the visitor is emailed once their message is kept, when the owner turned it on: which email
   * field of the form names the recipient, and the subject and message the owner wrote. Signed with the rest, so a
   * visitor can choose neither the words nor a field that was not checked as an email address.
   */
  confirm?: FormConfirmation;
}

export interface FormConfirmation {
  /** The `name` of one of the form's `email` fields. */
  field: string;
  subject: string;
  message: string;
  /** The email also lists what the visitor answered, as text and shortened. Off unless the owner asks. */
  answers?: boolean;
}

export function encodeSpec(spec: FormSpec): string {
  return Buffer.from(JSON.stringify(spec)).toString("base64url");
}

export function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function isSigned(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(secret, payload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Sealed addresses start with this; an older page's spec may still carry the address itself. */
const SEALED = "v1.";

/** The key that seals addresses: the forms secret, set apart from the one that signs. */
function sealingKey(secret: string): Buffer {
  return createHash("sha256").update(`brim-form-notify\n${secret}`).digest();
}

/**
 * Seals a form's notification addresses for the page, which anyone can read: only the server, with the site's
 * secret, opens them again. Without this a page would hand its owner's address to every harvester of addresses.
 */
export function sealAddress(secret: string, address: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(secret), iv);
  const sealed = Buffer.concat([cipher.update(address, "utf8"), cipher.final()]);
  return `${SEALED}${[iv, sealed, cipher.getAuthTag()].map((part) => part.toString("base64url")).join(".")}`;
}

/** The addresses a page's spec carries: opened when sealed, as they are when an older page wrote them plainly. */
export function openAddress(secret: string, value: string): string | undefined {
  if (!value.startsWith(SEALED)) return value;
  const [iv, sealed, tag] = value
    .slice(SEALED.length)
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !sealed || !tag) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", sealingKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

export function decodeSpec(encoded: string): FormSpec {
  return JSON.parse(Buffer.from(encoded, "base64url").toString()) as FormSpec;
}
