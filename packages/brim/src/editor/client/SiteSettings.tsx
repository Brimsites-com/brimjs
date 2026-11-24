import { type ReactNode, useEffect, useState } from "react";
import {
  type ContentType,
  type MailSettings,
  type MailSettingsUpdate,
  type SiteSettingsView,
  type SmtpServerView,
  api,
} from "./api.ts";
import { ItemField } from "./ItemForm.tsx";
import { CheckboxWidget, TextWidget } from "./fields.tsx";
import { RedirectsSettings } from "./RedirectsSettings.tsx";
import { type FormSummary, formsOf } from "./responses.ts";
import { Fieldset, Sidebar } from "./Sidebar.tsx";

const DELIVERY: Record<MailSettings["delivery"], string> = {
  site: "Emails are sent from your own email server, set below.",
  server: "Emails are sent by the site's server. Nothing to set up.",
  service: "Emails are sent by your host. Nothing to set up.",
  none: "Emails are not set up yet: messages are only kept in Content → Form responses. Add your own email server below to receive them by email.",
};

type ServerDraft = Omit<SmtpServerView, "hasPassword"> & { password: string }; // betterleaks:allow

const EMPTY_SERVER: ServerDraft = { host: "", port: 587, secure: false, user: "", password: "", from: "" }; // betterleaks:allow

/**
 * Settings of the whole site. First the site's own (src/site-settings.ts: phone, email, social profiles…), which
 * anyone who edits content changes; then, for its owners, who gets an email when a visitor writes through a form,
 * the sender's name, the owner's own email server, and the site's redirects.
 */
export function SiteSettings({
  onClose,
  canManage = true,
  locale,
  focus,
  onSaved,
  onOpenResponses,
}: {
  onClose: () => void;
  /** Opens a form's responses in the content browser (all of them without a name); absent for who cannot read them. */
  onOpenResponses?: ((form?: string) => void) | undefined;
  /** A setting clicked on the page: its section opens and it is brought into view. */
  focus?: string | undefined;
  /** A setting was saved: the page is drawn again to show it. */
  onSaved?: (() => void) | undefined;
  /** Owners also see the form emails and the redirects. */
  canManage?: boolean;
  /** The language whose settings are shown: the page's. */
  locale?: string | undefined;
}) {
  if (!canManage) {
    return (
      <Sidebar title="Site Settings" onClose={onClose}>
        <OwnSettings locale={locale} focus={focus} onSaved={onSaved} />
        {onOpenResponses && <FormsSection onOpen={onOpenResponses} />}
      </Sidebar>
    );
  }
  return (
    <OwnerSettings
      onClose={onClose}
      locale={locale}
      focus={focus}
      onSaved={onSaved}
      forms={onOpenResponses && <FormsSection onOpen={onOpenResponses} />}
    />
  );
}

/**
 * The site's forms that visitors wrote through, each with how many messages and the newest's day: one opens its
 * messages in the content browser, under Form responses.
 */
