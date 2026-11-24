import { type FormEvent, useEffect, useState } from "react";
import { type SiteInfo, type User, api, loadSiteInfo } from "./api.ts";

/**
 * `again` is the form shown over the editor when the session ran out while editing: the editor stays open behind it,
 * so a sign-in with the host opens in another tab and the owner comes back here to go on.
 */
export function Login({
  onSignedIn,
  again = false,
  resetToken,
}: {
  onSignedIn: (user: User) => void;
  again?: boolean;
  /** The token of a "forgot password" link: the form asks for the new password. */
  resetToken?: string | undefined;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [hostSignIn, setHostSignIn] = useState<SiteInfo["hostSignIn"]>(null);
  /** Signing in, asking for a link to set a new password, or setting it from that link. */
  const [mode, setMode] = useState<"sign-in" | "forgot" | "sent" | "reset">(resetToken ? "reset" : "sign-in");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSiteInfo().then((info) => setHostSignIn(info.hostSignIn ?? null));
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    try {
      onSignedIn((await api.signIn(email, password)).user);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not sign in.");
    }
  }

  /** After signing in with the host in another tab: the session it started is used here too. */
  async function goOn(): Promise<void> {
    setError("");
    try {
      onSignedIn((await api.session()).user);
    } catch {
      setError("Not signed in yet.");
    }
  }

  async function askForLink(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      setNotice((await api.forgotPassword(email)).message);
      setMode("sent");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not send the email.");
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { user } = await api.resetPassword(resetToken ?? "", password);
      // The link worked once: it leaves the address, so a reload or a shared screen does not show it.
      history.replaceState(null, "", location.pathname + location.search);
      onSignedIn(user);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not set the password.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "reset") {
    return (
      <form className="brim-login" onSubmit={setNewPassword}>
        <h1>Set a new password</h1>
        <p className="brim-login__note">It signs you out everywhere else.</p>
        <div className="field-group">
          <label className="field-label" htmlFor="brim-login-new-password">
            New password
          </label>
          <input
            id="brim-login-new-password"
            className="field-input"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="brim-login__hint">At least 10 characters.</p>
        </div>
        {error && (
          <p className="brim-login__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="cb-new-btn" disabled={busy}>
          Set password and sign in
        </button>
        <button type="button" className="brim-login__link" onClick={() => setMode("forgot")}>
          Ask for a new link
        </button>
      </form>
    );
  }

  if (mode === "forgot" || mode === "sent") {
    return (
      <form className="brim-login" onSubmit={askForLink}>
        <h1>Forgot your password?</h1>
        {mode === "sent" ? (
          <p className="brim-login__note" role="status">
            {notice} It works for an hour. Check your spam folder if it does not arrive.
          </p>
        ) : (
          <p className="brim-login__note">Write your email: we send you a link to set a new password.</p>
        )}
        <div className="field-group">
          <label className="field-label" htmlFor="brim-login-forgot-email">
            Email
          </label>
          <input
            id="brim-login-forgot-email"
            className="field-input"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {error && (
          <p className="brim-login__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="cb-new-btn" disabled={busy}>
          {mode === "sent" ? "Send again" : "Send the link"}
        </button>
        <button
          type="button"
          className="brim-login__link"
          onClick={() => {
            setError("");
            setMode("sign-in");
          }}
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form className="brim-login" onSubmit={submit}>
      <h1>{again ? "Sign in again" : "Sign in to edit"}</h1>
      {again && <p className="brim-login__note">You were signed out. Sign in to go on: nothing you changed is lost.</p>}
      <div className="field-group">
        <label className="field-label" htmlFor="brim-login-email">
          Email
        </label>
        <input
          id="brim-login-email"
          className="field-input"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="brim-login-password">
          Password
        </label>
        <input
          id="brim-login-password"
          className="field-input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && (
        <p className="brim-login__error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="cb-new-btn">
        Sign in
      </button>
      <button
        type="button"
        className="brim-login__link"
        onClick={() => {
          setError("");
          setMode("forgot");
        }}
      >
        Forgot password?
      </button>
      {hostSignIn && (
        <>
          <p className="brim-login__or">or</p>
          {/* The host checks who this is and, when they may sign in here, sends them back signed in. */}
          <a className="brim-login__host" href={hostSignIn.url} {...(again && { target: "_blank", rel: "noreferrer" })}>
            Continue with {hostSignIn.name}
          </a>
          {again && (
            <button type="button" className="brim-login__host brim-login__done" onClick={() => void goOn()}>
              I signed in, go on
            </button>
          )}
        </>
      )}
    </form>
  );
}

/**
 * Changing one's own password, from the editor's menu: the current one first, so a browser left signed in is not
 * enough to take the account. Every other session and access token ends; this one goes on.
 */
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.changePassword(current, password);
      setDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="brim-signin-again"
      role="dialog"
      aria-modal="true"
      aria-label="Change password"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="brim-login" onSubmit={submit}>
        <h1>Change password</h1>
        {done ? (
          <>
            <p className="brim-login__success" role="status">
              Your password is changed. You are signed out everywhere else, and access tokens made before stop working.
            </p>
            <button type="button" className="cb-new-btn" onClick={onClose} autoFocus>
              Done
            </button>
          </>
        ) : (
          <>
            <div className="field-group">
              <label className="field-label" htmlFor="brim-current-password">
                Current password
              </label>
              <input
                id="brim-current-password"
                className="field-input"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="brim-next-password">
                New password
              </label>
              <input
                id="brim-next-password"
                className="field-input"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="brim-login__hint">At least 10 characters. It signs you out everywhere else.</p>
            </div>
            {error && (
              <p className="brim-login__error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="cb-new-btn" disabled={busy}>
              Change password
            </button>
            <button type="button" className="brim-login__link" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </form>
    </div>
  );
}
