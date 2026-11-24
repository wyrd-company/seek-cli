import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfiguration } from "../src/lib/config.ts";
import { cleanEnv, seek, setting, show, tempDir, write } from "./harness.ts";

// The loader through the CLI's entry point: discovery, each precedence step,
// whole replacement, explicit empty values, validation per layer and after
// the merge, and the 0.3.2 inputs this release no longer reads.

function home(): { home: string; config: string } {
  const dir = tempDir("seek-loader-home-");
  return { home: dir, config: join(dir, ".config", "seek") };
}

describe("discovery", () => {
  test("the user file is $XDG_CONFIG_HOME/seek/client.yml, else ~/.config/seek/client.yml", async () => {
    const { home: dir, config } = home();
    const xdg = tempDir("seek-xdg-");
    write(join(xdg, "seek", "client.yml"), "vault:\n  mount: from-xdg\n");
    write(join(config, "client.yml"), "vault:\n  mount: from-home\n");
    const fromXdg = await show([], { home: dir, env: { XDG_CONFIG_HOME: xdg } });
    expect(fromXdg.json.files).toEqual([join(xdg, "seek", "client.yml")]);
    expect(setting(fromXdg.json, "vault.mount").value).toBe("from-xdg");
    for (const value of [undefined, "", "relative/dir"]) {
      const result = await show([], { home: dir, env: value === undefined ? {} : { XDG_CONFIG_HOME: value } });
      expect(result.json.files).toEqual([join(config, "client.yml")]);
      expect(setting(result.json, "vault.mount")).toEqual({ path: "vault.mount", value: "from-home", layer: { kind: "file", file: join(config, "client.yml") } });
    }
    expect(fromXdg.run.stderr).toBe("");
  });

  test("without files, every setting has its default or is unset", async () => {
    const result = await show([]);
    expect(result.run.exitCode).toBe(0);
    expect(result.json.files).toEqual([]);
    expect(setting(result.json, "vault.mount")).toEqual({ path: "vault.mount", value: "secret", layer: { kind: "default" } });
    expect(setting(result.json, "providers.exa.api-key")).toEqual({ path: "providers.exa.api-key", layer: { kind: "unset" } });
  });

  test("--config and SEEK_CONFIG name one file in place of the default files", async () => {
    const { home: dir, config } = home();
    write(join(config, "client.yml"), "vault:\n  mount: from-home\n");
    const other = write(join(tempDir(), "other.yml"), "vault:\n  kv-version: 1\n");
    for (const [args, env] of [[["--config", other], {}], [[], { SEEK_CONFIG: other }]] as const) {
      const result = await show([...args], { home: dir, env });
      expect(result.json.files).toEqual([other]);
      expect(setting(result.json, "vault.mount").layer).toEqual({ kind: "default" });
      expect(setting(result.json, "vault.kv-version").value).toBe(1);
    }
  });

  test("a missing explicit file stops a command, but is the target of config path and config init", async () => {
    const missing = join(tempDir(), "nested", "client.yml");
    const command = await seek(["web", "exa", "query", "--config", missing]);
    expect(command.exitCode).toBe(1);
    expect(command.stderr).toBe(`error: ${missing}: the configuration file does not exist\n`);
    expect((await seek(["config", "validate", "--config", missing])).exitCode).toBe(1);
    expect((await seek(["config", "path", "--config", missing])).stdout).toBe(`${missing}\n`);
    expect((await seek(["config", "path"], { env: { SEEK_CONFIG: missing } })).stdout).toBe(`${missing}\n`);
    expect((await seek(["config", "path", "--server"])).stdout).toBe("/etc/seek/server.yml\n");
  });

  test("the system file is below the user file", () => {
    const system = tempDir("seek-etc-");
    const { home: dir, config } = home();
    write(join(system, "client.yml"), "vault:\n  mount: from-system\n  kv-version: 1\n");
    write(join(config, "client.yml"), "vault:\n  mount: from-user\n");
    const loaded = loadConfiguration({ kind: "client", env: {}, home: dir, systemDir: system });
    expect(loaded.errors).toEqual([]);
    expect(loaded.files).toEqual([join(system, "client.yml"), join(config, "client.yml")]);
    expect(loaded.plain.get("vault.mount")).toEqual({ path: "vault.mount", value: "from-user", origin: { kind: "file", file: join(config, "client.yml") } });
    expect(loaded.plain.get("vault.kv-version")).toEqual({ path: "vault.kv-version", value: 1, origin: { kind: "file", file: join(system, "client.yml") } });
    const server = loadConfiguration({ kind: "server", env: { SEEK_SERVER_REQUIRE_TOKEN: "false" }, home: dir, systemDir: system });
    expect(server.files).toEqual([]);
  });
});

