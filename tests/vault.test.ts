import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  connectProxy,
  privateAuthority,
  seek,
  seekServerStub,
  setting,
  show,
  tempDir,
  vaultStub,
  write,
  type SeekServerStub,
  type VaultStub,
} from "./harness.ts";

// Vault and OpenBao sources through the CLI's entry point, against synthetic
// servers: binding every auth mapping to its server, the transport built from
// the effective configuration alone, trust, redirects, read sharing and the
// trimming of every resolved secret. Every credential is synthetic.

const SEARCH = ["web", "exa", "query", "--json"];
const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

function vault(options: Parameters<typeof vaultStub>[0] = {}): VaultStub {
  const stub = vaultStub(options);
  stops.push(stub.stop);
  return stub;
}

function seekServer(): SeekServerStub {
  const stub = seekServerStub();
  stops.push(stub.stop);
  return stub;
}

/** A client file whose server.token is a field of a KV secret, with extra YAML under the token's vault block and at the top level. */
function clientFile(seekUrl: string, vaultBlock: string[] = [], top: string[] = []): string {
  const lines = [
    "server:",
    `  url: ${seekUrl}`,
    "  token:",
    "    vault:",
    "      path: clients/cli",
    "      key: SEEK_SERVER_TOKEN",
    ...vaultBlock.map((line) => `      ${line}`),
    ...top,
    "",
  ];
  return write(join(tempDir(), "client.yml"), lines.join("\n"));
}

const TOKEN_SECRET = { "secret/data/clients/cli": { SEEK_SERVER_TOKEN: "synthetic-client-token" } };

