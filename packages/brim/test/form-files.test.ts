import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { HistoryStore } from "../src/content/history.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import {
  DiskPrivateFiles,
  HttpPrivateFiles,
  MAX_FILE_BYTES,
  MAX_MESSAGE_BYTES,
  type PrivateFiles,
  fileTypes,
  openFile,
  resolveFormFiles,
  safeFileName,
  sealFile,
  sniffFileType,
} from "../src/forms/files.ts";
import { type FormsHandler, TOKEN_HEADER, WORK_HEADER, createFormsHandler } from "../src/forms/handler.ts";
import { type FormSpec, encodeSpec, sign } from "../src/forms/spec.ts";
import { FormStore } from "../src/forms/store.ts";
import { solveWork } from "../src/forms/work.ts";
import { type MailMessage, Mailer } from "../src/mail/mailer.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";
import { RateLimiter } from "../src/server/rate-limit.ts";

const ORIGIN = "https://acme.example";
const PASSWORD = "correct horse battery"; // betterleaks:allow (a test account in a temporary database)
const visitor = { clientAddress: "203.0.113.7" };

const apply: FormSpec = {
  form: "/jobs#apply",
  title: "Apply",
  consentRequired: false,
  fields: [
    { name: "email", label: "Email", type: "email", required: true },
    { name: "cv", label: "CV", type: "file", required: false, accept: ["pdf"] },
    { name: "photos", label: "Photos", type: "file", required: false, accept: ["jpg", "png"], multiple: true },
  ],
};

const encoder = new TextEncoder();
const padded = (start: Uint8Array | string, size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set(typeof start === "string" ? encoder.encode(start) : start);
  return bytes;
};
const PDF = encoder.encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const PNG = padded(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 64);
const JPEG = padded(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 64);
const HTML = encoder.encode("<!doctype html><script>alert(document.cookie)</script>");
const SVG = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const ZIP = padded(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 64);
const EXE = padded("MZ", 64);

/** A private storage in memory, which the tests can look into and break. */
class MemoryFiles implements PrivateFiles {
  readonly kept = new Map<string, Uint8Array>();
  failOnWrite = 0;

  async write(path: string, bytes: Uint8Array): Promise<void> {
    if (this.failOnWrite > 0 && this.kept.size + 1 >= this.failOnWrite) throw new Error("The storage is down.");
    this.kept.set(path, bytes);
  }
  async read(path: string): Promise<Uint8Array | undefined> {
    return this.kept.get(path);
  }
  async remove(path: string): Promise<void> {
    this.kept.delete(path);
  }
}

interface Sent {
  field: string;
  name: string;
  bytes: Uint8Array;
  /** What the visitor's browser says the file is: never believed. */
  type?: string;
}

let brim: Brim;
let storage: MemoryFiles;
let forms: FormsHandler;
let admin: AdminHandler;
let mails: MailMessage[];
let background: Promise<void>[];

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
  storage = new MemoryFiles();
  mails = [];
  background = [];
  const mailer = new Mailer(
    { url: "https://mail.example.test/send" },
    {
      fetch: async (_input, init) => {
        mails.push(JSON.parse(String(init?.body)) as MailMessage);
        return new Response(null, { status: 202 });
      },
    },
  );
  forms = createFormsHandler(brim, {
    files: storage,
    mailer,
    siteUrl: ORIGIN,
    background: (work) => background.push(work),
  });
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    formFiles: storage,
  });
});

afterEach(() => vi.useRealTimers());

async function token(): Promise<string> {
  // The work asked grows with the messages tried on the site; these tests are about other limits.
  await brim.db.query("DELETE FROM brim_rate_limits WHERE key LIKE 'form:attempts%'");
  const response = await forms(new Request(`${ORIGIN}/_brim/forms/token`, { headers: { origin: ORIGIN } }), visitor);
  return ((await response?.json()) as { token: string }).token;
}

/** The headers a message with files proves itself with: its token and the work done for it. */
function proof(issued: string): Record<string, string> {
  const bits = Number(issued.split(".")[2]);
  return { [TOKEN_HEADER]: issued, [WORK_HEADER]: Number.isInteger(bits) ? String(solveWork(issued, bits)) : "0" };
}

