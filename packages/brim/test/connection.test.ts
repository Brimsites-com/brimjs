import { describe, expect, it } from "vitest";
import { connection, patientFetch } from "../src/editor/client/connection.ts";

const starting = (): Response => new Response("starting", { status: 503, headers: { "retry-after": "3" } });
const ok = (): Response => Response.json({ ok: true });

/** A server that gives these answers in turn; a thrown answer is a connection that broke. */
function serverThat(...answers: (() => Response)[]) {
  const pauses: number[] = [];
  const seen: boolean[] = [];
  let clock = 0;
  let calls = 0;
  return {
    pauses,
    seen,
    calls: () => calls,
    options: {
      fetch: (async () => {
        seen.push(connection.away());
        const next = answers[Math.min(calls++, answers.length - 1)];
        if (!next) throw new Error("no answer");
        return next();
      }) as typeof fetch,
      sleep: async (ms: number) => {
        pauses.push(ms);
        clock += ms;
      },
      now: () => clock,
      patienceMs: 10_000,
    },
  };
}

describe("a request to a server that is away", () => {
  it("is asked again until the server answers, and the editor says it is waiting meanwhile", async () => {
    const server = serverThat(starting, starting, ok);
    const changes: boolean[] = [];
    const stop = connection.subscribe(() => changes.push(connection.away()));
    const response = await patientFetch("/admin/api/pages", () => ({ method: "POST" }), server.options);
    stop();
    expect(response.status).toBe(200);
    expect(server.calls()).toBe(3);
    expect(server.pauses).toEqual([3000, 3000]);
    expect(server.seen).toEqual([false, true, true]);
    expect(changes).toEqual([true, false]);
    expect(connection.away()).toBe(false);
  });

  it("hands back the last answer once patience runs out", async () => {
    const server = serverThat(starting);
    const response = await patientFetch("/admin/api/pages", undefined, server.options);
    expect(response.status).toBe(503);
    expect(connection.away()).toBe(false);
  });

  it("repeats a save whose connection broke, but not a request that would add something twice", async () => {
    const broken = (): Response => {
      throw new TypeError("Failed to fetch");
    };
    const save = serverThat(broken, ok);
    expect((await patientFetch("/admin/api/nodes", () => ({ method: "PUT" }), save.options)).status).toBe(200);
    const create = serverThat(broken, ok);
    await expect(patientFetch("/admin/api/items", () => ({ method: "POST" }), create.options)).rejects.toThrow(
      "Failed to fetch",
    );
    expect(create.calls()).toBe(1);
    expect(connection.away()).toBe(false);
  });

  it("leaves every other answer alone", async () => {
    const server = serverThat(() => Response.json({ error: "Sign in first." }, { status: 401 }));
    expect((await patientFetch("/admin/api/session", undefined, server.options)).status).toBe(401);
    expect(server.calls()).toBe(1);
  });
});