describe("binding every auth mapping to its server", () => {
  test("a secret's own auth declared in a file without an address fails when the environment moves the server", async () => {
    const a = vault({ secrets: TOKEN_SECRET });
    const b = vault({ secrets: TOKEN_SECRET });
    const marker = join(tempDir(), "helper-ran");
    const file = clientFile("http://127.0.0.1:9", ["auth:", "  mode: token", `  token: { command: [touch, ${marker}] }`], ["vault:", `  address: ${a.url}`]);
    for (const args of [["config", "validate"], SEARCH]) {
      const result = await seek([...args, "--config", file], { env: { SEEK_VAULT_ADDRESS: b.url } });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`error: server.token.vault: uses the auth mapping declared in ${file}, which is bound to ${a.url}, but the block's server is ${b.url}`);
    }
    expect(existsSync(marker)).toBe(false);
    expect([a.seen.length, b.seen.length]).toEqual([0, 0]);
  });

  test("an auth mapping declared with no server in effect is unbound", async () => {
    const a = vault({ secrets: TOKEN_SECRET });
    const file = clientFile("http://127.0.0.1:9", [], ["vault:", "  auth: { mode: token, token: { value: synthetic-file-token } }"]);
    const result = await seek(["config", "validate", "--config", file], { env: { BAO_ADDR: a.url } });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`uses the auth mapping declared in ${file}, which is unbound, but the block's server is ${a.url}`);
    expect(a.seen).toHaveLength(0);
  });

  test("a top-level auth bound to another server is not used by a block on its own server", async () => {
    const a = vault({ secrets: TOKEN_SECRET });
    const b = vault({ secrets: TOKEN_SECRET });
    const file = clientFile("http://127.0.0.1:9", [`address: ${b.url}`], ["vault:", `  address: ${a.url}`, "  auth: { mode: token, token: { value: synthetic-file-token } }"]);
    const result = await seek([...SEARCH, "--config", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`which is bound to ${a.url}, but the block's server is ${b.url}`);
    expect([a.seen.length, b.seen.length]).toEqual([0, 0]);
  });

  test("an alias token stays bound to its own family's address", async () => {
    const a = vault({ secrets: TOKEN_SECRET });
    const b = vault({ secrets: TOKEN_SECRET });
    const file = clientFile("http://127.0.0.1:9");
    const cases: Array<Record<string, string>> = [
      { BAO_ADDR: a.url, VAULT_ADDR: b.url, VAULT_TOKEN: "synthetic-vault-token" },
      { SEEK_VAULT_ADDRESS: a.url, BAO_ADDR: b.url, BAO_TOKEN: "synthetic-bao-token" },
    ];
    for (const env of cases) {
      const result = await seek([...SEARCH, "--config", file], { env });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`which is bound to ${b.url}, but the block's server is ${a.url}`);
      expect(result.stderr).not.toContain("synthetic-");
    }
    expect([a.seen.length, b.seen.length]).toEqual([0, 0]);
  });

  test("matching alias pairs, and one address with either family's token, still work", async () => {
    const a = vault({ secrets: TOKEN_SECRET, tokens: ["synthetic-alias-token"] });
    const server = seekServer();
    const file = clientFile(server.url);
    const cases: Array<Record<string, string>> = [
      { BAO_ADDR: a.url, BAO_TOKEN: "synthetic-alias-token" },
      { VAULT_ADDR: a.url, VAULT_TOKEN: "synthetic-alias-token" },
      { BAO_ADDR: a.url, VAULT_TOKEN: "synthetic-alias-token" },
      { VAULT_ADDR: a.url, BAO_TOKEN: "synthetic-alias-token" },
      { BAO_ADDR: a.url, VAULT_ADDR: a.url, VAULT_TOKEN: "synthetic-alias-token" },
    ];
    for (const env of cases) {
      const result = await seek([...SEARCH, "--config", file], { env });
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    }
    expect(server.authorizations).toEqual(cases.map(() => "Bearer synthetic-client-token"));
    expect(a.seen.every((s) => s.headers["x-vault-token"] === "synthetic-alias-token")).toBe(true);
  });

  test("an exported BAO_* set for another server leaves a file's AppRole server alone once it is cleared or overridden per secret", async () => {
    const exported = vault({ secrets: TOKEN_SECRET });
    const approle = { roleId: "synthetic-role", secretId: "synthetic-secret-id", token: "synthetic-approle-token" };
    const fileServer = vault({ secrets: TOKEN_SECRET, approle });
    const seekStub = seekServer();
    const secretId = write(join(tempDir(), "secret-id"), "synthetic-secret-id\n");
    const login = ["auth:", "  mode: approle", "  role-id: synthetic-role", `  secret-id: { file: ${secretId} }`];
    const env = { BAO_ADDR: exported.url, BAO_TOKEN: "synthetic-exported-token", BAO_NAMESPACE: "exported-namespace" };
    const topLevel = clientFile(seekStub.url, [], ["vault:", `  address: ${fileServer.url}`, ...login.map((l) => `  ${l}`)]);
    const perSecret = clientFile(seekStub.url, [`address: ${fileServer.url}`, 'namespace: ""', ...login]);
    for (const [file, environment] of [[topLevel, {}], [perSecret, env]] as const) {
      const inspected = await show(["--config", file], { env: environment });
      expect(inspected.run.exitCode).toBe(0);
      const source = setting(inspected.json, "server.token").source.vault;
      expect(source.address).toBe(fileServer.url);
      expect(source.auth.mode).toBe("approle");
      expect(source.auth["declared-in"]).toEqual({ kind: "file", file });
      const result = await seek([...SEARCH, "--config", file], { env: environment });
      expect(result.exitCode).toBe(0);
    }
    expect(exported.seen).toHaveLength(0);
    const sent = JSON.stringify(fileServer.seen);
    expect(sent).not.toContain("synthetic-exported-token");
    expect(sent).not.toContain("exported-namespace");
    expect(seekStub.authorizations).toEqual(["Bearer synthetic-client-token", "Bearer synthetic-client-token"]);
  });
});

