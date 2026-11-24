import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { defineContentType } from "../src/content/content-types.ts";
import { ItemStore } from "../src/content/items.ts";
import { uploadResponse } from "../src/content/media.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { FormStore } from "../src/forms/store.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "http://localhost:4321";
// The smallest valid PNG header is enough for the format check.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const project = defineContentType({
  key: "project",
  label: "Projects",
  singular: "Project",
  slug: "projects",
  fields: [{ name: "cover", label: "Cover", type: "image" }],
});

let uploads: string;
let admin: AdminHandler;
let token: string;
let itemId: string;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  const brim: Brim = {
    db,
    history: new HistoryStore(db),
    drafts: new DraftStore(db),
    content: new ContentStore(db),
    items: new ItemStore(db),
    forms: new FormStore(db),
    accounts: new Accounts(db),
  };
  await brim.accounts.createUser("owner@example.test", "correct horse battery", "owner");
  token = await brim.accounts.createToken("owner@example.test", "test");
  itemId = (
    await brim.items.create("project", { slug: "lake-house", title: "Lake House", visibility: "private", data: {} })
  ).id;
  uploads = mkdtempSync(join(tmpdir(), "brim-media-"));
  admin = createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    contentTypes: () => [project],
    mediaDirectory: pathToFileURL(`${uploads}/`),
  });
});

async function upload(folder?: string): Promise<Response> {
  const headers = new Headers({ authorization: `Bearer ${token}`, "x-file-name": "photo.png" });
  if (folder !== undefined) headers.set("x-media-folder", folder);
  const response = await admin(new Request(`${ORIGIN}/admin/api/media`, { method: "POST", headers, body: PNG }), {
    clientAddress: "203.0.113.7",
  });
  if (!response) throw new Error("not handled");
  return response;
}

describe("media folders", () => {
  it("puts an image in the gallery when no folder is named", async () => {
    const { file } = (await (await upload()).json()) as { file: { url: string; folder: string } };
    expect(file.folder).toBe("");
    expect(file.url).toMatch(/^\/uploads\/[\w-]+\.png$/);
  });

  it("puts an image in one item's own folder, on disk too", async () => {
    const response = await upload(`project/${itemId}`);
    expect(response.status).toBe(201);
    const { file } = (await response.json()) as { file: { id: string; url: string; folder: string } };
    expect(file.folder).toBe(`project/${itemId}`);
    expect(file.url).toBe(`/uploads/project/${itemId}/${file.id}.png`);
    expect(existsSync(join(uploads, "project", itemId, `${file.id}.png`))).toBe(true);
  });

  it("refuses a folder that is not an existing item of a declared type", async () => {
    expect((await upload("project")).status).toBe(404);
    expect((await upload("project/no-such-item")).status).toBe(404);
    expect((await upload(`secrets/${itemId}`)).status).toBe(404);
    expect((await upload(`project/${itemId}/../..`)).status).toBe(404);
  });

  it("lists images with their folder", async () => {
    await upload();
    await upload(`project/${itemId}`);
    const response = await admin(
      new Request(`${ORIGIN}/admin/api/media`, { headers: { authorization: `Bearer ${token}` } }),
      { clientAddress: "203.0.113.7" },
    );
    const { files } = (await response!.json()) as { files: { folder: string }[] };
    expect(files.map((file) => file.folder).sort()).toEqual(["", `project/${itemId}`]);
  });
});

describe("serving uploads", () => {
  it("answers an uploaded image with its type, and nothing else in or outside the folder", async () => {
    const directory = mkdtempSync(join(tmpdir(), "brim-served-"));
    writeFileSync(join(directory, "photo.png"), PNG);
    const served = await uploadResponse(directory, "photo.png");

    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    for (const file of ["../photo.png", "missing.png", "notes.txt", ".photo.png"]) {
      expect((await uploadResponse(directory, file)).status).toBe(404);
    }
  });
});
