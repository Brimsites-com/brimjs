import { type FormEvent, useEffect, useId, useState } from "react";
import { type Redirect, api } from "./api.ts";
import { CheckboxWidget } from "./fields.tsx";
import { TrashIcon } from "./icons.tsx";
import { Fieldset } from "./Sidebar.tsx";

/**
 * The site's redirects, in Site Settings: old addresses that send visitors and search engines to new ones. A page
 * added from a template gets one by itself when its address changes; these are the rest (a removed page, a short
 * link). They answer on the server; a static build has none.
 */
export function RedirectsSettings() {
  const id = useId();
  const [redirects, setRedirects] = useState<Redirect[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.redirects().then(
      (loaded) => setRedirects(loaded.redirects),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, []);

  async function save(next: Redirect[]): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      setRedirects((await api.setRedirects(next)).redirects);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!redirects) return;
    const redirect: Redirect = { from: from.trim(), to: to.trim(), ...(temporary && { temporary: true }) };
    if (await save([...redirects, redirect])) {
      setFrom("");
      setTo("");
      setTemporary(false);
    }
  }

  return (
    <Fieldset title="Redirects">
      <p className="field-description">
        Old addresses that send visitors, and search engines, to new ones. A page added from a template gets its own
        when you change its address.
      </p>
      {redirects && redirects.length > 0 && (
        <ul className="brim-redirects">
          {redirects.map((redirect) => (
            <li key={redirect.from} className="brim-redirects__row">
              <span className="brim-redirects__addresses">
                <code>{redirect.from}</code>
                <span aria-hidden="true">→</span>
                <code>{redirect.to}</code>
                {redirect.temporary && <span className="cb-badge">302</span>}
              </span>
              <button
                type="button"
                className="brim-toolbar-btn brim-toolbar-btn--icon"
                aria-label={`Remove the redirect from ${redirect.from}`}
                title="Remove redirect"
                disabled={busy}
                onClick={() => void save(redirects.filter((candidate) => candidate !== redirect))}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      {redirects && redirects.length === 0 && <p className="brim-sidebar-note">No redirects yet.</p>}
      <form className="brim-redirects__new" onSubmit={(event) => void add(event)}>
        <div className="field-group">
          <label className="field-label" htmlFor={`${id}-from`}>
            Old address
          </label>
          <input
            id={`${id}-from`}
            className="field-input"
            placeholder="/old-page"
            value={from}
            required
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor={`${id}-to`}>
            Goes to
          </label>
          <input
            id={`${id}-to`}
            className="field-input"
            placeholder="/new-page or https://…"
            value={to}
            required
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <CheckboxWidget
          label="Temporary (302)"
          description="Search engines keep listing the old address. Leave it off for a page that moved for good."
          checked={temporary}
          onChange={setTemporary}
        />
        <div className="field-group">
          <button type="submit" className="url-browse-btn" disabled={busy || !redirects}>
            Add redirect
          </button>
        </div>
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Fieldset>
  );
}
