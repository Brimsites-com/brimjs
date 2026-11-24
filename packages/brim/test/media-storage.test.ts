import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkMedia, resolveMedia } from "../src/config.ts";
import { HttpFiles, MediaStore, uploadResponse } from "../src/content/media.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ENV = [
  "BRIM_MEDIA_STORAGE_URL",
  "BRIM_MEDIA_STORAGE_TOKEN",
  "BRIM_MEDIA_PUBLIC_URL",
  "BRIM_MEDIA_RESIZE",
  "BRIM_MEDIA_SITE_URL",
  "BRIM_MEDIA_SHARP",
];

afterEach(() => {
  for (const name of ENV) delete process.env[name];
});

describe("the media option", () => {
  it("keeps uploads on the server's disk, at full size, when nothing is set", () => {
    expect(resolveMedia()).toEqual({ widths: [320, 640, 960, 1280, 1920, 2560] });
  });

  it("takes the address of the site's own pictures from the config or the host's environment", () => {
    expect(resolveMedia({ siteUrl: "https://cdn.example/site/deploy-1/" }).siteUrl).toBe(
      "https://cdn.example/site/deploy-1",
    );
    process.env.BRIM_MEDIA_SITE_URL = "https://cdn.example/site/deploy-2";
    expect(resolveMedia({ siteUrl: "https://cdn.example/site/deploy-1" }).siteUrl).toBe(
      "https://cdn.example/site/deploy-2",
    );
    expect(() => checkMedia({ siteUrl: "cdn.example/site" })).toThrow(/siteUrl/);
  });

  it("makes copies on the server with sharp only when asked, and lets the host turn it on or off", () => {
    expect(resolveMedia().sharp).toBeUndefined();
    expect(resolveMedia({ sharp: true }).sharp).toBe(true);
    process.env.BRIM_MEDIA_SHARP = "0";
    expect(resolveMedia({ sharp: true }).sharp).toBeUndefined();
    process.env.BRIM_MEDIA_SHARP = "1";
    expect(resolveMedia().sharp).toBe(true);
  });

  it("reads storage, public address, resize and widths from the config", () => {
    const media = resolveMedia({
      storage: { url: "https://storage.example/site/", headers: { "x-key": "k" } },
      publicUrl: "https://cdn.example/site/",
      resize: "{url}?width={width}",
      widths: [800, 400, 400],
    });
    expect(media).toEqual({
      storage: { url: "https://storage.example/site", headers: { "x-key": "k" } },
      publicUrl: "https://cdn.example/site",
      resize: "{url}?width={width}",
      widths: [400, 800],
    });
  });

  it("lets the environment win, the storage's token sent as a bearer", () => {
    process.env.BRIM_MEDIA_STORAGE_URL = "https://host.example/media/site-1";
    process.env.BRIM_MEDIA_STORAGE_TOKEN = "test-token"; // betterleaks:allow (a test value)
    process.env.BRIM_MEDIA_PUBLIC_URL = "https://media.example/site-1";
    process.env.BRIM_MEDIA_RESIZE = "{url}?width={width}";
    expect(
      resolveMedia({ storage: { url: "https://other.example" }, publicUrl: "https://other.example" }),
    ).toMatchObject({
      storage: { url: "https://host.example/media/site-1", headers: { authorization: "Bearer test-token" } },
      publicUrl: "https://media.example/site-1",
      resize: "{url}?width={width}",
    });
  });

  it("refuses addresses that are not http and a resize without its placeholders", () => {
    expect(() => checkMedia({ storage: { url: "ftp://x" } })).toThrow(/storage.url/);
    expect(() => checkMedia({ publicUrl: "/cdn" })).toThrow(/publicUrl/);
    expect(() => checkMedia({ resize: "{url}?w=400" })).toThrow(/\{width\}/);
    expect(() => checkMedia({ resize: "/cdn-cgi/image/width={width}/{url}" })).not.toThrow();
  });
});