describe("precedence", () => {
  test("defaults, the user file, the environment and flags, each above the last", async () => {
    const { home: dir, config } = home();
    write(join(config, "client.yml"), "vault:\n  mount: file-mount\n  namespace: file-namespace\n  ca-cert: /file/ca.pem\n");
    const env = { SEEK_VAULT_NAMESPACE: "env-namespace", SEEK_VAULT_CA_CERT: "/env/ca.pem" };
    const result = await show(["--vault-ca-cert", "/flag/ca.pem"], { home: dir, env });
    expect(result.run.exitCode).toBe(0);
    expect(setting(result.json, "vault.kv-version")).toEqual({ path: "vault.kv-version", value: 2, layer: { kind: "default" } });
    expect(setting(result.json, "vault.mount")).toEqual({ path: "vault.mount", value: "file-mount", layer: { kind: "file", file: join(config, "client.yml") } });
    expect(setting(result.json, "vault.namespace")).toEqual({ path: "vault.namespace", value: "env-namespace", layer: { kind: "env", name: "SEEK_VAULT_NAMESPACE" } });
    expect(setting(result.json, "vault.ca-cert")).toEqual({ path: "vault.ca-cert", value: "/flag/ca.pem", layer: { kind: "flag", name: "--vault-ca-cert" } });
  });

  test("seek serve takes its address from the file, the environment and flags", async () => {
    const file = write(join(tempDir(), "server.yml"), "server:\n  host: 127.0.0.1\n  port: 1\n  require-token: false\n");
    const fromFile = loadConfiguration({ kind: "server", config: file, env: {} });
    expect(fromFile.plain.get("server.port")!.value).toBe(1);
    for (const [args, env] of [[["--port", "0"], { SEEK_SERVER_PORT: "1" }], [["--server-port", "0"], {}]] as const) {
      const server = Bun.spawn([process.execPath, join(import.meta.dir, "../src/index.ts"), "serve", "--config", file, ...args], {
        env: cleanEnv({ env }),
        stderr: "pipe",
      });
      try {
        const reader = server.stderr.getReader();
        let text = "";
        while (!text.includes("providers with keys")) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
        expect(text).toMatch(/listening on http:\/\/127\.0\.0\.1:\d+/);
        expect(text).not.toContain("127.0.0.1:1\n");
      } finally {
        server.kill();
      }
    }
  });

  test("a secret's source and an auth mapping from a higher layer replace the lower one whole", async () => {
    const { home: dir, config } = home();
    write(
      join(config, "client.yml"),
      [
        "providers:",
        "  exa:",
        "    api-key:",
        "      command: [op, read, op://Private/Exa/credential]",
        "      timeout: 5s",
        "vault:",
        "  address: https://bao.internal.example",
        "  auth:",
        "    mode: approle",
        "    role-id: synthetic-role",
        "    secret-id: { file: /run/secret-id }",
        "",
      ].join("\n"),
    );
    const env = { SEEK_PROVIDERS_EXA_API_KEY_FILE: "/run/exa", SEEK_VAULT_AUTH_MODE: "token", SEEK_VAULT_AUTH_TOKEN_FILE: "/run/token" };
    const result = await show([], { home: dir, env });
    expect(setting(result.json, "providers.exa.api-key")).toEqual({
      path: "providers.exa.api-key",
      source: { file: "/run/exa" },
      layer: { kind: "env", name: "SEEK_PROVIDERS_EXA_API_KEY_FILE" },
    });
    expect(setting(result.json, "vault.auth")).toEqual({
      path: "vault.auth",
      auth: { mode: "token", token: { file: "/run/token" }, "declared-in": { kind: "env", name: "SEEK_VAULT_AUTH_MODE" } },
      layer: { kind: "env", name: "SEEK_VAULT_AUTH_MODE" },
    });
  });

  test("a partial source in a higher layer is an error, not a patch", async () => {
    const { home: dir, config } = home();
    write(join(config, "client.yml"), "providers:\n  exa:\n    api-key:\n      command: [helper]\n");
    const result = await seek(["config", "validate"], { home: dir, env: { SEEK_PROVIDERS_EXA_API_KEY_TIMEOUT: "5s", SEEK_VAULT_AUTH_ROLE_ID: "synthetic-role" } });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: providers.exa.api-key: sets timeout without command (SEEK_PROVIDERS_EXA_API_KEY_TIMEOUT)\n");
    expect(result.stderr).toContain("error: vault.auth: sets no mode; expected mode token, approle or none (SEEK_VAULT_AUTH_ROLE_ID)\n");
  });

  test("an explicit empty value, false or 0 replaces a lower layer; an empty alias is unset", async () => {
    const { home: dir, config } = home();
    write(join(config, "client.yml"), "server:\n  url: https://seek.internal.example\nvault:\n  address: https://bao.internal.example\n  namespace: team\n");
    const result = await show([], { home: dir, env: { SEEK_SERVER_URL: "", BAO_ADDR: " ", SEEK_VAULT_NAMESPACE: "" } });
    expect(setting(result.json, "server.url")).toEqual({ path: "server.url", value: "", layer: { kind: "env", name: "SEEK_SERVER_URL" } });
    expect(setting(result.json, "vault.address").value).toBe("https://bao.internal.example");
    expect(setting(result.json, "vault.namespace")).toEqual({ path: "vault.namespace", value: "", layer: { kind: "env", name: "SEEK_VAULT_NAMESPACE" } });
    const server = write(join(tempDir(), "server.yml"), "server:\n  port: 9000\n  secret-refresh-seconds: 60\n");
    const off = await show(["--server", "--config", server, "--no-server-require-token"], { env: { SEEK_SERVER_PORT: "0", SEEK_SERVER_SECRET_REFRESH_SECONDS: "0" } });
    expect(off.run.exitCode).toBe(0);
    expect(setting(off.json, "server.port")).toEqual({ path: "server.port", value: 0, layer: { kind: "env", name: "SEEK_SERVER_PORT" } });
    expect(setting(off.json, "server.secret-refresh-seconds").value).toBe(0);
    expect(setting(off.json, "server.require-token")).toEqual({ path: "server.require-token", value: false, layer: { kind: "flag", name: "--no-server-require-token" } });
    const alias = await show(["--server", "--config", server, "--no-auth"]);
    expect(setting(alias.json, "server.require-token").layer).toEqual({ kind: "flag", name: "--no-auth" });
  });

  test("relative paths start from the declaring file's directory, or the working directory", async () => {
    const { home: dir, config } = home();
    write(join(config, "client.yml"), "providers:\n  exa:\n    api-key: { file: secrets/exa }\n  parallel:\n    api-key: { file: ~/keys/parallel }\n  firecrawl:\n    api-key: { command: [./bin/helper, get] }\n  google:\n    api-key: { command: [op, read] }\n");
    const cwd = tempDir("seek-cwd-");
    const result = await show([], { home: dir, cwd, env: { SEEK_PROVIDERS_PERPLEXITY_API_KEY_FILE: "keys/perplexity" } });
    expect(setting(result.json, "providers.exa.api-key").source).toEqual({ file: join(config, "secrets/exa") });
    expect(setting(result.json, "providers.parallel.api-key").source).toEqual({ file: join(dir, "keys/parallel") });
    expect(setting(result.json, "providers.firecrawl.api-key").source).toEqual({ command: { program: join(config, "bin/helper"), arguments: 1 }, timeout: "10s" });
    expect(setting(result.json, "providers.google.api-key").source).toEqual({ command: { program: "op", arguments: 1 }, timeout: "10s" });
    expect(setting(result.json, "providers.perplexity.api-key").source).toEqual({ file: join(cwd, "keys/perplexity") });
  });

  test("--<secret>-stdin reads one secret for this run, and a run takes one", async () => {
    const seekServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => Response.json({ results: [], requestId: req.headers.get("authorization") }) });
    try {
      const url = `http://127.0.0.1:${seekServer.port}`;
      const run = await seek(["web", "exa", "query", "--json", "--server-url", url, "--server-token-stdin"], { stdin: "  synthetic-stdin-token \n" });
      expect(run.exitCode).toBe(0);
      expect(JSON.parse(run.stdout).requestId).toBe("Bearer synthetic-stdin-token");
      const two = await seek(["config", "validate", "--server-token-stdin", "--providers-exa-api-key-stdin"], { stdin: "x\n" });
      expect(two.exitCode).toBe(1);
      expect(two.stderr).toContain("a run reads at most one secret from standard input");
    } finally {
      seekServer.stop(true);
    }
  });
});

