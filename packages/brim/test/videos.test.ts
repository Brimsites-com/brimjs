import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { resolveVideoUploads } from "../src/config.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { FormStore } from "../src/forms/store.ts";
import { startLevel, videoSource } from "../src/blocks/video/video-source.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "http://localhost:4321";
const EMAIL = "owner@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow
const HOST = "https://videos.example.test/v1/sites/abc/videos";
const HOST_TOKEN = "host-test-token"; // betterleaks:allow
const visitor = { clientAddress: "203.0.113.7" };

const TICKET = {
  id: "vid_1",
  upload: {
    protocol: "tus",
    endpoint: "https://upload.example.test/tus",
    headers: { "X-Signature": "abc" },
    metadata: { title: "clip.mp4" },
  },
  url: "https://cdn.example.test/vid_1/playlist.m3u8",
  posterUrl: null,
};

interface HostCall {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

let brim: Brim;
let hostCalls: HostCall[];
/** What the fake video host answers next. */
let hostAnswer: () => Response;

const fakeHost: typeof fetch = async (input, init) => {
  hostCalls.push({
    method: init?.method ?? "GET",
    url: String(input),
    authorization: new Headers(init?.headers).get("authorization"),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  });
  return hostAnswer();
};

function site(videoUploads?: { url?: string; token?: string }): AdminHandler {
  return createAdminHandler({
    brim,
    assetsDirectory: new URL("../editor-dist/", import.meta.url),
    videoUploads,
    fetch: fakeHost,
  });
}

async function call(
  admin: AdminHandler,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (method !== "GET") headers.set("origin", ORIGIN);
  const response = await admin(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    }),
    visitor,
  );
  if (!response) throw new Error(`${path} was not handled`);
  return response;
}

async function signIn(admin: AdminHandler): Promise<string> {
  const response = await call(admin, "POST", "/admin/api/session", { body: { email: EMAIL, password: PASSWORD } }); // betterleaks:allow
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  brim = {
    db,
    content: new ContentStore(db),
    items: new ItemStore(db),
    forms: new FormStore(db),
    history: new HistoryStore(db),
    drafts: new DraftStore(db),
    accounts: new Accounts(db),
  };
  await brim.accounts.createUser(EMAIL, PASSWORD, "owner");
  hostCalls = [];
  hostAnswer = () => Response.json(TICKET, { status: 201 });
});

