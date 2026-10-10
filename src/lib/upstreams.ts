import { loadConfig } from "./config.ts";
import { requireEnv } from "./env.ts";

export type UpstreamId =
  | "parallel"
  | "exa"
  | "brave-search"
  | "brave-answers"
  | "perplexity"
  | "google"
  | "firecrawl";

export interface UpstreamSpec {
  id: UpstreamId;
  /** Human-readable provider name used in error messages. */
  label: string;
  baseUrl: string;
  envVar: string;
  authHeaders(key: string): Record<string, string>;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export const UPSTREAMS: Readonly<Record<UpstreamId, UpstreamSpec>> = {
  parallel: {
    id: "parallel",
    label: "parallel",
    baseUrl: "https://api.parallel.ai",
    envVar: "PARALLEL_API_KEY",
    authHeaders: (key) => ({ "x-api-key": key }),
  },
  exa: {
    id: "exa",
    label: "exa",
    baseUrl: "https://api.exa.ai",
    envVar: "EXA_API_KEY",
    authHeaders: (key) => ({ "x-api-key": key }),
  },
  "brave-search": {
    id: "brave-search",
    label: "brave search",
    baseUrl: "https://api.search.brave.com/res/v1",
    envVar: "BRAVE_SEARCH_API_KEY",
    authHeaders: (key) => ({ "X-Subscription-Token": key }),
  },
  "brave-answers": {
    id: "brave-answers",
    label: "brave answers",
    baseUrl: "https://api.search.brave.com/res/v1",
    envVar: "BRAVE_ANSWERS_API_KEY",
    authHeaders: (key) => ({ "X-Subscription-Token": key }),
  },
  perplexity: {
    id: "perplexity",
    label: "perplexity",
    baseUrl: "https://api.perplexity.ai",
    envVar: "PERPLEXITY_API_KEY",
    authHeaders: bearer,
  },
  google: {
    id: "google",
    label: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envVar: "GEMINI_API_KEY",
    authHeaders: (key) => ({ "x-goog-api-key": key }),
  },
  firecrawl: {
    id: "firecrawl",
    label: "firecrawl",
    baseUrl: "https://api.firecrawl.dev",
    envVar: "FIRECRAWL_API_KEY",
    authHeaders: bearer,
  },
};

export function isUpstreamId(value: string): value is UpstreamId {
  return Object.hasOwn(UPSTREAMS, value);
}

export interface RemoteServer {
  url: string;
  token?: string;
}

/**
 * Returns the seek server the CLI should route provider calls through, or
 * null when the CLI should call providers directly with local API keys.
 */
export function remoteServer(): RemoteServer | null {
  const config = loadConfig();
  const url = (process.env.SEEK_SERVER_URL || config.SEEK_SERVER_URL || "").trim();
  if (!url) return null;
  const token = (process.env.SEEK_SERVER_TOKEN || config.SEEK_SERVER_TOKEN || "").trim();
  return { url: url.replace(/\/+$/, ""), ...(token ? { token } : {}) };
}

export function upstreamBaseUrl(id: UpstreamId): string {
  const remote = remoteServer();
  return remote ? `${remote.url}/v1/proxy/${id}` : UPSTREAMS[id].baseUrl;
}

/** Auth headers for a provider call: the provider key locally, the server token remotely. */
export function upstreamAuthHeaders(id: UpstreamId): Record<string, string> {
  const remote = remoteServer();
  if (remote) return remote.token ? bearer(remote.token) : {};
  const spec = UPSTREAMS[id];
  return spec.authHeaders(requireEnv(spec.envVar, spec.label));
}
