import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { AdminHandler } from "./handler.ts";
import { clientAddress } from "./http.ts";

type Next = (error?: unknown) => void;
/** Connect-style servers set `originalUrl` when a middleware is mounted on a sub-path. */
type NodeRequest = IncomingMessage & { originalUrl?: string | undefined };

/** Adapts the admin handler to Node's `(req, res, next)` middleware shape used by Vite and Express. */
export function toNodeMiddleware(handler: AdminHandler) {
  async function respond(req: NodeRequest, res: ServerResponse, next: Next): Promise<void> {
    const request = toRequest(req);
    const response = await handler(request, {
      clientAddress: clientAddress(request, req.socket.remoteAddress ?? "unknown"),
      serverOrigin: serverOrigin(req),
    });
    if (!response) return next();

    res.statusCode = response.status;
    // Each Set-Cookie is its own header: set one by one, the last would replace the others (signing in sets the
    // session and removes the old /admin cookie).
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") res.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) res.setHeader("set-cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  return (req: NodeRequest, res: ServerResponse, next: Next): void => {
    respond(req, res, next).catch(next);
  };
}

/** The address the connection reached this server on, read from the socket rather than from any header. */
function serverOrigin(req: NodeRequest): string | undefined {
  const { localAddress, localPort } = req.socket;
  if (!localAddress || !localPort) return undefined;
  const protocol = "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
  return `${protocol}://${localAddress.includes(":") ? `[${localAddress}]` : localAddress}:${localPort}`;
}

function toRequest(req: NodeRequest): Request {
  const protocol = "encrypted" in req.socket && req.socket.encrypted ? "https" : "http";
  const url = new URL(req.originalUrl ?? req.url ?? "/", `${protocol}://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    ...(hasBody && { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }),
  });
}
