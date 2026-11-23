import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createProgram } from "../src/program.ts";
import { braveAnswers, braveSearch } from "../src/providers/brave.ts";
import { exaContents, exaSearch } from "../src/providers/exa.ts";
import { firecrawlScrape } from "../src/providers/firecrawl.ts";
import { googleDeepResearch, submitGoogleDeepResearch } from "../src/providers/google.ts";
import {
  parallelExtract,
  parallelSearch,
  parallelTaskRun,
  submitParallelTaskRun,
} from "../src/providers/parallel.ts";
import {
  perplexityDeepResearch,
  perplexitySearch,
  submitPerplexityDeepResearch,
} from "../src/providers/perplexity.ts";
import { inspectResearchJob, retrieveResearchJob } from "../src/lib/research-jobs.ts";
import { UPSTREAMS, type UpstreamId, type UpstreamSpec } from "../src/lib/upstreams.ts";
import { SecretResolver } from "../src/server/secrets.ts";
import {
  FORWARDED_RESPONSE_HEADERS,
  STRIPPED_REQUEST_HEADERS,
  startServer,
} from "../src/server/server.ts";

// The OpenAPI definition is the contract; these tests bind it to the code in both directions.

interface Operation {
  tags: string[];
  responses: Record<string, { $ref?: string; content?: Record<string, { example?: unknown }> }>;
}
interface OpenApi {
  info: { description: string };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, Operation>>;
  components: {
    responses: Record<
      string,
      { headers?: Record<string, unknown>; content: Record<string, { example?: unknown }> }
    >;
  };
}

const openapi = Bun.YAML.parse(
  readFileSync("docs/specifications/http-api.openapi.yml", "utf8"),
) as OpenApi;

const PROXY = "/v1/proxy/";
const JOB_ID = "job 1/a"; // Encodes to one path segment: job%201%2Fa.

interface Call {
  method: string;
  path: string;
}
let calls: Call[] = [];

function providerResponse(id: string, method: string, path: string): Response {
  const encodedJob = encodeURIComponent(JOB_ID);
  if (id === "brave-answers") {
    return new Response('data: {"choices":[{"delta":{"content":"synthetic"}}]}\n\ndata: [DONE]\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  }
  const run = { run_id: JOB_ID, status: "completed", is_active: false, processor: "core" };
  const bodies: Record<string, unknown> = {
    "POST parallel/v1/tasks/runs": { ...run, status: "queued", is_active: true },
    [`GET parallel/v1/tasks/runs/${encodedJob}`]: run,
    [`GET parallel/v1/tasks/runs/${encodedJob}/result`]: {
      run,
      output: { type: "text", content: "synthetic report", basis: [] },
    },
    "POST google/interactions": { id: JOB_ID, status: "in_progress" },
    [`GET google/interactions/${encodedJob}`]: {
      id: JOB_ID,
      status: "completed",
      outputs: [{ text: "synthetic report" }],
    },
    "POST perplexity/v1/async/sonar": { id: JOB_ID, status: "CREATED", model: "m", created_at: 0 },
    [`GET perplexity/v1/async/sonar/${encodedJob}`]: {
      id: JOB_ID,
      status: "COMPLETED",
      model: "m",
      created_at: 0,
      response: { choices: [{ message: { role: "assistant", content: "synthetic" } }] },
    },
    "POST perplexity/chat/completions": {
      choices: [{ message: { role: "assistant", content: "synthetic" } }],
    },
    "POST parallel/v1/search": { search_id: "s", results: [] },
    "POST parallel/v1/extract": { extract_id: "e", results: [], errors: [] },
    "POST firecrawl/v2/scrape": { success: true, data: { markdown: "synthetic" } },
  };
  const body = bodies[`${method} ${id}${path}`] ?? { results: [] };
  return Response.json(body, {
    status: path === "/teapot" ? 418 : 200,
    headers: {
      "cache-control": "no-store",
      "retry-after": "7",
      "x-request-id": "synthetic-request",
      "set-cookie": "session=synthetic",
      "x-provider-only": "synthetic",
    },
  });
}

const fakeProviders = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const [, id = "", ...rest] = url.pathname.split("/");
    const path = rest.length > 0 ? `/${rest.join("/")}` : "";
    return providerResponse(id, req.method, path);
  },
});

function upstreams(baseUrl: (spec: UpstreamSpec) => string): Record<UpstreamId, UpstreamSpec> {
  return Object.fromEntries(
    Object.values(UPSTREAMS).map((spec) => [spec.id, { ...spec, baseUrl: baseUrl(spec) }]),
  ) as Record<UpstreamId, UpstreamSpec>;
}

