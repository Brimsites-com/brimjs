---
title: Forms
section: Build
order: 5
lead: Form and Newsletter keep what visitors send in the site's database and email it to the people who run the site.
---

## A form declared once

A form the site shows in more than one place (the footer, the contact page, a product's enquiry box) is declared once in `src/forms.ts` and placed with `form`:

```ts
// src/forms.ts
import { defineForm } from "@brimsites/brimjs";

export const quote = defineForm({
  key: "quote", // names the form for good: its content is kept as the node `form-quote`
  name: "Quote request", // what the owner reads in Form responses, and the heading
  fields: [
    { type: "step", label: "Your project" },
    { name: "details", label: "What do you need?", type: "textarea", required: true },
    { type: "step", label: "Your details" },
    { name: "name", label: "Name", type: "name", required: true, width: "half" },
    { name: "email", label: "Email", type: "email", required: true, width: "half" },
  ],
  buttonText: "Send",
  successMessage: "Thank you. We will reply soon.",
});
```

```astro
---
import { Form } from "@brimsites/brimjs/components";
import { quote } from "../forms.ts";
---
<Form form={quote} />
```

Every place shows the same form, kept in the site's shared content: the owner changes its fields, button or messages once and they change everywhere, and its responses are listed under one name. Props written next to it still win where it is placed (`<Form form={quote} buttonText="Ask for a quote" />`). A mistake in the declaration (a field type that does not exist, a name used twice, a select without options) stops the site when it starts.

A form used in one place can be written inline instead, with `nodeId`, `formName` and `fields`.

## Fields and steps

A field's `type` is one of `text`, `name`, `email`, `tel`, `url`, `number`, `date`, `textarea`, `select`, `radio` and `checkbox`; `select` and `radio` take `options`.

A field takes `width: "half"` to share a row with another half where the form is wide enough, and `help`, a line under the question.

A long form is asked in steps: an entry `{ type: "step", label, help }` starts a step, with the fields after it. Brim draws a tab per step, a progress bar and Back and Continue buttons (`backText`, `nextText`), checks a step before the next, and keeps the consent and the send button for the last step. Without its script every step shows, one under the other. The owner adds, moves and renames steps in the editor.

## Styling

A form is its fields, its texts (heading, intro, button, consent, the message after sending) and where its messages go. Its look is your CSS on classes that keep their names:

| Class | What it is |
| --- | --- |
| `.brim-form` | The form; as wide as its place |
| `.brim-form__fields` | The grid of fields; which share a row is their `width` |
| `.brim-form__field` | One field, with `data-type` and `data-width` |
| `.brim-form__help`, `.brim-form__check` | A help line, a checkbox row |
| `.brim-form__actions` | The buttons |
| `.brim-form__error`, `.brim-form__success` | The messages after sending |
| `.brim-form__tabs`, `.brim-form__tab` | Step tabs (`aria-selected`, `data-done`) |
| `.brim-form__progress` | The progress bar; its width is `--brim-form-progress` |
| `.brim-form__step`, `.brim-form__step-intro` | A step and its intro |

`buttonClass` and `backClass` give its buttons the site's own classes, so they look like every other button of the site.

## Your own markup

A function child draws the fields in your markup while Brim keeps the form around them: sending, the consent, the button and the messages. It gets the `steps`, the `fields` (each with the `id` its input takes) and `Field`, which draws one question.

```astro
---
import type { FormValue } from "@brimsites/brimjs";
---
<Form nodeId="quote" fields={fields}>
  {({ fields, Field }: FormValue) => (
    <div class="quote-grid">{fields.map((field) => <Field field={field} class="quote-grid__cell" />)}</div>
  )}
</Form>
```

In a form with steps drawn this way, elements with `data-step="0"`, `data-step="1"`… are the steps, and buttons with `data-go-step="<n>"`, `data-next-step` and `data-back-step` move between them.

## What is accepted

A submission is accepted only when it comes from a page of the site, carries a form description the site signed, a fresh single-use token with the work the visitor's browser did for it, an empty trap field, values that fit the form's fields, and the visitor is within their limit (5 messages to a form in 10 minutes). The site emails at most 300 messages a day; past that, messages are still kept, only not emailed. It keeps at most 5,000 a day. A form's own notification email is sealed in the page, so the page's source never shows it.

The work is a number the page's script finds while the visitor types: one that, after the token, gives a SHA-256 starting with 16 zero bits. A browser needs well under a second; the server checks it with one hash. It needs nothing set up and no third party, and a script that sends many messages pays for every one. While the site is being sent many messages (30 tried in ten minutes, then 100, five from one address at most), new tokens ask for four, then sixteen times as much work: a second or two, then several, for a real visitor, and far more for a script that sends thousands. `brim-form` carries `data-working` while the browser works.

For more, add a challenge from Cloudflare Turnstile or hCaptcha. The public key goes in the config, the secret in the server's environment:

```js
// astro.config.mjs
brim({ forms: { captcha: { provider: "turnstile", siteKey: "0x4AAAAAAA…" } } }); // or provider: "hcaptcha"
```

```bash
BRIM_CAPTCHA_SECRET=<the provider's secret key>   # betterleaks:allow (a placeholder)
```

Without `BRIM_CAPTCHA_SECRET` on the server, such forms refuse every message rather than take one unchecked, and the server's log says why. Turnstile's test keys pass in development.

## Where responses go

Responses appear in the editor under Form responses, filtered per form, and Site Settings lists the forms with their newest message. Owners and editors can read them. Agents read them with `brim_list_form_responses`.

Forms post to `/_brim/forms`, answered by the dev server and the built server. A static build has nothing to receive them.

## Form emails

Each message is also emailed to every user of the roles ticked in Site Settings (the owners by default, the editors too when ticked), to extra addresses set there and to the form's own notification email, ten addresses at most. Reply goes to the first email address the visitor wrote. The message is saved even if the email fails.

The links in it go to `BRIM_SITE_URL` or the `site` of `astro.config.mjs`, never to an address taken from the request. A site with neither sends its emails without links; a template then gets `""` for each address.

Who sends, first match wins:

1. The owner's own SMTP server, set in Site Settings → Own email server. With a password, this server and the next need TLS: port 465, or STARTTLS on any other.
2. An SMTP server given to the server: `brim({ mail: { smtp, from } })`, or `BRIM_SMTP_URL` and `BRIM_MAIL_FROM`.
3. A mail service that takes a JSON `POST`: `brim({ mail: { url, token } })`, or `BRIM_MAIL_URL` and `BRIM_MAIL_TOKEN`. A host can send for its sites this way without handing them a mail password.

Without any of them, messages are only kept for the editor, and Forgot password cannot send its link.

## Writing the email

What the email looks like is the site's code. `src/emails.ts` exports `emails`, and `form` writes the email for a message from what was sent: the form's title, the page it came from, each answer, the visitor's address and where the editor lists the messages.

```ts
// src/emails.ts
import { defineEmails, html } from "@brimsites/brimjs";

export const emails = defineEmails({
  form: (email) => ({
    subject: `${email.form}: ${email.answers[0]?.value ?? "new message"}`,
    fromName: "Studio Nord",
    html: html`
      <div style="font-family: Georgia, serif; max-width: 560px">
        <h1 style="font-size: 22px">${email.form}</h1>
        ${email.page && html`<p>Sent from <a href="${email.page}">${email.page}</a></p>`}
        <table>
          ${email.answers.map((answer) => html`<tr><td>${answer.label}</td><td>${answer.value}</td></tr>`)}
        </table>
        <p><a href="${email.responsesUrl}">All messages</a></p>
      </div>
    `,
  }),
});
```

- `html` escapes every value put in it, so what a visitor typed can never become markup. `rawHtml("…")` is for markup of your own, like a logo's `<svg>`.
- Anything the template leaves out is Brim's own: the subject, the sender's name, the text version and the HTML.
- A template that throws sends Brim's own email and logs the reason. No message is lost.
- Email clients read inline styles and simple tables, not the site's CSS.
- Signed in, `/admin/api/emails/form` shows the email for the newest message, or an example, as it would be sent; `?text` shows its subject and text version.