/** A message with files as the page's script sends it, after a person took a few seconds over the form. */
async function send(
  files: Sent[],
  options: { spec?: FormSpec; values?: Record<string, unknown>; trap?: string; token?: string | null } = {},
  handler: FormsHandler = forms,
): Promise<Response> {
  const spec = encodeSpec(options.spec ?? apply);
  const issued = options.token === undefined ? await token() : options.token;
  vi.advanceTimersByTime(5_000);
  const body = new FormData();
  body.set("spec", spec);
  body.set("signature", sign(await brim.forms.secret(), spec));
  body.set("trap", options.trap ?? "");
  body.set("consent", "false");
  body.set("values", JSON.stringify(options.values ?? { email: "ana@example.test" }));
  for (const file of files) {
    body.append(file.field, new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? "" }));
  }
  const response = await handler(
    new Request(`${ORIGIN}/_brim/forms/submit`, {
      method: "POST",
      headers: { origin: ORIGIN, ...(issued !== null && proof(issued)) },
      body,
    }),
    visitor,
  );
  if (!response) throw new Error("The form was not handled.");
  return response;
}

const error = async (response: Response): Promise<string> => ((await response.json()) as { error: string }).error;

async function nothingKept(): Promise<void> {
  expect(storage.kept.size).toBe(0);
  expect(await brim.forms.list()).toEqual([]);
}

/** An account whose role is none of Brim's, as one kept from when there was a third: it may read no message. */
async function signInWithoutRole(): Promise<string> {
  const cookie = await signInAs("editor", "leftover@example.test");
  await brim.db.query("UPDATE brim_users SET role = 'writer' WHERE email = 'leftover@example.test'");
  return cookie;
}

