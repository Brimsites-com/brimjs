import { HttpError, readBytes } from "../server/http.ts";
import { VERSION } from "../version.ts";
import { TOOLS, type ToolContext, instructionsFor } from "./tools.ts";

/**
 * The site's MCP endpoint (`/admin/mcp`): JSON-RPC over HTTP POST, the "streamable HTTP" transport
 * without server-sent events. Each request answers with JSON. The caller has already checked the token.
 */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** A call carries at most an item or a page element; the API it reaches takes 64 KB each. */
const MAX_BODY_BYTES = 1024 * 1024;
const SERVER_INFO = { name: "brimjs", title: "Brim.js site", version: VERSION };

interface Message {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: Record<string, unknown>;
}

/** Requests one batch may hold; more is refused, so one body cannot start thousands of tool calls. */
const MAX_BATCH = 20;

export async function handleMcp(request: Request, context: ToolContext): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBytes(request, MAX_BODY_BYTES)));
  } catch (failure) {
    if (failure instanceof HttpError) return reply(error(null, -32600, failure.message), failure.status);
    return reply(error(null, -32700, "The request is not valid JSON."));
  }

  const messages = Array.isArray(body) ? body : [body];
  if (messages.length > MAX_BATCH) {
    return reply(error(null, -32600, `A batch has at most ${MAX_BATCH} requests.`), 413);
  }
  // One after another: a batch is a list of steps, and changes that run at once would race each other.
  const answers: object[] = [];
  for (const message of messages) {
    const result = await answer(message as Message, context);
    if (result !== undefined) answers.push(result);
  }
  // Notifications get no answer.
  if (answers.length === 0) return new Response(null, { status: 202 });
  return reply(Array.isArray(body) ? answers : answers[0]);
}

async function answer(message: Message, context: ToolContext): Promise<object | undefined> {
  if (typeof message !== "object" || message === null || typeof message.method !== "string") {
    return error(message?.id ?? null, -32600, "Not a JSON-RPC request.");
  }
  const id = message.id;
  if (id === undefined) return undefined;

  switch (message.method) {
    case "initialize": {
      const asked = message.params?.protocolVersion;
      const protocolVersion =
        typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: instructionsFor(context),
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case "tools/call": {
      const tool = TOOLS.find((candidate) => candidate.name === message.params?.name);
      if (!tool) return error(id, -32602, `There is no tool "${String(message.params?.name)}".`);
      const args = message.params?.arguments;
      try {
        const output = await tool.run(
          typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {},
          context,
        );
        return result(id, { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] });
      } catch (failure) {
        // A refused change is the tool's answer, so the model can read it and try again.
        const text = failure instanceof Error ? failure.message : String(failure);
        return result(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return error(id, -32601, `The method "${message.method}" is not supported.`);
  }
}

function result(id: string | number | null, value: object): object {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: string | number | null, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
