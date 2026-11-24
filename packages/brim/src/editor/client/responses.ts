import type { FormResponse } from "./api.ts";

/** One form, as the owner reads its responses: under its name, wherever on the site it was filled in. */
export interface FormSummary {
  title: string;
  count: number;
  /** When its newest response came, ISO. */
  latest: string;
}

/**
 * The site's forms that have responses, newest first. A form is its name: the same form placed in a template (a
 * product's order form) is sent from every item's page, and its responses are still one list.
 */
export function formsOf(responses: FormResponse[]): FormSummary[] {
  const forms = new Map<string, FormSummary>();
  for (const response of responses) {
    const known = forms.get(response.title);
    if (!known) forms.set(response.title, { title: response.title, count: 1, latest: response.createdAt });
    else {
      known.count += 1;
      if (response.createdAt > known.latest) known.latest = response.createdAt;
    }
  }
  return [...forms.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}
