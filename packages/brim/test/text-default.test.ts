import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, dev } from "astro";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { textDefaultError, unkeptTextMarkup } from "../src/content/text-default.ts";
import { connect } from "../src/runtime/connect.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = fileURLToPath(new URL("./fixtures/text-site/", import.meta.url));
// Built inside the site, so the server finds brimjs's own dependencies the way an installed site does.
const outDir = join(siteRoot, "dist");
const workDir = mkdtempSync(join(tmpdir(), "brim-text-"));
const EMAIL = "owner@example.test";
const PASSWORD = "a long enough password"; // betterleaks:allow (a test account in a temporary database)

beforeAll(() => {
  // The site imports `@brimsites/brimjs` like any site; this package is linked in as it, as pnpm links it into the examples.
  const linked = join(siteRoot, "node_modules", "@brimsites/brimjs");
  if (!existsSync(linked)) {
    mkdirSync(join(siteRoot, "node_modules", "@brimsites"), { recursive: true });
    symlinkSync(packageRoot, linked, "dir");
  }
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
  // What the runs left in the site, the link back to this package among them, so no tool walks in a circle.
  for (const made of [outDir, ...["node_modules", ".astro", ".brim"].map((name) => join(siteRoot, name))]) {
    rmSync(made, { recursive: true, force: true });
  }
});

/** The markup inside the page's heading, with its spaces collapsed as the browser shows them. */
function headingOf(html: string): string {
  const from = html.indexOf(">", html.search(/<h2[\s>]/)) + 1;
  return html.slice(from, html.indexOf("</h2>", from)).replace(/\s+/g, " ").trim();
}

describe("a Text's default content", () => {
  it("is kept whole when it holds only what the saved formatting can say", () => {
    expect(unkeptTextMarkup("Un spațiu al tău.<br>De la primul pas")).toBeUndefined();
    expect(unkeptTextMarkup('<strong>a</strong> <b>b</b> <em>c</em> <i>d</i> <a href="/x">e</a>')).toBeUndefined();
    expect(unkeptTextMarkup("<u>u</u><s>s</s><del>d</del><sub>2</sub><sup>3</sup><br/><br />")).toBeUndefined();
    expect(unkeptTextMarkup('<span style="color:#c00; background-color: rgb(1, 2, 3)">red</span>')).toBeUndefined();
    expect(unkeptTextMarkup("<!-- <div>a note</div> --> words &lt;p&gt;")).toBeUndefined();
  });

  it("ignores the attributes Astro adds for scoped styles and the dev toolbar", () => {
    const html =
      'One<br data-astro-cid-abc123><strong data-astro-cid-abc123 data-astro-source-file="/src/pages/index.astro" ' +
      'data-astro-source-loc="7:3">two</strong>';
    expect(unkeptTextMarkup(html)).toBeUndefined();
  });

  it("names a nested Brim element, which an edit would make disappear", () => {
    const html = 'Start with <a href="/contact" data-brim-node="cta-link" data-brim-kind="link">a call</a>';
    expect(unkeptTextMarkup(html)).toBe(
      'another Brim element, "cta-link" (<a href="/contact" data-brim-node="cta-link">)',
    );
  });

  it("names block elements, which belong in a RichText", () => {
    expect(unkeptTextMarkup("<p>One</p><p>Two</p>")).toBe("a block element, <p>");
    expect(unkeptTextMarkup("<ul><li>One</li></ul>")).toBe("a block element, <ul>");
    expect(unkeptTextMarkup("<div>Box</div>")).toBe("a block element, <div>");
  });

  it("names elements and attributes the saved formatting has no place for", () => {
    expect(unkeptTextMarkup('Our <span class="accent">studio</span>')).toBe(
      '<span class="accent">, with its "class" attribute',
    );
    expect(unkeptTextMarkup('<a href="/x" target="_blank">x</a>')).toContain('"target" attribute');
    expect(unkeptTextMarkup("<a>nowhere</a>")).toBe("<a>, a link without an address");
    expect(unkeptTextMarkup('<span style="font-weight:700">x</span>')).toContain("a style other than a color");
    expect(unkeptTextMarkup('<span style="color:red">x</span>')).toContain("a style other than a color");
    expect(unkeptTextMarkup('Logo <img src="/logo.svg" alt="">')).toBe('<img src="/logo.svg" alt="">');
    expect(unkeptTextMarkup("<code>npm</code>")).toBe("<code>");
  });

  it("says which Text it is and how to fix it", () => {
    const message = textDefaultError("cta", '<a href="/c" data-brim-node="cta-link">call</a>');
    expect(message).toContain('<Text nodeId="cta">');
    expect(message).toContain('"cta-link"');
    expect(message).toContain("<RichText>");
    expect(message).toContain("split it into several Text elements");
    expect(textDefaultError("motto", "Kept<br>whole")).toBeUndefined();
  });
});

