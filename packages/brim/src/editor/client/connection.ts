/**
 * Keeps the editor working while its server is away for a moment — restarting, or started again by a host that
 * stops it while nobody edits. A request that finds no server is asked again until one answers, and the editor
 * shows that it is waiting instead of failing.
 */

/** A proxy in front of the server answers these while the server itself is not there. */
const AWAY = new Set([502, 503, 504]);
/**
 * A proxy answers these when it could not reach the server at all. A 504 is different: the server may have taken
 * the request and been too slow to answer, so a request that adds something could be done twice.
 */
const NEVER_REACHED = new Set([502, 503]);
/** Asking twice changes nothing more than asking once, so these are safe to repeat after a lost connection. */
const REPEATABLE = new Set(["GET", "HEAD", "PUT", "DELETE"]);

export interface Waiting {
  /** How long to keep asking before giving up. */
  patienceMs?: number;
  /** The pause between two tries when the answer does not name one. */
  pauseMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

let waiting = 0;
const listeners = new Set<() => void>();

function change(by: number): void {
  const before = waiting > 0;
  waiting += by;
  if (before !== waiting > 0) for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: true while a request waits for the server to come back. */
export const connection = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  away: (): boolean => waiting > 0,
};

function pauseFrom(response: Response, fallback: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : fallback;
}

/**
 * `fetch`, patient with a server that is away: it asks again until the server answers or patience runs out, and
 * then hands back the last answer (or the last failure). `init()` builds the request anew for each try.
 *
 * Only a proxy's "not there" answer is asked again. The server's own errors are JSON (a mail server that refused,
 * a picture that could not be drawn) and are handed back as they are. A request that is safe to repeat is asked
 * again after a 502, 503 or 504 and after a broken connection. A request that would add something twice (a POST)
 * is asked again only after a 502 or 503, which the server never saw.
 */
export async function patientFetch(
  url: string,
  init: () => RequestInit = () => ({}),
  { patienceMs = 180_000, pauseMs = 2000, fetch: send = fetch, sleep = wait, now = Date.now }: Waiting = {},
): Promise<Response> {
  const deadline = now() + patienceMs;
  let marked = false;
  try {
    for (;;) {
      const request = init();
      const repeatable = REPEATABLE.has((request.method ?? "GET").toUpperCase());
      let pause = pauseMs;
      try {
        const response = await send(url, request);
        if (!fromProxy(response, repeatable) || now() >= deadline) return response;
        pause = pauseFrom(response, pauseMs);
        await response.body?.cancel();
      } catch (failure) {
        if (!repeatable || now() >= deadline) throw failure;
      }
      if (!marked) {
        marked = true;
        change(1);
      }
      await sleep(pause);
    }
  } finally {
    if (marked) change(-1);
  }
}

/** A proxy's answer that the server is not there, which is worth asking again for this request. */
function fromProxy(response: Response, repeatable: boolean): boolean {
  if (!(repeatable ? AWAY : NEVER_REACHED).has(response.status)) return false;
  return !(response.headers.get("content-type") ?? "").includes("application/json");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
