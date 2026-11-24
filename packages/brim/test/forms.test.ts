import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { Accounts } from "../src/auth/accounts.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { type FormsHandler, createFormsHandler } from "../src/forms/handler.ts";
import { type FormSpec, encodeSpec, openAddress, sealAddress, sign } from "../src/forms/spec.ts";
import { RateLimiter } from "../src/server/rate-limit.ts";
import { WORK_BITS, solveWork, workDone } from "../src/forms/work.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";

const ORIGIN = "https://acme.example";
const visitor = { clientAddress: "203.0.113.7" };
const contact: FormSpec = {
  form: "/contact#contact-form",
  title: "Contact",
  consentRequired: false,
  fields: [
    { name: "email", label: "Email", type: "email", required: true },
    { name: "topic", label: "Topic", type: "select", required: false, options: ["Sales", "Support"] },
    { name: "message", label: "Message", type: "textarea", required: true },
  ],
};

let brim: Brim;
let forms: FormsHandler;

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
  forms = createFormsHandler(brim);
});

afterEach(() => vi.useRealTimers());

async function request(method: string, path: string, body?: unknown, origin = ORIGIN): Promise<Response> {
  const response = await forms(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { origin, ...(body !== undefined && { "content-type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    visitor,
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

async function token(): Promise<string> {
  return ((await (await request("GET", "/_brim/forms/token")).json()) as { token: string }).token;
}

/** A submission as the page's script sends it, after a person took a few seconds to fill the form. */
async function submission(overrides: Record<string, unknown> = {}, spec = contact): Promise<Record<string, unknown>> {
  const encoded = encodeSpec(spec);
  const issued = await token();
  vi.advanceTimersByTime(5_000);
  return {
    spec: encoded,
    signature: sign(await brim.forms.secret(), encoded),
    token: issued,
    work: solveWork(issued, Number(issued.split(".")[2])),
    trap: "",
    values: { email: "ana@example.test", topic: "Sales", message: "Hello" },
    ...overrides,
  };
}

const submit = (body: unknown, origin?: string): Promise<Response> =>
  request("POST", "/_brim/forms/submit", body, origin);

describe("a genuine submission", () => {
  it("is stored with the labels of the fields it answers", async () => {
    const response = await submit(
      await submission({ values: { email: "ana@example.test", message: "Hello", extra: "ignored" } }),
    );

    expect(response.status).toBe(200);
    expect(await brim.forms.list()).toMatchObject([
      {
        form: "/contact#contact-form",
        title: "Contact",
        answers: [
          { label: "Email", value: "ana@example.test" },
          { label: "Message", value: "Hello" },
        ],
      },
    ]);
  });
});

describe("the email about a message", () => {
  it("links to that very message in the editor", async () => {
    const sent: { html: string; text: string }[] = [];
    const mailer = {
      delivery: () => "smtp" as const,
      send: async (_settings: unknown, message: { html: string; text: string }) => {
        sent.push(message);
      },
    };
    await brim.accounts.createUser("owner@example.test", "a long password 1", "owner"); // betterleaks:allow
    forms = createFormsHandler(brim, { mailer: mailer as never });
    expect((await submit(await submission())).status).toBe(200);
    const id = (await brim.forms.list())[0]?.id;
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.html).toContain(`/admin/edit?response=${id}`);
  });
});

describe("a field of several choices", () => {
  const rooms = {
    ...contact,
    fields: [
      ...contact.fields,
      {
        name: "rooms",
        label: "Rooms",
        type: "checkboxes" as const,
        required: true,
        options: ["Living", "Kitchen", "Bath"],
      },
    ],
  };
  const values = (picked: unknown) => ({ email: "ana@example.test", message: "Hello", rooms: picked });

  it("keeps the choices ticked as one answer", async () => {
    const response = await submit(await submission({ values: values(["Living", "Bath", "Living"]) }, rooms));
    expect(response.status).toBe(200);
    expect((await brim.forms.list())[0]?.answers).toContainEqual({
      label: "Rooms",
      value: "Living, Bath",
      // Kept with what the question offered, so the editor shows the answer as the form showed it.
      choices: [{ label: "Living" }, { label: "Kitchen" }, { label: "Bath" }],
      picked: ["Living", "Bath"],
    });
  });

  it("keeps the choices picked whole, commas in their words and all", async () => {
    const styles = {
      ...contact,
      fields: [
        ...contact.fields,
        {
          name: "style",
          label: "Style",
          type: "checkboxes" as const,
          required: true,
          options: ["Warm, natural", "Calm"],
        },
      ],
    };
    const response = await submit(
      await submission(
        { values: { email: "ana@example.test", message: "Hello", style: ["Warm, natural", "Calm"] } },
        styles,
      ),
    );
    expect(response.status).toBe(200);
    expect((await brim.forms.list())[0]?.answers.find((answer) => answer.label === "Style")?.picked).toEqual([
      "Warm, natural",
      "Calm",
    ]);
  });

  it("refuses a choice the field does not offer, and none when one is required", async () => {
    expect((await submit(await submission({ values: values(["Garage"]) }, rooms))).status).toBe(422);
    expect((await submit(await submission({ values: values([]) }, rooms))).status).toBe(422);
  });
});

describe("a field asked only after another answer", () => {
  const city = {
    ...contact,
    fields: [
      ...contact.fields,
      { name: "place", label: "Place", type: "radio" as const, required: true, options: ["Here", "Other"] },
      {
        name: "town",
        label: "Town",
        type: "text" as const,
        required: true,
        showWhen: { field: "place", equals: ["Other"] },
      },
    ],
  };
  const values = (extra: Record<string, unknown>) => ({ email: "ana@example.test", message: "Hello", ...extra });

  it("is neither required nor kept while that answer is not given", async () => {
    const response = await submit(await submission({ values: values({ place: "Here", town: "Sneaked in" }) }, city));
    expect(response.status).toBe(200);
    expect((await brim.forms.list())[0]?.answers.map((answer) => answer.label)).not.toContain("Town");
  });

  it("is required once it is", async () => {
    expect((await submit(await submission({ values: values({ place: "Other" }) }, city))).status).toBe(422);
    expect((await submit(await submission({ values: values({ place: "Other", town: "Cluj" }) }, city))).status).toBe(
      200,
    );
  });
});

describe("abuse", () => {
  it("rejects a form the site did not sign", async () => {
    const forged = encodeSpec({ ...contact, fields: [] });
    const response = await submit(await submission({ spec: forged }));

    expect(response.status).toBe(400);
    expect(await brim.forms.list()).toEqual([]);
  });

  it("rejects a submission sent from another site", async () => {
    expect((await submit(await submission(), "https://evil.example")).status).toBe(403);
  });

  it("rejects a submission without a token, or with one the site did not issue", async () => {
    expect((await submit(await submission({ token: undefined }))).status).toBe(400);
    expect((await submit(await submission({ token: `${Date.now() - 5000}.abc.forged` }))).status).toBe(400);
  });

  it("rejects a submission whose browser did not do the work its token asks for", async () => {
    const response = await request("GET", "/_brim/forms/token");
    expect(((await response.json()) as { work: number }).work).toBe(WORK_BITS);
    const body = await submission();
    const lazy = [0, 1, 2, 3, 4, 5].find((nonce) => !workDone(body.token as string, nonce)) ?? 0;

    expect((await submit({ ...body, work: undefined })).status).toBe(400);
    expect((await submit({ ...body, work: lazy })).status).toBe(400);
    expect((await submit({ ...body, work: "12" })).status).toBe(400);
    // Refused for the work, the token is still good: the visitor's next try is not refused as already sent.
    expect((await submit(body)).status).toBe(200);
  });

  it("asks for more work while the site is being sent many messages, and the token keeps what it asked", async () => {
    const work = async () =>
      (await (await request("GET", "/_brim/forms/token")).json()) as { token: string; work: number };
    expect((await work()).work).toBe(WORK_BITS);
    const body = await submission({ trap: "spam" });
    for (let i = 0; i < 30; i++) await submit(body);
    const busy = await work();
    expect(busy.work).toBe(18);
    // A script cannot rewrite the level into its token: the token signs it.
    const [issuedAt, nonce, , signature] = busy.token.split(".");
    const easier = `${issuedAt}.${nonce}.${WORK_BITS}.${signature}`;
    vi.advanceTimersByTime(5_000);
    expect((await submit({ ...body, trap: "", token: easier, work: solveWork(easier) })).status).toBe(400);
    // The window after still remembers the one before; two windows on, the site is quiet again.
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect((await work()).work).toBe(18);
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect((await work()).work).toBe(WORK_BITS);
  });

  it("rejects a submission sent faster than a person could fill the form", async () => {
    const body = await submission();
    body.token = await token();
    body.work = solveWork(body.token as string, WORK_BITS);

    expect((await submit(body)).status).toBe(429);
  });

  it("accepts a token only once", async () => {
    const body = await submission();
    await submit(body);

    expect((await submit(body)).status).toBe(400);
    expect(await brim.forms.list()).toHaveLength(1);
  });

  it("rejects a token that is too old", async () => {
    const body = await submission();
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);

    expect((await submit(body)).status).toBe(400);
  });

  it("pretends to accept a submission that filled the hidden trap field, and stores nothing", async () => {
    const response = await submit(await submission({ trap: "http://spam.example" }));

    expect(response.status).toBe(200);
    expect(await brim.forms.list()).toEqual([]);
  });

  it("stops one visitor after five messages to the same form", async () => {
    for (let count = 0; count < 5; count++) expect((await submit(await submission())).status).toBe(200);

    expect((await submit(await submission())).status).toBe(429);
    expect(await brim.forms.list()).toHaveLength(5);
  });
});

describe("validation", () => {
  it.each([
    ["a missing required field", { email: "ana@example.test", message: "" }],
    ["a malformed e-mail address", { email: "not-an-email", message: "Hello" }],
    ["a choice the form does not offer", { email: "ana@example.test", topic: "Free money", message: "Hello" }],
    ["a message that is far too long", { email: "ana@example.test", message: "x".repeat(10_001) }],
  ])("rejects %s", async (_name, values) => {
    const response = await submit(await submission({ values }));

    expect(response.status).toBe(422);
    expect(await brim.forms.list()).toEqual([]);
  });

  it("requires consent when the form does", async () => {
    const withConsent = { ...contact, consentRequired: true };

    expect((await submit(await submission({}, withConsent))).status).toBe(422);
    expect((await submit(await submission({ consent: true }, withConsent))).status).toBe(200);
  });
});

describe("a challenge (Turnstile, hCaptcha)", () => {
  let asked: URLSearchParams[];
  let passes: boolean;
  const provider: typeof fetch = async (_url, init) => {
    asked.push(new URLSearchParams(String(init?.body)));
    return Response.json({ success: passes });
  };

  beforeEach(() => {
    asked = [];
    passes = true;
    forms = createFormsHandler(brim, { captcha: { provider: "turnstile", secret: "captcha-secret" }, fetch: provider });
  });

  it("lets a message through once its provider says the challenge was passed", async () => {
    expect((await submit(await submission({ captcha: "answer-1" }))).status).toBe(200);

    expect(await brim.forms.list()).toHaveLength(1);
    expect(asked.map((params) => Object.fromEntries(params))).toEqual([
      { secret: "captcha-secret", response: "answer-1", remoteip: visitor.clientAddress },
    ]);
  });

  it("refuses a message without the challenge's answer, or with one the provider refuses", async () => {
    expect((await submit(await submission())).status).toBe(400);
    passes = false;
    expect((await submit(await submission({ captcha: "forged" }))).status).toBe(400);

    expect(await brim.forms.list()).toEqual([]);
  });

  it("sends nothing unchecked when the server has no secret key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    forms = createFormsHandler(brim, { captcha: { provider: "turnstile", secret: undefined }, fetch: provider });

    expect((await submit(await submission({ captcha: "answer-1" }))).status).toBe(503);
    expect(await brim.forms.list()).toEqual([]);
    expect(asked).toEqual([]);
    error.mockRestore();
  });
});

describe("the form's notification address", () => {
  it("is sealed for the page: unreadable there, opened only with the site's secret", async () => {
    const secret = await brim.forms.secret();
    const sealed = sealAddress(secret, "boss@acme.example");

    expect(Buffer.from(encodeSpec({ ...contact, notify: sealed }), "base64url").toString()).not.toContain("boss");
    expect(openAddress(secret, sealed)).toBe("boss@acme.example");
    expect(openAddress("another site's secret", sealed)).toBeUndefined();
    expect(openAddress(secret, `${sealed.slice(0, -2)}xx`)).toBeUndefined();
    // A page made before addresses were sealed still names its address plainly, under the site's signature.
    expect(openAddress(secret, "boss@acme.example")).toBe("boss@acme.example");
  });
});

describe("the site's daily limit", () => {
  it("stops keeping messages only far past any real use", async () => {
    const now = Math.floor(Date.now() / 1000);
    await brim.db.query("INSERT INTO brim_rate_limits (key, window_start, count) VALUES (?, ?, ?)", [
      "form:site-kept",
      now - (now % (24 * 60 * 60)),
      5_000,
    ]);

    expect((await submit(await submission())).status).toBe(429);
    expect(await brim.forms.list()).toEqual([]);
  });
});

describe("rate limit rows", () => {
  it("are cleared once their window ended long ago, so the table does not grow without end", async () => {
    const limiter = new RateLimiter(brim.db);
    await limiter.allow("form-used:old", 1, 2 * 60 * 60);
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);

    await limiter.allow("form-used:new", 1, 2 * 60 * 60);

    const keys = (await brim.db.query("SELECT key FROM brim_rate_limits")).map((row) => row.key);
    expect(keys).toEqual(["form-used:new"]);
  });

  it("refuse a window longer than the one rows are kept for", async () => {
    await expect(new RateLimiter(brim.db).allow("x", 1, 3 * 24 * 60 * 60)).rejects.toThrow(/at most/);
  });
});

it("leaves every other path to the site", async () => {
  expect(await forms(new Request(`${ORIGIN}/contact`), visitor)).toBeUndefined();
});