async function signInAs(role: "owner" | "editor", email = `${role}@example.test`): Promise<string> {
  await brim.accounts.createUser(email, PASSWORD, role);
  const response = await admin(
    new Request(`${ORIGIN}/admin/api/session`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }), // betterleaks:allow
    }),
    visitor,
  );
  return (response?.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function api(method: string, path: string, cookie?: string, body?: unknown): Promise<Response> {
  const response = await admin(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        ...(cookie && { cookie }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    visitor,
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

describe("a message with files", () => {
  it("is kept with its files, sealed where they are stored and listed by name, type and size", async () => {
    const response = await send([
      { field: "cv", name: "Ana Popescu CV.pdf", bytes: PDF },
      { field: "photos", name: "one.jpg", bytes: JPEG },
      { field: "photos", name: "two.png", bytes: PNG },
    ]);

    expect(response.status).toBe(200);
    const [message] = await brim.forms.list();
    expect(message?.answers).toEqual([{ label: "Email", value: "ana@example.test" }]);
    expect(message?.files).toMatchObject([
      { label: "CV", name: "Ana Popescu CV.pdf", mime: "application/pdf", size: PDF.byteLength },
      { label: "Photos", name: "one.jpg", mime: "image/jpeg", size: JPEG.byteLength },
      { label: "Photos", name: "two.png", mime: "image/png", size: PNG.byteLength },
    ]);
    // Stored under generated names only, and unreadable without the site's secret.
    expect([...storage.kept.keys()]).toEqual(message?.files.map((file) => `${message.id}/${file.id}`));
    for (const key of storage.kept.keys()) expect(key).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const stored = Buffer.from([...storage.kept.values()][0] ?? []);
    expect(stored.includes(Buffer.from("%PDF"))).toBe(false);
    // Never in the media library the owner picks pictures from.
    expect(await brim.db.query("SELECT * FROM brim_media")).toEqual([]);
  });

  it("goes through without a file when the field is not required, and asks for one when it is", async () => {
    expect((await send([])).status).toBe(200);

    const required = { ...apply, fields: apply.fields.map((field) => ({ ...field, required: true })) };
    const response = await send([], { spec: required });
    expect(response.status).toBe(422);
    expect(await error(response)).toBe('"CV" is required.');
  });

  it("tells the owners where to download each file, and attaches none to the email", async () => {
    await brim.accounts.createUser("owner@example.test", PASSWORD, "owner");
    await send([{ field: "cv", name: "cv.pdf", bytes: PDF }]);
    await Promise.all(background);

    const [message] = await brim.forms.list();
    const link = `${ORIGIN}/admin/api/responses/${message?.id}/files/${message?.files[0]?.id}`;
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toEqual(["owner@example.test"]);
    expect(mails[0]?.text).toContain(`cv.pdf (1 KB): ${link}`);
    expect(mails[0]?.html).toContain(`href="${link}"`);
    expect(Object.keys(mails[0] ?? {}).sort()).toEqual(["fromName", "html", "replyTo", "subject", "text", "to"]);
  });
});

describe("a file that is not what its field takes", () => {
  it("is recognised by its bytes, whatever its name and declared type say", async () => {
    const response = await send([{ field: "cv", name: "cv.pdf", bytes: HTML, type: "application/pdf" }]);

    expect(response.status).toBe(422);
    expect(await error(response)).toBe('"CV" takes only PDF files.');
    await nothingKept();
  });

  it("refuses a real file of a kind the field does not take", async () => {
    expect((await send([{ field: "cv", name: "photo.png", bytes: PNG }])).status).toBe(422);
    await nothingKept();
  });

  it("never takes SVG, HTML, archives or programs, even when a form's fields name them", async () => {
    const anything = {
      ...apply,
      fields: [
        apply.fields[0]!,
        // As if the form's author had asked for them: only Brim's own kinds can be named.
        { name: "cv", label: "CV", type: "file", required: false, accept: ["svg", "html", "zip", "exe"] },
      ],
    } as unknown as FormSpec;
    for (const [name, bytes] of [
      ["logo.svg", SVG],
      ["page.html", HTML],
      ["files.zip", ZIP],
      ["setup.exe", EXE],
      ["report.docx", ZIP],
    ] as const) {
      const response = await send([{ field: "cv", name, bytes }], { spec: anything });
      expect(response.status, name).toBe(422);
      vi.advanceTimersByTime(11 * 60 * 1000);
    }
    await nothingKept();
  });

  it("ignores files sent under a name the form has no file field for", async () => {
    const response = await send([
      { field: "email", name: "a.pdf", bytes: PDF },
      { field: "elsewhere", name: "b.pdf", bytes: PDF },
    ]);

    expect(response.status).toBe(200);
    expect(storage.kept.size).toBe(0);
    expect((await brim.forms.list())[0]?.files).toEqual([]);
  });
});

describe("a file field asked only after another answer", () => {
  const conditional: FormSpec = {
    ...apply,
    fields: [
      { type: "radio", name: "kind", label: "Kind", required: true, options: ["Job", "Other"] },
      ...apply.fields.map((field) =>
        field.type === "file" ? { ...field, required: true, showWhen: { field: "kind", equals: ["Job"] } } : field,
      ),
    ],
  };

  it("is not required, nor are its files kept, when it was not asked", async () => {
    const values = { email: "ana@example.test", kind: "Other" };
    const response = await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], { spec: conditional, values });
    expect(response.status).toBe(200);
    expect(storage.kept.size).toBe(0);
  });

  it("is required when it was asked", async () => {
    const values = { email: "ana@example.test", kind: "Job" };
    expect((await send([], { spec: conditional, values })).status).toBe(422);
  });
});

describe("sizes and counts", () => {
  it("refuses a file larger than one file may be", async () => {
    const response = await send([{ field: "cv", name: "big.pdf", bytes: padded("%PDF-1.7\n", MAX_FILE_BYTES + 1) }]);

    expect(response.status).toBe(422);
    expect(await error(response)).toBe('"CV": a file is larger than 8.0 MB.');
    await nothingKept();
  });

  it("refuses an empty file", async () => {
    expect((await send([{ field: "cv", name: "empty.pdf", bytes: new Uint8Array(0) }])).status).toBe(422);
    await nothingKept();
  });

  it("refuses a request that says it is larger than a message may be, before reading any of it", async () => {
    const issued = await token();
    vi.advanceTimersByTime(5_000);
    let read = false;
    // Nothing is asked of this body until someone reads it.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          read = true;
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const response = await forms(
      new Request(`${ORIGIN}/_brim/forms/submit`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(MAX_MESSAGE_BYTES * 3),
          ...proof(issued),
        },
        body,
        duplex: "half",
      } as RequestInit),
      visitor,
    );

    expect(response?.status).toBe(413);
    expect(read).toBe(false);
    await nothingKept();
  });

  it("stops reading a body that turns out larger than a message may be", async () => {
    const issued = await token();
    vi.advanceTimersByTime(5_000);
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        // It would go on for 100 MB; the server must give up a little past 10.
        if (sent > 100 * 1024 * 1024) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = await forms(
      new Request(`${ORIGIN}/_brim/forms/submit`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x", ...proof(issued) },
        body,
        duplex: "half",
      } as RequestInit),
      visitor,
    );

    expect(response?.status).toBe(413);
    expect(sent).toBeLessThan(13 * 1024 * 1024);
    await nothingKept();
  });

  it("takes one file in a field for one, and five at most in a field for several", async () => {
    const two = await send([
      { field: "cv", name: "a.pdf", bytes: PDF },
      { field: "cv", name: "b.pdf", bytes: PDF },
    ]);
    expect(two.status).toBe(422);
    expect(await error(two)).toBe('"CV" takes one file.');

    const six = await send(
      Array.from({ length: 6 }, (_, index) => ({ field: "photos", name: `${index}.jpg`, bytes: JPEG })),
    );
    expect(six.status).toBe(422);
    expect(await error(six)).toBe('"Photos" takes at most 5 files.');

    // Five in one field and one in another is six in the message.
    const acrossFields = await send([
      { field: "cv", name: "a.pdf", bytes: PDF },
      ...Array.from({ length: 5 }, (_, index) => ({ field: "photos", name: `${index}.jpg`, bytes: JPEG })),
    ]);
    expect(acrossFields.status).toBe(422);
    expect(await error(acrossFields)).toBe("A message takes at most 5 files.");
    await nothingKept();
  });
});

