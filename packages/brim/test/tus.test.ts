import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TusError, encodeMetadata, tusUpload } from "../src/editor/client/tus.ts";

interface Upload {
  length: number;
  metadata: string | undefined;
  bytes: Buffer;
}

/** A small tus 1.0.0 server: creation, HEAD and PATCH, with a switch to fail the next PATCH. */
let server: Server;
let endpoint: string;
let uploads: Map<string, Upload>;
let seen: { method: string; headers: Record<string, string | string[] | undefined> }[];
/** How many of the next PATCH requests the server drops after taking half of the piece. */
let failures: number;
let refuseCreation: boolean;

beforeEach(async () => {
  uploads = new Map();
  seen = [];
  failures = 0;
  refuseCreation = false;
  server = createServer((request, response) => {
    seen.push({ method: request.method ?? "", headers: request.headers });
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const id = request.url?.split("/files/")[1];
      const upload = id ? uploads.get(id) : undefined;
      if (request.headers["tus-resumable"] !== "1.0.0") return void response.writeHead(412).end();
      if (request.method === "POST" && request.url === "/files") {
        if (refuseCreation) return void response.writeHead(403).end("The signature has expired.");
        const created = String(uploads.size + 1);
        uploads.set(created, {
          length: Number(request.headers["upload-length"]),
          metadata: request.headers["upload-metadata"] as string | undefined,
          bytes: Buffer.alloc(0),
        });
        // A relative address, as tus allows: the client resolves it against the endpoint.
        return void response.writeHead(201, { location: `/files/${created}` }).end();
      }
      if (!upload) return void response.writeHead(404).end();
      if (request.method === "HEAD") {
        return void response.writeHead(200, { "upload-offset": String(upload.bytes.length) }).end();
      }
      if (request.method === "PATCH") {
        if (Number(request.headers["upload-offset"]) !== upload.bytes.length) return void response.writeHead(409).end();
        const body = Buffer.concat(chunks);
        if (failures > 0) {
          failures--;
          upload.bytes = Buffer.concat([upload.bytes, body.subarray(0, Math.floor(body.length / 2))]);
          return void response.writeHead(500).end();
        }
        upload.bytes = Buffer.concat([upload.bytes, body]);
        return void response.writeHead(204, { "upload-offset": String(upload.bytes.length) }).end();
      }
      response.writeHead(405).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/files`;
});

afterEach(() => new Promise<void>((resolve) => void server.close(() => resolve())));

function fileOf(size: number): { file: Blob; bytes: Buffer } {
  const bytes = Buffer.from(Uint8Array.from({ length: size }, (_, index) => (index * 7) % 251));
  return { file: new Blob([bytes], { type: "video/mp4" }), bytes };
}

describe("tus upload", () => {
  it("creates the upload with the host's headers and metadata, then sends the file in pieces", async () => {
    const { file, bytes } = fileOf(2500);
    const progress: number[] = [];
    const url = await tusUpload(
      file,
      { endpoint, headers: { "X-Signature": "abc" }, metadata: { title: "Vară – clip.mp4", filetype: "video/mp4" } },
      { chunkSize: 1000, onProgress: (sent) => progress.push(sent) },
    );

    expect(url).toBe(`${endpoint}/1`);
    const upload = uploads.get("1");
    expect(upload?.length).toBe(2500);
    expect(upload?.bytes.equals(bytes)).toBe(true);
    expect(upload?.metadata).toBe(
      `title ${Buffer.from("Vară – clip.mp4").toString("base64")},filetype ${Buffer.from("video/mp4").toString("base64")}`,
    );
    expect(progress).toEqual([0, 1000, 2000, 2500]);
    expect(seen.map((request) => request.method)).toEqual(["POST", "PATCH", "PATCH", "PATCH"]);
    // The host's headers travel with every request, not only the first.
    expect(seen.every((request) => request.headers["x-signature"] === "abc")).toBe(true);
    expect(seen[1]?.headers["content-type"]).toBe("application/offset+octet-stream");
    expect(seen.slice(1).map((request) => request.headers["upload-offset"])).toEqual(["0", "1000", "2000"]);
  });

  it("goes on from where the server got to after a piece failed halfway", async () => {
    const { file, bytes } = fileOf(3000);
    failures = 1;
    await tusUpload(file, { endpoint }, { chunkSize: 1000, retryDelayMs: 1 });

    expect(uploads.get("1")?.bytes.equals(bytes)).toBe(true);
    expect(seen.map((request) => request.method)).toEqual(["POST", "PATCH", "HEAD", "PATCH", "PATCH", "PATCH"]);
  });

  it("gives up after the server keeps failing", async () => {
    const { file } = fileOf(3000);
    failures = 10;

    await expect(
      tusUpload(file, { endpoint }, { chunkSize: 1000, retries: 2, retryDelayMs: 1 }),
    ).rejects.toBeInstanceOf(TusError);
  });

  it("says what the host said when it refuses the upload", async () => {
    refuseCreation = true;

    await expect(tusUpload(fileOf(10).file, { endpoint })).rejects.toThrow("The signature has expired.");
  });

  it("stops when it is cancelled", async () => {
    const { file } = fileOf(5000);
    const controller = new AbortController();
    const upload = tusUpload(
      file,
      { endpoint },
      {
        chunkSize: 1000,
        signal: controller.signal,
        onProgress: (sent) => sent >= 2000 && controller.abort(),
      },
    );

    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
    expect(uploads.get("1")?.bytes.length).toBeLessThan(5000);
  });

  it("writes metadata as tus asks: key, space, base64 of the value", () => {
    expect(encodeMetadata({ filetype: "video/mp4", title: "ă" })).toBe("filetype dmlkZW8vbXA0,title xIM=");
    expect(encodeMetadata({})).toBe("");
  });
});
