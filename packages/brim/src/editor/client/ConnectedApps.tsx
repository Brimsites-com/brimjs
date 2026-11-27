import { useEffect, useState } from "react";
import { type ConnectedApp, api } from "./api.ts";

/**
 * AI apps (ChatGPT, Claude…) that edit the site through its MCP, from the editor's menu: the address to paste into
 * the app, and the apps the user connected, each with a button that disconnects it at once. An owner sees everyone's.
 */
export function ConnectedApps({ onClose, owner }: { onClose: () => void; owner: boolean }) {
  const [mcp, setMcp] = useState("");
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .connections(owner)
      .then((answer) => {
        setMcp(answer.mcp);
        setApps(answer.connections);
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Could not load the apps."));
  }, [owner]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function disconnect(app: ConnectedApp): Promise<void> {
    setError("");
    try {
      await api.disconnect(app.id);
      setApps((current) => current?.filter((candidate) => candidate.id !== app.id) ?? null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not disconnect the app.");
    }
  }

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(mcp);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="brim-signin-again"
      role="dialog"
      aria-modal="true"
      aria-label="Connected apps"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="brim-login brim-connected-apps">
        <h1>Connected apps</h1>
        <p className="brim-login__hint">
          Edit the site by chatting with ChatGPT, Claude or another AI app. Add a connector (an MCP server) in the app
          with this address, then sign in here when it asks.
        </p>
        {mcp && (
          <div className="brim-connected-apps__address">
            <code>{mcp}</code>
            <button type="button" className="brim-login__link" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {error && (
          <p className="brim-login__error" role="alert">
            {error}
          </p>
        )}
        {apps === null && !error && <p className="brim-login__hint">Loading…</p>}
        {apps && apps.length === 0 && <p className="brim-login__hint">No app is connected yet.</p>}
        {apps && apps.length > 0 && (
          <ul className="brim-connected-apps__list">
            {apps.map((app) => (
              <li key={app.id}>
                <div>
                  <strong>{app.app}</strong>
                  <span className="brim-login__hint">
                    {[app.appHost, owner ? app.email : "", `last used ${when(app.lastUsedAt ?? app.createdAt)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <button type="button" className="brim-login__link" onClick={() => void disconnect(app)}>
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="cb-new-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