const allKeys = Object.fromEntries(Object.values(UPSTREAMS).map((spec) => [spec.envVar, "synthetic-key"]));
const seekServer = startServer({
  hostname: "127.0.0.1",
  port: 0,
  secrets: new SecretResolver(null, { ...allKeys, SEEK_SERVER_TOKEN: "synthetic-token" }, () => ({})),
  upstreams: upstreams((spec) => `http://127.0.0.1:${fakeProviders.port}/${spec.id}`),
  log: (line) => {
    const [method = "", target = ""] = line.split(" ");
    calls.push({ method, path: PROXY + target });
  },
});
const base = `http://127.0.0.1:${seekServer.port}`;

const savedEnv = { ...process.env };
beforeAll(() => {
  delete process.env.SEEK_VAULT_PATH;
  process.env.SEEK_SERVER_URL = base;
  process.env.SEEK_SERVER_TOKEN = "synthetic-token";
});
afterEach(() => {
  calls = [];
});
afterAll(() => {
  for (const name of ["SEEK_SERVER_URL", "SEEK_SERVER_TOKEN", "SEEK_VAULT_PATH"]) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  seekServer.stop(true);
  fakeProviders.stop(true);
});

function templateMatcher(template: string): RegExp {
  const pattern = template
    .split("/")
    .map((segment) => (/^\{[^}]+\}$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^$()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${pattern}$`);
}

const proxyOperations = Object.entries(openapi.paths)
  .filter(([template]) => template.startsWith(PROXY))
  .flatMap(([template, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      template,
      method: method.toUpperCase(),
      operation,
      matcher: templateMatcher(template),
    })),
  );

/** Each provider call that seek's command actions make, in server mode. */
async function runCommandProviderCalls(): Promise<void> {
  await parallelSearch("synthetic query", { maxResults: 1 });
  await parallelExtract(["https://example.com/"], { objective: "synthetic" });
  await parallelTaskRun("synthetic question");
  await submitParallelTaskRun("synthetic question");
  await exaSearch("synthetic query");
  await exaContents(["https://example.com/"]);
  await braveSearch("synthetic query", { count: 1, freshness: "pw" });
  await braveAnswers("synthetic question");
  await braveAnswers("synthetic question", { enableResearch: true });
  await perplexitySearch("synthetic question");
  await perplexityDeepResearch("synthetic question");
  await submitPerplexityDeepResearch("synthetic question");
  await googleDeepResearch("synthetic question");
  await submitGoogleDeepResearch("synthetic question");
  await firecrawlScrape("https://example.com/");
  for (const provider of ["google", "parallel", "perplexity"] as const) {
    await inspectResearchJob(provider, JOB_ID);
    await retrieveResearchJob(provider, JOB_ID);
  }
}

describe("http-api.openapi.yml", () => {
  test("documents exactly the routes and methods seek's commands call through the server", async () => {
    await runCommandProviderCalls();
    expect(calls.length).toBeGreaterThan(15);

    const unmatched = calls.filter(
      (call) => !proxyOperations.some((op) => op.method === call.method && op.matcher.test(call.path)),
    );
    expect(unmatched).toEqual([]);

    const unused = proxyOperations
      .filter((op) => !calls.some((call) => op.method === call.method && op.matcher.test(call.path)))
      .map((op) => `${op.method} ${op.template}`);
    expect(unused).toEqual([]);
  });

  test("tags each route with its upstream, base URL, key header and key variable", () => {
    for (const op of proxyOperations) {
      const upstream = op.template.slice(PROXY.length).split("/")[0]!;
      expect(Object.hasOwn(UPSTREAMS, upstream)).toBe(true);
      expect(op.operation.tags).toEqual([upstream]);
    }
    for (const spec of Object.values(UPSTREAMS)) {
      const tag = openapi.tags.find((t) => t.name === spec.id);
      expect(tag).toBeDefined();
      expect(tag!.description).toContain(spec.baseUrl);
      expect(tag!.description).toContain(spec.envVar);
      for (const header of Object.keys(spec.authHeaders("x"))) {
        expect(tag!.description).toContain(`\`${header}`);
      }
    }
  });

  test("documents seek's own responses on every proxy route", () => {
    for (const op of proxyOperations) {
      expect(Object.keys(op.operation.responses).sort()).toEqual(["401", "502", "503", "default"]);
    }
  });

  test("names every request header the server removes, and the response headers it keeps", () => {
    const paragraph = openapi.info.description
      .split("\n\n")
      .find((p) => p.startsWith("Before forwarding"))!;
    const named = new Set([...paragraph.matchAll(/`([A-Za-z-]+)`/g)].map((m) => m[1]!.toLowerCase()));
    const keyHeaders = Object.values(UPSTREAMS).flatMap((spec) =>
      Object.keys(spec.authHeaders("x")).map((h) => h.toLowerCase()),
    );
    expect(named).toEqual(new Set([...STRIPPED_REQUEST_HEADERS, ...keyHeaders]));
    expect(paragraph).toContain("`X-Forwarded-*`");

    const kept = Object.keys(openapi.components.responses.ProviderResponse!.headers ?? {});
    expect(new Set(["content-type", ...kept.map((h) => h.toLowerCase())])).toEqual(
      new Set(FORWARDED_RESPONSE_HEADERS),
    );
  });

  test("names the address seek serve binds by default", () => {
    const saved = { host: process.env.SEEK_SERVER_HOST, port: process.env.SEEK_SERVER_PORT };
    delete process.env.SEEK_SERVER_HOST;
    delete process.env.SEEK_SERVER_PORT;
    try {
      const serve = createProgram().commands.find((c) => c.name() === "serve")!;
      const host = serve.options.find((o) => o.long === "--host")!.defaultValue;
      const port = serve.options.find((o) => o.long === "--port")!.defaultValue;
      expect(openapi.servers[0]!.url).toBe(`http://${host}:${port}`);
    } finally {
      if (saved.host !== undefined) process.env.SEEK_SERVER_HOST = saved.host;
      if (saved.port !== undefined) process.env.SEEK_SERVER_PORT = saved.port;
    }
  });
});