function FormsSection({ onOpen }: { onOpen: (form?: string) => void }) {
  const [forms, setForms] = useState<FormSummary[] | null>(null);
  useEffect(() => {
    api.responses().then(
      ({ responses }) => setForms(formsOf(responses)),
      () => setForms([]),
    );
  }, []);
  const total = forms?.reduce((sum, form) => sum + form.count, 0) ?? 0;

  return (
    <Fieldset title="Forms">
      {forms === null ? (
        <p className="brim-sidebar-note">Loading…</p>
      ) : forms.length === 0 ? (
        <p className="brim-sidebar-note">No messages yet. What visitors send through the site's forms shows here.</p>
      ) : (
        <ul className="site-forms">
          {forms.map((form) => (
            <li key={form.title}>
              <button type="button" className="site-forms__row" onClick={() => onOpen(form.title)}>
                <span className="site-forms__title">{form.title}</span>
                <span className="site-forms__meta">
                  {form.count} {form.count === 1 ? "message" : "messages"} · last{" "}
                  {new Date(form.latest).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="field-group">
        <button type="button" className="url-browse-btn" onClick={() => onOpen()}>
          {total > 0 ? `All ${total} messages in Content` : "Open Form responses in Content"}
        </button>
      </div>
    </Fieldset>
  );
}

/** The roles whose users can be emailed every form message: those who may read the messages in the editor. */
const NOTIFIED_ROLES = [
  {
    role: "owner",
    label: "Email the site's owners",
    description: "Every owner of the site gets each message a visitor sends through a form.",
  },
  {
    role: "editor",
    label: "Email the site's editors",
    description: "Every editor of the site gets each message too.",
  },
] as const;

/** A pseudo content type for the site's settings, which the item fields' widgets take. */
const SETTINGS_TYPE = {
  key: "site_settings",
  label: "Site settings",
  singular: "Site settings",
  slug: "site-settings",
  fields: [],
  hasPage: false,
} as ContentType;

/**
 * The site's own settings, grouped as the site declared them, edited with the same widgets as an item's fields and
 * saved as soon as they change. Nothing shows when the site declares none.
 */
function OwnSettings({
  locale,
  focus,
  onSaved,
  onLoaded,
}: {
  locale?: string | undefined;
  focus?: string | undefined;
  onSaved?: (() => void) | undefined;
  /** Tells whether the site declares settings of its own, so the panel opens on them rather than form emails. */
  onLoaded?: ((declares: boolean) => void) | undefined;
}) {
  const [view, setView] = useState<SiteSettingsView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.siteSettings(locale).then(
      (loaded) => {
        setView(loaded);
        onLoaded?.(loaded.fields.length > 0);
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // The setting clicked on the page comes into view once its section is drawn.
  useEffect(() => {
    if (!view || !focus) return;
    document.getElementById(`site-setting-${focus}`)?.scrollIntoView({ block: "center" });
    document
      .querySelector<HTMLElement>(
        `#site-setting-${CSS.escape(focus)} input, #site-setting-${CSS.escape(focus)} textarea`,
      )
      ?.focus();
  }, [view, focus]);

  if (error) return <p className="field-error">{error}</p>;
  if (!view) return <p className="brim-sidebar-note">Loading…</p>;
  if (view.fields.length === 0) return null;

  async function change(name: string, value: unknown): Promise<void> {
    setError("");
    try {
      setView(await api.saveSiteSettings({ [name]: value ?? null }, locale));
      onSaved?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  const groups = [...new Set(view.fields.map((field) => field.group ?? "Site"))];
  const focusGroup = view.fields.find((field) => field.name === focus)?.group ?? (focus ? "Site" : undefined);
  return (
    <>
      {groups.map((group, index) => (
        <Fieldset key={group} title={group} open={focusGroup ? group === focusGroup : index === 0}>
          {view.fields
            .filter((field) => (field.group ?? "Site") === group)
            .map((field) => (
              <div key={field.name} id={`site-setting-${field.name}`}>
                <ItemField
                  type={SETTINGS_TYPE}
                  field={field}
                  value={view.values[field.name] ?? undefined}
                  onChange={(value) => void change(field.name, value)}
                />
              </div>
            ))}
        </Fieldset>
      ))}
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

function OwnerSettings({
  onClose,
  locale,
  focus,
  onSaved,
  forms,
}: {
  onClose: () => void;
  /** The site's forms and their messages, for who can read them. */
  forms?: ReactNode;
  locale?: string | undefined;
  focus?: string | undefined;
  onSaved?: (() => void) | undefined;
}) {
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [declares, setDeclares] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [ownServer, setOwnServer] = useState(false);
  const [server, setServer] = useState<ServerDraft>(EMPTY_SERVER);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.mail().then(
      (loaded) => {
        setSettings(loaded);
        setOwnServer(loaded.smtp !== null);
        if (loaded.smtp) setServer({ ...loaded.smtp, password: "" }); // betterleaks:allow
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, []);

  async function save(change: Partial<MailSettingsUpdate>): Promise<boolean> {
    if (!settings) return false;
    setError("");
    setNote("");
    const { delivery: _, smtp, ...current } = settings;
    try {
      const saved = await api.saveMail({
        ...current,
        smtp: smtp ? { ...smtp, password: "" } : null, // betterleaks:allow (empty keeps the saved one)
        ...change,
      });
      setSettings(saved);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  }

  async function saveServer(): Promise<void> {
    setBusy(true);
    if (await save({ smtp: server })) {
      setServer({ ...server, password: "" }); // betterleaks:allow
      setNote("Email server saved.");
    }
    setBusy(false);
  }

  async function sendTest(): Promise<void> {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const { sentTo } = await api.testMail();
      setNote(`A test email was sent to ${sentTo}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setBusy(false);
  }

  return (
    <Sidebar title="Site Settings" onClose={onClose}>
      {!settings ? (
        error ? (
          <p className="field-error">{error}</p>
        ) : (
          <p className="brim-sidebar-note">Loading…</p>
        )
      ) : (
        <>
          <OwnSettings locale={locale} focus={focus} onSaved={onSaved} onLoaded={setDeclares} />
          {forms}
          {/* One section is open at a time: the site's own settings come first when it declares some. */}
          <Fieldset title="Form emails" open={!declares && !focus}>
            <p className="brim-sidebar-note">{DELIVERY[settings.delivery]}</p>
            {NOTIFIED_ROLES.map(({ role, label, description }) => (
              <CheckboxWidget
                key={role}
                label={label}
                description={description}
                checked={settings.notifyRoles.includes(role)}
                onChange={(on) =>
                  void save({
                    notifyRoles: on
                      ? [...settings.notifyRoles, role]
                      : settings.notifyRoles.filter((chosen) => chosen !== role),
                  })
                }
              />
            ))}
            <p className="brim-sidebar-note">
              Writers are never emailed form messages: their role cannot read them in the editor either.
            </p>
            <TextWidget
              label="Also send to"
              description="More addresses that get every message, separated by commas."
              placeholder="office@example.com"
              value={settings.notify.join(", ")}
              onChange={(notify) => void save({ notify })}
            />
            <TextWidget
              label="Sender name"
              description="The name the emails come from. Empty uses the site's address."
              value={settings.senderName}
              onChange={(senderName) => void save({ senderName })}
            />
            {settings.delivery !== "none" && (
              <div className="field-group">
                <button type="button" className="url-browse-btn" disabled={busy} onClick={() => void sendTest()}>
                  Send a test email
                </button>
              </div>
            )}
          </Fieldset>
          <Fieldset title="Own email server" open={settings.smtp !== null}>
            <CheckboxWidget
              label="Send from my own email server"
              description="Emails then come from your own address. Your email provider gives these details (SMTP)."
              checked={ownServer}
              onChange={(checked) => {
                setOwnServer(checked);
                if (!checked && settings.smtp) void save({ smtp: null }).then(() => setServer(EMPTY_SERVER));
              }}
            />
            {ownServer && (
              <>
                <TextWidget
                  label="From address"
                  type="email"
                  placeholder="hello@yourcompany.com"
                  value={server.from}
                  onChange={(from) => setServer({ ...server, from })}
                />
                <TextWidget
                  label="Server address"
                  placeholder="smtp.yourcompany.com"
                  value={server.host}
                  onChange={(host) => setServer({ ...server, host })}
                />
                <TextWidget
                  label="Port"
                  description="Usually 587, or 465."
                  value={String(server.port)}
                  onChange={(port) => {
                    const value = Number(port) || 587;
                    setServer({ ...server, port: value, secure: value === 465 });
                  }}
                />
                <TextWidget label="Username" value={server.user} onChange={(user) => setServer({ ...server, user })} />
                <TextWidget
                  label="Password"
                  type="password"
                  description={settings.smtp?.hasPassword ? "Saved. Write a new one only to change it." : undefined}
                  placeholder={settings.smtp?.hasPassword ? "••••••••" : ""}
                  value={server.password}
                  onChange={(password) => setServer({ ...server, password })} // betterleaks:allow
                />
                <div className="field-group">
                  <button type="button" className="url-browse-btn" disabled={busy} onClick={() => void saveServer()}>
                    Save email server
                  </button>
                </div>
              </>
            )}
          </Fieldset>
          <RedirectsSettings />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {note && (
            <p className="brim-sidebar-note" role="status">
              {note}
            </p>
          )}
        </>
      )}
    </Sidebar>
  );
}
