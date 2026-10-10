import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultSecretSource, vaultConfigFromEnv, type VaultConfig } from "../src/server/vault.ts";

type Handler = (req: Request) => Response | Promise<Response>;

function fakeFetch(handler: Handler): { fetch: typeof fetch; calls: Request[] } {
  const calls: Request[] = [];
  const impl = (async (...args: Parameters<typeof fetch>) => {
    const req = new Request(args[0] as string, args[1]);
    calls.push(req.clone() as Request);
    return await handler(req);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function config(overrides: Partial<VaultConfig> = {}): VaultConfig {
  return {
    addr: "http://vault.test",
    mount: "secret",
    path: "seek",
    kvVersion: 2,
    auth: { kind: "token", token: "root" },
    refreshMs: 60_000,
    ...overrides,
  };
}

describe("vaultConfigFromEnv", () => {
  test("is disabled unless SEEK_VAULT_PATH is set", () => {
    expect(vaultConfigFromEnv({ VAULT_ADDR: "http://v", VAULT_TOKEN: "t" })).toBeNull();
  });

  test("accepts OpenBao variable names", () => {
    const cfg = vaultConfigFromEnv({
      SEEK_VAULT_PATH: "/team/seek/",
      BAO_ADDR: "https://bao.internal/",
      BAO_TOKEN: "s.abc",
      BAO_NAMESPACE: "tools",
    });
    expect(cfg).toEqual({
      addr: "https://bao.internal",
      namespace: "tools",
      mount: "secret",
      path: "team/seek",
      kvVersion: 2,
      auth: { kind: "token", token: "s.abc" },
      refreshMs: 300_000,
    });
  });

  test("prefers AppRole and reads the secret id from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "seek-vault-"));
    const file = join(dir, "secret-id");
    writeFileSync(file, "sid-from-file\n");
    const cfg = vaultConfigFromEnv({
      SEEK_VAULT_PATH: "seek",
      VAULT_ADDR: "http://v",
      VAULT_TOKEN: "ignored",
      SEEK_VAULT_ROLE_ID: "rid",
      SEEK_VAULT_SECRET_ID_FILE: file,
    });
    expect(cfg?.auth).toEqual({ kind: "approle", mount: "approle", roleId: "rid", secretId: "sid-from-file" });
  });

  test("fails loudly when credentials are missing", () => {
    expect(() => vaultConfigFromEnv({ SEEK_VAULT_PATH: "seek", VAULT_ADDR: "http://v" })).toThrow(
      /no Vault credentials/,
    );
  });
});

describe("VaultSecretSource", () => {
  test("reads a KV v2 path with the token and namespace", async () => {
    const { fetch, calls } = fakeFetch(() =>
      Response.json({ data: { data: { EXA_API_KEY: "exa-from-vault" }, metadata: {} } }),
    );
    const source = new VaultSecretSource(config({ namespace: "tools" }), fetch);
    expect(await source.get("EXA_API_KEY")).toBe("exa-from-vault");
    expect(await source.get("MISSING")).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://vault.test/v1/secret/data/seek");
    expect(calls[0]!.headers.get("x-vault-token")).toBe("root");
    expect(calls[0]!.headers.get("x-vault-namespace")).toBe("tools");
  });

  test("reads a KV v1 path", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ data: { EXA_API_KEY: "v1" } }));
    const source = new VaultSecretSource(config({ kvVersion: 1, mount: "kv" }), fetch);
    expect(await source.get("EXA_API_KEY")).toBe("v1");
    expect(calls[0]!.url).toBe("http://vault.test/v1/kv/seek");
  });

  test("logs in with AppRole and logs in again after a 403", async () => {
    let logins = 0;
    let reads = 0;
    const { fetch, calls } = fakeFetch(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/v1/auth/approle/login") {
        logins += 1;
        expect(await req.json()).toEqual({ role_id: "rid", secret_id: "sid" });
        return Response.json({ auth: { client_token: `tok-${logins}` } });
      }
      reads += 1;
      if (req.headers.get("x-vault-token") === "tok-1" && reads > 1) {
        return Response.json({ errors: ["permission denied"] }, { status: 403 });
      }
      return Response.json({ data: { data: { K: req.headers.get("x-vault-token") } } });
    });
    const source = new VaultSecretSource(
      config({ auth: { kind: "approle", mount: "approle", roleId: "rid", secretId: "sid" }, refreshMs: 0 }),
      fetch,
    );
    expect(await source.get("K")).toBe("tok-1");
    expect(await source.get("K")).toBe("tok-2");
    expect(logins).toBe(2);
    expect(calls.some((c) => c.url.endsWith("/login") && c.headers.get("x-vault-token"))).toBe(false);
  });

  test("keeps serving cached secrets when a refresh fails", async () => {
    let fail = false;
    const { fetch } = fakeFetch(() =>
      fail ? new Response("down", { status: 500 }) : Response.json({ data: { data: { K: "v" } } }),
    );
    const source = new VaultSecretSource(config({ refreshMs: 0 }), fetch);
    expect(await source.get("K")).toBe("v");
    fail = true;
    const originalWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(await source.get("K")).toBe("v");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  test("throws when the first read fails", async () => {
    const { fetch } = fakeFetch(() => new Response('{"errors":["permission denied"]}', { status: 403 }));
    const source = new VaultSecretSource(config(), fetch);
    await expect(source.refresh()).rejects.toThrow(/HTTP 403/);
  });
});