describe("video uploads through a video host", () => {
  const clip = { name: "clip.mp4", size: 1_500_000, type: "video/mp4" };

  it("asks the host for a place to upload and hands its answer to the editor", async () => {
    const admin = site({ url: `${HOST}/`, token: HOST_TOKEN });
    const response = await call(admin, "POST", "/admin/api/videos", { body: clip, cookie: await signIn(admin) });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(TICKET);
    expect(hostCalls).toEqual([{ method: "POST", url: HOST, authorization: `Bearer ${HOST_TOKEN}`, body: clip }]);
  });

  it("asks the host whether a video is ready", async () => {
    const admin = site({ url: HOST, token: HOST_TOKEN });
    const status = { id: "vid_1", status: "processing", progress: 40, url: TICKET.url, posterUrl: null };
    hostAnswer = () => Response.json(status);
    const response = await call(admin, "GET", "/admin/api/videos/vid_1", { cookie: await signIn(admin) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(status);
    expect(hostCalls).toEqual([
      { method: "GET", url: `${HOST}/vid_1`, authorization: `Bearer ${HOST_TOKEN}`, body: undefined },
    ]);
  });

  it("never lets a video's id change which address of the host is asked", async () => {
    const admin = site({ url: HOST });
    const cookie = await signIn(admin);

    expect((await call(admin, "GET", "/admin/api/videos/..%2F..%2Fother", { cookie })).status).toBe(404);
    expect((await call(admin, "GET", "/admin/api/videos/a%3Fb=1", { cookie })).status).toBe(404);
    expect(hostCalls).toEqual([]);
  });

  it("is only for signed-in users", async () => {
    const admin = site({ url: HOST });

    expect((await call(admin, "POST", "/admin/api/videos", { body: clip })).status).toBe(401);
    expect((await call(admin, "GET", "/admin/api/videos/vid_1")).status).toBe(401);
    expect(hostCalls).toEqual([]);
  });

  it("answers 501 with a clear message on a site without a video host", async () => {
    const admin = site();
    const cookie = await signIn(admin);
    const created = await call(admin, "POST", "/admin/api/videos", { body: clip, cookie });

    expect(created.status).toBe(501);
    expect(await created.json()).toEqual({
      error: "Video uploads are not set up for this site. Paste a video link instead.",
    });
    expect((await call(admin, "GET", "/admin/api/videos/vid_1", { cookie })).status).toBe(501);
    expect(hostCalls).toEqual([]);
  });

  it("treats a host that is not on HTTPS as not set up", async () => {
    const admin = site({ url: "http://videos.example.test/videos" });

    expect((await call(admin, "POST", "/admin/api/videos", { body: clip, cookie: await signIn(admin) })).status).toBe(
      501,
    );
  });

  it("takes only video files, and never asks the host about anything else", async () => {
    const admin = site({ url: HOST });
    const cookie = await signIn(admin);
    const image = await call(admin, "POST", "/admin/api/videos", { body: { ...clip, type: "image/png" }, cookie });

    expect(image.status).toBe(422);
    expect(await image.json()).toEqual({ error: "Only video files can be uploaded here." });
    expect((await call(admin, "POST", "/admin/api/videos", { body: { ...clip, size: 0 }, cookie })).status).toBe(422);
    expect((await call(admin, "POST", "/admin/api/videos", { body: { ...clip, name: "" }, cookie })).status).toBe(422);
    expect(hostCalls).toEqual([]);
  });

  it("passes on what the host says when it refuses", async () => {
    const admin = site({ url: HOST });
    const cookie = await signIn(admin);
    hostAnswer = () => Response.json({ error: "This video is larger than your plan allows." }, { status: 413 });
    const refused = await call(admin, "POST", "/admin/api/videos", { body: clip, cookie });

    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: "This video is larger than your plan allows." });

    hostAnswer = () => Response.json({ error: "No such video." }, { status: 404 });
    const missing = await call(admin, "GET", "/admin/api/videos/vid_9", { cookie });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such video." });
  });

  it("does not sign the editor out when the host rejects the site's token", async () => {
    const admin = site({ url: HOST });
    hostAnswer = () => Response.json({ error: "The token is not valid." }, { status: 401 });
    const response = await call(admin, "POST", "/admin/api/videos", { body: clip, cookie: await signIn(admin) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The token is not valid." });
  });

  it("says so when the host cannot be reached or answers nonsense", async () => {
    const admin = site({ url: HOST });
    const cookie = await signIn(admin);
    hostAnswer = () => {
      throw new TypeError("fetch failed");
    };
    const down = await call(admin, "POST", "/admin/api/videos", { body: clip, cookie });
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: "The video host did not answer. Try again in a moment." });

    hostAnswer = () => Response.json({ id: "vid_1" }, { status: 201 });
    expect((await call(admin, "POST", "/admin/api/videos", { body: clip, cookie })).status).toBe(502);
  });

  it("lists the host's videos, and leaves out entries it cannot use", async () => {
    const admin = site({ url: HOST, token: HOST_TOKEN });
    const video = {
      id: "vid_2",
      name: "clip.mp4",
      size: 1_500_000,
      status: "ready",
      url: TICKET.url,
      posterUrl: "https://cdn.example.test/vid_2/poster.jpg",
      createdAt: "2026-11-20T10:00:00.000Z",
    };
    hostAnswer = () =>
      Response.json({
        videos: [
          { ...video, owner: "someone" },
          { id: "vid_1", status: "processing", url: TICKET.url, size: "big" },
          { ...video, id: "../other" },
          { ...video, status: "gone" },
          { ...video, url: undefined },
          "vid_3",
          null,
        ],
      });
    const response = await call(admin, "GET", "/admin/api/videos", { cookie: await signIn(admin) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      supported: true,
      videos: [
        video,
        { id: "vid_1", name: "", size: 0, status: "processing", url: TICKET.url, posterUrl: null, createdAt: "" },
      ],
    });
    expect(hostCalls).toEqual([{ method: "GET", url: HOST, authorization: `Bearer ${HOST_TOKEN}`, body: undefined }]);
  });

  it("says the list is not supported when the host does not know it", async () => {
    const admin = site({ url: HOST });
    const cookie = await signIn(admin);

    for (const status of [404, 405, 501]) {
      hostAnswer = () => new Response(null, { status });
      const response = await call(admin, "GET", "/admin/api/videos", { cookie });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ supported: false, videos: [] });
    }

    hostAnswer = () => Response.json({ error: "The video host is busy." }, { status: 503 });
    const busy = await call(admin, "GET", "/admin/api/videos", { cookie });
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: "The video host is busy." });

    hostAnswer = () => Response.json({ videos: "none" });
    expect((await call(admin, "GET", "/admin/api/videos", { cookie })).status).toBe(502);
  });

  it("deletes a video from the host, whether the host answers with a body or without", async () => {
    const admin = site({ url: HOST, token: HOST_TOKEN });
    const cookie = await signIn(admin);

    hostAnswer = () => new Response(null, { status: 204 });
    const empty = await call(admin, "DELETE", "/admin/api/videos/vid_1", { cookie });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ deleted: true });
    expect(empty.headers.get("x-brim-changed")).toBeNull();

    hostAnswer = () => Response.json({ deleted: true });
    expect((await call(admin, "DELETE", "/admin/api/videos/vid_1", { cookie })).status).toBe(200);
    const asked = { method: "DELETE", url: `${HOST}/vid_1`, authorization: `Bearer ${HOST_TOKEN}`, body: undefined };
    expect(hostCalls).toEqual([asked, asked]);
  });

  it("never asks the host to delete a video whose id is not one", async () => {
    const admin = site({ url: HOST });
    const cookie = await signIn(admin);

    expect((await call(admin, "DELETE", "/admin/api/videos/..%2F..%2Fother", { cookie })).status).toBe(404);
    expect((await call(admin, "DELETE", "/admin/api/videos/a%3Fb=1", { cookie })).status).toBe(404);
    expect(hostCalls).toEqual([]);
  });

  it("passes on what the host says when it refuses to delete", async () => {
    const admin = site({ url: HOST });
    hostAnswer = () => Response.json({ error: "No such video." }, { status: 404 });
    const missing = await call(admin, "DELETE", "/admin/api/videos/vid_9", { cookie: await signIn(admin) });

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such video." });
  });

  it("lists and deletes for the same users as uploading: every signed-in role, nobody else", async () => {
    const admin = site({ url: HOST });

    expect((await call(admin, "GET", "/admin/api/videos")).status).toBe(401);
    expect((await call(admin, "DELETE", "/admin/api/videos/vid_1")).status).toBe(401);
    expect(hostCalls).toEqual([]);

    await brim.accounts.createUser("editor@example.test", PASSWORD, "editor");
    const session = await call(admin, "POST", "/admin/api/session", {
      body: { email: "editor@example.test", password: PASSWORD }, // betterleaks:allow
    });
    const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect((await call(admin, "POST", "/admin/api/videos", { body: clip, cookie })).status).toBe(201);
    hostAnswer = () => Response.json({ videos: [] });
    expect((await call(admin, "GET", "/admin/api/videos", { cookie })).status).toBe(200);
    hostAnswer = () => new Response(null, { status: 204 });
    expect((await call(admin, "DELETE", "/admin/api/videos/vid_1", { cookie })).status).toBe(200);
  });

  it("answers 501 for the list and a delete on a site without a video host", async () => {
    const admin = site();
    const cookie = await signIn(admin);

    expect((await call(admin, "GET", "/admin/api/videos", { cookie })).status).toBe(501);
    expect((await call(admin, "DELETE", "/admin/api/videos/vid_1", { cookie })).status).toBe(501);
    expect(hostCalls).toEqual([]);
  });

  it("lists the capability only when a host is set up", async () => {
    const capabilities = async (admin: AdminHandler): Promise<string[]> =>
      ((await (await call(admin, "GET", "/admin/api/info")).json()) as { capabilities: string[] }).capabilities;

    expect(await capabilities(site())).not.toContain("video-uploads");
    expect(await capabilities(site({ url: HOST }))).toContain("video-uploads");
  });
});