describe("the transport is built from the effective configuration alone", () => {
  const SENTINELS = {
    VAULT_SKIP_VERIFY: "sentinel-skip-verify",
    VAULT_CACERT: "/sentinel/cacert.pem",
    VAULT_CAPATH: "/sentinel/capath",
    VAULT_CLIENT_CERT: "/sentinel/client.pem",
    VAULT_CLIENT_KEY: "/sentinel/client.key",
    VAULT_TLS_SERVER_NAME: "sentinel-server-name",
    VAULT_HEADERS: "X-Sentinel-Header: sentinel-header",
    VAULT_PROXY_ADDR: "http://127.0.0.1:1",
    VAULT_HTTP_PROXY: "http://127.0.0.1:1",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  };

  test("no unsupported variable reaches a request, and the configured proxy carries both calls through CONNECT", async () => {
    const approle = { roleId: "synthetic-role", secretId: "synthetic-secret-id", token: "synthetic-approle-token" };
    const store = vault({ secrets: TOKEN_SECRET, approle });
    const configured = await connectProxy();
    const ambient = await connectProxy();
    stops.push(configured.stop, ambient.stop);
    const seekStub = seekServer();
    const file = clientFile(seekStub.url, [], [
      "vault:",
      `  address: ${store.url}`,
      `  proxy: ${configured.url}`,
      "  auth: { mode: approle, role-id: synthetic-role, secret-id: { value: synthetic-secret-id } }",
    ]);
    const env = {
      ...SENTINELS,
      BAO_ADDR: store.url,
      VAULT_ADDR: store.url,
      BAO_NAMESPACE: "team",
      HTTP_PROXY: ambient.url,
      HTTPS_PROXY: ambient.url,
      ALL_PROXY: ambient.url,
      http_proxy: ambient.url,
      NO_PROXY: "127.0.0.1,localhost",
    };
    const result = await seek([...SEARCH, "--config", file], { env });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // seek reaches its own server stub directly too, since the provider call is not Vault's.
    expect(ambient.requests.filter((r) => r.includes(new URL(store.url).host))).toEqual([]);
    expect(configured.requests).toHaveLength(2);
    for (const head of configured.requests) {
      expect(head.startsWith(`CONNECT ${new URL(store.url).host} HTTP/1.1`)).toBe(true);
      expect(head.toLowerCase()).not.toContain("proxy-authorization");
    }
    expect(store.seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /v1/auth/approle/login", "GET /v1/secret/data/clients/cli"]);
    const sent = JSON.stringify(store.seen);
    for (const value of Object.values(SENTINELS)) if (value.length > 1) expect(sent).not.toContain(value);
    expect(store.seen.every((s) => s.headers["x-vault-namespace"] === "team")).toBe(true);
  });

  describe("trust, for a KV read and an AppRole login against a private authority's certificate", () => {
    const authority = privateAuthority();
    const other = privateAuthority("another authority");
    const approle = { roleId: "synthetic-role", secretId: "synthetic-secret-id", token: "synthetic-approle-token" };

    function tlsVault(): VaultStub {
      return vault({ secrets: TOKEN_SECRET, approle, tls: { cert: authority.cert, key: authority.key } });
    }

    function hashedDirectory(withAuthority: boolean): string {
      const dir = tempDir("seek-certs-");
      if (withAuthority) copyFileSync(authority.caPath, join(dir, `${authority.hash}.0`));
      return dir;
    }

    /** The token block for a read, or a login whose secret ID comes from a helper that runs first. */
    function auth(operation: "read" | "login", helper?: string[]): string[] {
      const credential = helper ? `{ command: [${helper.join(", ")}] }` : "{ value: synthetic-approle-token }";
      return operation === "read"
        ? ["auth:", "  mode: token", `  token: ${credential}`]
        : ["auth:", "  mode: approle", "  role-id: synthetic-role", `  secret-id: ${helper ? credential : "{ value: synthetic-secret-id }"}`];
    }

    for (const operation of ["read", "login"] as const) {
      test(`${operation}: rejected with no input, accepted through each trust input, whatever NODE_TLS_REJECT_UNAUTHORIZED says`, async () => {
        const store = tlsVault();
        const seekStub = seekServer();
        const run = (env: Record<string, string>, block: string[] = [], address = store.url) =>
          seek([...SEARCH, "--config", clientFile(seekStub.url, [`address: ${address}`, ...auth(operation), ...block])], { env: { NODE_TLS_REJECT_UNAUTHORIZED: "0", ...env } });

        const rejected = await run({ SSL_CERT_DIR: hashedDirectory(false) });
        expect(rejected.exitCode).toBe(1);
        expect(rejected.stderr).toContain(operation === "read" ? "vault GET /v1/secret/data/clients/cli failed:" : "vault POST /v1/auth/approle/login failed:");
        const accepted: Array<Record<string, string>> = [
          { NODE_EXTRA_CA_CERTS: authority.caPath },
          { SSL_CERT_FILE: authority.caPath },
          { SSL_CERT_DIR: hashedDirectory(true) },
        ];
        for (const env of accepted) expect((await run(env)).exitCode).toBe(0);
        expect((await run({}, [`ca-cert: ${authority.caPath}`])).exitCode).toBe(0);

        const everywhere = { NODE_EXTRA_CA_CERTS: authority.caPath, SSL_CERT_FILE: authority.caPath, SSL_CERT_DIR: hashedDirectory(true) };
        const wrongAuthority = await run(everywhere, [`ca-cert: ${other.caPath}`]);
        expect(wrongAuthority.exitCode).toBe(1);
        const byAddress = await run(everywhere, [], store.url.replace("localhost", "127.0.0.1"));
        expect(byAddress.exitCode).toBe(1);
        expect(byAddress.stderr).toContain("ERR_TLS_CERT_ALTNAME_INVALID");
        expect(seekStub.authorizations).toEqual(Array(4).fill("Bearer synthetic-client-token"));
      });

      test(`${operation}: an authority added to SSL_CERT_DIR after the configuration loaded is trusted only at the next load`, async () => {
        const store = tlsVault();
        const seekStub = seekServer();
        const dir = hashedDirectory(false);
        // The helper runs after the configuration loaded and before the first TLS connection.
        const helper = write(join(tempDir(), "add-authority.sh"), `#!/bin/sh\ncp '${authority.caPath}' '${join(dir, `${authority.hash}.0`)}'\necho ${operation === "read" ? "synthetic-approle-token" : "synthetic-secret-id"}\n`, 0o755);
        const file = clientFile(seekStub.url, [`address: ${store.url}`, ...auth(operation, [helper])]);
        const first = await seek([...SEARCH, "--config", file], { env: { SSL_CERT_DIR: dir, NODE_TLS_REJECT_UNAUTHORIZED: "0" } });
        expect(existsSync(join(dir, `${authority.hash}.0`))).toBe(true);
        expect(first.exitCode).toBe(1);
        const next = await seek([...SEARCH, "--config", file], { env: { SSL_CERT_DIR: dir, NODE_TLS_REJECT_UNAUTHORIZED: "0" } });
        expect(next.exitCode).toBe(0);
      });
    }

    test("a public site is accepted with no input, through the bundled roots", async () => {
      const file = clientFile("http://127.0.0.1:9", ["address: https://example.com", "auth: { mode: none }"]);
      const result = await seek([...SEARCH, "--config", file], { env: { SSL_CERT_FILE: "/nonexistent/cert.pem", SSL_CERT_DIR: hashedDirectory(false) } });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/vault GET \/v1\/secret\/data\/clients\/cli failed: HTTP \d{3}\n/);
    });
  });
});

