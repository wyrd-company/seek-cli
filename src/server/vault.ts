import { readFileSync } from "node:fs";

/**
 * Minimal Vault / OpenBao KV client. Both servers speak the same HTTP API, so
 * one implementation covers either. Secrets are read from a single KV path
 * whose keys match seek's env var names (e.g. EXA_API_KEY).
 */

export type VaultAuth =
  | { kind: "token"; token: string }
  | { kind: "token-file"; path: string }
  | { kind: "approle"; mount: string; roleId: string; secretId: string };

export interface VaultConfig {
  addr: string;
  namespace?: string;
  mount: string;
  path: string;
  kvVersion: 1 | 2;
  auth: VaultAuth;
  refreshMs: number;
}

type Env = Record<string, string | undefined>;

function first(env: Env, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readTrimmed(path: string): string {
  return readFileSync(path, "utf8").trim();
}

/** Returns null when Vault is not configured (SEEK_VAULT_PATH unset). */
export function vaultConfigFromEnv(env: Env = process.env): VaultConfig | null {
  const path = first(env, "SEEK_VAULT_PATH");
  if (!path) return null;

  const addr = first(env, "SEEK_VAULT_ADDR", "VAULT_ADDR", "BAO_ADDR");
  if (!addr) {
    throw new Error("SEEK_VAULT_PATH is set but no Vault address is configured. Set VAULT_ADDR (or BAO_ADDR).");
  }

  const kvVersion = first(env, "SEEK_VAULT_KV_VERSION") ?? "2";
  if (kvVersion !== "1" && kvVersion !== "2") {
    throw new Error(`SEEK_VAULT_KV_VERSION must be 1 or 2, got '${kvVersion}'.`);
  }

  const refreshSeconds = Number(first(env, "SEEK_VAULT_REFRESH_SECONDS") ?? "300");
  if (!Number.isFinite(refreshSeconds) || refreshSeconds < 0) {
    throw new Error("SEEK_VAULT_REFRESH_SECONDS must be a non-negative number.");
  }

  const namespace = first(env, "VAULT_NAMESPACE", "BAO_NAMESPACE");
  return {
    addr: addr.replace(/\/+$/, ""),
    ...(namespace ? { namespace } : {}),
    mount: (first(env, "SEEK_VAULT_MOUNT") ?? "secret").replace(/^\/+|\/+$/g, ""),
    path: path.replace(/^\/+|\/+$/g, ""),
    kvVersion: kvVersion === "1" ? 1 : 2,
    auth: vaultAuthFromEnv(env),
    refreshMs: refreshSeconds * 1000,
  };
}

function vaultAuthFromEnv(env: Env): VaultAuth {
  const roleId = first(env, "SEEK_VAULT_ROLE_ID");
  if (roleId) {
    const secretIdFile = first(env, "SEEK_VAULT_SECRET_ID_FILE");
    const secretId = secretIdFile ? readTrimmed(secretIdFile) : first(env, "SEEK_VAULT_SECRET_ID");
    if (!secretId) {
      throw new Error("SEEK_VAULT_ROLE_ID is set but SEEK_VAULT_SECRET_ID (or SEEK_VAULT_SECRET_ID_FILE) is not.");
    }
    const mount = (first(env, "SEEK_VAULT_APPROLE_MOUNT") ?? "approle").replace(/^\/+|\/+$/g, "");
    return { kind: "approle", mount, roleId, secretId };
  }
  const tokenFile = first(env, "SEEK_VAULT_TOKEN_FILE");
  if (tokenFile) return { kind: "token-file", path: tokenFile };
  const token = first(env, "VAULT_TOKEN", "BAO_TOKEN");
  if (token) return { kind: "token", token };
  throw new Error(
    "SEEK_VAULT_PATH is set but no Vault credentials are configured. Set VAULT_TOKEN, " +
      "SEEK_VAULT_TOKEN_FILE, or SEEK_VAULT_ROLE_ID + SEEK_VAULT_SECRET_ID.",
  );
}

class VaultHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class VaultSecretSource {
  private secrets: Record<string, string> = {};
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;
  private loginToken: string | null = null;

  constructor(
    readonly config: VaultConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  describe(): string {
    return `${this.config.addr} ${this.config.mount}/${this.config.path} (kv v${this.config.kvVersion}, ${this.config.auth.kind} auth)`;
  }

  /** Reads the secret path; throws if Vault cannot be reached or denies access. */
  async refresh(): Promise<void> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return await this.inflight;
  }

  /**
   * Returns a secret, re-reading Vault when the cache is older than the
   * refresh interval. A failed refresh keeps serving the last good values.
   */
  async get(name: string): Promise<string | undefined> {
    const stale = this.fetchedAt === 0 || Date.now() - this.fetchedAt >= this.config.refreshMs;
    if (stale) {
      try {
        await this.refresh();
      } catch (err) {
        if (this.fetchedAt === 0) throw err;
        process.stderr.write(`warning: vault refresh failed, using cached secrets: ${(err as Error).message}\n`);
      }
    }
    return this.secrets[name];
  }

  private async load(): Promise<void> {
    let data: Record<string, unknown>;
    try {
      data = await this.read();
    } catch (err) {
      // An AppRole token may have expired; log in again once and retry.
      if (!(err instanceof VaultHttpError) || err.status !== 403 || this.config.auth.kind !== "approle") throw err;
      this.loginToken = null;
      data = await this.read();
    }
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") secrets[key] = value;
    }
    this.secrets = secrets;
    this.fetchedAt = Date.now();
  }

  private async read(): Promise<Record<string, unknown>> {
    const { mount, path, kvVersion } = this.config;
    const url = kvVersion === 2 ? `/v1/${mount}/data/${path}` : `/v1/${mount}/${path}`;
    const body = (await this.call("GET", url, await this.token())) as {
      data?: { data?: Record<string, unknown> } & Record<string, unknown>;
    };
    const data = kvVersion === 2 ? body.data?.data : body.data;
    if (!data || typeof data !== "object") {
      throw new Error(`vault returned no data for ${mount}/${path}`);
    }
    return data;
  }

  private async token(): Promise<string> {
    const auth = this.config.auth;
    switch (auth.kind) {
      case "token":
        return auth.token;
      case "token-file":
        // Re-read each time so tokens rotated by Vault Agent are picked up.
        return readTrimmed(auth.path);
      case "approle": {
        if (this.loginToken) return this.loginToken;
        const body = (await this.call("POST", `/v1/auth/${auth.mount}/login`, undefined, {
          role_id: auth.roleId,
          secret_id: auth.secretId,
        })) as { auth?: { client_token?: string } };
        const token = body.auth?.client_token;
        if (!token) throw new Error("vault approle login returned no client token");
        this.loginToken = token;
        return token;
      }
    }
  }

  private async call(method: string, path: string, token?: string, payload?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers["X-Vault-Token"] = token;
    if (this.config.namespace) headers["X-Vault-Namespace"] = this.config.namespace;
    if (payload !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchImpl(`${this.config.addr}${path}`, {
      method,
      headers,
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // Vault error bodies carry messages, never secret values.
      throw new VaultHttpError(res.status, `vault ${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
  }
}
