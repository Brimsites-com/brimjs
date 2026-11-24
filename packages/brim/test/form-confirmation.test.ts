import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { HistoryStore } from "../src/content/history.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { defineForm } from "../src/forms/define.ts";
import { type FormsHandler, type FormsOptions, createFormsHandler } from "../src/forms/handler.ts";
import { type FormSpec, encodeSpec, sealAddress, sign } from "../src/forms/spec.ts";
import { solveWork } from "../src/forms/work.ts";
import { FormStore } from "../src/forms/store.ts";
import { type MailMessage, Mailer, headerText, safeMessage } from "../src/mail/mailer.ts";
import { MailSettingsStore } from "../src/mail/settings.ts";
import { type SiteEmails, html } from "../src/mail/templates.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { RateLimiter } from "../src/server/rate-limit.ts";

const ORIGIN = "https://acme.example";
const OWNER = "owner@example.test";
const DAY = 24 * 60 * 60;

const contact: FormSpec = {
  form: "/contact#contact-form",
  title: "Contact",
  consentRequired: false,
  fields: [
    { name: "name", label: "Name", type: "text", required: false },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "message", label: "Message", type: "textarea", required: true },
  ],
  confirm: { field: "email", subject: "Am primit mesajul tău", message: "Mulțumim!\nRevenim în curând." },
};

let brim: Brim;
let mails: MailMessage[];
let background: Promise<void>[];
let serviceAnswer: () => Response;

function mailer(): Mailer {
  return new Mailer(
    { url: "https://mail.example.test/send" },
    {
      fetch: async (_input, init) => {
        mails.push(JSON.parse(String(init?.body)) as MailMessage);
        return serviceAnswer();
      },
    },
  );
}

function forms(options: FormsOptions = {}): FormsHandler {
  return createFormsHandler(brim, { mailer: mailer(), background: (work) => background.push(work), ...options });
}

beforeEach(async () => {
  // Limits are counted in fixed windows of the clock, so the tests start at the beginning of one.
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
  await brim.accounts.createUser(OWNER, "correct horse battery", "owner"); // betterleaks:allow
  mails = [];
  background = [];
  serviceAnswer = () => new Response(null, { status: 202 });
});

afterEach(() => vi.useRealTimers());

/** Sends the form as a visitor would and waits for its emails. */
async function send(
  handler: FormsHandler,
  values: Record<string, unknown> = {},
  options: { spec?: FormSpec; trap?: string; clientAddress?: string } = {},
): Promise<Response> {
  const info = { clientAddress: options.clientAddress ?? "203.0.113.7" };
  // The work asked grows with the messages tried on the site; these tests are about other limits.
  await brim.db.query("DELETE FROM brim_rate_limits WHERE key LIKE 'form:attempts%'");
  const issued = (await (
    await handler(new Request(`${ORIGIN}/_brim/forms/token`, { headers: { origin: ORIGIN } }), info)
  )?.json()) as { token: string };
  vi.advanceTimersByTime(5_000);
  const spec = encodeSpec(options.spec ?? contact);
  const response = await handler(
    new Request(`${ORIGIN}/_brim/forms/submit`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        spec,
        signature: sign(await brim.forms.secret(), spec),
        token: issued.token,
        work: solveWork(issued.token),
        trap: options.trap ?? "",
        values: { name: "Ana", email: "ana@example.test", message: "Aș dori o ofertă.", ...values },
      }),
    }),
    info,
  );
  await Promise.all(background);
  if (!response) throw new Error("The form was not handled.");
  return response;
}

const toVisitor = (): MailMessage[] => mails.filter((mail) => !mail.to.includes(OWNER));
const toOwner = (): MailMessage[] => mails.filter((mail) => mail.to.includes(OWNER));