describe("seek server conforms to http-api.openapi.yml", () => {
  const example = (name: string) =>
    openapi.components.responses[name]!.content["application/json"]!.example;

  test("answers the health check for any method without a token", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await fetch(`${base}/healthz`, { method });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(openapi.paths["/healthz"]!.get!.responses["200"]!.content!["application/json"]!.example);
    }
  });

  test("returns the documented errors", async () => {
    const unauthorized = await fetch(`${base}/v1/proxy/exa/search`, { method: "POST" });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");
    expect(await unauthorized.json()).toEqual(example("Unauthorized"));

    const outside = await fetch(`${base}/v2/anything`);
    expect(outside.status).toBe(404);
    expect(openapi.info.description).toContain(`\`${await outside.text()}\``);

    const unknown = await fetch(`${base}/v1/proxy/nope/x`, {
      headers: { authorization: "Bearer synthetic-token" },
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe("unknown provider 'nope'");

    const unreachable = upstreams(() => "http://127.0.0.1:1");
    const noKeys = startServer({
      hostname: "127.0.0.1",
      port: 0,
      secrets: new SecretResolver(null, { SEEK_SERVER_TOKEN: "synthetic-token" }, () => ({})),
      upstreams: unreachable,
      log: () => {},
    });
    const withKeys = startServer({
      hostname: "127.0.0.1",
      port: 0,
      secrets: new SecretResolver(null, { ...allKeys, SEEK_SERVER_TOKEN: "synthetic-token" }, () => ({})),
      upstreams: unreachable,
      log: () => {},
    });
    try {
      const init = { method: "POST", headers: { authorization: "Bearer synthetic-token" }, body: "{}" };
      const noKey = await fetch(`http://127.0.0.1:${noKeys.port}/v1/proxy/exa/search`, init);
      expect(noKey.status).toBe(503);
      expect(await noKey.json()).toEqual(example("NoProviderKey"));

      const badGateway = await fetch(`http://127.0.0.1:${withKeys.port}/v1/proxy/exa/search`, init);
      expect(badGateway.status).toBe(502);
      expect(await badGateway.json()).toEqual(example("BadGateway"));
    } finally {
      noKeys.stop(true);
      withKeys.stop(true);
    }
  });

  test("passes the provider's status, body and documented headers through", async () => {
    const res = await fetch(`${base}/v1/proxy/exa/teapot`, {
      headers: { authorization: "Bearer synthetic-token" },
    });
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ results: [] });
    for (const name of FORWARDED_RESPONSE_HEADERS) expect(res.headers.get(name)).not.toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-provider-only")).toBeNull();
  });
});
