import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../src/program.ts";
import { KNOWN_KEYS } from "../src/lib/config.ts";
import { vaultConfigFromEnv } from "../src/server/vault.ts";

// The configuration schemas are the contract; these tests bind them to the code.

interface Schema {
  properties: Record<string, { description: string; default?: string; enum?: string[]; pattern?: string }>;
}

const fileSchema = JSON.parse(
  readFileSync("docs/specifications/configuration.file.schema.json", "utf8"),
) as Schema;
const environmentSchema = JSON.parse(
  readFileSync("docs/specifications/configuration.environment.schema.json", "utf8"),
) as Schema;

const SERVER_KEYS = ["SEEK_SERVER_URL", "SEEK_SERVER_TOKEN"];
const providerKeys = KNOWN_KEYS.map(([envVar]) => envVar);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

/** Variable names the source reads: process.env.NAME, first(env, "NAME", ...), secrets.get("NAME"), and KNOWN_KEYS. */
function variablesReadBySource(): Set<string> {
  const names = new Set(providerKeys);
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]!);
    for (const m of text.matchAll(/first\(env,([^)]*)\)/g)) {
      for (const literal of m[1]!.matchAll(/"([A-Z][A-Z0-9_]*)"/g)) names.add(literal[1]!);
    }
    for (const m of text.matchAll(/\.get\("([A-Z][A-Z0-9_]*)"\)/g)) names.add(m[1]!);
  }
  return names;
}

function initTemplate(): { config: Record<string, unknown>; fileMode: number; dirMode: number } {
  const home = mkdtempSync(join(tmpdir(), "seek-config-test-"));
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/index.ts", "config", "init"],
    cwd: process.cwd(),
    env: { ...process.env, XDG_CONFIG_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  const path = join(home, "seek", "config.json");
  return {
    config: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>,
    fileMode: statSync(path).mode & 0o777,
    dirMode: statSync(join(home, "seek")).mode & 0o777,
  };
}

describe("configuration.file.schema.json", () => {
  test("defines exactly the provider keys and the two server keys", () => {
    expect(Object.keys(fileSchema.properties).sort()).toEqual([...providerKeys, ...SERVER_KEYS].sort());
  });

  test("describes the template seek config init writes", () => {
    const { config, fileMode, dirMode } = initTemplate();
    expect(Object.keys(config).sort()).toEqual([...providerKeys].sort());
    for (const value of Object.values(config)) expect(value).toBe("");
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });
});

describe("configuration.environment.schema.json", () => {
  test("defines exactly the variables the source reads", () => {
    expect(new Set(Object.keys(environmentSchema.properties))).toEqual(variablesReadBySource());
  });

  test("defines each key it shares with the file schema the same way", () => {
    for (const [name, definition] of Object.entries(fileSchema.properties)) {
      const fromEnvironment = environmentSchema.properties[name]!;
      if (name === "SEEK_SERVER_URL") {
        expect(fromEnvironment.description.startsWith(definition.description)).toBe(true);
        expect({ ...fromEnvironment, description: "" }).toEqual({ ...definition, description: "" });
      } else {
        expect(fromEnvironment).toEqual(definition);
      }
    }
  });

  test("documents the defaults seek serve applies", () => {
    const saved = { host: process.env.SEEK_SERVER_HOST, port: process.env.SEEK_SERVER_PORT };
    delete process.env.SEEK_SERVER_HOST;
    delete process.env.SEEK_SERVER_PORT;
    try {
      const serve = createProgram().commands.find((c) => c.name() === "serve")!;
      const option = (long: string) => serve.options.find((o) => o.long === long)!.defaultValue;
      expect(environmentSchema.properties.SEEK_SERVER_HOST!.default).toBe(option("--host"));
      expect(environmentSchema.properties.SEEK_SERVER_PORT!.default).toBe(option("--port"));
    } finally {
      if (saved.host !== undefined) process.env.SEEK_SERVER_HOST = saved.host;
      if (saved.port !== undefined) process.env.SEEK_SERVER_PORT = saved.port;
    }
  });

  test("documents the Vault defaults and accepted values", () => {
    const vault = environmentSchema.properties;
    const minimal = { SEEK_VAULT_PATH: "seek", VAULT_ADDR: "https://vault.example", VAULT_TOKEN: "synthetic" };
    const config = vaultConfigFromEnv(minimal)!;
    expect(config.mount).toBe(vault.SEEK_VAULT_MOUNT!.default!);
    expect(String(config.kvVersion)).toBe(vault.SEEK_VAULT_KV_VERSION!.default!);
    expect(config.refreshMs).toBe(Number(vault.SEEK_VAULT_REFRESH_SECONDS!.default) * 1000);

    const approle = vaultConfigFromEnv({ ...minimal, SEEK_VAULT_ROLE_ID: "r", SEEK_VAULT_SECRET_ID: "s" })!;
    expect(approle.auth).toMatchObject({ kind: "approle", mount: vault.SEEK_VAULT_APPROLE_MOUNT!.default });

    for (const version of vault.SEEK_VAULT_KV_VERSION!.enum!) {
      expect(vaultConfigFromEnv({ ...minimal, SEEK_VAULT_KV_VERSION: version })!.kvVersion).toBe(Number(version) as 1 | 2);
    }
    expect(() => vaultConfigFromEnv({ ...minimal, SEEK_VAULT_KV_VERSION: "3" })).toThrow();

    const refresh = new RegExp(vault.SEEK_VAULT_REFRESH_SECONDS!.pattern!);
    for (const seconds of ["0", "1.5", "300"]) {
      expect(refresh.test(seconds)).toBe(true);
      expect(vaultConfigFromEnv({ ...minimal, SEEK_VAULT_REFRESH_SECONDS: seconds })!.refreshMs).toBe(Number(seconds) * 1000);
    }
  });
});
