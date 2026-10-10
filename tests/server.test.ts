import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { braveAnswers } from "../src/providers/brave.ts";
import { exaSearch } from "../src/providers/exa.ts";
import { UPSTREAMS, type UpstreamId, type UpstreamSpec } from "../src/lib/upstreams.ts";
import { SecretResolver } from "../src/server/secrets.ts";
import { startServer } from "../src/server/server.ts";

interface SeenRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

let seen: SeenRequest[] = [];

const fakeUpstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    seen.push({
      method: req.method,
      path: url.pathname + url.search,
      headers: Object.fromEntries(req.headers.entries()),
      body: await req.text(),
    });
    if (url.pathname.endsWith("/chat/completions")) {
      const sse =
        'data: {"id":"a1","choices":[{"delta":{"content":"hello "}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}]}\n\n' +
        "data: [DONE]\n\n";
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    if (url.pathname.endsWith("/fail")) {
      return Response.json({ error: "quota" }, { status: 429, headers: { "retry-after": "7" } });
    }
    return Response.json({ results: [], requestId: "r1" }, { headers: { "set-cookie": "a=b" } });
  },
});

const fakeUpstreams = Object.fromEntries(
  Object.values(UPSTREAMS).map((spec) => [
    spec.id,
    { ...spec, baseUrl: `http://127.0.0.1:${fakeUpstream.port}/${spec.id}` },
  ]),
) as Record<UpstreamId, UpstreamSpec>;

const serverEnv: Record<string, string> = {
  SEEK_SERVER_TOKEN: "old-token, client-token",
  EXA_API_KEY: "server-exa-key",
  BRAVE_ANSWERS_API_KEY: "server-brave-key",
};

const seekServer = startServer({
  hostname: "127.0.0.1",
  port: 0,
  secrets: new SecretResolver(null, serverEnv, () => ({})),
  upstreams: fakeUpstreams,
  log: () => {},
});
const base = `http://127.0.0.1:${seekServer.port}`;

afterAll(() => {
  seekServer.stop(true);
  fakeUpstream.stop(true);
});

afterEach(() => {
  seen = [];
  delete process.env.SEEK_SERVER_URL;
  delete process.env.SEEK_SERVER_TOKEN;
});

describe("seek serve proxy", () => {
  test("serves an unauthenticated health check", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("rejects missing and wrong client tokens", async () => {
    const missing = await fetch(`${base}/v1/proxy/exa/search`, { method: "POST" });
    expect(missing.status).toBe(401);
    const wrong = await fetch(`${base}/v1/proxy/exa/search`, {
      method: "POST",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  test("swaps the client token for the provider key and forwards the request", async () => {
    const res = await fetch(`${base}/v1/proxy/exa/search?x=1`, {
      method: "POST",
      headers: {
        authorization: "Bearer old-token",
        "content-type": "application/json",
        "x-api-key": "client-supplied",
        "api-revision": "2026-05-20",
      },
      body: JSON.stringify({ query: "q" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({ results: [], requestId: "r1" });

    expect(seen).toHaveLength(1);
    const upstream = seen[0]!;
    expect(upstream.path).toBe("/exa/search?x=1");
    expect(upstream.headers["x-api-key"]).toBe("server-exa-key");
    expect(upstream.headers.authorization).toBeUndefined();
    expect(upstream.headers["api-revision"]).toBe("2026-05-20");
    expect(JSON.parse(upstream.body)).toEqual({ query: "q" });
  });

  test("passes upstream errors through with their status", async () => {
    const res = await fetch(`${base}/v1/proxy/exa/fail`, {
      headers: { authorization: "Bearer client-token" },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
  });

  test("strips connection-nominated and proxy authentication headers", async () => {
    const res = await fetch(`${base}/v1/proxy/exa/search`, {
      headers: {
        authorization: "Bearer client-token",
        connection: "X-Private-Hop, x-second-hop",
        "x-private-hop": "first-hop-value",
        "x-second-hop": "second-hop-value",
        "proxy-authenticate": "Basic realm=test",
        "x-end-to-end": "preserved",
      },
    });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers["x-private-hop"]).toBeUndefined();
    expect(seen[0]!.headers["x-second-hop"]).toBeUndefined();
    expect(seen[0]!.headers["proxy-authenticate"]).toBeUndefined();
    expect(seen[0]!.headers["x-end-to-end"]).toBe("preserved");
    expect(seen[0]!.headers["x-api-key"]).toBe("server-exa-key");
  });

  test("returns 503 when the server has no key for a provider", async () => {
    const res = await fetch(`${base}/v1/proxy/parallel/v1/search`, {
      method: "POST",
      headers: { authorization: "Bearer client-token" },
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("PARALLEL_API_KEY");
    expect(seen).toHaveLength(0);
  });

  test("returns 404 for unknown providers", async () => {
    const res = await fetch(`${base}/v1/proxy/evil.example.com/x`, {
      headers: { authorization: "Bearer client-token" },
    });
    expect(res.status).toBe(404);
  });
});

describe("CLI remote mode", () => {
  test("provider calls route through the server without local keys", async () => {
    process.env.SEEK_SERVER_URL = `${base}/`;
    process.env.SEEK_SERVER_TOKEN = "client-token";
    const saved = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    try {
      const result = await exaSearch("roof materials", { numResults: 2 });
      expect(result.requestId).toBe("r1");
    } finally {
      if (saved !== undefined) process.env.EXA_API_KEY = saved;
    }
    expect(seen[0]?.path).toBe("/exa/search");
    expect(seen[0]?.headers["x-api-key"]).toBe("server-exa-key");
    expect(JSON.parse(seen[0]!.body).numResults).toBe(2);
  });

  test("streams server-sent events through the server", async () => {
    process.env.SEEK_SERVER_URL = base;
    process.env.SEEK_SERVER_TOKEN = "client-token";
    const result = await braveAnswers("hi");
    expect(result.choices?.[0]?.message?.content).toBe("hello world");
    expect(seen[0]?.path).toBe("/brave-answers/chat/completions");
    expect(seen[0]?.headers["x-subscription-token"]).toBe("server-brave-key");
  });
});

describe("SecretResolver", () => {
  test("prefers env, then vault, then config", async () => {
    const vault = { get: async (name: string) => ({ A: "vault-a", B: "vault-b" })[name] };
    const resolver = new SecretResolver(
      vault as never,
      { A: "env-a" },
      () => ({ A: "cfg-a", B: "cfg-b", C: "cfg-c" }),
    );
    expect(await resolver.get("A")).toBe("env-a");
    expect(await resolver.get("B")).toBe("vault-b");
    expect(await resolver.get("C")).toBe("cfg-c");
    expect(await resolver.get("D")).toBeUndefined();
  });
});
