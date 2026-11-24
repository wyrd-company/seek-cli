import type { Configuration } from "../lib/config.ts";
import { SecretResolver } from "../lib/secrets.ts";
import { UPSTREAMS, type UpstreamId } from "../lib/upstreams.ts";

/** The secrets a seek server reads per request: its accepted client tokens and each provider's key. */
export interface ServerSecrets {
  tokens(): Promise<string[]>;
  providerKey(id: UpstreamId): Promise<string | undefined>;
}

/** Splits `server.tokens` on commas, so a new token can be added before the old one is removed. */
export function splitTokens(value: string | undefined): string[] {
  return (value ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

interface Held {
  value: string;
  resolvedAt: number;
  pending?: Promise<void>;
}

/**
 * The server's secrets. Every configured secret is resolved before the server
 * listens; each is resolved again once `server.secret-refresh-seconds` has
 * passed, and a later resolution that fails writes one warning and keeps the
 * value already held.
 */
export class SecretStore implements ServerSecrets {
  private readonly held = new Map<string, Held>();
  private readonly resolver: SecretResolver;
  private readonly refreshMs: number;

  constructor(
    readonly configuration: Configuration,
    private readonly warn: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
    private readonly now: () => number = Date.now,
  ) {
    this.resolver = new SecretResolver(configuration);
    this.refreshMs = Number(configuration.plain.get("server.secret-refresh-seconds")?.value ?? 300) * 1000;
  }

  /** The secrets that have a source. */
  configured(): string[] {
    return [...this.configuration.secrets.values()].filter((s) => s.source).map((s) => s.path);
  }

  /** Resolves every configured secret; throws when one fails. */
  async start(): Promise<void> {
    await Promise.all(
      this.configured().map(async (path) => {
        const value = (await this.resolver.resolve(path))!;
        this.held.set(path, { value, resolvedAt: this.now() });
      }),
    );
  }

  async get(path: string): Promise<string | undefined> {
    const held = this.held.get(path);
    if (!held) return undefined;
    if (this.now() - held.resolvedAt >= this.refreshMs) {
      held.pending ??= this.resolver
        .resolve(path)
        .then((value) => {
          held.value = value!;
        })
        .catch((error: Error) => {
          this.warn(`seek serve: warning: ${error.message}; keeping the value resolved earlier`);
        })
        .finally(() => {
          held.resolvedAt = this.now();
          held.pending = undefined;
        });
      await held.pending;
    }
    return held.value;
  }

  async tokens(): Promise<string[]> {
    return splitTokens(await this.get("server.tokens"));
  }

  async providerKey(id: UpstreamId): Promise<string | undefined> {
    return await this.get(UPSTREAMS[id].setting);
  }
}
