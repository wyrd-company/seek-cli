import { assertValid, loadConfiguration, missingSecretMessage, type Configuration } from "./config.ts";
import { SecretResolver } from "./secrets.ts";

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
  /** The setting that holds the provider's API key. */
  setting: string;
  authHeaders(key: string): Record<string, string>;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export const UPSTREAMS: Readonly<Record<UpstreamId, UpstreamSpec>> = {
  parallel: {
    id: "parallel",
    label: "parallel",
    baseUrl: "https://api.parallel.ai",
    setting: "providers.parallel.api-key",
    authHeaders: (key) => ({ "x-api-key": key }),
  },
  exa: {
    id: "exa",
    label: "exa",
    baseUrl: "https://api.exa.ai",
    setting: "providers.exa.api-key",
    authHeaders: (key) => ({ "x-api-key": key }),
  },
  "brave-search": {
    id: "brave-search",
    label: "brave search",
    baseUrl: "https://api.search.brave.com/res/v1",
    setting: "providers.brave-search.api-key",
    authHeaders: (key) => ({ "X-Subscription-Token": key }),
  },
  "brave-answers": {
    id: "brave-answers",
    label: "brave answers",
    baseUrl: "https://api.search.brave.com/res/v1",
    setting: "providers.brave-answers.api-key",
    authHeaders: (key) => ({ "X-Subscription-Token": key }),
  },
  perplexity: {
    id: "perplexity",
    label: "perplexity",
    baseUrl: "https://api.perplexity.ai",
    setting: "providers.perplexity.api-key",
    authHeaders: bearer,
  },
  google: {
    id: "google",
    label: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    setting: "providers.google.api-key",
    authHeaders: (key) => ({ "x-goog-api-key": key }),
  },
  firecrawl: {
    id: "firecrawl",
    label: "firecrawl",
    baseUrl: "https://api.firecrawl.dev",
    setting: "providers.firecrawl.api-key",
    authHeaders: bearer,
  },
};

export function isUpstreamId(value: string): value is UpstreamId {
  return Object.hasOwn(UPSTREAMS, value);
}

/** A direct-mode command needs a provider key that has no source in any layer. */
export class MissingProviderKeyError extends Error {
  constructor(spec: UpstreamSpec, configuration: Configuration) {
    super(`Missing API key for ${spec.label}: ${missingSecretMessage(spec.setting, configuration)}`);
    this.name = "MissingProviderKeyError";
  }
}

/** The loaded client configuration a command uses, with the secrets it has resolved. */
export class ClientContext {
  readonly resolver: SecretResolver;
  private readonly resolved = new Map<string, Promise<string | undefined>>();

  constructor(readonly configuration: Configuration) {
    this.resolver = new SecretResolver(configuration);
  }

  /** The seek server URL in server mode, or null in direct mode. */
  serverUrl(): string | null {
    const url = this.configuration.plain.get("server.url")?.value;
    return typeof url === "string" && url !== "" ? url : null;
  }

  /** Whether a provider has an API key source; in server mode the server holds the keys. */
  hasKey(id: UpstreamId): boolean {
    return this.serverUrl() !== null || this.resolver.configured(UPSTREAMS[id].setting);
  }

  /** Resolves a secret once per command, when the command needs it. */
  secret(path: string): Promise<string | undefined> {
    let pending = this.resolved.get(path);
    if (!pending) {
      pending = this.resolver.resolve(path);
      this.resolved.set(path, pending);
    }
    return pending;
  }
}

let active: ClientContext | undefined;

/** Makes a loaded client configuration the one provider calls use. */
export function useClientConfiguration(configuration: Configuration): ClientContext {
  active = new ClientContext(configuration);
  return active;
}

/** The active client configuration, or, outside a command, the one the environment and default files give. */
export function clientContext(): ClientContext {
  return active ?? new ClientContext(assertValid(loadConfiguration({ kind: "client" })));
}

export function upstreamBaseUrl(id: UpstreamId): string {
  const remote = clientContext().serverUrl();
  return remote !== null ? `${remote}/v1/proxy/${id}` : UPSTREAMS[id].baseUrl;
}

/** Auth headers for a provider call: the provider key directly, the client token through a server. */
export async function upstreamAuthHeaders(id: UpstreamId): Promise<Record<string, string>> {
  const context = clientContext();
  if (context.serverUrl() !== null) {
    const token = await context.secret("server.token");
    return token ? bearer(token) : {};
  }
  const spec = UPSTREAMS[id];
  if (!context.resolver.configured(spec.setting)) throw new MissingProviderKeyError(spec, context.configuration);
  return spec.authHeaders((await context.secret(spec.setting))!);
}
