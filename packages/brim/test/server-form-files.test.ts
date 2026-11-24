import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { solveWork } from "../src/forms/work.ts";
import { connect } from "../src/runtime/connect.ts";

/**
 * A visitor's file from the page to the owner's download, on the built server as a host runs it: uploads on the
 * server's own disk, so files are kept beside the database.
 */
const exampleRoot = fileURLToPath(new URL("../../../examples/basic/", import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), "brim-form-files-server-"));
const outDir = join(workDir, "dist");
const databaseUrl = `file:${join(workDir, "data.db")}`; // betterleaks:allow (a temporary test database)
const PASSWORD = "a long enough password"; // betterleaks:allow (a test account in a temporary database)
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");

let server: ChildProcess;
let origin: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function signIn(email: string): Promise<string> {
  const session = await fetch(`${origin}/admin/api/session`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }), // betterleaks:allow
  });
  return (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

beforeAll(async () => {
  const brim = await connect(databaseUrl);
  await brim.accounts.createUser("owner@example.test", PASSWORD, "owner");
  await brim.accounts.createUser("writer@example.test", PASSWORD, "writer");
  await build({ root: exampleRoot, outDir, logLevel: "silent", site: "https://acme.test" });
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(outDir, "server", "entry.mjs")], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), BRIM_DATABASE_URL: databaseUrl }, // betterleaks:allow
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const up = await fetch(`${origin}/admin/api/info`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 120_000);

afterAll(() => {
  server?.kill();
  rmSync(workDir, { recursive: true, force: true });
});

describe("a visitor's file on the built server", () => {
  it("goes from the page's form to the owner's download, and nowhere a visitor can reach", async () => {
    const html = await (await fetch(`${origin}/quote`)).text();
    expect(html).toMatch(/<input[^>]*name="plan"[^>]*type="file"[^>]*accept=".pdf,.jpg,.png"[^>]*multiple/);
    const spec = /data-spec="([^"]+)"/.exec(html)?.[1] ?? "";
    const signature = /data-signature="([^"]+)"/.exec(html)?.[1] ?? "";
    const { token } = (await (await fetch(`${origin}/_brim/forms/token`)).json()) as { token: string };
    // A person takes a few seconds over a form.
    await new Promise((resolve) => setTimeout(resolve, 2_200));

    const body = new FormData();
    body.set("spec", spec);
    body.set("signature", signature);
    body.set("trap", "");
    body.set("consent", "false");
    body.set("values", JSON.stringify({ name: "Ana", email: "ana@example.test" }));
    body.append("plan", new File([PDF], "garden plan.pdf", { type: "application/pdf" }));
    const sent = await fetch(`${origin}/_brim/forms/submit`, {
      method: "POST",
      // What a browser sends with a form posted on the same site; Astro refuses a multipart post without it.
      headers: { origin, "sec-fetch-site": "same-origin", "x-brim-form-token": token, "x-brim-form-work": String(solveWork(token)) },
      body,
    });
    expect(sent.status).toBe(200);

    const owner = await signIn("owner@example.test");
    const { responses } = (await (
      await fetch(`${origin}/admin/api/responses`, { headers: { cookie: owner } })
    ).json()) as { responses: { id: string; files: { id: string; name: string; mime: string; size: number }[] }[] };
    const [message] = responses;
    expect(message?.files).toMatchObject([{ name: "garden plan.pdf", mime: "application/pdf", size: PDF.byteLength }]);

    // On the server's disk beside the database, sealed; never under the public uploads.
    const kept = join(workDir, "form-files", message?.id ?? "", message?.files[0]?.id ?? "");
    expect(existsSync(kept)).toBe(true);
    const path = `/admin/api/responses/${message?.id}/files/${message?.files[0]?.id}`;
    expect((await fetch(`${origin}${path}`)).status).toBe(401);
    expect((await fetch(`${origin}${path}`, { headers: { cookie: await signIn("writer@example.test") } })).status).toBe(
      403,
    );
    for (const guess of [
      `/uploads/${message?.id}/${message?.files[0]?.id}`,
      `/form-files/${message?.id}/${message?.files[0]?.id}`,
      `/.brim/form-files/${message?.id}/${message?.files[0]?.id}`,
    ]) {
      expect((await fetch(`${origin}${guess}`)).status, guess).toBe(404);
    }

    const download = await fetch(`${origin}${path}`, { headers: { cookie: owner } });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF);
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("cache-control")).toBe("no-store, private");

    // Deleted with its message.
    const deleted = await fetch(`${origin}/admin/api/responses`, {
      method: "DELETE",
      headers: { origin, cookie: owner, "content-type": "application/json" },
      body: JSON.stringify({ id: message?.id }),
    });
    expect(deleted.status).toBe(200);
    expect(existsSync(kept)).toBe(false);
    expect(readdirSync(join(workDir, "form-files"))).toEqual([]);
  }, 30_000);

  it("refuses a message larger than a message may be", async () => {
    const { token } = (await (await fetch(`${origin}/_brim/forms/token`)).json()) as { token: string };
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const body = new FormData();
    body.append("plan", new File([new Uint8Array(12 * 1024 * 1024)], "huge.pdf"));
    const sent = await fetch(`${origin}/_brim/forms/submit`, {
      method: "POST",
      // What a browser sends with a form posted on the same site; Astro refuses a multipart post without it.
      headers: { origin, "sec-fetch-site": "same-origin", "x-brim-form-token": token, "x-brim-form-work": String(solveWork(token)) },
      body,
    }).then(
      (response) => response.status,
      // A server may also close the connection on a body it will not read.
      () => 413,
    );

    expect(sent).toBe(413);
    expect(readdirSync(join(workDir, "form-files"), { recursive: true }).length).toBe(0);
  }, 30_000);
});
