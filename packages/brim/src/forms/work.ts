import { createHash } from "node:crypto";

/**
 * A little work every form asks of the visitor's browser before it sends, on every site, with nothing to set up and
 * no third party: find a number that, after the form's token, gives a SHA-256 starting with this many zero bits.
 * A browser finds one in well under a second while the visitor types (it starts when they first touch the form); the
 * server checks it with one hash. Each token is good once, so the work cannot be reused: a script sending thousands
 * of messages pays for every one. A challenge from Turnstile or hCaptcha (`forms.captcha`) goes further.
 */
export const WORK_BITS = 16;

/**
 * More work when the site is being sent many messages: each step doubles it twice (about 0.4 s, 1.5 s, 6 s in a
 * desktop browser, a few times that on an old phone). Real visitors wait a little while it lasts; a script sending
 * thousands pays sixteen times as much for each. The levels are messages tried on the whole site in ten minutes,
 * this window or the one before, so the work does not drop the moment a new window starts.
 */
export const WORK_LEVELS: readonly { attempts: number; bits: number }[] = [
  { attempts: 100, bits: 20 },
  { attempts: 30, bits: 18 },
];
export const WORK_WINDOW_SECONDS = 10 * 60;

/** The work asked for a new token, after `attempts` messages were tried on the site lately. */
export function workBits(attempts: number): number {
  return WORK_LEVELS.find((level) => attempts >= level.attempts)?.bits ?? WORK_BITS;
}

/** Whether `nonce` is the work asked for `token`. */
export function workDone(token: string, nonce: unknown, bits = WORK_BITS): boolean {
  if (typeof nonce !== "number" || !Number.isSafeInteger(nonce) || nonce < 0) return false;
  return leadingZeroBits(createHash("sha256").update(`${token}.${nonce}`).digest()) >= bits;
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Does the work for `token` (tests and scripts of the site's own; the page does it in the browser). */
export function solveWork(token: string, bits = WORK_BITS): number {
  for (let nonce = 0; ; nonce++) if (workDone(token, nonce, bits)) return nonce;
}