describe("routes and redirects", () => {
  const approle = { roleId: "synthetic-role", secretId: "synthetic-secret-id", token: "synthetic-approle-token" };
  const login = ["auth: { mode: approle, role-id: synthetic-role, secret-id: { value: synthetic-secret-id } }"];

  test("a base path stays in front of the read and the login, and boundary slashes are removed", async () => {
    const store = vault({ base: "/team-a", secrets: { "team/kv/data/team/seek": { SEEK_SERVER_TOKEN: "synthetic-client-token" } }, approle: { ...approle, mount: "apps/approle" } });
    const seekStub = seekServer();
    const file = write(
      join(tempDir(), "client.yml"),
      [
        "server:",
        `  url: ${seekStub.url}`,
        "  token:",
        "    vault: { path: /team/seek/, key: SEEK_SERVER_TOKEN, mount: /team/kv/ }",
        "vault:",
        `  address: ${store.url}/`,
        "  auth: { mode: approle, mount: /apps/approle/, role-id: synthetic-role, secret-id: { value: synthetic-secret-id } }",
        "",
      ].join("\n"),
    );
    const result = await seek([...SEARCH, "--config", file]);
    expect(result.stderr).toBe("");
    expect(store.seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /team-a/v1/auth/apps/approle/login", "GET /team-a/v1/team/kv/data/team/seek"]);
  });

  test("an empty or dot segment in a mount or path fails validation", async () => {
    for (const [field, value] of [["path", "team//seek"], ["path", "team/../seek"], ["mount", "./kv"], ["mount", "kv/."]] as const) {
      const file = clientFile("http://127.0.0.1:9", field === "mount" ? [`mount: ${value}`] : []);
      if (field === "path") write(file, readFileSync(file, "utf8").replace("path: clients/cli", `path: ${value}`));
      const result = await seek(["config", "validate", "--config", file], { env: { BAO_ADDR: "http://127.0.0.1:9", BAO_TOKEN: "synthetic" } });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`error: server.token.vault.${field}: expected`);
    }
  });

  test("a 307 within the origin and base path is followed with the same token or login body", async () => {
    const store = vault({
      base: "/team-a",
      secrets: TOKEN_SECRET,
      approle,
      handler(req, url) {
        if (url.pathname === "/team-a/v1/auth/old/login") return new Response(null, { status: 307, headers: { location: "/team-a/v1/auth/approle/login" } });
        if (url.pathname === "/team-a/v1/secret/data/moved") return new Response(null, { status: 307, headers: { location: `${store.url}/v1/secret/data/clients/cli` } });
        return undefined;
      },
    });
    const seekStub = seekServer();
    const file = write(
      join(tempDir(), "client.yml"),
      `server:\n  url: ${seekStub.url}\n  token:\n    vault: { path: moved, key: SEEK_SERVER_TOKEN }\nvault:\n  address: ${store.url}\n  auth: { mode: approle, mount: old, role-id: synthetic-role, secret-id: { value: synthetic-secret-id } }\n`,
    );
    const result = await seek([...SEARCH, "--config", file]);
    expect(result.stderr).toBe("");
    expect(store.seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "POST /team-a/v1/auth/old/login",
      "POST /team-a/v1/auth/approle/login",
      "GET /team-a/v1/secret/data/moved",
      "GET /team-a/v1/secret/data/clients/cli",
    ]);
    expect(JSON.parse(store.seen[1]!.body)).toEqual({ role_id: "synthetic-role", secret_id: "synthetic-secret-id" });
    expect(store.seen[3]!.headers["x-vault-token"]).toBe("synthetic-approle-token");
  });

  test("a redirect to another origin or outside the base path is refused, and its target receives nothing", async () => {
    const elsewhere = vault({ secrets: TOKEN_SECRET, approle });
    for (const operation of ["read", "login"] as const) {
      for (const target of ["origin", "path"] as const) {
        const store = vault({
          base: "/team-a",
          handler(req, url) {
            const location = target === "origin" ? `${elsewhere.url}${url.pathname.replace("/team-a", "")}` : url.pathname.replace("/team-a", "/team-b");
            return new Response(null, { status: 307, headers: { location } });
          },
        });
        const block = operation === "read" ? ["auth: { mode: token, token: { value: synthetic-vault-token } }"] : login;
        const file = clientFile("http://127.0.0.1:9", [`address: ${store.url}`, ...block]);
        const result = await seek([...SEARCH, "--config", file]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("outside the configured server and base path; seek refused it");
        expect(result.stderr).toContain(target === "origin" ? elsewhere.url : "/team-b/v1/");
        expect(store.seen).toHaveLength(1);
        expect(store.seen.filter((s) => s.path.startsWith("/team-b"))).toEqual([]);
      }
    }
    expect(elsewhere.seen).toHaveLength(0);
  });
});

