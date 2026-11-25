import { html, type SiteEmails } from "../src/mail/templates.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { Accounts } from "../src/auth/accounts.ts";
import { resolveMail } from "../src/config.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { type FormsHandler, createFormsHandler } from "../src/forms/handler.ts";
import { type FormSpec, encodeSpec, sealAddress, sign } from "../src/forms/spec.ts";
import { solveWork } from "../src/forms/work.ts";
import { FormStore } from "../src/forms/store.ts";
import { type MailMessage, Mailer, parseSmtpUrl } from "../src/mail/mailer.ts";
import type { SmtpServer } from "../src/mail/settings.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "https://acme.example";
const OWNER = "owner@example.test";
const EDITOR = "editor@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow
const SERVICE = "https://mail.example.test/sites/abc/mail";
const SERVICE_TOKEN = "mail-test-token"; // betterleaks:allow
const visitor = { clientAddress: "203.0.113.7" };

const contact: FormSpec = {
  form: "/contact#contact-form",
  title: "Contact",
  consentRequired: false,
  fields: [
    { name: "name", label: "Name", type: "text", required: false },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "message", label: "Message", type: "textarea", required: true },
  ],
};

interface ServiceCall {
  url: string;
  authorization: string | null;
  body: MailMessage;
}

let brim: Brim;
let serviceCalls: ServiceCall[];
let smtpCalls: { server: SmtpServer; from: string; message: MailMessage }[];
let serviceAnswer: () => Response;
let background: Promise<void>[];

const fakeService: typeof fetch = async (input, init) => {
  serviceCalls.push({
    url: String(input),
    authorization: new Headers(init?.headers).get("authorization"),
    body: JSON.parse(String(init?.body)) as MailMessage,
  });
  return serviceAnswer();
};

const fakeSmtp = async (server: SmtpServer, from: string, message: MailMessage): Promise<void> => {
  smtpCalls.push({ server, from, message });
};

function mailer(options: Parameters<typeof resolveMail>[0] = { url: SERVICE, token: SERVICE_TOKEN }): Mailer {
  return new Mailer(options, { fetch: fakeService, smtp: fakeSmtp });
}

function admin(mail = mailer()): AdminHandler {
  return createAdminHandler({ brim, assetsDirectory: new URL("../editor-dist/", import.meta.url), mailer: mail });
}

function forms(mail: Mailer | undefined = mailer(), emails?: SiteEmails, siteUrl: string | undefined = ORIGIN) {
  return createFormsHandler(brim, {
    mailer: mail,
    siteUrl: siteUrl || undefined,
    background: (work) => background.push(work),
    ...(emails && { emails: () => emails }),
  });
}