describe("a confirmation", () => {
  it("is not sent unless the form's owner turned it on", async () => {
    const { confirm: _confirm, ...plain } = contact;
    expect((await send(forms(), {}, { spec: plain })).status).toBe(200);

    expect(toOwner()).toHaveLength(1);
    expect(toVisitor()).toEqual([]);
  });

  it("goes once, to the address in the form's email field, in the owner's words and the site's name", async () => {
    await new MailSettingsStore(brim.db).update({ notify: "office@acme.example" });
    await send(forms({ siteName: "Acme Studio" }));

    expect(toVisitor()).toHaveLength(1);
    const [mail] = toVisitor();
    expect(mail).toMatchObject({
      to: ["ana@example.test"],
      subject: "Am primit mesajul tău",
      fromName: "Acme Studio",
      // Replies go to the site, never to anything a visitor wrote.
      replyTo: "office@acme.example",
    });
    expect(mail?.text).toContain("Mulțumim!\nRevenim în curând.");
    // The owner still hears about the message, with the visitor as "Reply".
    expect(toOwner()[0]).toMatchObject({ replyTo: "ana@example.test" });
  });

  it("says nothing the visitor typed: a stranger cannot make the site write their words to someone", async () => {
    await send(forms(), {
      name: "Click https://evil.example/login",
      message: "Your account is locked. Visit https://evil.example",
    });

    const [mail] = toVisitor();
    for (const part of [mail?.subject, mail?.text, mail?.html, mail?.fromName]) {
      expect(part).not.toContain("evil.example");
      expect(part).not.toContain("locked");
    }
  });

  it("repeats the answers only when the owner asked, as text and cut short", async () => {
    const withAnswers = { ...contact, confirm: { ...contact.confirm!, answers: true } };
    await send(forms(), { message: `<a href="https://x.example">${"x".repeat(5_000)}</a>` }, { spec: withAnswers });

    const [mail] = toVisitor();
    expect(mail?.text).toContain("Name:\nAna");
    expect(mail?.html).toContain("&#60;a href=");
    expect(mail?.html).not.toContain("<a href");
    // 300 characters of one answer at most.
    expect(mail?.text).not.toContain("x".repeat(301));
  });

  it("replies to the form's own notification address before Site Settings'", async () => {
    await new MailSettingsStore(brim.db).update({ notify: "office@acme.example" });
    const notify = sealAddress(await brim.forms.secret(), "sales@acme.example, second@acme.example");
    await send(forms(), {}, { spec: { ...contact, notify } });

    expect(toVisitor()[0]?.replyTo).toBe("sales@acme.example");
  });

  it("has no Reply-To when the site named no address of its own, never the owner's sign-in address", async () => {
    await send(forms());

    expect(toVisitor()[0]?.replyTo).toBeUndefined();
  });
});

describe("who a confirmation can go to", () => {
  it("only an email field of the form: a field of another kind names no one", async () => {
    const wrong = { ...contact, confirm: { ...contact.confirm!, field: "name" } };
    await send(forms(), { name: "victim@example.test" }, { spec: wrong });

    expect(toVisitor()).toEqual([]);
    expect(await brim.forms.list()).toHaveLength(1);
  });

  it("only what the signed form says: a visitor cannot add a confirmation or change its words", async () => {
    const handler = forms();
    const { confirm: _confirm, ...plain } = contact;
    const forged = encodeSpec({ ...plain, confirm: { field: "email", subject: "Hi", message: "Buy now" } });
    const response = await handler(
      new Request(`${ORIGIN}/_brim/forms/submit`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          spec: forged,
          signature: sign(await brim.forms.secret(), encodeSpec(plain)),
          values: {},
        }),
      }),
      { clientAddress: "203.0.113.7" },
    );

    expect(response?.status).toBe(400);
    expect(mails).toEqual([]);
  });

  it("one address only: a list, a name with an address, or a line end is no recipient", async () => {
    const handler = forms();
    // Refused as not an email address at all.
    for (const email of [
      "victim@example.test\r\nBcc: everyone@example.test",
      "a@example.test, b@example.test",
      "Victim <victim@example.test>",
    ]) {
      const response = await send(handler, { email });
      expect(response.status, JSON.stringify(email)).toBe(422);
      vi.advanceTimersByTime(3 * 60 * 1000);
    }
    expect(mails).toEqual([]);
    expect(await brim.forms.list()).toEqual([]);

    // Passes the form's own loose check, but is not one plain address: kept for the owner, confirmed to no one.
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect((await send(handler, { email: "a,b@example.test" })).status).toBe(200);
    expect(await brim.forms.list()).toHaveLength(1);
    expect(toVisitor()).toEqual([]);
  });
});

