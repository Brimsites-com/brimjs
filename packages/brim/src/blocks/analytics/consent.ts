/** A visitor's choice about statistics, kept in their browser. */
export interface ConsentChoice {
  statistics: boolean;
  /** When it was made, in milliseconds. */
  at: number;
}

export const CONSENT_KEY = "brim-consent";
/** A choice is asked again after this long. */
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

/** The choice as it was stored, or `null` when there is none, it is too old or it cannot be read. */
export function readChoice(raw: string | null, now: number): ConsentChoice | null {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<ConsentChoice> | null;
    if (typeof value?.statistics !== "boolean" || typeof value.at !== "number") return null;
    return value.at > now || now - value.at >= CONSENT_MAX_AGE ? null : { statistics: value.statistics, at: value.at };
  } catch {
    return null;
  }
}

/** The cookies Google Analytics keeps: `_ga` and one `_ga_<id>` per measurement id. */
export function isStatisticsCookie(name: string): boolean {
  return name === "_ga" || name.startsWith("_ga_");
}

/**
 * What deletes a cookie of this host name wherever it was set: on the host name alone, on the host name as a domain and
 * on every domain above it. A cookie is only deleted with the domain it was set with, and that cannot be read back
 * everywhere. A domain the browser does not accept (a public suffix) changes nothing.
 */
export function deletions(name: string, host: string): string[] {
  const labels = host.split(".");
  const isAddress = host.includes(":") || /^[\d.]+$/.test(host);
  const domains = isAddress ? [] : labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
  return ["", ...domains.map((domain) => `; Domain=${domain}`)].map((domain) => `${name}=; Max-Age=0; Path=/${domain}`);
}

/**
 * A Google Analytics 4 measurement id (`G-XXXXXXXXXX`), or `undefined` when it is empty. Anything else is refused:
 * it goes into the page and into the address of a script.
 */
export function measurementId(value: string | undefined): string | undefined {
  const id = value?.trim().toUpperCase();
  if (!id) return undefined;
  if (!/^G-[A-Z0-9]{4,20}$/.test(id)) {
    throw new Error(`BRIM_GOOGLE_ANALYTICS_ID "${value?.trim()}" must be a measurement id, like G-XXXXXXXXXX.`);
  }
  return id;
}