describe("a Text's default content in dev", () => {
  let server: Awaited<ReturnType<typeof dev>>;
  let origin: string;

  beforeAll(async () => {
    process.env.BRIM_DATABASE_URL = `file:${join(workDir, "dev.db")}`; // betterleaks:allow (a temporary test database)
    // Astro leaves out its page handler when it sees Vitest, so the dev server is started without the sign.
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      server = await dev({ root: siteRoot, logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
    } finally {
      process.env.VITEST = vitest;
    }
    origin = `http://127.0.0.1:${server.address.port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    delete process.env.BRIM_DATABASE_URL;
  });

  /** Opens a page and returns what was drawn of it and what the dev server reported. */
  async function open(path: string): Promise<{ html: string; logged: string }> {
    const written: string[] = [];
    // Astro's logger writes to the standard error stream itself.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      const html = await (await fetch(`${origin}${path}`)).text();
      return { html, logged: written.join("") };
    } finally {
      stderr.mockRestore();
    }
  }

  it("is drawn as written when an edit keeps it whole", async () => {
    const { html, logged } = await open("/");
    // In dev, Astro marks each element with where it is in the source.
    expect(headingOf(html)).toMatch(
      /^Un spațiu al tău\. <br[^>]*> De la <strong[^>]*>primul<\/strong> <a href="\/pas"[^>]*>pas<\/a>$/,
    );
    expect(html).not.toContain("data-brim-unkept");
    expect(logged).toBe("");
  });

  it("stops the page, naming the Text, when it holds another Brim element", async () => {
    // The dev server shows the error over the page in the browser, and logs it.
    const { html, logged } = await open("/nested");
    expect(html).not.toContain("Start with");
    expect(logged).toContain('<Text nodeId="cta">');
    expect(logged).toContain('another Brim element, "cta-link"');
    expect(logged).toContain("<RichText>");
  });

  it("stops the page when it holds block elements", async () => {
    const { html, logged } = await open("/block");
    expect(html).not.toContain("First paragraph");
    expect(logged).toContain('<Text nodeId="intro">');
    expect(logged).toContain("a block element, <p>");
  });
});

describe("a Text's default content on the built server", () => {
  const databaseUrl = `file:${join(workDir, "server.db")}`; // betterleaks:allow (a temporary test database)
  let server: ChildProcess;
  let origin: string;
  let cookie: string;

  function send(method: string, path: string, body?: unknown, signedIn = false): Promise<Response> {
    return fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        ...(body !== undefined && { "content-type": "application/json" }),
        ...(signedIn && { cookie }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    const brim = await connect(databaseUrl);
    await brim.accounts.createUser(EMAIL, PASSWORD, "owner");
    await build({ root: siteRoot, outDir, logLevel: "silent" });

    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.on("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => resolve(free));
      });
    });
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
    const session = await send("POST", "/admin/api/session", { email: EMAIL, password: PASSWORD }); // betterleaks:allow
    cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }, 120_000);

  afterAll(() => {
    server?.kill();
  });

  it("draws a page the edit would not keep whole for visitors as before, without checking it", async () => {
    const response = await send("GET", "/nested");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(headingOf(html)).toBe('Start with <a href="/contact"> a call </a>');
    expect(html).not.toContain("data-brim");
  });

  it("draws it for the signed-in owner too, marked so the editor will not let them type into it", async () => {
    const html = await (await send("GET", "/nested", undefined, true)).text();
    expect(html).toMatch(/<h2 [^>]*data-brim-node="cta"[^>]*data-brim-unkept[^>]*>/);
    expect(headingOf(html)).toMatch(/^Start with <a data-brim-node="cta-link"[^>]*> a call <\/a>$/);
  });

  it("draws the same markup after the owner saves the text unchanged", async () => {
    const before = headingOf(await (await send("GET", "/")).text());
    expect(before).toBe('Un spațiu al tău. <br> De la <strong>primul</strong> <a href="/pas">pas</a>');
    const editing = await (await send("GET", "/", undefined, true)).text();
    expect(editing).not.toContain("data-brim-unkept");

    // What the editor reads from the element above, its spaces collapsed, and sends when the owner saves it.
    const rich = [
      "Un spațiu al tău. ",
      { tag: "br", children: [] },
      " De la ",
      { tag: "strong", children: ["primul"] },
      " ",
      { tag: "a", href: "/pas", children: ["pas"] },
    ];
    const value = { text: "Un spațiu al tău. De la primul pas", rich };
    const node = { path: "/", scope: "page", nodeId: "motto", kind: "text", value };
    expect((await send("PUT", "/admin/api/nodes", node, true)).status).toBe(200);

    expect(headingOf(await (await send("GET", "/")).text())).toBe(before);
  });
});
