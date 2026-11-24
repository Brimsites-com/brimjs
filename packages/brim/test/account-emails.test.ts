import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts, type Role } from "../src/auth/accounts.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { HistoryStore } from "../src/content/history.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import { type MailMessage, Mailer } from "../src/mail/mailer.ts";
import { accountNotice } from "../src/mail/notify.ts";
import { type AccountEmail, type SiteEmails, defineEmails, html } from "../src/mail/templates.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminOptions, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "http://localhost:4321";
const PASSWORD = "correct horse battery"; // betterleaks:allow

let brim: Brim;
let sent: MailMessage[];

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  brim = {
    db,
    content: new ContentStore(db),
    items: new ItemStore(db),
    forms: new FormStore(db),
    history: new HistoryStore(db),
    drafts: new DraftStore(db),
    accounts: new Accounts(db),
  };
  sent = [];
});

function site(options: Partial<AdminOptions> = {}) {
  const mailer = new Mailer(
    { smtp: "smtp://mail.example.test:587", from: "site@example.test" },
    { smtp: async (_server, _from, message) => void sent.push(message) },
  );
  const handler = createAdminHandler({
    brim,
    siteUrl: "https://cozy.example",
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    mediaDirectory: pathToFileURL(`${mkdtempSync(join(tmpdir(), "brim-accounts-media-"))}/`),
    mailer,
    ...options,
  });
  return async (method: string, path: string, auth: string, body?: unknown) => {
    const response = await handler(
      new Request(`${ORIGIN}/admin/api${path}`, {
        method,
        headers: {
          ...(auth.startsWith("brim_") && !auth.includes("=")
            ? { authorization: `Bearer ${auth}` }
            : { cookie: auth, origin: ORIGIN }),
          "content-type": "application/json",
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
      { clientAddress: "203.0.113.7" },
    );
    if (!response) throw new Error(`${path} was not handled`);
    return response;
  };
}

async function signedIn(role: Role, email = `${role}@example.test`) {
  await brim.accounts.createUser(email, PASSWORD, role);
  const user = (await brim.accounts.authenticate(email, PASSWORD))!;
  const session = await brim.accounts.startSession(user.id);
  return { cookie: `brim_session=${session.token}`, token: await brim.accounts.createToken(email, "host") };
}

describe("the users API", () => {
  it("is the owners' alone", async () => {
    const call = site();
    const editor = await signedIn("editor");
    expect((await call("GET", "/users", editor.cookie)).status).toBe(403);
    expect((await call("POST", "/users", editor.cookie, { email: "x@example.test" })).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("adds a user and emails them a link to choose their password, which signs them in", async () => {
    const call = site();
    const owner = await signedIn("owner");
    // A host's dashboard calls with an owner's token.
    const added = await call("POST", "/users", owner.token, { email: "Ana@Example.test", role: "writer" });
    expect(added.status).toBe(201);
    const answer = (await added.json()) as {
      user: { email: string; role: string };
      password: string; // betterleaks:allow
      emailed: boolean;
    };
    expect(answer).toMatchObject({ user: { email: "ana@example.test", role: "writer" }, emailed: true });
    expect(answer.password).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
    expect(await brim.accounts.authenticate("ana@example.test", answer.password)).toBeTruthy();

    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message.to).toEqual(["ana@example.test"]);
    expect(message.subject).toBe("You can now edit cozy.example");
    expect(message.fromName).toBe("cozy.example");
    expect(message.text).toContain("owner@example.test added you to cozy.example as a writer");
    expect(message.text).toContain("within 7 days");
    expect(message.text).toContain("The editor: https://cozy.example/admin/edit");
    // Never the password itself.
    expect(message.text).not.toContain(answer.password);
    expect(message.html).not.toContain(answer.password);

    const token = /https:\/\/cozy\.example\/admin\/edit#reset=([\w-]+)/.exec(message.text)![1]!;
    const chosen = await call("POST", "/password/reset", "", { token, password: "my own long password" }); // betterleaks:allow
    expect(chosen.status).toBe(200);
    expect(await brim.accounts.authenticate("ana@example.test", "my own long password")).toBeTruthy();
  });

  it("keeps a password the owner chose, and says when no email could be sent", async () => {
    const call = site({ mailer: undefined });
    const owner = await signedIn("owner");
    const added = await call("POST", "/users", owner.cookie, { email: "ana@example.test", password: PASSWORD }); // betterleaks:allow
    const answer = (await added.json()) as Record<string, unknown>;
    expect(added.status).toBe(201);
    expect(answer.password).toBeUndefined();
    expect(answer).toMatchObject({ user: { role: "editor" }, emailed: false });
    expect(answer.emailError).toContain("not set up");
    expect((await call("POST", "/users", owner.cookie, { email: "ana@example.test" })).status).toBe(409);
    expect((await call("POST", "/users", owner.cookie, { email: "x@example.test", role: "boss" })).status).toBe(422);
  });

  it("leaves the email to the caller with notify: false", async () => {
    const call = site();
    const owner = await signedIn("owner");
    const added = await call("POST", "/users", owner.cookie, { email: "ana@example.test", notify: false });
    expect(await added.json()).toMatchObject({ emailed: false });
    expect(sent).toEqual([]);
  });

  it("emails a role change, and nothing when the role stays", async () => {
    const call = site();
    const owner = await signedIn("owner");
    await brim.accounts.createUser("ana@example.test", PASSWORD, "writer");
    const same = await call("PUT", "/users", owner.cookie, { email: "ana@example.test", role: "writer" });
    expect(await same.json()).toMatchObject({ emailed: false });
    const changed = await call("PUT", "/users", owner.cookie, { email: "ana@example.test", role: "editor" });
    expect(await changed.json()).toMatchObject({ user: { role: "editor" }, emailed: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Your role on cozy.example is now editor");
    expect(sent[0]!.text).toContain("from writer to editor");
    expect(sent[0]!.text).not.toContain("#reset=");
    expect((await call("PUT", "/users", owner.cookie, { email: "nobody@example.test", role: "editor" })).status).toBe(
      404,
    );
    // A site always keeps an owner.
    expect((await call("PUT", "/users", owner.cookie, { email: "owner@example.test", role: "editor" })).status).toBe(
      422,
    );
  });

  it("resets access: the old password and sessions end, tokens when asked, and the email gives a new link", async () => {
    const call = site();
    const owner = await signedIn("owner");
    const ana = await signedIn("editor", "ana@example.test");
    const reset = await call("POST", "/users/reset", owner.cookie, { email: "ana@example.test", revokeTokens: true });
    const answer = (await reset.json()) as { password: string; revokedTokens: number; emailed: boolean }; // betterleaks:allow
    expect(answer).toMatchObject({ revokedTokens: 1, emailed: true });
    expect(await brim.accounts.authenticate("ana@example.test", PASSWORD)).toBeUndefined();
    expect(await brim.accounts.authenticate("ana@example.test", answer.password)).toBeTruthy();
    expect(await brim.accounts.sessionUser(ana.cookie.split("=")[1]!)).toBeUndefined();
    expect(await brim.accounts.tokenUser(ana.token)).toBeUndefined();
    expect(sent[0]!.subject).toBe("Your access to cozy.example was reset");
    expect(sent[0]!.text).toContain("within 1 day");
    expect(sent[0]!.text).toMatch(/#reset=[\w-]+/);
  });

  it("lists and removes users", async () => {
    const call = site();
    const owner = await signedIn("owner");
    await brim.accounts.createUser("ana@example.test", PASSWORD, "writer");
    const listed = (await (await call("GET", "/users", owner.cookie)).json()) as { users: { email: string }[] };
    expect(listed.users.map((user) => user.email)).toEqual(["owner@example.test", "ana@example.test"]);
    expect((await call("DELETE", "/users", owner.cookie, { email: "ana@example.test" })).status).toBe(200);
    expect((await brim.accounts.listUsers()).map((user) => user.email)).toEqual(["owner@example.test"]);
  });

  it("previews each account email for owners, sending nothing", async () => {
    const call = site({ emails: () => ({ roleChanged: (email) => ({ subject: `Rol nou: ${email.role}` }) }) });
    const owner = await signedIn("owner");
    const added = await call("GET", "/emails/account?kind=added", owner.cookie);
    expect(added.headers.get("content-type")).toContain("text/html");
    expect(await added.text()).toContain("Choose your password");
    const role = await call("GET", "/emails/account?kind=role&text", owner.cookie);
    expect(await role.text()).toContain("Subject: Rol nou: editor");
    expect((await call("GET", "/emails/account?kind=nope", owner.cookie)).status).toBe(422);
    const editor = await signedIn("editor");
    expect((await call("GET", "/emails/account", editor.cookie)).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("says it has the users API in /info", async () => {
    const info = (await (await site()("GET", "/info", "")).json()) as { capabilities: string[] };
    expect(info.capabilities).toContain("users");
  });
});

describe("the site's account emails", () => {
  it("are written by the site's templates in src/emails.ts", async () => {
    const seen: AccountEmail[] = [];
    const emails: SiteEmails = defineEmails({
      userAdded: (email) => {
        seen.push(email);
        return {
          subject: `Bun venit pe ${email.site}`,
          fromName: "Studio Nord",
          html: html`<a href="${email.passwordUrl}">Alege parola</a>`,
          text: `Alege parola: ${email.passwordUrl}`,
        };
      },
    });
    const call = site({
      emails: () => emails,
      hostSignIn: { url: "https://host.example/sign-in?site=cozy", name: "Brimsites" },
    });
    const owner = await signedIn("owner");
    await call("POST", "/users", owner.cookie, { email: "ana@example.test", role: "editor" });
    expect(seen[0]).toMatchObject({
      kind: "added",
      email: "ana@example.test",
      role: "editor",
      by: "owner@example.test",
      editorUrl: "https://cozy.example/admin/edit",
      passwordLinkHours: 168, // betterleaks:allow
      hostSignIn: { name: "Brimsites" },
    });
    expect(sent[0]).toMatchObject({
      to: ["ana@example.test"],
      subject: "Bun venit pe cozy.example",
      fromName: "Studio Nord",
    });
    expect(sent[0]!.html).toMatch(/^<a href="https:\/\/cozy\.example\/admin\/edit#reset=[\w-]+">Alege parola<\/a>$/);

    // Without a template of its own for a role change, the site sends Brim's.
    await call("PUT", "/users", owner.cookie, { email: "ana@example.test", role: "writer" });
    expect(sent[1]!.subject).toBe("Your role on cozy.example is now writer");
  });

  it("fall back to Brim's own when the site's template fails", async () => {
    const call = site({
      emails: () => ({
        userAdded: () => {
          throw new Error("typo");
        },
      }),
    });
    const owner = await signedIn("owner");
    await call("POST", "/users", owner.cookie, { email: "ana@example.test" });
    expect(sent[0]!.subject).toBe("You can now edit cozy.example");
  });

  it("Brim's own mentions the host's sign-in when the site offers it", () => {
    const message = accountNotice(
      {
        kind: "added",
        site: "cozy.example",
        siteUrl: "https://cozy.example",
        email: "ana@example.test",
        role: "owner",
        roleDescription: "manage everything",
        editorUrl: "https://cozy.example/admin/edit",
        passwordUrl: "https://cozy.example/admin/edit#reset=abc", // betterleaks:allow
        passwordLinkHours: 168, // betterleaks:allow
        hostSignIn: { name: "Brimsites", url: "https://host.example" },
        sentAt: new Date(),
      },
      { senderName: "Cozy <Homes>" } as never,
    );
    expect(message.text).toContain("An owner of the site added you to cozy.example as an owner");
    expect(message.text).toContain('choose "Continue with Brimsites"');
    expect(message.html).toContain("Choose your password");
    expect(message.html).toContain("Continue with Brimsites");
    expect(message.fromName).toBe("Cozy <Homes>");
  });
});