describe("headers", () => {
  it("a subject or a sender's name is one clean line, whoever wrote it", () => {
    expect(headerText("Hello\r\nBcc: all@example.test")).toBe("Hello Bcc: all@example.test");
    expect(headerText("a b\u0000c\u0085d")).toBe("a b c d");
    expect(headerText("x".repeat(500))).toHaveLength(200);

    const safe = safeMessage({
      to: ["ana@example.test", "bad\r\nBcc: x@example.test", "Name <n@example.test>", "a@example.test,b@example.test"],
      replyTo: "office@acme.example\r\nBcc: x@example.test",
      subject: "Thanks\r\nBcc: all@example.test\r\n\r\n<html>",
      fromName: 'Acme" <attacker@evil.example>\r\nX-Injected: 1',
      text: "text",
      html: "<p>html</p>",
    });
    expect(safe.to).toEqual(["ana@example.test"]);
    expect(safe.replyTo).toBeUndefined();
    expect(safe.subject).toBe("Thanks Bcc: all@example.test <html>");
    expect(safe.fromName).toBe("Acme attacker@evil.example X-Injected: 1");
    for (const header of [safe.subject, safe.fromName, ...safe.to]) expect(header).not.toMatch(/[\r\n]/);
    expect(() => safeMessage({ ...safe, to: ["not an address"] })).toThrow("no valid recipient");
  });

  it("a confirmation's subject and sender carry no line end, from the form or from the site's template", async () => {
    const emails: SiteEmails = {
      confirmation: () => ({
        subject: "Mulțumim\r\nBcc: x@example.test",
        fromName: "Acme\r\nReply-To: x@example.test",
      }),
    };
    const injected = { ...contact, confirm: { ...contact.confirm!, subject: "Hi\r\nBcc: all@example.test" } };
    await send(forms(), {}, { spec: injected });
    vi.advanceTimersByTime(60_000);
    await send(forms({ emails: () => emails }), { email: "dan@example.test" });

    expect(toVisitor()).toHaveLength(2);
    for (const mail of toVisitor()) {
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.fromName).not.toMatch(/[\r\n]/);
      expect(mail.to).toHaveLength(1);
    }
  });
});

describe("the site's own confirmation (src/emails.ts)", () => {
  it("writes the look and the words; who it goes to and where replies go stay Brim's", async () => {
    const seen: unknown[] = [];
    const emails: SiteEmails = {
      confirmation: (email) => {
        seen.push(email);
        return {
          subject: `${email.subject} · Codeso`,
          fromName: "Codeso",
          html: html`<h1>${email.form}</h1>`,
          // Not part of what a template gives: ignored.
          ...({ to: ["victim@example.test"], replyTo: "attacker@evil.example" } as object),
        };
      },
    };
    await send(forms({ emails: () => emails }));

    expect(toVisitor()).toHaveLength(1);
    expect(toVisitor()[0]).toMatchObject({
      to: ["ana@example.test"],
      subject: "Am primit mesajul tău · Codeso",
      fromName: "Codeso",
      html: "<h1>Contact</h1>",
    });
    expect(toVisitor()[0]?.replyTo).toBeUndefined();
    // The template is given no answers unless the owner asked for them.
    expect(seen[0]).toMatchObject({ form: "Contact", site: "acme.example", answers: [] });
  });

  it("falls back to Brim's own when the template fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const emails: SiteEmails = {
      confirmation: () => {
        throw new Error("broken template");
      },
    };
    await send(forms({ emails: () => emails }));

    expect(toVisitor()[0]).toMatchObject({ to: ["ana@example.test"], subject: "Am primit mesajul tău" });
  });
});

