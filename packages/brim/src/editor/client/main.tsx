import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { type User, api, whenSignedOut } from "./api.ts";
import { connection } from "./connection.ts";
import { Editor } from "./Editor.tsx";
import { Login } from "./Login.tsx";
import "./editor.css";
import { startTheme } from "./theme.ts";

/** `undefined` while the session is being checked, `null` when nobody is signed in. */
type Session = User | null | undefined;

/** The token of a "forgot password" link, which carries it after `#` so it never reaches a server log. */
function resetTokenInAddress(): string | undefined {
  const match = /^#reset=([\w-]+)$/.exec(location.hash);
  return match?.[1];
}

function App() {
  const [user, setUser] = useState<Session>(undefined);
  const [resetToken, setResetToken] = useState(resetTokenInAddress);
  /** Set while the session ran out in the middle of editing: signing in again lets the waiting requests go on. */
  const [expired, setExpired] = useState<(() => void) | null>(null);

  useEffect(() => {
    api.session().then(
      ({ user: current }) => setUser(current),
      () => setUser(null),
    );
  }, []);

  // The editor stays open behind the sign-in form, so nothing typed or changed is lost while signing in again.
  const editing = Boolean(user);
  useEffect(() => {
    if (!editing) return;
    let waiting: Promise<void> | null = null;
    whenSignedOut(() => {
      waiting ??= new Promise<void>((resolve) =>
        setExpired(() => () => {
          waiting = null;
          setExpired(null);
          resolve();
        }),
      );
      return waiting;
    });
    return () => whenSignedOut(null);
  }, [editing]);

  return (
    <>
      {/* A reset link opens its form even for someone signed in already (on another account, or still). */}
      {resetToken && user !== undefined && (
        <Login
          resetToken={resetToken}
          onSignedIn={(next) => {
            setResetToken(undefined);
            setUser(next);
          }}
        />
      )}
      {!resetToken && user === null && <Login onSignedIn={setUser} />}
      {!resetToken && user && <Editor user={user} onSignedOut={() => setUser(null)} />}
      {!resetToken && user && expired && (
        <div className="brim-signin-again" role="dialog" aria-modal="true" aria-label="Sign in again">
          <Login
            again
            onSignedIn={(next) => {
              setUser(next);
              expired();
            }}
          />
        </div>
      )}
      <Reconnecting />
    </>
  );
}

/** Shown while a request waits for a server that is away (restarting, or stopped while nobody was editing). */
function Reconnecting() {
  const away = useSyncExternalStore(connection.subscribe, connection.away);
  if (!away) return null;
  return (
    <div className="brim-editor-reconnecting" role="status" aria-live="polite">
      <span className="brim-editor-reconnecting-dot" aria-hidden="true" />
      <span>
        <strong>The editor is starting again.</strong> It was paused while idle. It carries on by itself in a few
        seconds — nothing to reload.
      </span>
    </div>
  );
}

/** The editor follows the system's light or dark appearance, unless the user picked one in the ⋯ menu. */
startTheme();

const root = document.getElementById("brim-editor");
if (!root) throw new Error("The editor page is missing its root element.");
createRoot(root).render(<App />);