describe("validation", () => {
  test("errors from every layer are reported at once with their paths and layers", async () => {
    const { home: dir, config } = home();
    const file = write(join(config, "client.yml"), "EXA_API_KEY: synthetic-flat-key\nvault:\n  kv-version: three\nproviders:\n  exa:\n    api-key: { file: /a, command: [b] }\n");
    const result = await seek(["config", "validate", "--vault-mount", "team//seek"], { home: dir, env: { SEEK_VAULT_KV_VERSION: "3", SEEK_PROVIDERS_PARALLEL_API_KEY_COMMAND: "not json" } });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n").filter(Boolean).sort()).toEqual(
      [
        `error: EXA_API_KEY: is not a setting (${file})`,
        `error: vault.kv-version: expected one of 1, 2 (${file})`,
        `error: providers.exa.api-key: sets 2 sources (file, command); expected exactly one (${file})`,
        "error: vault.kv-version: expected one of 1, 2 (SEEK_VAULT_KV_VERSION)",
        "error: providers.parallel.api-key.command: expected a JSON array of strings (SEEK_PROVIDERS_PARALLEL_API_KEY_COMMAND)",
        "error: vault.mount: expected a path of non-empty segments, none of them `.` or `..` (--vault-mount)",
      ].sort(),
    );
    expect(result.stderr).not.toContain("synthetic-flat-key");
  });

  test("a command stops on a configuration error before it resolves a secret", async () => {
    const marker = join(tempDir(), "helper-ran");
    const env = { SEEK_SERVER_URL: "http://127.0.0.1:9", SEEK_SERVER_TOKEN_COMMAND: JSON.stringify(["touch", marker]), SEEK_VAULT_KV_VERSION: "3" };
    const result = await seek(["web", "exa", "query"], { env });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("error: vault.kv-version: expected one of 1, 2 (SEEK_VAULT_KV_VERSION)\n");
    expect(existsSync(marker)).toBe(false);
  });

  test("a URL with synthetic credentials fails validation without repeating them", async () => {
    const env = { SEEK_VAULT_ADDRESS: "https://synthetic-user:synthetic-password@bao.internal.example", SEEK_VAULT_PROXY: "http://proxy-user:proxy-password@proxy.internal.example:3128" };
    const result = await seek(["config", "validate"], { env });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: vault.address: expected an https:// or http:// URL");
    expect(result.stderr).toContain("error: vault.proxy: expected an http:// or https:// URL with a host and optional port only");
    for (const secret of ["synthetic-user", "synthetic-password", "proxy-user", "proxy-password"]) expect(result.stderr).not.toContain(secret);
    const query = await seek(["config", "validate"], { env: { SEEK_VAULT_ADDRESS: "https://bao.internal.example/?token=synthetic-query" } });
    expect(query.exitCode).toBe(1);
    expect(query.stderr).not.toContain("synthetic-query");
  });

  test("the server requires server.tokens while server.require-token is true", async () => {
    const result = await seek(["config", "validate", "--server", "--config", write(join(tempDir(), "server.yml"), "{}\n")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: server.tokens has no source. Set SEEK_SERVER_TOKENS_VALUE or SEEK_SERVER_TOKENS_FILE");
    const served = await seek(["serve", "--config", write(join(tempDir(), "server.yml"), "{}\n")]);
    expect(served.exitCode).toBe(1);
    expect(served.stderr).toContain("server.tokens has no source");
    expect((await seek(["config", "validate", "--server", "--no-auth", "--config", write(join(tempDir(), "server.yml"), "{}\n")])).exitCode).toBe(0);
  });

  test("a server file does not take the client's server.url", async () => {
    const file = write(join(tempDir(), "server.yml"), "server:\n  url: https://seek.internal.example\n  tokens: { file: /run/tokens }\n");
    const result = await seek(["config", "validate", "--server", "--config", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(`error: server.url: is not a setting (${file})\n`);
  });

  test("a direct-mode command without a key names the setting, its variables and the user file", async () => {
    const { home: dir, config } = home();
    const result = await seek(["web", "exa", "query"], { home: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `error: Missing API key for exa: providers.exa.api-key has no source. Set SEEK_PROVIDERS_EXA_API_KEY_VALUE or SEEK_PROVIDERS_EXA_API_KEY_FILE, pass --providers-exa-api-key-file, or add providers.exa.api-key to ${join(config, "client.yml")}`,
    );
  });
});

describe("the seek 0.3.2 configuration", () => {
  const RETIRED = {
    PARALLEL_API_KEY: "synthetic-parallel",
    EXA_API_KEY: "synthetic-exa",
    BRAVE_SEARCH_API_KEY: "synthetic-brave-search",
    BRAVE_ANSWERS_API_KEY: "synthetic-brave-answers",
    PERPLEXITY_API_KEY: "synthetic-perplexity",
    GEMINI_API_KEY: "synthetic-gemini",
    FIRECRAWL_API_KEY: "synthetic-firecrawl",
    SEEK_SERVER_TOKEN: "synthetic-client-token",
    SEEK_VAULT_PATH: "seek",
    SEEK_VAULT_ADDR: "https://bao.internal.example",
    SEEK_VAULT_ROLE_ID: "synthetic-role",
    SEEK_VAULT_SECRET_ID: "synthetic-secret-id",
    SEEK_VAULT_SECRET_ID_FILE: "/run/secret-id",
    SEEK_VAULT_APPROLE_MOUNT: "approle",
    SEEK_VAULT_TOKEN_FILE: "/run/token",
    SEEK_VAULT_REFRESH_SECONDS: "10",
  };

  test("the JSON file and the retired variables change nothing and write nothing to stderr", async () => {
    const { home: dir, config } = home();
    const xdg = tempDir("seek-xdg-");
    const json = JSON.stringify({ EXA_API_KEY: "synthetic-json-exa", SEEK_SERVER_URL: "https://seek.internal.example", SEEK_SERVER_TOKEN: "synthetic-json-token" });
    write(join(config, "config.json"), json);
    write(join(xdg, "seek", "config.json"), json);
    for (const env of [{}, { XDG_CONFIG_HOME: xdg }] as Array<Record<string, string>>) {
      const baseline = await show([], { home: dir, env });
      for (const kind of ["client", "server"]) {
        const args = kind === "server" ? ["--server", "--no-auth"] : [];
        const clean = await show(args, { home: dir, env });
        const legacy = await show(args, { home: dir, env: { ...env, ...RETIRED } });
        expect(legacy.run.stderr).toBe("");
        expect(legacy.run.exitCode).toBe(0);
        expect(legacy.json).toEqual(clean.json);
      }
      expect(baseline.json.files).toEqual([]);
      const command = await seek(["web", "exa", "query"], { home: dir, env: { ...env, ...RETIRED } });
      expect(command.exitCode).toBe(2);
      for (const value of Object.values(RETIRED).filter((v) => v.startsWith("synthetic-"))) expect(command.stderr).not.toContain(value);
    }
  });

  test("the names 0.3.2 shares with this release still take effect", async () => {
    const xdg = tempDir("seek-xdg-");
    write(join(xdg, "seek", "client.yml"), "vault:\n  ca-cert: /etc/ca.pem\n");
    const client = await show([], { env: { XDG_CONFIG_HOME: xdg, SEEK_SERVER_URL: "https://seek.internal.example", SEEK_VAULT_MOUNT: "kv", SEEK_VAULT_KV_VERSION: "1", BAO_ADDR: "https://bao.internal.example", BAO_NAMESPACE: "team" } });
    expect(client.json.files).toEqual([join(xdg, "seek", "client.yml")]);
    expect(setting(client.json, "server.url").value).toBe("https://seek.internal.example");
    expect(setting(client.json, "vault.mount").layer).toEqual({ kind: "env", name: "SEEK_VAULT_MOUNT" });
    expect(setting(client.json, "vault.kv-version").value).toBe(1);
    expect(setting(client.json, "vault.address").layer).toEqual({ kind: "env", name: "BAO_ADDR" });
    expect(setting(client.json, "vault.namespace").layer).toEqual({ kind: "env", name: "BAO_NAMESPACE" });
    const vault = await show([], { env: { VAULT_ADDR: "https://vault.internal.example", VAULT_NAMESPACE: "ns", VAULT_TOKEN: "synthetic-vault-token" } });
    expect(setting(vault.json, "vault.address")).toEqual({ path: "vault.address", value: "https://vault.internal.example", layer: { kind: "env", name: "VAULT_ADDR" } });
    expect(setting(vault.json, "vault.auth").auth).toEqual({ mode: "token", token: { value: "<redacted>" }, "declared-in": { kind: "env", name: "VAULT_TOKEN" } });
    const both = await show([], { env: { VAULT_ADDR: "https://vault.internal.example", BAO_ADDR: "https://bao.internal.example", SEEK_VAULT_ADDRESS: "https://seek.internal.example" } });
    expect(setting(both.json, "vault.address").layer).toEqual({ kind: "env", name: "SEEK_VAULT_ADDRESS" });
    const server = await show(["--server", "--no-auth"], { env: { SEEK_SERVER_HOST: "0.0.0.0", SEEK_SERVER_PORT: "9000" } });
    expect(setting(server.json, "server.host").value).toBe("0.0.0.0");
    expect(setting(server.json, "server.port").value).toBe(9000);
  });
});

describe("config init and config path", () => {
  test("a fresh installation writes the template to a new explicit path with mode 0600", async () => {
    const target = join(tempDir(), "new", "dir", "client.yml");
    expect((await seek(["config", "path", "--config", target])).stdout).toBe(`${target}\n`);
    const init = await seek(["config", "init", "--config", target]);
    expect(init.exitCode).toBe(0);
    expect(init.stdout).toBe(`Created ${target}\nUncomment the settings you use, then check them with seek config validate.\n`);
    const { statSync } = await import("node:fs");
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(statSync(join(target, "..")).mode & 0o777).toBe(0o700);
    expect((await seek(["config", "validate", "--config", target])).exitCode).toBe(0);
    const server = join(tempDir(), "server.yml");
    expect((await seek(["config", "init", "--server", "--config", server])).exitCode).toBe(0);
    expect(readFileSync(server, "utf8")).toContain("#   tokens:");
  });

  test("without --force an existing target is left unchanged with exit status 1; --force replaces it", async () => {
    const target = write(join(tempDir(), "client.yml"), "# mine\n");
    const refused = await seek(["config", "init", "--config", target]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toBe(`error: ${target} already exists. Re-run with --force to replace it.\n`);
    expect(readFileSync(target, "utf8")).toBe("# mine\n");
    const forced = await seek(["config", "init", "--force", "--config", target]);
    expect(forced.exitCode).toBe(0);
    expect(readFileSync(target, "utf8")).toContain("# seek client configuration");
  });

  test("a target that appears after the command starts is left unchanged", async () => {
    const { writeTemplate } = await import("../src/commands/config.ts");
    const { writeFileSync, readdirSync } = await import("node:fs");
    const dir = tempDir();
    const target = join(dir, "client.yml");
    expect(() => writeTemplate(target, "# template\n", false, () => writeFileSync(target, "# raced\n"))).toThrow(/EEXIST/);
    expect(readFileSync(target, "utf8")).toBe("# raced\n");
    expect(readdirSync(dir)).toEqual(["client.yml"]);
  });

  test("a failed --force write leaves the existing file unchanged", async () => {
    const dir = tempDir();
    const target = write(join(dir, "client.yml"), "# mine\n");
    const { chmodSync } = await import("node:fs");
    chmodSync(dir, 0o500);
    try {
      const result = await seek(["config", "init", "--force", "--config", target]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`error: cannot write ${target}`);
      expect(readFileSync(target, "utf8")).toBe("# mine\n");
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