describe("uploads kept in a storage", () => {
  it("sends each image with PUT and the site's headers, and lists it under /uploads as before", async () => {
    const sent: { url: string; method: string | undefined; headers: Record<string, string>; size: number }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        method: init.method,
        headers: init.headers as Record<string, string>,
        size: (init.body as Uint8Array).byteLength,
      });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const db = openDatabase(":memory:");
    await migrate(db);
    const store = new MediaStore(
      db,
      new HttpFiles("https://storage.example/site/", { authorization: "Bearer t" }, fetcher),
    );

    const file = await store.upload(PNG, "lamp.png", "product/abc");

    expect(file.url).toMatch(/^\/uploads\/product\/abc\/[\w-]+\.png$/);
    expect(sent).toEqual([
      {
        url: `https://storage.example/site${file.url}`,
        method: "PUT",
        headers: { authorization: "Bearer t", "content-type": "image/png" },
        size: PNG.byteLength,
      },
    ]);
    expect(await store.list()).toHaveLength(1);
  });

  it("keeps nothing in the database when the storage refuses the image", async () => {
    const db = openDatabase(":memory:");
    await migrate(db);
    const refusing = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    const store = new MediaStore(db, new HttpFiles("https://storage.example", {}, refusing));

    await expect(store.upload(PNG, "lamp.png")).rejects.toThrow(/could not be stored \(403\)/);
    expect(await store.list()).toEqual([]);
  });
});

describe("the library a page at a time", () => {
  it("reaches every image of a large library, searches it whole and filters a folder", async () => {
    const db = openDatabase(":memory:");
    await migrate(db);
    const store = new MediaStore(
      db,
      new HttpFiles(
        "https://storage.example",
        {},
        (async () => new Response(null, { status: 201 })) as unknown as typeof fetch,
      ),
    );
    // 620 images, more than the old list of 500 held; the oldest is the one searched for.
    const rows = Array.from({ length: 620 }, (_, index) => ({
      sql: "INSERT INTO brim_media (id, url, name, mime, size, created_at, folder) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        `id-${String(index).padStart(4, "0")}`,
        `/uploads/${index}.png`,
        index === 0 ? "Marazzi_Art 100%.png" : `photo-${index}.png`,
        "image/png",
        1,
        `2026-11-20T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
        index % 10 === 0 ? "produs/abc" : "",
      ],
    }));
    await db.batch(rows);

    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await store.page({ ...(after && { after }), limit: 200 });
      seen.push(...page.files.map((file) => file.id));
      after = page.next;
    } while (after);
    expect(seen).toHaveLength(620);
    expect(new Set(seen).size).toBe(620);
    expect(seen[0]).toBe("id-0619");

    // Any case; % and _ are letters of the name, not wildcards.
    expect((await store.page({ search: "marazzi_art 100%" })).files.map((file) => file.id)).toEqual(["id-0000"]);
    expect((await store.page({ search: "marazzi%art" })).files).toEqual([]);
    expect((await store.page({ folder: "produs/abc" })).files).toHaveLength(62);
    expect((await store.page({ folder: "", limit: 500 })).next).toBeDefined();
  });
});

describe("/uploads when images are served from elsewhere", () => {
  it("leads to the public address, but answers files still on the server itself", async () => {
    const directory = mkdtempSync(join(tmpdir(), "brim-uploads-"));
    const db = openDatabase(":memory:");
    await migrate(db);
    const old = await new MediaStore(db, pathToFileURL(`${directory}/`)).upload(PNG, "old.png");
    const name = old.url.slice("/uploads/".length);

    const kept = await uploadResponse(directory, name, "https://cdn.example/site");
    expect(kept.status).toBe(200);

    const moved = await uploadResponse(directory, "product/abc/new.png", "https://cdn.example/site");
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("https://cdn.example/site/uploads/product/abc/new.png");

    expect((await uploadResponse(directory, "../secret.png", "https://cdn.example/site")).status).toBe(404);
  });
});
