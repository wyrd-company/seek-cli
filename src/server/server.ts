import { createHash, timingSafeEqual } from "node:crypto";
import { isUpstreamId, UPSTREAMS, type UpstreamId, type UpstreamSpec } from "../lib/upstreams.ts";
import type { SecretResolver } from "./secrets.ts";

export interface ServerOptions {
  secrets: SecretResolver;
  /** Skip client token checks. Only for trusted networks. */
  allowUnauthenticated?: boolean;
  /** Override upstream specs (used by tests). */
  upstreams?: Readonly<Record<UpstreamId, UpstreamSpec>>;
  log?: (line: string) => void;
}

const PROXY_PREFIX = "/v1/proxy/";

// Headers never forwarded upstream: hop-by-hop, client credentials, and
// anything fetch recomputes. Provider auth headers are added by the server.
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
]);

const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control", "retry-after", "x-request-id"];

function json(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(presented: string, accepted: string[]): boolean {
  const presentedDigest = digest(presented);
  let ok = false;
  for (const token of accepted) {
    if (timingSafeEqual(presentedDigest, digest(token))) ok = true;
  }
  return ok;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export function createHandler(opts: ServerOptions): (req: Request) => Promise<Response> {
  const upstreams = opts.upstreams ?? UPSTREAMS;
  const log = opts.log ?? ((line: string) => process.stderr.write(line + "\n"));
  const providerAuthHeaders = new Set(
    Object.values(upstreams).flatMap((spec) => Object.keys(spec.authHeaders("x")).map((h) => h.toLowerCase())),
  );

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") return json(200, { status: "ok" });
    if (!url.pathname.startsWith(PROXY_PREFIX)) return json(404, { error: "not found" });

    if (!opts.allowUnauthenticated) {
      const accepted = await opts.secrets.serverTokens();
      const presented = bearerToken(req);
      if (accepted.length === 0 || !presented || !tokenMatches(presented, accepted)) {
        return json(401, { error: "missing or invalid seek server token" }, { "www-authenticate": "Bearer" });
      }
    }

    const rest = url.pathname.slice(PROXY_PREFIX.length);
    const slash = rest.indexOf("/");
    const id = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? "" : rest.slice(slash);
    if (!isUpstreamId(id)) return json(404, { error: `unknown provider '${id}'` });
    if (path.split("/").some((segment) => segment === ".." || segment === ".")) {
      return json(400, { error: "invalid path" });
    }
    const spec = upstreams[id];

    const key = await opts.secrets.get(spec.envVar);
    if (!key) {
      return json(503, {
        error: `seek server has no API key configured for ${spec.label} (${spec.envVar})`,
      });
    }

    const connectionHeaders = new Set(
      (req.headers.get("connection") ?? "").split(",").map((name) => name.trim().toLowerCase()),
    );
    const headers = new Headers();
    req.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (STRIPPED_REQUEST_HEADERS.has(lower) || connectionHeaders.has(lower) || providerAuthHeaders.has(lower) || lower.startsWith("x-forwarded-")) return;
      headers.set(name, value);
    });
    for (const [name, value] of Object.entries(spec.authHeaders(key))) headers.set(name, value);

    const target = `${spec.baseUrl}${path}${url.search}`;
    const started = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        redirect: "manual",
        signal: req.signal,
      });
    } catch (err) {
      log(`${req.method} ${id}${path} -> upstream error after ${Date.now() - started}ms: ${(err as Error).message}`);
      return json(502, { error: `upstream request to ${spec.label} failed` });
    }
    log(`${req.method} ${id}${path} -> ${upstream.status} (${Date.now() - started}ms)`);

    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // Stream the body through so SSE responses (Brave Answers) are not buffered.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  };
}

export interface StartServerOptions extends ServerOptions {
  hostname: string;
  port: number;
}

export function startServer(opts: StartServerOptions): ReturnType<typeof Bun.serve> {
  const handler = createHandler(opts);
  return Bun.serve({
    hostname: opts.hostname,
    port: opts.port,
    fetch(req, server) {
      // Deep research calls can stay quiet for minutes; don't drop them.
      if (req.url.includes(PROXY_PREFIX)) server.timeout(req, 0);
      return handler(req);
    },
  });
}
