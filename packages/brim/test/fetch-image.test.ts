import { describe, expect, it } from "vitest";
import { fetchImage, isPrivate } from "../src/server/fetch-image.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const publicHost = async () => [{ address: "93.184.215.14" }];

function web(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return routes[url]?.() ?? new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("fetching an image for the media library", () => {
  it("answers the bytes and the name the address gives", async () => {
    const fetcher = web({
      "https://cdn.example/a/b%20c.png": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
    });
    const image = await fetchImage("https://cdn.example/a/b%20c.png", fetcher, publicHost);
    expect([...image.bytes]).toEqual([...PNG]);
    expect(image.name).toBe("b c.png");
  });

  it("follows a redirect, checking where it leads", async () => {
    const fetcher = web({
      "https://cdn.example/old.png": () =>
        new Response(null, { status: 301, headers: { location: "http://10.0.0.5/x.png" } }),
    });
    await expect(fetchImage("https://cdn.example/old.png", fetcher, publicHost)).rejects.toThrow(
      /not a public address/,
    );
  });

  it("refuses a name that leads into the server's network", async () => {
    const internal = async () => [{ address: "93.184.215.14" }, { address: "192.168.1.10" }];
    await expect(fetchImage("https://intranet.example/x.png", web({}), internal)).rejects.toThrow(
      /not a public address/,
    );
  });

  it("refuses other protocols, pages, and images over 10 MB", async () => {
    await expect(fetchImage("file:///etc/passwd", web({}), publicHost)).rejects.toThrow(/Only http and https/);
    const page = web({
      "https://cdn.example/p": () => new Response("<p>", { headers: { "content-type": "text/html" } }),
    });
    await expect(fetchImage("https://cdn.example/p", page, publicHost)).rejects.toThrow(/not an image/);
    const big = web({
      "https://cdn.example/big.png": () =>
        new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }),
    });
    await expect(fetchImage("https://cdn.example/big.png", big, publicHost)).rejects.toThrow(/larger than 10 MB/);
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (address) => expect(isPrivate(address)).toBe(true));

  it.each(["93.184.215.14", "8.8.8.8", "2606:4700::1111"])("treats %s as public", (address) => {
    expect(isPrivate(address)).toBe(false);
  });
});
