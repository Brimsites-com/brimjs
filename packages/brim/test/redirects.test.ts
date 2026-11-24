import { describe, expect, it } from "vitest";
import { parseRedirects, redirectFor, redirectsAfterMove } from "../src/content/redirects.ts";

describe("redirects", () => {
  it("normalizes the old address and keeps a query or anchor on the new one", () => {
    expect(parseRedirects([{ from: "/old/?utm=1", to: "/new/?tab=2" }])).toEqual([{ from: "/old", to: "/new?tab=2" }]);
  });

  it("refuses Brim's own routes, a redirect to itself, duplicates and other schemes", () => {
    expect(() => parseRedirects([{ from: "/admin/edit", to: "/" }])).toThrow(/belongs to Brim/);
    expect(() => parseRedirects([{ from: "/a", to: "/a/" }])).toThrow(/to itself/);
    expect(() =>
      parseRedirects([
        { from: "/a", to: "/b" },
        { from: "/a/", to: "/c" },
      ]),
    ).toThrow(/twice/);
    expect(() => parseRedirects([{ from: "/a", to: "javascript:alert(1)" }])).toThrow(/full address/);
    expect(() => parseRedirects([{ from: "a", to: "/b" }])).toThrow(/starting with/);
  });

  it("refuses a chain that leads back to where it started", () => {
    const chain = [
      { from: "/a", to: "/b" },
      { from: "/b", to: "/c?x=1" },
      { from: "/c", to: "/a" },
    ];
    expect(() => parseRedirects(chain)).toThrow(/leads back/);
  });

  it("answers permanent or temporary, with the visitor's query when the target has none", () => {
    const redirects = [
      { from: "/old", to: "/new" },
      { from: "/sale", to: "/shop?season=summer", temporary: true },
    ];
    const moved = redirectFor(redirects, "/old/", "?ref=mail");
    const sale = redirectFor(redirects, "/sale", "?ref=mail");

    expect(moved?.status).toBe(301);
    expect(moved?.headers.get("location")).toBe("/new?ref=mail");
    expect(sale?.status).toBe(302);
    expect(sale?.headers.get("location")).toBe("/shop?season=summer");
    expect(redirectFor(redirects, "/elsewhere", "")).toBeUndefined();
  });

  it("after a move, sends the old address and every redirect to it straight to the new one", () => {
    const before = [
      { from: "/short", to: "/services/lawn#prices" },
      { from: "/services/lawn-care", to: "/elsewhere" },
    ];
    expect(redirectsAfterMove(before, "/services/lawn", "/services/lawn-care")).toEqual([
      { from: "/short", to: "/services/lawn-care#prices" },
      { from: "/services/lawn", to: "/services/lawn-care" },
    ]);
  });
});
