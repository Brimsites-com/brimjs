import { describe, expect, it } from "vitest";
import {
  CONSENT_MAX_AGE,
  deletions,
  isStatisticsCookie,
  measurementId,
  readChoice,
} from "../src/blocks/analytics/consent.ts";

describe("visitor statistics", () => {
  it("takes a Google Analytics 4 id and refuses anything else, since it goes into the page", () => {
    expect(measurementId(undefined)).toBeUndefined();
    expect(measurementId("  ")).toBeUndefined();
    expect(measurementId(" g-abc1234567 ")).toBe("G-ABC1234567");
    for (const wrong of ["UA-12345-1", "G-", 'G-1"><script>', "GTM-ABCDEF"]) {
      expect(() => measurementId(wrong)).toThrow(/BRIM_GOOGLE_ANALYTICS_ID/);
    }
  });

  it("keeps a choice for 180 days and asks again after that, or when it cannot be read", () => {
    const now = 1_800_000_000_000;
    const at = (made: number) => readChoice(JSON.stringify({ statistics: true, at: made }), now);
    expect(at(now - 1000)).toEqual({ statistics: true, at: now - 1000 });
    expect(at(now - CONSENT_MAX_AGE)).toBeNull();
    expect(at(now + 1000)).toBeNull();
    for (const raw of [null, "", "{", "true", '{"statistics":"yes","at":1}']) expect(readChoice(raw, now)).toBeNull();
  });

  it("deletes its cookies on the host name alone and on every domain above it, where a tag may have set them", () => {
    expect(["_ga", "_ga_ABC123"].every(isStatisticsCookie)).toBe(true);
    expect(["_gat", "ga", "brim_session", ""].some(isStatisticsCookie)).toBe(false);
    expect(deletions("_ga", "blog.studio.example")).toEqual([
      "_ga=; Max-Age=0; Path=/",
      "_ga=; Max-Age=0; Path=/; Domain=blog.studio.example",
      "_ga=; Max-Age=0; Path=/; Domain=studio.example",
    ]);
    expect(deletions("_ga", "studio.example")).toContain("_ga=; Max-Age=0; Path=/; Domain=studio.example");
    for (const host of ["localhost", "127.0.0.1", "[::1]"])
      expect(deletions("_ga", host)).toEqual(["_ga=; Max-Age=0; Path=/"]);
  });
});
