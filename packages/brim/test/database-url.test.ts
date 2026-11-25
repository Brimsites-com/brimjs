import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDatabase } from "../src/config.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { assertSecureDatabaseUrl, splitDatabaseUrl } from "../src/db/url.ts";
import brim from "../src/index.ts";

describe("a database's address", () => {
  it("is refused when it would be reached unencrypted over the internet", () => {
    for (const url of [
      "http://db.example.com",
      "HTTP://db.example.com",
      "ws://db.example.com",
      "libsql://db.example.com:8080?tls=0",
      "http://93.184.216.34:8080",
      "http://172.32.0.1",
    ]) {
      expect(() => assertSecureDatabaseUrl(url), url).toThrow(/unencrypted/);
    }
    expect(() => openDatabase("http://db.example.com", "token")).toThrow(/unencrypted/);
  });

  it("may be encrypted, a file, or on this computer or a private network", () => {
    for (const url of [
      "libsql://db.example.com",
      "https://db.example.com",
      "wss://db.example.com",
      "file:./.brim/data.db",
      ":memory:",
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://[::1]:8080",
      "http://sqld:8080",
      "http://10.0.0.4:8080",
      "ws://172.20.0.2",
      "http://db.internal",
    ]) {
      expect(() => assertSecureDatabaseUrl(url), url).not.toThrow();
    }
  });

  it("gives up the token written in it", () => {
    expect(splitDatabaseUrl("libsql://db.example.com?authToken=a%2Bb&tls=1")).toEqual({
      url: "libsql://db.example.com?tls=1",
      authToken: "a+b",
    });
    expect(splitDatabaseUrl("libsql://db.example.com?authToken=abc").url).toBe("libsql://db.example.com");
    expect(splitDatabaseUrl("file:./a.db?cache=shared")).toEqual({
      url: "file:./a.db?cache=shared",
      authToken: undefined,
    });
    expect(resolveDatabase({ database: "libsql://db.example.com?authToken=abc" }, "/site")).toEqual({
      databaseUrl: "libsql://db.example.com",
      authToken: "abc",
    });
  });
});

describe("a build", () => {
  const exampleRoot = fileURLToPath(new URL("../../../examples/basic/", import.meta.url));
  const workDir = mkdtempSync(join(tmpdir(), "brim-token-"));
  const before = process.env.BRIM_DATABASE_TOKEN;
  const TOKEN = "token-that-stays-out-of-the-build"; // betterleaks:allow (a made-up token)

  beforeAll(async () => {
    delete process.env.BRIM_DATABASE_TOKEN;
    mkdirSync(join(workDir, "dist"), { recursive: true });
    await build({
      root: exampleRoot,
      configFile: false,
      outDir: join(workDir, "dist"),
      logLevel: "silent",
      site: "https://acme.test",
      integrations: [brim({ database: `file:${join(workDir, "data.db")}`, authToken: TOKEN })],
    });
  }, 120_000);

  afterAll(() => {
    if (before === undefined) delete process.env.BRIM_DATABASE_TOKEN;
    else process.env.BRIM_DATABASE_TOKEN = before; // betterleaks:allow
    rmSync(workDir, { recursive: true, force: true });
  });

  it("never holds the token of astro.config: the server reads BRIM_DATABASE_TOKEN where it runs", () => {
    const files = readdirSync(join(workDir, "dist"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(m?js|json|html)$/.test(entry.name))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((text) => text.includes("process.env.BRIM_DATABASE_TOKEN"))).toBe(true);
    expect(files.filter((text) => text.includes(TOKEN))).toEqual([]);
  });
});
