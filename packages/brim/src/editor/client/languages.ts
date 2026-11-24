import { useEffect, useState } from "react";
import { localeOfPath, pathInLocale } from "../../server/locales.ts";
import { type SiteLocales, loadSiteInfo } from "./api.ts";

export { localeOfPath, pathInLocale };

/** The site's languages from its code; `null` until known and for a site with one language. */
export function useSiteLocales(): SiteLocales | null {
  const [locales, setLocales] = useState<SiteLocales | null>(null);
  useEffect(() => {
    let current = true;
    // A site that declares only its own language has nothing to switch to: no language menus at all.
    void loadSiteInfo().then(
      (info) => current && setLocales(info.locales && info.locales.locales.length > 1 ? info.locales : null),
    );
    return () => {
      current = false;
    };
  }, []);
  return locales;
}

/** An item's language as a code: "" means the default one. */
export function itemLocale(item: { locale: string }, locales: SiteLocales): string {
  return item.locale || locales.defaultLocale;
}

/** The item in every language it is written in, itself included, from the items of its type. */
export function translationsOf<T extends { id: string; translationOf: string | null }>(item: T, items: T[]): T[] {
  const original = item.translationOf ?? item.id;
  return items.filter((candidate) => (candidate.translationOf ?? candidate.id) === original);
}
