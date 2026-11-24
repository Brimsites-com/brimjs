import { CONSENT_KEY, type ConsentChoice, deletions, isStatisticsCookie, readChoice } from "./consent.ts";

/**
 * Asks the visitor once, keeps the answer in their browser and loads Google Analytics only after they accept.
 * Nothing is used for advertising. Taking consent back deletes the cookies, whatever domain they were set on, and
 * stops the counting at once.
 *
 * Cookies are asked to stay on this host name alone (`cookie_domain: none`). A Google tag made as a Tag Manager
 * container configures itself and ignores what the page asks, so its cookies land on the registrable domain unless the
 * tag itself says otherwise; where the browser can tell, a warning says so (docs/seo-and-pages.md).
 */
interface AnalyticsWindow extends Window {
  dataLayer?: unknown[];
  [disabled: `ga-disable-${string}`]: boolean | undefined;
}

const view = window as unknown as AnalyticsWindow;
/** The choice of this page when the browser keeps nothing (storage blocked). */
let unsaved: ConsentChoice | null = null;

function choice(): ConsentChoice | null {
  try {
    return readChoice(localStorage.getItem(CONSENT_KEY), Date.now()) ?? unsaved;
  } catch {
    return unsaved;
  }
}

function keep(statistics: boolean): void {
  unsaved = { statistics, at: Date.now() };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(unsaved));
  } catch {
    // Kept for this page only.
  }
}

/** The browser itself asks not to be followed: that is an answer, so the visitor is not asked again. */
const refusedByBrowser = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

// gtag.js reads what is pushed as `arguments`, not as an array.
function gtag(..._command: unknown[]): void {
  view.dataLayer ??= [];
  view.dataLayer.push(arguments);
}

function start(id: string): void {
  view[`ga-disable-${id}`] = false;
  if (document.querySelector("script[data-statistics]")) return;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
  gtag("js", new Date());
  gtag("config", id, {
    cookie_domain: "none",
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  warnOfSharedCookies();
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  script.dataset.statistics = "";
  document.head.append(script);
}

function stop(id: string): void {
  view[`ga-disable-${id}`] = true;
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0] ?? "";
    if (!isStatisticsCookie(name)) continue;
    for (const deletion of deletions(name, location.hostname)) document.cookie = deletion;
  }
}

/** Said once in the console: the tag set its cookies on a domain, where the sites next to this one see them too. */
function warnOfSharedCookies(): void {
  const store = (window as unknown as { cookieStore?: EventTarget }).cookieStore;
  if (!store) return;
  const heard = (event: Event) => {
    const { changed = [] } = event as Event & { changed?: { name?: string; domain?: string | null }[] };
    const shared = changed.find((cookie) => isStatisticsCookie(cookie.name ?? "") && cookie.domain);
    if (!shared) return;
    store.removeEventListener("change", heard);
    console.warn(
      `[brim] Google Analytics set ${shared.name} on ${shared.domain}, so other sites on that domain receive it. ` +
        'Set the tag\'s "cookie_domain" to "none" in Google Tag Manager to keep it on this host name.',
    );
  };
  store.addEventListener("change", heard);
}

class BrimAnalytics extends HTMLElement {
  connectedCallback(): void {
    const id = this.dataset.id;
    const banner = this.querySelector<HTMLElement>(".brim-consent");
    if (!id || !banner) return;
    const made = choice();
    if (made?.statistics) start(id);
    banner.hidden = made !== null || refusedByBrowser;

    for (const button of banner.querySelectorAll<HTMLElement>("[data-consent]")) {
      button.addEventListener("click", () => {
        const accepted = button.dataset.consent === "accept";
        keep(accepted);
        banner.hidden = true;
        if (accepted) start(id);
        else stop(id);
      });
    }
    for (const opener of document.querySelectorAll<HTMLElement>("[data-cookie-settings]")) {
      opener.hidden = false;
      opener.addEventListener("click", (event) => {
        event.preventDefault();
        banner.hidden = false;
        banner.querySelector<HTMLElement>("[data-consent]")?.focus();
      });
    }
  }
}

if (!customElements.get("brim-analytics")) customElements.define("brim-analytics", BrimAnalytics);