describe("the checks every message passes", () => {
  it("reads nothing from a message with files that carries no fresh token", async () => {
    for (const bad of [null, "forged.token.value"]) {
      const response = await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], { token: bad });
      expect(response.status).toBe(400);
    }
    await nothingKept();
  });

  it("takes a token once, with files as without", async () => {
    const issued = await token();
    expect((await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], { token: issued })).status).toBe(200);
    expect((await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], { token: issued })).status).toBe(400);
    expect(storage.kept.size).toBe(1);
  });

  it("refuses a form the site did not sign", async () => {
    const issued = await token();
    vi.advanceTimersByTime(5_000);
    const body = new FormData();
    body.set("spec", encodeSpec({ ...apply, fields: [{ name: "cv", label: "CV", type: "file", required: false }] }));
    body.set("signature", sign(await brim.forms.secret(), encodeSpec(apply)));
    body.set("values", "{}");
    body.append("cv", new File([new Uint8Array(PDF)], "cv.pdf"));
    const response = await forms(
      new Request(`${ORIGIN}/_brim/forms/submit`, {
        method: "POST",
        headers: { origin: ORIGIN, [TOKEN_HEADER]: issued },
        body,
      }),
      visitor,
    );

    expect(response?.status).toBe(400);
    await nothingKept();
  });

  it("pretends to accept a message that filled the trap field, and keeps neither it nor its files", async () => {
    const response = await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], { trap: "https://spam.example" });

    expect(response.status).toBe(200);
    await nothingKept();
  });

  it("keeps no file of a message whose answers are refused", async () => {
    const response = await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], { values: { email: "not an address" } });

    expect(response.status).toBe(422);
    await nothingKept();
  });

  it("asks for the challenge's answer when the site's forms have one", async () => {
    const guarded = createFormsHandler(brim, {
      files: storage,
      captcha: { provider: "turnstile", secret: "secret" }, // betterleaks:allow (a test value)
      fetch: async () => Response.json({ success: false }),
    });
    const response = await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], {}, guarded);

    expect(response.status).toBe(400);
    await nothingKept();
  });

  it("refuses files on a site with no private place to keep them", async () => {
    const response = await send([{ field: "cv", name: "cv.pdf", bytes: PDF }], {}, createFormsHandler(brim));

    expect(response.status).toBe(501);
    expect(await brim.forms.list()).toEqual([]);
  });

  it("keeps nothing when the storage fails halfway through a message's files", async () => {
    storage.failOnWrite = 2;
    const response = await send([
      { field: "photos", name: "one.jpg", bytes: JPEG },
      { field: "photos", name: "two.jpg", bytes: JPEG },
    ]);

    expect(response.status).toBe(503);
    await nothingKept();
  });
});

