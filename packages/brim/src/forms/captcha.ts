/**
 * An optional challenge on the site's forms, from Cloudflare Turnstile or hCaptcha. The trap field, the time it
 * takes to fill a form and the token stop scripts that post; a challenge also stops a script that drives a real
 * browser. The site key is public and set in the config; the secret key only ever comes from the server's
 * environment (`BRIM_CAPTCHA_SECRET`), never from the code or the page.
 */
export type CaptchaProvider = "turnstile" | "hcaptcha";

export interface CaptchaOptions {
  provider: CaptchaProvider;
  /** The public key the provider gives the site; the secret goes in `BRIM_CAPTCHA_SECRET`. */
  siteKey: string;
}

interface Provider {
  /** The provider's script, which draws a widget into every element with `widgetClass`. */
  script: string;
  widgetClass: string;
  /** The hidden field the widget fills with its answer, inside the form. */
  responseField: string;
  verifyUrl: string;
}

export const CAPTCHA_PROVIDERS: Record<CaptchaProvider, Provider> = {
  turnstile: {
    script: "https://challenges.cloudflare.com/turnstile/v0/api.js",
    widgetClass: "cf-turnstile",
    responseField: "cf-turnstile-response",
    verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  },
  hcaptcha: {
    script: "https://js.hcaptcha.com/1/api.js",
    widgetClass: "h-captcha",
    responseField: "h-captcha-response",
    verifyUrl: "https://api.hcaptcha.com/siteverify",
  },
};

/** The challenge as the config names it, checked when the site starts; `undefined` when forms have none. */
export function resolveCaptcha(options: CaptchaOptions | undefined): CaptchaOptions | undefined {
  if (!options) return undefined;
  if (!Object.hasOwn(CAPTCHA_PROVIDERS, options.provider)) {
    throw new Error(`brim({ forms: { captcha } }): provider must be "turnstile" or "hcaptcha".`);
  }
  const siteKey = typeof options.siteKey === "string" ? options.siteKey.trim() : "";
  if (siteKey === "") throw new Error("brim({ forms: { captcha } }): siteKey is required (the provider's public key).");
  return { provider: options.provider, siteKey };
}

/** What the forms handler checks a challenge with: the provider, and the secret read from the environment. */
export interface CaptchaCheck {
  provider: CaptchaProvider;
  secret: string | undefined;
}

export function captchaCheck(options: CaptchaOptions | undefined): CaptchaCheck | undefined {
  return options && { provider: options.provider, secret: process.env.BRIM_CAPTCHA_SECRET?.trim() || undefined };
}

/**
 * Asks the provider whether the answer a visitor's widget gave is genuine, and fresh: each answer is good once.
 * A provider that does not answer in time counts as a failed check, so a form is never sent unchecked.
 */
export async function verifyCaptcha(
  check: CaptchaCheck & { secret: string },
  answer: string,
  remoteip: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const body = new URLSearchParams({ secret: check.secret, response: answer, remoteip });
  try {
    const response = await fetcher(CAPTCHA_PROVIDERS[check.provider].verifyUrl, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}