describe("limits on confirmations", () => {
  it("one address hears from the site three times a day; the messages are still kept and the owner told", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = forms();
    for (let message = 0; message < 4; message++) {
      // From different visitors: the address is what is counted.
      expect((await send(handler, {}, { clientAddress: `198.51.100.${message}` })).status).toBe(200);
    }

    expect(toVisitor()).toHaveLength(3);
    expect(toOwner()).toHaveLength(4);
    expect(await brim.forms.list()).toHaveLength(4);
    // Written another way, it is the same address.
    await send(handler, { email: "ANA@Example.TEST" }, { clientAddress: "198.51.100.9" });
    expect(toVisitor()).toHaveLength(3);
  });

  it("one visitor causes ten a day, whatever addresses they type", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = forms();
    for (let message = 0; message < 11; message++) {
      // Five messages to a form in ten minutes is the visitor's limit on messages, so they take their time.
      if (message % 5 === 0) vi.advanceTimersByTime(11 * 60 * 1000);
      expect((await send(handler, { email: `victim${message}@example.test` })).status).toBe(200);
    }

    expect(toVisitor()).toHaveLength(10);
    expect(toOwner()).toHaveLength(11);
  });

  it("the whole site sends two hundred a day, counted apart from the owners' emails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const limiter = new RateLimiter(brim.db);
    await limiter.add("form-confirm:site", 200, 200, DAY);
    await send(forms());
    // Confirmations are spent; the owner is still told.
    expect(toVisitor()).toEqual([]);
    expect(toOwner()).toHaveLength(1);

    // And the other way round: the owners' emails spent, a visitor is still confirmed.
    vi.advanceTimersByTime(DAY * 1000);
    await limiter.add("form:site-emails", 300, 300, DAY);
    mails = [];
    await send(forms(), { email: "dan@example.test" });
    expect(toOwner()).toEqual([]);
    expect(toVisitor()).toHaveLength(1);
  });
});

describe("a message that was not accepted", () => {
  it("is never confirmed: the trap field, a failed challenge, a refused answer, a used token", async () => {
    expect((await send(forms(), {}, { trap: "https://spam.example" })).status).toBe(200);
    expect(mails).toEqual([]);

    const guarded = forms({
      captcha: { provider: "turnstile", secret: "secret" }, // betterleaks:allow (a test value)
      fetch: async () => Response.json({ success: false }),
    });
    expect((await send(guarded)).status).toBe(400);
    expect((await send(forms(), { message: "" })).status).toBe(422);
    expect(mails).toEqual([]);
    expect(await brim.forms.list()).toEqual([]);
  });
});

describe("sending", () => {
  it("without anything to send with, the message is kept and the visitor has their answer", async () => {
    const handler = createFormsHandler(brim, { mailer: new Mailer({}), background: (work) => background.push(work) });

    expect((await send(handler)).status).toBe(200);
    expect(await brim.forms.list()).toHaveLength(1);
    expect((await send(createFormsHandler(brim), { email: "dan@example.test" })).status).toBe(200);
  });

  it("a sender that refuses the confirmation costs the visitor nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    serviceAnswer = () => new Response(null, { status: 500 });

    expect((await send(forms())).status).toBe(200);
    expect(await brim.forms.list()).toHaveLength(1);
  });
});

describe("a form declared in code", () => {
  const fields = [
    { name: "name", label: "Name", type: "text" as const },
    { name: "email", label: "Email", type: "email" as const },
  ];

  it("can start with its confirmation on", () => {
    const form = defineForm({
      key: "contact",
      name: "Contact",
      fields,
      confirmationEmail: true,
      confirmationField: "email",
    });
    expect(form.settings).toMatchObject({ confirmationEmail: true, confirmationField: "email" });
  });

  it("must send it to one of its email fields", () => {
    expect(() =>
      defineForm({ key: "contact", name: "Contact", fields, confirmationEmail: true, confirmationField: "name" }),
    ).toThrow('sends its confirmation to "name", which is not one of its email fields.');
    expect(() =>
      defineForm({ key: "contact", name: "Contact", fields: [fields[0]!], confirmationEmail: true }),
    ).toThrow("has no email field");
  });

  it("names only Brim's kinds of file", () => {
    expect(() =>
      defineForm({
        key: "apply",
        name: "Apply",
        fields: [{ name: "cv", label: "CV", type: "file", accept: ["svg" as "pdf"] }],
      }),
    ).toThrow('taking "svg"');
  });
});