describe("resolution", () => {
  test("a token file, a secret-ID file, a helper and a value each yield the bare secret", async () => {
    const approle = { roleId: "synthetic-role", secretId: "synthetic-secret-id", token: "synthetic-approle-token" };
    const store = vault({ secrets: TOKEN_SECRET, approle, tokens: ["synthetic-approle-token", "synthetic-file-token"] });
    const seekStub = seekServer();
    const dir = tempDir();
    const tokenFile = write(join(dir, "token"), "  synthetic-file-token \n");
    const secretIdFile = write(join(dir, "secret-id"), "  synthetic-secret-id \n");
    const helper = write(join(dir, "helper.sh"), "#!/bin/sh\nprintf '  synthetic-helper-token \\n'\n", 0o755);
    const withToken = clientFile(seekStub.url, [`address: ${store.url}`, `auth: { mode: token, token: { file: ${tokenFile} } }`]);
    const withLogin = clientFile(seekStub.url, [`address: ${store.url}`, `auth: { mode: approle, role-id: " synthetic-role ", secret-id: { file: ${secretIdFile} } }`]);
    expect((await seek([...SEARCH, "--config", withToken])).exitCode).toBe(0);
    expect((await seek([...SEARCH, "--config", withLogin])).exitCode).toBe(0);
    expect(store.seen[0]!.headers["x-vault-token"]).toBe("synthetic-file-token");
    expect(JSON.parse(store.seen[1]!.body)).toEqual({ role_id: "synthetic-role", secret_id: "synthetic-secret-id" });
    const helperFile = write(join(dir, "helper.yml"), `server:\n  url: ${seekStub.url}\n  token: { command: [${helper}] }\n`);
    const valueFile = write(join(dir, "value.yml"), `server:\n  url: ${seekStub.url}\n  token: { value: "  synthetic-value-token \\n" }\n`);
    expect((await seek([...SEARCH, "--config", helperFile])).exitCode).toBe(0);
    expect((await seek([...SEARCH, "--config", valueFile])).exitCode).toBe(0);
    expect((await seek(SEARCH, { env: { SEEK_SERVER_URL: seekStub.url, SEEK_SERVER_TOKEN_VALUE: "  synthetic-env-token \n" } })).exitCode).toBe(0);
    expect(seekStub.authorizations).toEqual([
      "Bearer synthetic-client-token",
      "Bearer synthetic-client-token",
      "Bearer synthetic-helper-token",
      "Bearer synthetic-value-token",
      "Bearer synthetic-env-token",
    ]);
  });

  test("a unix:// address reaches an agent socket", async () => {
    const socket = join(tempDir("seek-sock-"), "agent.sock");
    const paths: string[] = [];
    const agent = Bun.serve({
      unix: socket,
      fetch(req) {
        paths.push(new URL(req.url).pathname);
        return Response.json({ data: { data: { SEEK_SERVER_TOKEN: "synthetic-client-token" } } });
      },
    });
    stops.push(() => agent.stop(true));
    const seekStub = seekServer();
    const file = clientFile(seekStub.url, [`address: unix://${socket}`, "auth: { mode: none }"]);
    const result = await seek([...SEARCH, "--config", file]);
    expect(result.stderr).toBe("");
    expect(paths).toEqual(["/v1/secret/data/clients/cli"]);
    expect(seekStub.authorizations).toEqual(["Bearer synthetic-client-token"]);
  });

  test("an empty namespace selects the root, even under an exported BAO_NAMESPACE", async () => {
    const exported = vault({});
    const store = vault({ secrets: TOKEN_SECRET });
    const seekStub = seekServer();
    const file = clientFile(seekStub.url, [`address: ${store.url}`, 'namespace: ""', "auth: { mode: token, token: { value: synthetic-vault-token } }"]);
    const env = { BAO_ADDR: exported.url, BAO_TOKEN: "synthetic-exported-token", BAO_NAMESPACE: "tenant-a" };
    const inspected = await show(["--config", file], { env });
    expect(setting(inspected.json, "server.token").source.vault.namespace).toBe("");
    expect(setting(inspected.json, "vault.namespace")).toEqual({ path: "vault.namespace", value: "tenant-a", layer: { kind: "env", name: "BAO_NAMESPACE" } });
    const text = await seek(["config", "show", "--config", file], { env });
    expect(text.stdout).toContain("    namespace: (root)\n");
    expect((await seek([...SEARCH, "--config", file], { env })).exitCode).toBe(0);
    expect(store.seen).toHaveLength(1);
    expect(Object.keys(store.seen[0]!.headers)).not.toContain("x-vault-namespace");
    expect(exported.seen).toHaveLength(0);
  });

  test("AppRole logs in again once after a 403, and a failed call never prints the response", async () => {
    let logins = 0;
    const store = vault({
      handler(req, url, seen) {
        if (url.pathname === "/v1/auth/approle/login") return Response.json({ auth: { client_token: `synthetic-login-${++logins}` } });
        if (seen.headers["x-vault-token"] === "synthetic-login-1") return new Response("denied synthetic-login-1", { status: 403 });
        return Response.json({ data: { data: { SEEK_SERVER_TOKEN: "synthetic-client-token" } } });
      },
    });
    const seekStub = seekServer();
    const file = clientFile(seekStub.url, [`address: ${store.url}`, "auth: { mode: approle, role-id: synthetic-role, secret-id: { value: synthetic-secret-id } }"]);
    expect((await seek([...SEARCH, "--config", file])).exitCode).toBe(0);
    expect(logins).toBe(2);
    const failing = vault({ handler: () => new Response("private synthetic-response-body", { status: 500 }) });
    const result = await seek([...SEARCH, "--config", clientFile(seekStub.url, [`address: ${failing.url}`, "auth: { mode: none }"])]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("error: server.token: vault GET /v1/secret/data/clients/cli failed: HTTP 500\n");
  });

  test("direct mode never contacts Vault for the client token, and server mode without a token sends none", async () => {
    const store = vault({ secrets: TOKEN_SECRET });
    const seekStub = seekServer();
    const file = clientFile('""', [`address: ${store.url}`, "auth: { mode: none }"]);
    const direct = await seek([...SEARCH, "--config", file]);
    expect(direct.exitCode).toBe(2);
    expect(store.seen).toHaveLength(0);
    expect((await seek(SEARCH, { env: { SEEK_SERVER_URL: seekStub.url } })).exitCode).toBe(0);
    expect(seekStub.authorizations).toEqual([null]);
  });
});

describe("seek serve", () => {
  async function serve(file: string, env: Record<string, string> = {}): Promise<{ port: number; log: () => string; stop(): void }> {
    const { cleanEnv } = await import("./harness.ts");
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/index.ts"), "serve", "--config", file, "--port", "0"], { env: cleanEnv({ env }), stderr: "pipe" });
    stops.push(() => child.kill());
    let text = "";
    const reader = child.stderr.getReader();
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += new TextDecoder().decode(value);
      }
    })();
    void pump;
    const started = Date.now();
    while (!text.includes("providers with keys") && Date.now() - started < 10_000) {
      if (child.exitCode !== null) break;
      await Bun.sleep(20);
    }
    const port = Number(/listening on http:\/\/[^:]+:(\d+)/.exec(text)?.[1] ?? 0);
    return { port, log: () => text, stop: () => child.kill() };
  }

  test("resolves every secret before it listens, refreshes them, and keeps a value when a refresh fails", async () => {
    let tokens = "synthetic-old, synthetic-new";
    let failing = false;
    const store = vault({
      handler(req, url) {
        if (failing) return new Response("down", { status: 500 });
        if (url.pathname === "/v1/secret/data/seek") return Response.json({ data: { data: { SEEK_SERVER_TOKENS: tokens, EXA_API_KEY: "synthetic-exa" } } });
        return undefined;
      },
    });
    const file = write(
      join(tempDir(), "server.yml"),
      [
        "server:",
        "  secret-refresh-seconds: 0",
        "  tokens:",
        "    vault: { path: seek, key: SEEK_SERVER_TOKENS }",
        "providers:",
        "  exa:",
        "    api-key:",
        "      vault: { path: seek, key: EXA_API_KEY }",
        "vault:",
        `  address: ${store.url}`,
        "  auth: { mode: token, token: { value: synthetic-vault-token } }",
        "",
      ].join("\n"),
    );
    const server = await serve(file);
    expect(server.log()).toContain(`seek serve: read server.tokens from vault ${store.url} secret/seek (kv v2, token auth)`);
    expect(server.log()).toContain("seek serve: providers with keys: exa");
    const call = (token: string) => fetch(`http://127.0.0.1:${server.port}/v1/proxy/parallel/v1/search`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect((await call("synthetic-new")).status).toBe(503);
    tokens = "synthetic-rotated";
    expect((await call("synthetic-rotated")).status).toBe(503);
    expect((await call("synthetic-new")).status).toBe(401);
    failing = true;
    expect((await call("synthetic-rotated")).status).toBe(503);
    expect(server.log()).toContain("seek serve: warning: server.tokens: vault GET /v1/secret/data/seek failed: HTTP 500; keeping the value resolved earlier");
    expect(server.log()).not.toContain("synthetic-rotated");
  });

  test("refuses to start when a configured secret fails", async () => {
    const store = vault({ handler: () => new Response(null, { status: 403 }) });
    const file = write(join(tempDir(), "server.yml"), `server:\n  tokens: { vault: { path: seek, key: SEEK_SERVER_TOKENS } }\nvault:\n  address: ${store.url}\n  auth: { mode: none }\n`);
    const { seek: run } = await import("./harness.ts");
    const result = await run(["serve", "--config", file, "--port", "0"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("error: server.tokens: vault GET /v1/secret/data/seek failed: HTTP 403\n");
  });

  test("secrets share a read only when their whole context is the same", async () => {
    const authority = privateAuthority();
    const store = vault({ secrets: { "secret/data/seek": { SEEK_SERVER_TOKENS: "synthetic-token", GEMINI_API_KEY: "synthetic-google", EXA_API_KEY: "synthetic-exa", PARALLEL_API_KEY: "synthetic-parallel" } } });
    const file = write(
      join(tempDir(), "server.yml"),
      [
        "server:",
        "  tokens: { vault: { path: seek, key: SEEK_SERVER_TOKENS } }",
        "providers:",
        "  google:",
        "    api-key: { vault: { path: /seek/, key: GEMINI_API_KEY } }",
        "  exa:",
        "    api-key: { vault: { path: seek, key: EXA_API_KEY, auth: { mode: token, token: { value: synthetic-other-token } } } }",
        "  parallel:",
        `    api-key: { vault: { path: seek, key: PARALLEL_API_KEY, ca-cert: ${authority.caPath} } }`,
        "vault:",
        `  address: ${store.url}`,
        "  auth: { mode: token, token: { value: synthetic-vault-token } }",
        "",
      ].join("\n"),
    );
    const server = await serve(file);
    expect(server.log()).toContain("providers with keys: parallel, exa, google");
    // The client tokens and the Google key share one context and one read; a different auth or ca-cert does not.
    expect(store.seen).toHaveLength(3);
    expect(store.seen.map((s) => s.headers["x-vault-token"]).sort()).toEqual(["synthetic-other-token", "synthetic-vault-token", "synthetic-vault-token"]);
  });
});

describe("inspection never reads a secret", () => {
  test("config show and config validate redact, run no helper, read no secret file and contact no Vault", async () => {
    const authority = privateAuthority();
    const store = vault({ secrets: TOKEN_SECRET });
    const dir = tempDir();
    const marker = join(dir, "helper-ran");
    const unreadable = write(join(dir, "unreadable-secret"), "synthetic-file-secret\n", 0o000);
    const certs = join(dir, "certs");
    mkdirSync(certs);
    copyFileSync(authority.caPath, join(certs, `${authority.hash}.0`));
    const file = write(
      join(dir, "client.yml"),
      [
        "server:",
        "  url: https://synthetic-user:synthetic-password@seek.internal.example/base?synthetic-query#synthetic-fragment",
        "  token:",
        "    vault:",
        "      path: clients/cli",
        "      key: SEEK_SERVER_TOKEN",
        `      ca-cert: ${authority.caPath}`,
        "      auth: { mode: approle, role-id: synthetic-role-id, secret-id: { command: [touch, " + marker + ", synthetic-sensitive-argument] } }",
        "providers:",
        `  exa:\n    api-key: { file: ${unreadable} }`,
        "  parallel:\n    api-key: { value: synthetic-literal-key }",
        "  firecrawl:\n    api-key: { vault: { path: seek, key: FIRECRAWL_API_KEY } }",
        "vault:",
        `  address: ${store.url}`,
        "  auth: { mode: token, token: { value: synthetic-vault-token } }",
        "",
      ].join("\n"),
    );
    const env = { NODE_EXTRA_CA_CERTS: authority.caPath, SSL_CERT_DIR: certs, SSL_CERT_FILE: authority.caPath };
    const json = await show(["--config", file], { env });
    const text = await seek(["config", "show", "--config", file], { env });
    const validate = await seek(["config", "validate", "--config", file], { env });
    for (const run of [json.run, text, validate]) {
      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      for (const secret of ["synthetic-user", "synthetic-password", "synthetic-query", "synthetic-fragment", "synthetic-role-id", "synthetic-sensitive-argument", "synthetic-literal-key", "synthetic-vault-token", "synthetic-file-secret"]) {
        expect(run.stdout).not.toContain(secret);
      }
    }
    expect(existsSync(marker)).toBe(false);
    expect(store.seen).toHaveLength(0);

    expect(setting(json.json, "server.url").value).toBe("https://<redacted>@seek.internal.example/base?<redacted>#<redacted>");
    const token = setting(json.json, "server.token").source.vault;
    expect(token.auth).toEqual({
      mode: "approle",
      mount: "approle",
      "role-id": "<redacted>",
      "secret-id": { command: { program: "touch", arguments: 2 }, timeout: "10s" },
      "declared-in": { kind: "file", file },
    });
    expect(token.trust).toEqual([{ input: "ca-cert", path: authority.caPath, certificates: 1 }]);
    const firecrawl = setting(json.json, "providers.firecrawl.api-key").source.vault;
    expect(firecrawl.trust.map((t: { input: string }) => t.input)).toEqual(["bundled", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"]);
    expect(firecrawl.trust.slice(1)).toEqual([
      { input: "NODE_EXTRA_CA_CERTS", path: authority.caPath, certificates: 1 },
      { input: "SSL_CERT_FILE", path: authority.caPath, certificates: 1 },
      { input: "SSL_CERT_DIR", path: certs, certificates: 1 },
    ]);
    expect(firecrawl.auth.token).toEqual({ value: "<redacted>" });
    expect(setting(json.json, "providers.parallel.api-key").source).toEqual({ value: "<redacted>" });
    expect(setting(json.json, "vault.auth").auth.token).toEqual({ value: "<redacted>" });
    expect(text.stdout).toContain(`    trust: ca-cert ${authority.caPath} (1 certificate)\n`);
    expect(text.stdout).toContain("secret-id helper touch (2 arguments), timeout 10s");

    const { compileDefinitions } = await import("../scripts/docs/validate.ts");
    const validateShow = compileDefinitions().schemas.get("configuration.show.schema.json")!;
    expect(validateShow(json.json), JSON.stringify(validateShow.errors)).toBe(true);
  });

  test("a failing helper's arguments never appear in its error", async () => {
    const seekStub = seekServer();
    const file = write(join(tempDir(), "client.yml"), `server:\n  url: ${seekStub.url}\n  token: { command: ["false", synthetic-sensitive-argument] }\n`);
    const result = await seek([...SEARCH, "--config", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("error: server.token: helper false (1 argument) exited with status 1\n");
    const timeout = write(join(tempDir(), "client.yml"), `server:\n  url: ${seekStub.url}\n  token: { command: [sleep, "5"], timeout: 100ms }\n`);
    const slow = await seek([...SEARCH, "--config", timeout]);
    expect(slow.stderr).toBe("error: server.token: helper sleep (1 argument) timed out after 100ms\n");
    expect(seekStub.authorizations).toEqual([]);
  });
});