describe("video uploads through the MCP", () => {
  const clip = { name: "clip.mp4", size: 1_500_000, type: "video/mp4" };

  let token: string;
  beforeEach(async () => {
    token = await brim.accounts.createToken(EMAIL, "agent");
  });

  async function mcpTool(admin: AdminHandler, name: string, args: Record<string, unknown> = {}) {
    const response = await admin(
      new Request(`${ORIGIN}/admin/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      }),
      visitor,
    );
    const { result } = (await response!.json()) as { result: { content: { text: string }[]; isError?: boolean } };
    const text = result.content[0]?.text ?? "";
    return result.isError ? { error: text } : { output: JSON.parse(text) };
  }

  it("starts an upload, says when the video is ready and lists the host's videos", async () => {
    const admin = site({ url: HOST, token: HOST_TOKEN });

    expect(await mcpTool(admin, "brim_start_video_upload", clip)).toEqual({ output: TICKET });
    expect(hostCalls.at(-1)).toEqual({ method: "POST", url: HOST, authorization: `Bearer ${HOST_TOKEN}`, body: clip });

    const ready = { id: "vid_1", status: "ready", url: TICKET.url, posterUrl: "https://cdn.example.test/vid_1/p.jpg" };
    hostAnswer = () => Response.json(ready);
    expect(await mcpTool(admin, "brim_video_status", { id: "vid_1" })).toEqual({ output: ready });
    expect(hostCalls.at(-1)?.url).toBe(`${HOST}/vid_1`);

    hostAnswer = () => Response.json({ videos: [{ ...ready, name: "clip.mp4", size: 1_500_000 }] });
    const listed = await mcpTool(admin, "brim_list_videos");
    expect(listed.output.supported).toBe(true);
    expect(listed.output.videos[0]).toMatchObject({ id: "vid_1", status: "ready", url: TICKET.url });
  });

  it("refuses clearly on a site without a video host", async () => {
    const answer = await mcpTool(site(), "brim_start_video_upload", clip);
    expect(answer.error).toContain("Video uploads are not set up");
    expect(hostCalls).toEqual([]);
  });
});

describe("video host configuration", () => {
  it("is off without an address, and the environment wins over the config", () => {
    const saved = { url: process.env.BRIM_VIDEO_UPLOADS_URL, token: process.env.BRIM_VIDEO_UPLOADS_TOKEN }; // betterleaks:allow
    try {
      delete process.env.BRIM_VIDEO_UPLOADS_URL;
      delete process.env.BRIM_VIDEO_UPLOADS_TOKEN;
      expect(resolveVideoUploads()).toBeUndefined();
      expect(resolveVideoUploads({ token: "t" })).toBeUndefined(); // betterleaks:allow
      expect(resolveVideoUploads({ url: HOST, token: "from-config" })).toEqual({ url: HOST, token: "from-config" }); // betterleaks:allow

      process.env.BRIM_VIDEO_UPLOADS_URL = "https://other.example.test/videos";
      process.env.BRIM_VIDEO_UPLOADS_TOKEN = "from-env"; // betterleaks:allow
      expect(resolveVideoUploads({ url: HOST, token: "from-config" })).toEqual({
        // betterleaks:allow
        url: "https://other.example.test/videos",
        token: "from-env", // betterleaks:allow
      });
    } finally {
      for (const [name, value] of [
        ["BRIM_VIDEO_UPLOADS_URL", saved.url],
        ["BRIM_VIDEO_UPLOADS_TOKEN", saved.token],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("how a video address is played", () => {
  const playback = { autoplay: false, loop: false, muted: true, controls: true };

  it("plays an address ending in .m3u8 as an HLS stream", () => {
    const stream = "https://cdn.example.test/vid_1/playlist.m3u8";

    expect(videoSource(stream, playback)).toEqual({ kind: "hls", src: stream });
    expect(videoSource(`${stream}?token=abc#t=3`, playback)).toEqual({ kind: "hls", src: `${stream}?token=abc#t=3` });
    expect(videoSource("/media/clip.M3U8", playback)).toEqual({ kind: "hls", src: "/media/clip.M3U8" });
  });

  it("keeps files, YouTube, Vimeo and empty addresses as they were", () => {
    expect(videoSource("https://cdn.example.test/clip.mp4", playback)).toEqual({
      kind: "file",
      src: "https://cdn.example.test/clip.mp4",
    });
    expect(videoSource("https://cdn.example.test/clip.mp4?list=a.m3u8", playback).kind).toBe("file");
    expect(videoSource("https://youtu.be/aqz-KE-bpKQ", playback).kind).toBe("embed");
    expect(videoSource("https://vimeo.com/76979871", playback).kind).toBe("embed");
    expect(videoSource("", playback)).toEqual({ kind: "none" });
    expect(videoSource("javascript:alert(1)//a.m3u8", playback)).toEqual({ kind: "none" });
  });
});

describe("the quality an HLS stream starts on", () => {
  // As Bunny Stream lists them: the smallest first, then out of order.
  const heights = [640, 854, 1280, 352, 1920];

  it("is the smallest one at least as tall as the player on this screen", () => {
    expect(startLevel(heights, 790, 1)).toBe(1); // 854
    expect(startLevel(heights, 790, 2)).toBe(4); // 1580 device pixels: 1920
    expect(startLevel(heights, 300, 1)).toBe(3); // 352
    expect(startLevel(heights, 469, 3)).toBe(2); // counted as 2: 938 → 1280
  });

  it("is the tallest when none is tall enough, and nothing when the stream lists none", () => {
    expect(startLevel(heights, 1200, 2)).toBe(4);
    expect(startLevel([], 500, 1)).toBe(-1);
  });
});
