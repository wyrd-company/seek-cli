#!/usr/bin/env node
// The seek practice server: a stand-in for a seek server that answers with
// made-up results, so you can try seek, and code against a seek server,
// without provider API keys. It never contacts a provider.
//
//   node practice-server.mjs        (Node.js 18 or later)
//   bun practice-server.mjs         (Bun)
//
// It listens on http://127.0.0.1:8788, or on the port in PORT, and accepts
// the client token `practice-token`. It answers the seek server HTTP API:
// GET /healthz, and under /v1/proxy/ these provider routes:
//
//   POST parallel/v1/search                 seek web parallel
//   POST exa/search                         seek web exa
//   POST exa/contents                       seek scrape exa
//   POST parallel/v1/tasks/runs             seek research parallel
//   GET  parallel/v1/tasks/runs/<id>        seek research status parallel
//   GET  parallel/v1/tasks/runs/<id>/result seek research get parallel
//
// Searches return at most three results. A research job is `queued` when it
// is submitted, `running` at its first status lookup and `completed` from
// the second. Every URL it returns is on example.com.

import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PRACTICE_TOKEN = "practice-token";
export const DEFAULT_PORT = 8788;
const CREATED_AT = "2026-01-01T00:00:00Z";
const MAX_RESULTS = 3;

/** Fresh state for one server: the research jobs it has accepted. */
export function practiceState() {
  return { runs: new Map(), nextRun: 1 };
}

function results(count) {
  return Math.max(0, Math.min(MAX_RESULTS, Number.isInteger(count) ? count : MAX_RESULTS));
}

function practiceUrl(name) {
  return `https://example.com/practice/${name}`;
}

function run(id, entry) {
  const status = entry.lookups === 0 ? "queued" : entry.lookups === 1 ? "running" : "completed";
  return {
    run_id: id,
    interaction_id: id.replace("trun_", "interaction_"),
    status,
    is_active: status !== "completed",
    processor: entry.processor,
    created_at: CREATED_AT,
    modified_at: CREATED_AT,
  };
}

const json = (status, body) => ({ status, body });

/**
 * The practice answer to one provider request: `provider` and `path` are the
 * parts after /v1/proxy/, and `body` is the parsed JSON request body.
 */
export function practiceResponse(state, method, provider, path, body = {}) {
  const route = `${method} ${provider}${path}`;

  if (route === "POST parallel/v1/search") {
    const query = body.search_queries?.[0] ?? body.objective ?? "";
    const count = results(body.advanced_settings?.max_results);
    return json(200, {
      search_id: "search_practice_1",
      results: Array.from({ length: count }, (_, i) => ({
        url: practiceUrl(`result-${i + 1}`),
        title: `Practice result ${i + 1} for "${query}"`,
        excerpts: [`A made-up excerpt about "${query}". The practice server wrote it; Parallel did not.`],
        publish_date: "2026-01-01",
      })),
    });
  }

  if (route === "POST exa/search") {
    const query = body.query ?? "";
    const count = results(body.numResults);
    return json(200, {
      requestId: "practice-request-1",
      results: Array.from({ length: count }, (_, i) => ({
        id: practiceUrl(`result-${i + 1}`),
        url: practiceUrl(`result-${i + 1}`),
        title: `Practice result ${i + 1} for "${query}"`,
        score: Number((0.9 - i * 0.1).toFixed(1)),
        highlights: [`A made-up highlight about "${query}". The practice server wrote it; Exa did not.`],
      })),
    });
  }

  if (route === "POST exa/contents") {
    const urls = Array.isArray(body.urls) ? body.urls : [];
    return json(200, {
      requestId: "practice-request-2",
      results: urls.map((url, i) => ({
        id: url,
        url,
        title: `Practice page ${i + 1}`,
        text: `Made-up text for ${url}. The practice server wrote it and did not fetch the page.`,
      })),
    });
  }

  if (route === "POST parallel/v1/tasks/runs") {
    const id = `trun_practice_${state.nextRun++}`;
    const entry = { input: String(body.input ?? ""), processor: body.processor ?? "core", lookups: 0 };
    state.runs.set(id, entry);
    return json(200, run(id, entry));
  }

  const task = /^\/v1\/tasks\/runs\/([^/]+)(\/result)?$/.exec(path);
  if (method === "GET" && provider === "parallel" && task) {
    const id = decodeURIComponent(task[1]);
    const entry = state.runs.get(id);
    if (!entry) return json(404, { error: { message: `No practice research job ${id}.` } });
    if (!task[2]) {
      entry.lookups += 1;
      return json(200, run(id, entry));
    }
    const current = run(id, entry);
    if (current.status !== "completed") return json(409, { error: { message: `Practice research job ${id} is ${current.status}.` } });
    return json(200, {
      run: current,
      output: {
        type: "text",
        content: `A made-up report on "${entry.input}". The practice server wrote it from two invented sources.`,
        basis: [
          {
            field: "output",
            reasoning: "Invented by the practice server.",
            citations: [
              { url: practiceUrl("source-1"), title: "Practice source 1" },
              { url: practiceUrl("source-2"), title: "Practice source 2" },
            ],
          },
        ],
      },
    });
  }

  return json(404, { error: `the practice server has no answer for ${method} /v1/proxy/${provider}${path}` });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** A practice server, not yet listening. `log` receives one line per proxied request. */
export function createPracticeServer({ log = (line) => void process.stdout.write(line + "\n") } = {}) {
  const state = practiceState();
  return createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/healthz") return send(200, { status: "ok" });
    if (!url.pathname.startsWith("/v1/proxy/")) return send(404, { error: "not found" });
    if ((req.headers.authorization ?? "") !== `Bearer ${PRACTICE_TOKEN}`) {
      return send(401, { error: "missing or invalid seek server token" }, { "www-authenticate": "Bearer" });
    }
    const rest = url.pathname.slice("/v1/proxy/".length);
    const slash = rest.indexOf("/");
    const provider = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? "" : rest.slice(slash);
    const answer = practiceResponse(state, req.method ?? "GET", provider, path, await readBody(req));
    log(`${req.method} ${provider}${path} -> ${answer.status}`);
    send(answer.status, answer.body);
  });
}

const runAsScript = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (runAsScript) {
  const port = process.env.PORT === undefined ? DEFAULT_PORT : Number(process.env.PORT);
  const server = createPracticeServer();
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    process.stdout.write(
      `seek practice server listening on http://127.0.0.1:${address.port}\n` +
        `client token: ${PRACTICE_TOKEN}\n`,
    );
  });
  const stop = () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
