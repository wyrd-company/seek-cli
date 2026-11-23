import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const clientToken = "synthetic-client-secret";
const vaultToken = "synthetic-bao-secret";
const fileToken = "synthetic-file-secret";
const search = ["web", "exa", "query", "--json"];

let configHome: string;
let vault: Bun.Server<undefined>;
let seek: Bun.Server<undefined>;
let vaultReply: () => Response;
let wantedToken: string | null;
let vaultReads: number;
let seekRequests: number;

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "seek-client-vault-"));
  mkdirSync(join(configHome, "seek"));
  vaultReads = 0;
  seekRequests = 0;
  wantedToken = clientToken;
  vaultReply = () => Response.json({ data: { data: { SEEK_SERVER_TOKEN: clientToken } } });
  vault = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      vaultReads++;
      if (new URL(req.url).pathname !== "/v1/secret/data/clients/test") return new Response(null, { status: 404 });
      if (req.headers.get("x-vault-token") !== vaultToken) return new Response(null, { status: 403 });
      return vaultReply();
    },
  });
  seek = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      seekRequests++;
      const path = new URL(req.url).pathname;
      if (!["/v1/proxy/exa/search", "/v1/proxy/brave-answers/chat/completions"].includes(path)) {
        return new Response(null, { status: 404 });
      }
      const auth = req.headers.get("authorization");
      if (auth !== (wantedToken && `Bearer ${wantedToken}`)) {
        // Simulate a proxy that echoes a rejected header in its error response.
        return new Response(`rejected ${auth}`, { status: 401 });
      }
      return Response.json({ results: [], requestId: "authenticated-search" });
    },
  });
});

afterEach(() => {
  vault.stop(true);
  seek.stop(true);
  rmSync(configHome, { recursive: true, force: true });
});

function saveConfig(values: Record<string, string>) {
  writeFileSync(join(configHome, "seek", "config.json"), JSON.stringify(values));
}

async function cli(args = search, env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, "--no-env-file", "src/index.ts", ...args], {
    env: {
      XDG_CONFIG_HOME: configHome,
      SEEK_SERVER_URL: seek.url.href,
      BAO_ADDR: vault.url.href,
      BAO_TOKEN: vaultToken,
      SEEK_VAULT_PATH: "clients/test",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  for (const token of [clientToken, vaultToken, fileToken]) {
    expect(stdout + stderr).not.toContain(token);
  }
  return { exitCode, stdout, stderr };
}

describe("CLI server token from Vault/OpenBao", () => {
  test("authenticates a search with the KV field ahead of a saved token", async () => {
    saveConfig({ SEEK_SERVER_URL: seek.url.href, SEEK_SERVER_TOKEN: fileToken });
    const result = await cli(search, { SEEK_SERVER_URL: "", SEEK_SERVER_TOKEN: " " });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).requestId).toBe("authenticated-search");
    expect([vaultReads, seekRequests]).toEqual([1, 1]);
  });

  test("the environment token bypasses even incomplete Vault settings", async () => {
    saveConfig({ SEEK_SERVER_TOKEN: fileToken });
    const result = await cli(search, { SEEK_SERVER_TOKEN: clientToken, BAO_ADDR: "" });
    expect(result.exitCode).toBe(0);
    expect([vaultReads, seekRequests]).toEqual([0, 1]);
  });

  test("uses the saved token when the field is absent or Vault is disabled", async () => {
    wantedToken = fileToken;
    saveConfig({ SEEK_SERVER_TOKEN: fileToken });
    vaultReply = () => Response.json({ data: { data: {} } });
    expect((await cli()).exitCode).toBe(0);
    expect((await cli(search, { SEEK_VAULT_PATH: "" })).exitCode).toBe(0);
    expect([vaultReads, seekRequests]).toEqual([1, 2]);
  });

  test("supports a server with no authentication when all token sources are empty", async () => {
    wantedToken = null;
    vaultReply = () => Response.json({ data: { data: { SEEK_SERVER_TOKEN: " " } } });
    expect((await cli()).exitCode).toBe(0);
    expect([vaultReads, seekRequests]).toEqual([1, 1]);
  });

  test("a first Vault read failure stops the request even with a saved token", async () => {
    saveConfig({ SEEK_SERVER_TOKEN: fileToken });
    vaultReply = () => new Response(`denied ${vaultToken} ${clientToken}`, { status: 403 });
    const result = await cli();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("HTTP 403");
    expect([vaultReads, seekRequests]).toEqual([1, 0]);
  });

  test("rejected bearer tokens stay out of JSON and streaming endpoint errors", async () => {
    wantedToken = fileToken;
    for (const args of [search, ["web", "brave", "answers", "query"]]) {
      const result = await cli(args);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("HTTP 401");
      expect(result.stderr).toContain("Bearer [redacted]");
    }
    expect([vaultReads, seekRequests]).toEqual([2, 2]);
  });

  test("direct mode still requires the provider key and never contacts Vault", async () => {
    const result = await cli(search, { SEEK_SERVER_URL: "" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing API key for exa");
    expect([vaultReads, seekRequests]).toEqual([0, 0]);
  });

  test("config show identifies the configured source offline and reveals no token fragments", async () => {
    saveConfig({ SEEK_SERVER_TOKEN: fileToken });
    for (const [env, source] of [
      [{ SEEK_SERVER_TOKEN: clientToken }, "env"],
      [{}, "Vault/OpenBao configured"],
      [{ SEEK_VAULT_PATH: "" }, "config"],
    ] as const) {
      const result = await cli(["config", "show"], env);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`(token: ${source})`);
      expect(result.stdout).not.toContain("synt…cret");
    }
    expect([vaultReads, seekRequests]).toEqual([0, 0]);
  });
});
