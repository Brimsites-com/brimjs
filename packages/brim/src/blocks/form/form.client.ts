/**
 * Sends a form to the site's server and shows the outcome in place.
 * The token is asked for when the visitor first touches the form, so by the time they send it
 * the server can tell a person from a script that posts straight away.
 */
const ENDPOINT = "/_brim/forms";
/** The hidden fields a challenge's widget fills (Turnstile, hCaptcha): sent as the challenge, never as an answer. */
const CAPTCHA_FIELDS = ["cf-turnstile-response", "h-captcha-response"];

/** The providers' own scripts, when the page loaded one. */
declare global {
  interface Window {
    turnstile?: { reset: (widget?: Element) => void };
    hcaptcha?: { reset: () => void };
  }
}

class BrimForm extends HTMLElement {
  #token: Promise<{ token: string; work: number }> | undefined;
  #step = 0;

  connectedCallback(): void {
    const form = this.querySelector("form");
    if (!form) return;
    this.#setUpConditions(form);
    this.#setUpSteps(form);
    form.addEventListener("focusin", () => this.#requestToken(), { once: true });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#submit(form);
    });
  }

  /**
   * A field with `data-show-when` (`{ field, equals }`) shows once that other field has one of those answers; hidden,
   * its inputs are disabled, so they are neither checked nor sent. A field that appears takes the focus.
   */
  #setUpConditions(form: HTMLFormElement): void {
    const dependent = [...form.querySelectorAll<HTMLElement>("[data-show-when]")];
    if (dependent.length === 0) return;
    const update = (focus: boolean) => {
      for (const field of dependent) {
        let condition: { field?: string; equals?: string[] } = {};
        try {
          condition = JSON.parse(field.dataset.showWhen ?? "{}");
        } catch {}
        const answers = [...form.elements]
          .filter(
            (element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
              "name" in element && (element as HTMLInputElement).name === condition.field,
          )
          .filter(
            (element) =>
              !(element instanceof HTMLInputElement) || !/radio|checkbox/.test(element.type) || element.checked,
          )
          .map((element) => element.value.trim());
        const shown = answers.some((answer) => condition.equals?.includes(answer));
        const appeared = shown && field.hidden;
        field.hidden = !shown;
        for (const input of field.querySelectorAll<HTMLInputElement>("input, select, textarea"))
          input.disabled = !shown;
        if (appeared && focus)
          field.querySelector<HTMLElement>("input:not([type=radio]):not([type=checkbox]), textarea, select")?.focus();
      }
    };
    form.addEventListener("change", () => update(true));
    update(false);
  }

  /**
   * A form asked in steps shows one `[data-step]` at a time. Continue and the tabs ahead check the steps they pass;
   * the consent and the send button (`[data-last-step]`) wait for the last step. Without this script every step shows.
   */
  #setUpSteps(form: HTMLFormElement): void {
    const panels = [...form.querySelectorAll<HTMLElement>("[data-step]")];
    if (panels.length < 2 || form.dataset.steps) return;
    form.dataset.steps = String(panels.length);
    this.setAttribute("data-stepping", "");
    const go = (target: number) => {
      for (let index = this.#step; index < target; index++) {
        if (!this.#valid(panels[index])) return this.#show(form, panels, index);
      }
      this.#show(form, panels, target);
    };
    // The editor shows the step its sidebar has open, without checking the steps before it.
    this.addEventListener("brim:show-step", (event) => this.#show(form, panels, Number((event as CustomEvent).detail)));
    form.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-go-step], [data-next-step], [data-back-step]",
      );
      if (!button || !form.contains(button)) return;
      if (button.hasAttribute("data-next-step")) go(this.#step + 1);
      else if (button.hasAttribute("data-back-step")) this.#show(form, panels, this.#step - 1);
      else go(Number(button.dataset.goStep));
    });
    // With `data-auto-advance`, a step that asks one single choice moves on once it is answered.
    form.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (!this.hasAttribute("data-auto-advance") || input.type !== "radio") return;
      const panel = panels[this.#step];
      if (!panel?.contains(input) || this.#step >= panels.length - 1) return;
      // Only when the step asks nothing else: a field that has just appeared waits for its answer.
      if ([...panel.querySelectorAll<HTMLElement>(".brim-form__field")].filter((field) => !field.hidden).length !== 1)
        return;
      const step = this.#step;
      // A moment to see the choice taken; a click elsewhere meanwhile wins.
      window.setTimeout(() => {
        if (this.#step === step) go(step + 1);
      }, 350);
    });
    // Enter in a one-line field moves on instead of sending half the form.
    form.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (event.key === "Enter" && target.tagName === "INPUT" && this.#step < panels.length - 1) {
        event.preventDefault();
        go(this.#step + 1);
      }
    });
    this.#show(form, panels, 0);
  }

  #valid(panel: HTMLElement | undefined): boolean {
    requireGroups(panel);
    return [...(panel?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [])].every((input) =>
      input.reportValidity(),
    );
  }

  #show(form: HTMLFormElement, panels: HTMLElement[], target: number): void {
    const index = Math.min(panels.length - 1, Math.max(0, Number.isFinite(target) ? target : 0));
    const last = index === panels.length - 1;
    this.#step = index;
    panels.forEach((panel, n) => {
      panel.hidden = n !== index;
    });
    for (const tab of form.querySelectorAll<HTMLElement>("[data-go-step]")) {
      const n = Number(tab.dataset.goStep);
      tab.setAttribute("aria-selected", String(n === index));
      tab.toggleAttribute("data-done", n < index);
    }
    for (const element of form.querySelectorAll<HTMLElement>("[data-last-step]")) element.hidden = !last;
    for (const element of form.querySelectorAll<HTMLElement>("[data-next-step]")) element.hidden = last;
    for (const element of form.querySelectorAll<HTMLElement>("[data-back-step]")) element.hidden = index === 0;
    this.style.setProperty("--brim-form-progress", `${((index + 1) / panels.length) * 100}%`);
    this.dataset.step = String(index);
    // For the site's CSS, e.g. content: attr(data-step-number) " / " attr(data-steps).
    this.dataset.stepNumber = String(index + 1);
    this.dataset.steps = String(panels.length);
  }

  /** The challenge's answer, when the form has a challenge. */
  #captcha(data: FormData): string | undefined {
    const field = CAPTCHA_FIELDS.find((name) => data.has(name));
    return field === undefined ? undefined : String(data.get(field) ?? "");
  }

  /** A challenge's answer is good once: after a failed sending the widget asks again. */
  #resetCaptcha(): void {
    const widget = this.querySelector(".brim-form__captcha");
    if (!widget) return;
    if (widget.classList.contains("cf-turnstile")) window.turnstile?.reset(widget);
    else window.hcaptcha?.reset();
  }

  /** Why a file input's files cannot be sent (too many, too large), or nothing. */
  #fileProblem(input: HTMLInputElement): string | undefined {
    const files = [...(input.files ?? [])];
    const label = input.closest(".brim-form__field")?.querySelector("label")?.textContent?.replace("*", "").trim();
    const maxFiles = Number(input.dataset.maxFiles) || 1;
    const maxBytes = Number(input.dataset.maxBytes) || Infinity;
    const name = label ? `"${label}"` : "This field";
    if (files.length > maxFiles) return `${name} takes at most ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`;
    if (files.some((file) => file.size > maxBytes)) {
      return `${name}: a file is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
    }
    return undefined;
  }

  /** A token, and the work the server asks for it, done while the visitor fills the form in. */
  #requestToken(): Promise<{ token: string; work: number }> {
    this.#token ??= fetch(`${ENDPOINT}/token`)
      .then((response) => response.json() as Promise<{ token?: string; work?: number }>)
      .then(async ({ token = "", work: bits = 0 }) => {
        // `data-working` while the browser works, for the site's CSS (it takes seconds while the site is under attack).
        this.toggleAttribute("data-working", true);
        try {
          return { token, work: await solve(token, bits) };
        } finally {
          this.removeAttribute("data-working");
        }
      });
    return this.#token;
  }

  async #submit(form: HTMLFormElement): Promise<void> {
    const error = this.querySelector<HTMLElement>(".brim-form__error");
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (form.dataset.steps) {
      // A step left wrong (its fields are hidden now) is shown with what is missing.
      const panels = [...form.querySelectorAll<HTMLElement>("[data-step]")];
      const wrong = panels.findIndex((panel) => panel.querySelector(":invalid") !== null);
      if (wrong !== -1) {
        this.#show(form, panels, wrong);
        this.#valid(panels[wrong]);
        return;
      }
    }
    requireGroups(form);
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const values: Record<string, string | boolean | string[]> = {};
    for (const element of form.elements) {
      if (!(
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ))
        continue;
      if (!element.name || element.name === "website" || element.name === "consent" || element.disabled) continue;
      if (CAPTCHA_FIELDS.includes(element.name)) continue;
      // Files travel as files, beside the answers.
      if (element instanceof HTMLInputElement && element.type === "file") continue;
      // The checkboxes of a field of several choices send the ones ticked, as a list.
      if (element.closest('.brim-form__field[data-type="checkboxes"]'))
        values[element.name] = data.getAll(element.name).map(String);
      else if (element instanceof HTMLInputElement && element.type === "checkbox")
        values[element.name] = element.checked;
      else values[element.name] = String(data.get(element.name) ?? "");
    }

    const fileInputs = [...form.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter(
      (input) => input.name && (input.files?.length ?? 0) > 0,
    );
    // Said here before anything is sent; the server checks the same, and what each file really is.
    const refused = fileInputs.map((input) => this.#fileProblem(input)).find(Boolean);
    if (refused) {
      if (error) {
        error.textContent = refused;
        error.hidden = false;
      }
      return;
    }

    if (button) button.disabled = true;
    if (error) error.hidden = true;
    try {
      const { token, work } = await this.#requestToken();
      const message = {
        spec: this.dataset.spec,
        signature: this.dataset.signature,
        trap: data.get("website"),
        consent: data.get("consent") === "on",
        ...(this.#captcha(data) !== undefined && { captcha: this.#captcha(data) }),
      };
      let request: RequestInit;
      if (fileInputs.length === 0) {
        request = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...message, token, work, values }),
        };
      } else {
        // A message with files is sent as a multipart form; its token and work go in headers, which the server checks
        // before it reads the files.
        const body = new FormData();
        body.set("spec", message.spec ?? "");
        body.set("signature", message.signature ?? "");
        body.set("trap", String(message.trap ?? ""));
        body.set("consent", String(message.consent));
        if (message.captcha !== undefined) body.set("captcha", message.captcha);
        body.set("values", JSON.stringify(values));
        for (const input of fileInputs) for (const file of input.files ?? []) body.append(input.name, file);
        request = { method: "POST", headers: { "x-brim-form-token": token, "x-brim-form-work": String(work) }, body };
      }
      const response = await fetch(`${ENDPOINT}/submit`, request);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(this.dataset.error || body.error || "Something went wrong. Please try again.");
      }
      form.hidden = true;
      const success = this.querySelector<HTMLElement>(".brim-form__success");
      if (success) success.hidden = false;
    } catch (failure) {
      // A token is good for one attempt; the next one gets a fresh token, and a fresh challenge.
      this.#token = undefined;
      this.#resetCaptcha();
      if (error) {
        error.textContent = failure instanceof Error ? failure.message : "Something went wrong. Please try again.";
        error.hidden = false;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }
}

/**
 * A required field of several choices needs one ticked: the browser has no such rule for a group of checkboxes, so
 * its first box carries the message while none is.
 */
function requireGroups(root: ParentNode | undefined): void {
  for (const group of root?.querySelectorAll<HTMLElement>(".brim-form__choices[data-required]") ?? []) {
    const boxes = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const none = !boxes.some((box) => box.checked);
    boxes.forEach((box, index) => box.setCustomValidity(none && index === 0 ? "Please choose at least one." : ""));
    if (group.dataset.watched) continue;
    group.dataset.watched = "";
    group.addEventListener("change", () => requireGroups(group.parentElement ?? undefined));
  }
}

/**
 * The number that, after the token, gives a SHA-256 starting with `bits` zero bits (forms/work.ts checks it). Hashes
 * are asked for in batches: the browser computes them off the page's thread, so typing stays smooth meanwhile.
 */
async function solve(token: string, bits: number): Promise<number> {
  const encoder = new TextEncoder();
  const BATCH = 256;
  for (let start = 0; start < 2 ** 32; start += BATCH) {
    const hashes = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => crypto.subtle.digest("SHA-256", encoder.encode(`${token}.${start + i}`))),
    );
    const found = hashes.findIndex((hash) => leadingZeroBits(new Uint8Array(hash)) >= bits);
    if (found !== -1) return start + found;
  }
  return 0;
}

function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte !== 0) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}

if (!customElements.get("brim-form")) customElements.define("brim-form", BrimForm);
