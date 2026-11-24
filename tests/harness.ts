/**
 * Shared fixtures for the configuration tests: running seek through its entry
 * point in a clean environment, synthetic Vault or OpenBao servers, a seek
 * server stub that records the client token, CONNECT proxies, and a private
 * certificate authority. Every credential here is synthetic.
 */
import { afterAll } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "seek-config-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function write(path: string, text: string, mode?: number): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  if (mode !== undefined) chmodSync(path, mode);
  return path;
}

export interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SeekOptions {
  env?: Record<string, string>;
  cwd?: string;
  home?: string;
  stdin?: string;
}

/** The environment seek runs in: PATH and a fresh HOME, plus the given variables. */
export function cleanEnv(options: SeekOptions = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: options.home ?? tempDir("seek-home-"), ...options.env };
}

/** Runs seek from source through its entry point, without blocking servers in this process. */
export async function seek(args: string[], options: SeekOptions = {}): Promise<Run> {
  const child = Bun.spawn([process.execPath, join(ROOT, "src/index.ts"), ...args], {
    cwd: options.cwd ?? ROOT,
    env: cleanEnv(options),
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, stderr };
}

/** `seek config show --json`, parsed, with its run. */
export async function show(args: string[], options: SeekOptions = {}): Promise<{ run: Run; json: any }> {
  const run = await seek(["config", "show", "--json", ...args], options);
  return { run, json: run.stdout ? JSON.parse(run.stdout) : undefined };
}

export function setting(json: any, path: string): any {
  return (json.settings as any[]).find((s) => s.path === path);
}

export interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface VaultStubOptions {
  /** KV secrets by route after `/v1/`, such as `secret/data/seek`. */
  secrets?: Record<string, Record<string, string>>;
  /** Tokens a read accepts; any token when unset. */
  tokens?: string[];
  approle?: { mount?: string; roleId: string; secretId: string; token: string };
  /** A base path the server serves under, such as `/team-a`. */
  base?: string;
  tls?: { cert: string; key: string };
  /** Answers before the default routes, when it returns a response. */
  handler?: (req: Request, url: URL, seen: Seen) => Response | undefined | Promise<Response | undefined>;
}

export interface VaultStub {
  url: string;
  /** `https://localhost:<port>` for a TLS stub. */
  port: number;
  seen: Seen[];
  stop(): void;
}

/** A synthetic Vault or OpenBao server that records every request. */
export function vaultStub(options: VaultStubOptions = {}): VaultStub {
  const seen: Seen[] = [];
  const base = options.base ?? "";
  const server = Bun.serve({
    hostname: options.tls ? "::" : "127.0.0.1",
    port: 0,
    ...(options.tls ? { tls: options.tls } : {}),
    async fetch(req) {
      const url = new URL(req.url);
      const entry: Seen = { method: req.method, path: url.pathname, headers: Object.fromEntries(req.headers.entries()), body: await req.text() };
      seen.push(entry);
      const custom = await options.handler?.(req, url, entry);
      if (custom) return custom;
      if (!url.pathname.startsWith(`${base}/v1/`)) return new Response(null, { status: 404 });
      const route = url.pathname.slice(`${base}/v1/`.length);
      const approle = options.approle;
      if (req.method === "POST" && approle && route === `auth/${approle.mount ?? "approle"}/login`) {
        const body = JSON.parse(entry.body || "{}") as { role_id?: string; secret_id?: string };
        if (body.role_id !== approle.roleId || body.secret_id !== approle.secretId) return Response.json({ errors: ["invalid"] }, { status: 400 });
        return Response.json({ auth: { client_token: approle.token } });
      }
      const accepted = options.tokens ?? (approle ? [approle.token] : undefined);
      if (accepted && !accepted.includes(entry.headers["x-vault-token"] ?? "")) return Response.json({ errors: ["permission denied"] }, { status: 403 });
      const data = options.secrets?.[route];
      if (!data) return new Response(null, { status: 404 });
      return Response.json(route.includes("/data/") ? { data: { data } } : { data });
    },
  });
  const url = options.tls ? `https://localhost:${server.port}${base}` : `http://127.0.0.1:${server.port}${base}`;
  return { url, port: server.port!, seen, stop: () => server.stop(true) };
}

export interface SeekServerStub {
  url: string;
  /** The Authorization header of each provider call. */
  authorizations: Array<string | null>;
  stop(): void;
}

/** A seek server that answers every provider call and records the client token it was sent. */
export function seekServerStub(): SeekServerStub {
  const authorizations: Array<string | null> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      authorizations.push(req.headers.get("authorization"));
      return Response.json({ results: [], requestId: "synthetic-request" });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, authorizations, stop: () => server.stop(true) };
}

export interface ProxyStub {
  url: string;
  /** The request head of each CONNECT, or of any other request. */
  requests: string[];
  connections: number;
  stop(): void;
}

/** An HTTP proxy that tunnels CONNECT requests and records each request head. */
export function connectProxy(): Promise<ProxyStub> {
  const stub: ProxyStub = { url: "", requests: [], connections: 0, stop: () => server.close() };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    stub.connections++;
    sockets.add(socket);
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onData);
      const text = head.subarray(0, end).toString("latin1");
      stub.requests.push(text);
      const [method, authority] = text.split(" ");
      if (method !== "CONNECT" || !authority) {
        socket.end("HTTP/1.1 405 Method Not Allowed\r\ncontent-length: 0\r\n\r\n");
        return;
      }
      const colon = authority.lastIndexOf(":");
      const host = authority.slice(0, colon).replace(/^\[|\]$/g, "");
      const upstream = net.connect(Number(authority.slice(colon + 1)), host, () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const rest = head.subarray(end + 4);
        if (rest.length > 0) upstream.write(rest);
        socket.pipe(upstream).pipe(socket);
      });
      sockets.add(upstream);
      upstream.on("error", () => socket.destroy());
    };
    socket.on("data", onData);
    socket.on("error", () => {});
  });
  stub.stop = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      stub.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
      resolve(stub);
    });
  });
}

export interface Authority {
  dir: string;
  /** The authority's certificate, PEM. */
  caPath: string;
  /** Its OpenSSL subject hash, the name a hashed directory gives it. */
  hash: string;
  cert: string;
  key: string;
}

function openssl(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["openssl", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`openssl ${args[0]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

/** A private certificate authority and a server certificate it signed for `localhost` only. */
export function privateAuthority(name = "seek test authority"): Authority {
  const dir = tempDir("seek-ca-");
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", `/CN=${name}`], dir);
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"], dir);
  writeFileSync(join(dir, "server.ext"), "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\n");
  openssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "2", "-extfile", "server.ext"], dir);
  const hash = openssl(["x509", "-hash", "-noout", "-in", "ca.pem"], dir).trim();
  return { dir, caPath: join(dir, "ca.pem"), hash, cert: readFileSync(join(dir, "server.pem"), "utf8"), key: readFileSync(join(dir, "server.key"), "utf8") };
}
