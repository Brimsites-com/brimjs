import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { type PageGate, accessCookieName, pageGate } from "../src/runtime/page-access.ts";
import { RateLimiter } from "../src/server/rate-limit.ts";

const URL_OF_PAGE = "https://acme.test/members";
let gate: Omit<PageGate, "request">;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  gate = {
    path: "/members",
    hash: await hashPassword("open sesame"),
    secret: "site-secret",
    server: true,
    clientAddress: "203.0.113.7",
    rateLimiter: new RateLimiter(db),
    siteName: "Acme",
  };
});

function post(password: string, cookie?: string): Request { // betterleaks:allow
  return new Request(URL_OF_PAGE, {
    method: "POST",
    body: new URLSearchParams({ brim_page_password: password }), // betterleaks:allow
    headers: cookie ? { cookie } : {},
  });
}

describe("a password-protected page", () => {
  it("shows visitors a password form, never the page, and keeps it out of caches and search", async () => {
    const response = await pageGate({ ...gate, request: new Request(URL_OF_PAGE) });

    expect(response?.status).toBe(401);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
    expect(await response?.text()).toContain('name="brim_page_password"');
  });

  it("refuses a wrong password", async () => {
    const response = await pageGate({ ...gate, request: post("guess") });

    expect(response?.status).toBe(401);
    expect(await response?.text()).toContain("That password is not right.");
  });

  it("opens the page once the right password is given, until the password changes", async () => {
    const opened = await pageGate({ ...gate, request: post("open sesame") });
    const cookie = (opened?.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    expect(opened?.status).toBe(303);
    expect(opened?.headers.get("location")).toBe("/members");
    expect(opened?.headers.get("set-cookie")).toContain("Path=/members;");
    expect(cookie.startsWith(`${accessCookieName("/members")}=`)).toBe(true);
    expect(await pageGate({ ...gate, request: new Request(URL_OF_PAGE, { headers: { cookie } }) })).toBeUndefined();

    const changed = { ...gate, hash: await hashPassword("new password") };
    expect((await pageGate({ ...changed, request: new Request(URL_OF_PAGE, { headers: { cookie } }) }))?.status).toBe(
      401,
    );
  });

  it("opens no other protected page with the same visit", async () => {
    const opened = await pageGate({ ...gate, request: post("open sesame") });
    const cookie = (opened?.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const other = { ...gate, path: "/partners" };

    expect(
      (await pageGate({ ...other, request: new Request("https://acme.test/partners", { headers: { cookie } }) }))
        ?.status,
    ).toBe(401);
  });

  it("stops guessing after ten attempts", async () => {
    for (let attempt = 0; attempt < 10; attempt++) await pageGate({ ...gate, request: post(`guess ${attempt}`) });

    expect((await pageGate({ ...gate, request: post("open sesame") }))?.status).toBe(429);
  });

  it("is left out of a static build, which has no server to ask for the password", async () => {
    const response = await pageGate({ ...gate, server: false, request: new Request(URL_OF_PAGE) });

    expect(await response?.text()).not.toContain("<form");
  });
});
