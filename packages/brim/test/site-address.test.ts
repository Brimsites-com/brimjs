import { describe, expect, it } from "vitest";
import { siteAddress } from "../src/integration.ts";

describe("the site's address from its host (BRIM_SITE_URL)", () => {
  it("takes an http or https address, as its origin", () => {
    expect(siteAddress("https://www.studionord.ro/")).toBe("https://www.studionord.ro");
    expect(siteAddress(" https://studionord.brimsites.com/blog ")).toBe("https://studionord.brimsites.com");
    expect(siteAddress("http://localhost:4321")).toBe("http://localhost:4321");
  });

  it("is nothing when unset or not an address", () => {
    expect(siteAddress(undefined)).toBeUndefined();
    expect(siteAddress("")).toBeUndefined();
    expect(siteAddress("studionord.ro")).toBeUndefined();
    expect(siteAddress("ftp://studionord.ro")).toBeUndefined();
  });
});