describe("limits on files", () => {
  it("stops one visitor after 30 MB of files in a day", async () => {
    const file = { field: "cv", name: "big.pdf", bytes: padded("%PDF-1.7\n", MAX_FILE_BYTES) };
    for (let message = 0; message < 3; message++) expect((await send([file])).status).toBe(200);

    const fourth = await send([file]);
    expect(fourth.status).toBe(429);
    expect(storage.kept.size).toBe(3);
    expect(await brim.forms.list()).toHaveLength(3);
  }, 30_000);

  it("stops the whole site after 500 MB of files in a day", async () => {
    await new RateLimiter(brim.db).add("form-files:site", 500 * 1024 * 1024, 500 * 1024 * 1024, 24 * 60 * 60);

    expect((await send([{ field: "cv", name: "cv.pdf", bytes: PDF }])).status).toBe(429);
    await nothingKept();
  });

  it("stops reading messages with files from a visitor who sent twenty in ten minutes", async () => {
    const issued = await token();
    vi.advanceTimersByTime(5_000);
    const attempt = (): Promise<Response | undefined> =>
      forms(
        new Request(`${ORIGIN}/_brim/forms/submit`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x", ...proof(issued) },
          body: "--x--\r\n",
        }),
        visitor,
      );
    for (let sent = 0; sent < 20; sent++) expect((await attempt())?.status).toBe(400);

    expect((await attempt())?.status).toBe(429);
  }, 20_000); // 21 requests in a row: over the 5 s default when the whole suite loads the machine
});

