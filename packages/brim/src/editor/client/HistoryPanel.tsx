import { useEffect, useState } from "react";
import { type HistoryEntry, api } from "./api.ts";
import { Sidebar } from "./Sidebar.tsx";

const ACTIONS: Record<HistoryEntry["action"], string> = {
  changed: "changed",
  reset: "reset to original",
  deleted: "deleted",
};
const TARGETS: Record<HistoryEntry["target"], string> = { node: "Element", item: "Item", page: "Page" };

/**
 * What changed lately on this page or on the whole site, newest first, with who changed it. "Restore" puts the
 * element, item or deleted page back to what it was before that change; restoring is a change too, so it can be
 * taken back in turn.
 */
export function HistoryPanel({
  path,
  onRestored,
  onClose,
}: {
  /** The page being edited, for "This page". */
  path: string;
  /** Called after a change was taken back, so the page is drawn again. */
  onRestored: (entry: HistoryEntry) => void;
  onClose: () => void;
}) {
  const [everywhere, setEverywhere] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = (): void => {
    api.history(everywhere ? undefined : path).then(
      (loaded) => setEntries(loaded.history),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
  };
  useEffect(load, [everywhere, path]);

  async function restore(entry: HistoryEntry): Promise<void> {
    setBusy(entry.id);
    setError("");
    try {
      await api.restoreHistory(entry.id);
      onRestored(entry);
      load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy("");
    }
  }

  return (
    <Sidebar title="History" onClose={onClose}>
      <p className="brim-sidebar-note">
        Changes of the last 90 days. Restore puts something back to what it was before that change.
      </p>
      <div className="cb-view-toggle brim-history__scope" role="group" aria-label="Which changes">
        <button type="button" aria-pressed={!everywhere} onClick={() => setEverywhere(false)}>
          This page
        </button>
        <button type="button" aria-pressed={everywhere} onClick={() => setEverywhere(true)}>
          Whole site
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {entries && entries.length === 0 && (
        <p className="brim-sidebar-note">
          {everywhere ? "Nothing was changed yet." : "Nothing was changed on this page yet."}
        </p>
      )}
      {entries && entries.length > 0 && (
        <ul className="brim-redirects brim-history">
          {entries.map((entry) => (
            <li key={entry.id} className="brim-redirects__row">
              <span className="brim-history__what">
                <strong>{entry.title}</strong>
                <span>
                  {TARGETS[entry.target]} {ACTIONS[entry.action]}
                  {everywhere && entry.page ? ` · ${entry.page}` : ""}
                </span>
                <span>
                  {entry.user} · {when(entry.at)}
                </span>
              </span>
              <button
                type="button"
                className="brim-toolbar-btn brim-toolbar-btn--outline"
                disabled={busy !== ""}
                onClick={() => void restore(entry)}
              >
                {busy === entry.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sidebar>
  );
}

/** "Today 14:05", or the date and time for an older change, as the browser writes them. */
function when(at: string): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === date.toDateString();
  return today ? `Today ${time}` : `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}
