import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { toNodeMiddleware } from "../src/server/node.ts";

describe("Node middleware", () => {
  it("sends every Set-Cookie of a response, not only the last", async () => {
    const middleware = toNodeMiddleware(async () => {
      const headers = new Headers({ "content-type": "text/plain" });
      headers.append("set-cookie", "brim_session=new; Path=/");
      headers.append("set-cookie", "brim_session=; Path=/admin; Max-Age=0");
      return new Response("ok", { headers });
    });
    const server = createServer((req, res) => middleware(req, res, () => res.end()));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/admin/api/session`);

      expect(response.headers.getSetCookie()).toEqual([
        "brim_session=new; Path=/",
        "brim_session=; Path=/admin; Max-Age=0",
      ]);
      expect(response.headers.get("content-type")).toBe("text/plain");
      expect(await response.text()).toBe("ok");
    } finally {
      server.close();
    }
  });
});