describe("the name a visitor gave a file", () => {
  it("is kept as a plain name: no folders, no control characters, the extension of what the file is", () => {
    expect(safeFileName("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(safeFileName("..\\..\\windows\\system32\\cmd.exe", "pdf")).toBe("cmd.pdf");
    expect(safeFileName("invoice.pdf.html", "pdf")).toBe("invoice.pdf.pdf");
    expect(safeFileName('a"\r\nContent-Type: text/html\r\n\r\n<script>.pdf', "pdf")).toBe("htmlscript.pdf");
    expect(safeFileName(".htaccess", "png")).toBe("file.png");
    expect(safeFileName("", "jpg")).toBe("file.jpg");
    expect(safeFileName("x".repeat(500), "pdf")).toHaveLength(104);
  });

  it("never reaches the storage or a header", async () => {
    await send([{ field: "cv", name: '../../../etc/cron.d/x"\r\nSet-Cookie: a=b.pdf', bytes: PDF }]);

    const [message] = await brim.forms.list();
    expect(message?.files[0]?.name).toBe("xSet-Cookie a=b.pdf");
    expect([...storage.kept.keys()]).toEqual([`${message?.id}/${message?.files[0]?.id}`]);

    const download = await api(
      "GET",
      `/admin/api/responses/${message?.id}/files/${message?.files[0]?.id}`,
      await signInAs("owner"),
    );
    expect(download.headers.get("content-disposition")).toBe(
      `attachment; filename="xSet-Cookie a=b.pdf"; filename*=UTF-8''xSet-Cookie%20a%3Db.pdf`,
    );
  });
});

describe("downloading a visitor's file", () => {
  async function kept(): Promise<string> {
    await send([{ field: "cv", name: "cv.pdf", bytes: PDF }]);
    const [message] = await brim.forms.list();
    return `/admin/api/responses/${message?.id}/files/${message?.files[0]?.id}`;
  }

  it("is for someone signed in who may read messages: never a visitor, nor an account without a role", async () => {
    const path = await kept();

    expect((await api("GET", path)).status).toBe(401);
    expect((await api("GET", path, "brim_session=made-up")).status).toBe(401);
    expect((await api("GET", path, await signInWithoutRole())).status).toBe(403);
    expect((await api("GET", path, await signInAs("editor"))).status).toBe(200);
  });

  it("is always a download, of the kind the file is, that the browser may neither run nor keep", async () => {
    const response = await api("GET", await kept(), await signInAs("owner"));

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="cv.pdf"; filename*=UTF-8''cv.pdf`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "no-store, private",
      "cross-origin-resource-policy": "same-origin",
    });
  });

  it("finds a file only through its own message, by ids: a path in the address leads nowhere", async () => {
    const path = await kept();
    const owner = await signInAs("owner");
    const [, , , , responseId, , fileId] = path.split("/");
    await send([{ field: "cv", name: "other.pdf", bytes: PDF }]);
    const other = (await brim.forms.list()).find((message) => message.id !== responseId);

    for (const wrong of [
      `/admin/api/responses/${other?.id}/files/${fileId}`,
      `/admin/api/responses/${responseId}/files/${other?.files[0]?.id}`,
      `/admin/api/responses/${responseId}/files/..%2F..%2Fdata.db`,
      `/admin/api/responses/..%2F..%2Fetc/files/passwd`,
      `/admin/api/responses/${responseId}/files/${fileId}%00.html`,
      `/admin/api/responses/${responseId}/files/${fileId}/../../../session`,
    ]) {
      expect((await api("GET", wrong, owner)).status, wrong).toBe(404);
    }
    // Nothing of a visitor's file is served anywhere else.
    expect(await admin(new Request(`${ORIGIN}/uploads/${responseId}/${fileId}`), visitor)).toBeUndefined();
  });

  it("refuses a file that was changed where it is stored", async () => {
    const path = await kept();
    const [key, sealed] = [...storage.kept.entries()][0]!;
    storage.kept.set(
      key,
      sealed.map((byte, index) => (index === 20 ? byte ^ 1 : byte)),
    );

    expect((await api("GET", path, await signInAs("owner"))).status).toBe(404);
  });

  it("lists a message's files without their bytes, and says the site takes files", async () => {
    await kept();
    const owner = await signInAs("owner");
    const { responses } = (await (await api("GET", "/admin/api/responses", owner)).json()) as {
      responses: { files: Record<string, unknown>[] }[];
    };

    expect(Object.keys(responses[0]?.files[0] ?? {}).sort()).toEqual(["id", "label", "mime", "name", "size"]);
    expect((await api("GET", "/admin/api/responses", await signInWithoutRole())).status).toBe(403);
    const info = (await (await api("GET", "/admin/api/info")).json()) as { capabilities: string[] };
    expect(info.capabilities).toContain("form-files");
  });

  it("stops with the message: deleting it deletes its files", async () => {
    const path = await kept();
    const owner = await signInAs("owner");
    const [message] = await brim.forms.list();

    expect((await api("DELETE", "/admin/api/responses", await signInWithoutRole(), { id: message?.id })).status).toBe(
      403,
    );
    expect(storage.kept.size).toBe(1);
    expect((await api("DELETE", "/admin/api/responses", owner, { id: message?.id })).status).toBe(200);
    expect(storage.kept.size).toBe(0);
    expect((await api("GET", path, owner)).status).toBe(404);
  });

  it("says so when a message lists a file the site no longer has (content moved without its files)", async () => {
    const path = await kept();
    storage.kept.clear();
    const response = await api("GET", path, await signInAs("owner"));

    expect(response.status).toBe(404);
    expect(await error(response)).toBe("This file is no longer kept on this site.");
  });
});

describe("what a file is", () => {
  it("is read from its first bytes", () => {
    expect(sniffFileType(PDF)).toBe("pdf");
    expect(sniffFileType(PNG)).toBe("png");
    expect(sniffFileType(JPEG)).toBe("jpg");
    for (const bytes of [HTML, SVG, ZIP, EXE, new Uint8Array(0), encoder.encode("\n%PDF-1.7")]) {
      expect(sniffFileType(bytes)).toBeUndefined();
    }
  });

  it("a field takes only Brim's kinds: anything else written there falls back to the default ones", () => {
    expect(fileTypes(undefined)).toEqual(["pdf", "jpg", "png", "webp"]);
    expect(fileTypes("pdf, .JPG, image/png")).toEqual(["pdf", "jpg", "png"]);
    expect(fileTypes(["gif"])).toEqual(["gif"]);
    expect(fileTypes(["svg", "html", "*/*", "exe"])).toEqual(["pdf", "jpg", "png", "webp"]);
    expect(fileTypes("pdf, svg")).toEqual(["pdf"]);
  });
});

describe("where files are kept", () => {
  it("a sealed file opens only with the site's secret, and only unchanged", () => {
    const sealed = sealFile("secret-a", PDF);

    expect(openFile("secret-a", sealed)).toEqual(PDF);
    expect(openFile("secret-b", sealed)).toBeUndefined();
    expect(openFile("secret-a", sealed.subarray(0, 20))).toBeUndefined();
  });

  it("on disk: under the private folder by generated names, and nowhere a path could lead", async () => {
    const directory = mkdtempSync(join(tmpdir(), "brim-form-files-"));
    try {
      const disk = new DiskPrivateFiles(directory);
      const path = "0b0e5d4e-6f0a-4a3c-9d2b-7a1f3c5e8b10/7c9e6679-7425-40de-944b-e07fc1f90ae7";
      await disk.write(path, PDF);
      expect(await disk.read(path)).toEqual(PDF);
      for (const bad of ["../outside", "a/../../b", "/etc/passwd", `${path}/../../x`, "plain-name"]) {
        await expect(disk.write(bad, PDF)).rejects.toThrow("Not a form file.");
        await expect(disk.read(bad)).rejects.toThrow("Not a form file.");
        await expect(disk.remove(bad)).rejects.toThrow("Not a form file.");
      }
      await disk.remove(path);
      expect(await disk.read(path)).toBeUndefined();
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("in a private storage: PUT, GET and DELETE under /form-files with the site's key", async () => {
    const calls: { method: string; url: string; authorization: string | null }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return init?.method === undefined ? new Response(null, { status: 404 }) : new Response(null, { status: 201 });
    };
    const files = new HttpPrivateFiles("https://private.example/site-1/", { authorization: "Bearer key" }, fetcher);
    const path = "0b0e5d4e-6f0a-4a3c-9d2b-7a1f3c5e8b10/7c9e6679-7425-40de-944b-e07fc1f90ae7";

    await files.write(path, PDF);
    expect(await files.read(path)).toBeUndefined();
    await files.remove(path);
    await expect(files.write("../uploads/x.svg", SVG)).rejects.toThrow("Not a form file.");

    const address = `https://private.example/site-1/form-files/${path}`;
    expect(calls).toEqual([
      { method: "PUT", url: address, authorization: "Bearer key" },
      { method: "GET", url: address, authorization: "Bearer key" },
      { method: "DELETE", url: address, authorization: "Bearer key" },
    ]);
  });

  it("a site that keeps uploads in a storage takes files only once it is given a private one", () => {
    const directory = "/srv/site/.brim/form-files";
    expect(resolveFormFiles({ mediaInStorage: false, directory })).toBeInstanceOf(DiskPrivateFiles);
    expect(resolveFormFiles({ mediaInStorage: true, directory })).toBeUndefined();
    expect(
      resolveFormFiles({ mediaInStorage: true, directory, storage: { url: "https://private.example/site-1" } }),
    ).toBeInstanceOf(HttpPrivateFiles);

    vi.stubEnv("BRIM_PRIVATE_STORAGE_URL", "https://private.example/site-1");
    try {
      expect(resolveFormFiles({ mediaInStorage: true, directory })).toBeInstanceOf(HttpPrivateFiles);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
