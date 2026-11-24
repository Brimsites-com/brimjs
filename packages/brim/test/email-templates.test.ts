import { describe, expect, it } from "vitest";
import { html, rawHtml, writtenBySite, type FormEmail } from "../src/mail/templates.ts";
import type { MailMessage } from "../src/mail/mailer.ts";

const email: FormEmail = {
  form: "Comandă produs",
  site: "studionord.ro",
  siteUrl: "https://studionord.ro",
  page: "https://studionord.ro/produse/marazzi-art",
  answers: [
    { label: "Nume", value: "Ana <script>alert(1)</script>" },
    { label: "Mesaj", value: "40 m² & plintă" },
  ],
  replyTo: "ana@example.com",
  responsesUrl: "https://studionord.ro/admin/edit",
  responseUrl: "https://studionord.ro/admin/edit?response=r1",
  sentAt: new Date("2026-11-20T10:00:00Z"),
};

const brims: MailMessage = {
  to: ["owner@studionord.ro"],
  subject: "New message from Comandă produs on studionord.ro",
  text: "Brim's text",
  html: "<p>Brim's html</p>",
  replyTo: "ana@example.com",
  fromName: "studionord.ro",
};

describe("html for emails", () => {
  it("escapes every value, and keeps markup made with html, lists of it and the site's own", () => {
    // prettier-ignore
    const rows = email.answers.map((answer) => html`<tr><td>${answer.label}</td><td>${answer.value}</td></tr>`);
    // prettier-ignore
    const written = html`<table>${rows}</table>${rawHtml("<hr>")}${undefined}${false}${null}`;
    expect(String(written)).toBe(
      "<table><tr><td>Nume</td><td>Ana &#60;script&#62;alert(1)&#60;/script&#62;</td></tr>" +
        "<tr><td>Mesaj</td><td>40 m² &#38; plintă</td></tr></table><hr>",
    );
  });
});

describe("the site's form email", () => {
  it("takes the site's subject, html, text and sender name, and Brim's for what it leaves out", async () => {
    const message = await writtenBySite(
      brims,
      (e) => ({ subject: `Cerere: ${e.form}\nBcc: x`, html: html`<h1>${e.form}</h1>` }),
      email,
    );
    expect(message).toEqual({ ...brims, subject: "Cerere: Comandă produs Bcc: x", html: "<h1>Comandă produs</h1>" });

    const full = await writtenBySite(brims, async () => ({ text: "Text", fromName: "Studio Nord" }), email);
    expect(full).toMatchObject({
      text: "Text",
      fromName: "Studio Nord",
      html: brims.html,
      to: brims.to,
      replyTo: brims.replyTo,
    });
  });

  it("escapes html given as a plain string, and sends Brim's own when the template fails", async () => {
    const plain = await writtenBySite(brims, () => ({ html: "<b>x</b>" as never }), email);
    expect(plain.html).toBe("&#60;b&#62;x&#60;/b&#62;");
    const failed = await writtenBySite(
      brims,
      () => {
        throw new Error("typo");
      },
      email,
    );
    expect(failed).toEqual(brims);
    expect(await writtenBySite(brims, undefined, email)).toEqual(brims);
  });
});