async function call(
  handler: AdminHandler | FormsHandler,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; server?: string; forwardedHost?: string } = {},
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (options.forwardedHost) {
    headers.set("x-forwarded-host", options.forwardedHost);
    headers.set("x-forwarded-proto", "https");
  }
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await handler(
    new Request(`${options.server ?? ORIGIN}${path}`, {
      method,
      headers,
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    }),
    visitor,
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

async function signIn(handler: AdminHandler, email = OWNER): Promise<string> {
  const response = await call(handler, "POST", "/admin/api/session", { body: { email, password: PASSWORD } }); // betterleaks:allow
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** Sends the contact form as a visitor would, and waits for the email to go out. */
async function sendForm(
  handler: FormsHandler,
  spec: FormSpec = contact,
  through: { server?: string; forwardedHost?: string } = {},
): Promise<Response> {
  const { token } = (await (await call(handler, "GET", "/_brim/forms/token", through)).json()) as { token: string };
  vi.advanceTimersByTime(5_000);
  const encoded = encodeSpec(spec);
  const response = await call(handler, "POST", "/_brim/forms/submit", {
    ...through,
    body: {
      spec: encoded,
      signature: sign(await brim.forms.secret(), encoded),
      token,
      work: solveWork(token),
      trap: "",
      values: { name: "Ana", email: "ana@visitor.test", message: "Hello <b>there</b>" },
    },
  });
  await Promise.all(background);
  return response;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-01T00:00:00Z") });
  const db = openDatabase(":memory:");
  await migrate(db);
  brim = {
    db,
    history: new HistoryStore(db),
    drafts: new DraftStore(db),
    content: new ContentStore(db),
    items: new ItemStore(db),
    forms: new FormStore(db),
    accounts: new Accounts(db),
  };
  await brim.accounts.createUser(OWNER, PASSWORD, "owner");
  await brim.accounts.createUser(EDITOR, PASSWORD, "editor");
  serviceCalls = [];
  smtpCalls = [];
  background = [];
  serviceAnswer = () => Response.json({ ok: true }, { status: 202 });
});

afterEach(() => vi.useRealTimers());

describe("a form message", () => {
  it("is emailed to the owners through the mail service, with Reply going to the visitor", async () => {
    expect((await sendForm(forms())).status).toBe(200);

    expect(serviceCalls).toHaveLength(1);
    const [sent] = serviceCalls;
    expect(sent?.url).toBe(SERVICE);
    expect(sent?.authorization).toBe(`Bearer ${SERVICE_TOKEN}`);
    expect(sent?.body).toMatchObject({
      to: [OWNER],
      replyTo: "ana@visitor.test",
      subject: "New message from Contact on acme.example",
      fromName: "acme.example",
    });
    expect(sent?.body.text).toContain("Hello <b>there</b>");
    // The visitor's words are text in the HTML, never markup.
    expect(sent?.body.html).toContain("Hello &#60;b&#62;there&#60;/b&#62;");
    expect(sent?.body.html).not.toContain("<b>there</b>");
  });

  it("says which page it was sent from: the product a template's order form is about", async () => {
    const order = { ...contact, form: "/produse/ceramica/marazzi-art#comanda-form", title: "Comandă produs" };
    await sendForm(forms(), order);

    const body = serviceCalls[0]?.body;
    expect(body?.text).toMatch(/Sent from: https?:\/\/[^/\s]+\/produse\/ceramica\/marazzi-art\n/);
    expect(body?.html).toMatch(/Sent from <a href="https?:\/\/[^"/]+\/produse\/ceramica\/marazzi-art"/);
    // A form declared by name has no page to name.
    serviceCalls = [];
    await sendForm(forms(), { ...contact, form: "newsletter" });
    expect(serviceCalls[0]?.body.text).not.toContain("Sent from");
  });

  it("names the site's public address, never the server's own behind a proxy", async () => {
    const order = { ...contact, form: "/produse/marazzi-art#comanda-form", title: "Comandă produs" };
    await sendForm(forms(), order, { server: "http://localhost:43967", forwardedHost: "acme.example" });
    const body = serviceCalls[0]?.body;
    expect(body?.subject).toBe("New message from Comandă produs on acme.example");
    expect(body?.fromName).toBe("acme.example");
    expect(body?.text).toContain("Sent from: https://acme.example/produse/marazzi-art");
    expect(body?.text).toContain("All messages: https://acme.example/admin/edit");
    expect(JSON.stringify(body)).not.toContain("localhost");

    // The address its host gives it (BRIM_SITE_URL, its own domain) wins.
    process.env.BRIM_SITE_URL = "https://www.studionord.test/";
    try {
      serviceCalls = [];
      await sendForm(forms(), order, { server: "http://localhost:43967", forwardedHost: "acme.example" });
      expect(serviceCalls[0]?.body.subject).toBe("New message from Comandă produs on www.studionord.test");
      expect(serviceCalls[0]?.body.text).toContain("Sent from: https://www.studionord.test/produse/marazzi-art");
    } finally {
      delete process.env.BRIM_SITE_URL;
    }
  });

  it("has no link where whoever wrote could choose its address, and says to open the editor", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const order = { ...contact, form: "/produse/marazzi-art#comanda-form", title: "Comandă produs" };
    // The same message, its sender naming another host: with the site's address set, and without.
    const forged = { server: ORIGIN, forwardedHost: "acme.example" };
    await sendForm(forms(mailer(), undefined, "https://www.studionord.test"), order, forged);
    expect(JSON.stringify(serviceCalls[0]?.body)).toContain("https://www.studionord.test/admin/edit?response=");
    expect(JSON.stringify(serviceCalls[0]?.body)).not.toContain("acme.example");

    serviceCalls = [];
    let seen: { site: string; siteUrl: string; responsesUrl: string; responseUrl: string } | undefined;
    const emails: SiteEmails = {
      form: (email) => {
        seen = email;
        return undefined as never;
      },
    };
    await sendForm(forms(mailer(), emails, ""), order, forged);
    const body = serviceCalls[0]?.body;
    expect(body?.subject).toBe("New message from Comandă produs on the site");
    expect(body?.text).toContain("Read it in the site's editor.");
    expect(`${body?.text}${body?.html}`).not.toMatch(/https?:/);
    expect(seen).toMatchObject({ site: "the site", siteUrl: "", responsesUrl: "", responseUrl: "" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("is written by the site's template when it has one, and previewed in the editor's API", async () => {
    const emails: SiteEmails = {
      form: (email) => ({
        subject: `Cerere nouă: ${email.form}`,
        html: html`<h1>${email.form}</h1><p>${email.page ?? ""}</p>${email.answers.map((a) => html`<p>${a.label}: ${a.value}</p>`)}`,
      }),
    };
    await sendForm(forms(mailer(), emails), { ...contact, form: "/produse/marazzi#comanda", title: "Comandă" });
    const body = serviceCalls[0]?.body;
    expect(body?.subject).toBe("Cerere nouă: Comandă");
    expect(body?.html).toContain("<h1>Comandă</h1><p>https://acme.example/produse/marazzi</p>");
    expect(body?.html).toContain("Message: Hello &#60;b&#62;there&#60;/b&#62;");
    // The text version is still Brim's, made from the answers; Reply still goes to the visitor.
    expect(body?.text).toContain("Hello <b>there</b>");
    expect(body?.replyTo).toBe("ana@visitor.test");

    const site = createAdminHandler({
      brim,
      assetsDirectory: new URL("../editor-dist/", import.meta.url),
      mailer: mailer(),
      emails: () => emails,
    });
    const cookie = await signIn(site);
    expect((await call(site, "GET", "/admin/api/emails/form")).status).toBe(401);
    const preview = await call(site, "GET", "/admin/api/emails/form", { cookie });
    expect(preview.headers.get("content-type")).toContain("text/html");
    expect(preview.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await preview.text()).toContain("<h1>Comandă</h1>");
    const text = await (await call(site, "GET", "/admin/api/emails/form?text", { cookie })).text();
    expect(text).toMatch(/^Subject: Cerere nouă: Comandă\n/);
  });

  it("also goes to the addresses in Site Settings and the form's own, once each", async () => {
    const site = admin();
    await call(site, "PUT", "/admin/api/mail", {
      cookie: await signIn(site),
      body: { notifyOwners: true, notify: "office@acme.example, OWNER@example.test", senderName: "Acme" },
    });

    await sendForm(forms(), { ...contact, notify: "sales@acme.example,office@acme.example" });

    expect(serviceCalls[0]?.body.to).toEqual([OWNER, "office@acme.example", "sales@acme.example"]);
    expect(serviceCalls[0]?.body.fromName).toBe("Acme");
  });

  it("goes to the form's own address when the page carries it sealed", async () => {
    const sealed = sealAddress(await brim.forms.secret(), "sales@acme.example");
    expect(sealed).not.toContain("sales");

    await sendForm(forms(), { ...contact, notify: sealed });

    expect(serviceCalls[0]?.body.to).toEqual([OWNER, "sales@acme.example"]);
  });

  it("is kept but not emailed once the site has sent its emails for the day", async () => {
    // The day's 300 emails were sent already.
    const now = Math.floor(Date.now() / 1000);
    await brim.db.query("INSERT INTO brim_rate_limits (key, window_start, count) VALUES (?, ?, ?)", [
      "form:site-emails",
      now - (now % (24 * 60 * 60)),
      300,
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await sendForm(forms())).status).toBe(200);
    expect(await brim.forms.list()).toHaveLength(1);
    expect(serviceCalls).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("goes to every user of the roles Site Settings chose, leaving out a role it does not know", async () => {
    const site = admin();
    const cookie = await signIn(site);
    const saved = await call(site, "PUT", "/admin/api/mail", {
      cookie,
      body: { notifyRoles: ["owner", "editor", "writer"], notify: [], senderName: "" },
    });
    expect(((await saved.json()) as { notifyRoles: string[] }).notifyRoles).toEqual(["owner", "editor"]);

    await sendForm(forms());

    expect(serviceCalls[0]?.body.to).toEqual([OWNER, EDITOR]);
  });

  it("emails no user when no role is chosen, only the addresses given", async () => {
    const site = admin();
    await call(site, "PUT", "/admin/api/mail", {
      cookie: await signIn(site),
      body: { notifyRoles: [], notify: "office@acme.example", senderName: "" },
    });

    await sendForm(forms());

    expect(serviceCalls[0]?.body.to).toEqual(["office@acme.example"]);
  });

  it("reads the settings saved before roles, and a client that sends only notifyOwners keeps the other roles", async () => {
    await brim.db.query("INSERT INTO brim_meta (key, value) VALUES ('mail_settings', ?)", [
      JSON.stringify({ notifyOwners: false, notify: [], senderName: "", smtp: null }),
    ]);
    const site = admin();
    const cookie = await signIn(site);
    const read = (await (await call(site, "GET", "/admin/api/mail", { cookie })).json()) as Record<string, unknown>;
    expect(read).toMatchObject({ notifyRoles: [], notifyOwners: false });

    await call(site, "PUT", "/admin/api/mail", {
      cookie,
      body: { notifyRoles: ["editor"], notify: [], senderName: "" },
    });
    const older = await call(site, "PUT", "/admin/api/mail", {
      cookie,
      body: { notifyOwners: true, notify: [], senderName: "" },
    });
    expect(((await older.json()) as { notifyRoles: string[] }).notifyRoles).toEqual(["owner", "editor"]);
  });

  it("is still saved when the email cannot be sent", async () => {
    serviceAnswer = () => Response.json({ error: "No." }, { status: 500 });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await sendForm(forms())).status).toBe(200);
    expect(await brim.forms.list()).toHaveLength(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("is only saved when the site has no way to send email", async () => {
    expect((await sendForm(forms(new Mailer({}, { fetch: fakeService, smtp: fakeSmtp })))).status).toBe(200);
    expect(await brim.forms.list()).toHaveLength(1);
    expect(serviceCalls).toEqual([]);
  });

  it("goes through the owner's own server once one is set, from its address", async () => {
    const site = admin();
    await call(site, "PUT", "/admin/api/mail", {
      cookie: await signIn(site),
      body: {
        notifyOwners: true,
        notify: [],
        senderName: "Acme",
        smtp: { host: "smtp.acme.example", port: 465, user: "hello@acme.example", password: "app-password", from: "hello@acme.example" }, // betterleaks:allow
      },
    });

    await sendForm(forms());

    expect(serviceCalls).toEqual([]);
    expect(smtpCalls).toHaveLength(1);
    expect(smtpCalls[0]).toMatchObject({
      from: "hello@acme.example",
      server: { host: "smtp.acme.example", port: 465, secure: true, user: "hello@acme.example" },
    });
  });

  it("goes through an SMTP server given to the server, from its sender", async () => {
    await sendForm(forms(mailer({ smtp: "smtps://mailer:secret@smtp.host.test:465", from: "Host <no-reply@host.test>" }))); // betterleaks:allow

    expect(smtpCalls[0]).toMatchObject({
      from: "Host <no-reply@host.test>",
      server: { host: "smtp.host.test", port: 465, secure: true, user: "mailer" },
    });
  });
});

describe("Site Settings for email", () => {
  it("does not carry the saved password to another email server", async () => {
    const site = admin();
    const cookie = await signIn(site);
    const server = { host: "smtp.acme.example", port: 587, user: "u", from: "hello@acme.example" };
    await call(site, "PUT", "/admin/api/mail", { cookie, body: { smtp: { ...server, password: "app-password" } } }); // betterleaks:allow

    const moved = await call(site, "PUT", "/admin/api/mail", { cookie, body: { smtp: { ...server, host: "smtp.elsewhere.example", password: "" } } }); // betterleaks:allow
    expect(moved.status).toBe(422);
    expect(((await moved.json()) as { error: string }).error).toMatch(/Type the password again/);
    const otherPort = await call(site, "PUT", "/admin/api/mail", { cookie, body: { smtp: { ...server, port: 2525, password: "" } } }); // betterleaks:allow
    expect(otherPort.status).toBe(422);

    // With its own password the new server is saved.
    const typed = await call(site, "PUT", "/admin/api/mail", { cookie, body: { smtp: { ...server, host: "smtp.elsewhere.example", password: "other-password" } } }); // betterleaks:allow
    expect(typed.status).toBe(200);
  });

  it("never shows the saved password, and keeps it when the editor sends none", async () => {
    const site = admin();
    const cookie = await signIn(site);
    const server = { host: "smtp.acme.example", port: 587, user: "u", from: "hello@acme.example" };
    await call(site, "PUT", "/admin/api/mail", { cookie, body: { smtp: { ...server, password: "app-password" } } }); // betterleaks:allow

    const shown = (await (await call(site, "PUT", "/admin/api/mail", { cookie, body: { senderName: "Acme", smtp: { ...server, password: "" } } })).json()) as Record<string, unknown>; // betterleaks:allow
    expect(JSON.stringify(shown)).not.toContain("app-password");
    expect(shown).toMatchObject({ delivery: "site", senderName: "Acme", smtp: { host: "smtp.acme.example", hasPassword: true } });

    await sendForm(forms());
    expect(smtpCalls[0]?.server.password).toBe("app-password"); // betterleaks:allow
  });

  it("says who sends, without telling anything of the server's own setup", async () => {
    const site = admin(mailer({ smtp: "smtps://mailer:secret@smtp.host.test:465", from: "no-reply@host.test", url: SERVICE, token: SERVICE_TOKEN })); // betterleaks:allow
    const body = await (await call(site, "GET", "/admin/api/mail", { cookie: await signIn(site) })).text();

    expect(JSON.parse(body)).toMatchObject({ delivery: "server", smtp: null });
    for (const hidden of ["secret", "smtp.host.test", "no-reply@host.test", SERVICE, SERVICE_TOKEN]) {
      expect(body).not.toContain(hidden);
    }
  });

  it("are the owners' only", async () => {
    const site = admin();
    const cookie = await signIn(site, EDITOR);
    expect((await call(site, "GET", "/admin/api/mail", { cookie })).status).toBe(403);
    expect((await call(site, "PUT", "/admin/api/mail", { cookie, body: { notify: "x@y.test" } })).status).toBe(403);
  });

  it("refuse an address that is not one", async () => {
    const site = admin();
    const response = await call(site, "PUT", "/admin/api/mail", { cookie: await signIn(site), body: { notify: "not an address" } });
    expect(response.status).toBe(422);
  });

  it("send a test email to the owner asking", async () => {
    const site = admin();
    const response = await call(site, "POST", "/admin/api/mail/test", { cookie: await signIn(site) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sentTo: OWNER });
    expect(serviceCalls[0]?.body).toMatchObject({ to: [OWNER], subject: "Test email from acme.example" });
  });
});

describe("the server's email setup", () => {
  afterEach(() => {
    delete process.env.BRIM_SMTP_URL;
    delete process.env.BRIM_MAIL_URL;
  });

  it("is read from the environment, which wins over the config", () => {
    process.env.BRIM_SMTP_URL = "smtp://a:b@env.test:2525"; // betterleaks:allow
    process.env.BRIM_MAIL_URL = "https://env.test/mail";
    expect(resolveMail({ smtp: "smtp://config.test", url: "https://config.test/mail", from: "x@config.test" })).toEqual({
      smtp: "smtp://a:b@env.test:2525", // betterleaks:allow
      url: "https://env.test/mail",
      from: "x@config.test",
      token: undefined,
    });
  });

  it("reads SMTP addresses with their user and password", () => {
    expect(parseSmtpUrl("smtp://user%40x.test:p%40ss@smtp.x.test")).toEqual({ // betterleaks:allow
      host: "smtp.x.test",
      port: 587,
      secure: false,
      user: "user@x.test",
      password: "p@ss", // betterleaks:allow
    });
    expect(parseSmtpUrl("https://not-smtp.test")).toBeUndefined();
  });
});
