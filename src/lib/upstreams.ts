import { SecretResolver } from "../server/secrets.ts";
import { VaultSecretSource, vaultConfigFromEnv } from "../server/vault.ts";
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

export function remoteServerUrl(): string | null {
  const config = loadConfig();
  const url = (process.env.SEEK_SERVER_URL || config.SEEK_SERVER_URL || "").trim();
  return url ? url.replace(/\/+$/, "") : null;
}

// A CLI invocation may poll a job several times. Share the KV cache, but only
// configure it once a remote request actually needs the Vault credential.
let clientVault: VaultSecretSource | undefined;
const clientSecrets = new SecretResolver({
  async get(name) {
    if (!clientVault) {
      const config = vaultConfigFromEnv();
      if (!config) return undefined;
      clientVault = new VaultSecretSource(config);
    }
    return clientVault.get(name);
  },
});

export function upstreamBaseUrl(id: UpstreamId): string {
  const remote = remoteServerUrl();
  return remote !== null ? `${remote}/v1/proxy/${id}` : UPSTREAMS[id].baseUrl;
}

/** Auth headers for a provider call: the provider key locally, the server token remotely. */
export async function upstreamAuthHeaders(id: UpstreamId): Promise<Record<string, string>> {
  if (remoteServerUrl() !== null) {
    const token = await clientSecrets.get("SEEK_SERVER_TOKEN");
    return token ? bearer(token) : {};
  }
  const spec = UPSTREAMS[id];
  return spec.authHeaders(requireEnv(spec.envVar, spec.label));
}
