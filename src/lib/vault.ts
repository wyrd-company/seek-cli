/**
 * seek's Vault and OpenBao client. It builds each connection from the
 * effective configuration alone, as docs/technical-designs/secret-resolution.yml
 * describes: it sends requests with node:http and node:https, which read no
 * proxy variable and follow no redirect, opens the CONNECT tunnel for
 * `vault.proxy` itself, trusts exactly the certificate list fixed when the
 * configuration loaded, keeps every route under the address's base path, and
 * follows a redirect only within that origin and base path.
 */
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { isIP, type Socket } from "node:net";
import type { BoundAuth, LocalSource, VaultBlock } from "./config.ts";
import { redactUrl } from "./redact.ts";

export class VaultError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "VaultError";
  }
}

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 20;
const READ_REDIRECTS = new Set([301, 302, 303, 307, 308]);
const LOGIN_REDIRECTS = new Set([307, 308]);
/** The origin a `unix://` address's requests use; only the socket path identifies the server. */
const SOCKET_ORIGIN = "http://localhost";

interface Base {
  url: URL;
  /** The base path, without a trailing slash, that every route stays under. */
  prefix: string;
  socketPath?: string;
}

function base(address: string): Base {
  if (address.startsWith("unix://")) {
    return { url: new URL(SOCKET_ORIGIN), prefix: "", socketPath: address.slice("unix://".length) };
  }
  const url = new URL(address);
  return { url, prefix: url.pathname.replace(/\/+$/, "") };
}

/** Splits a mount or path on `/` after removing leading and trailing slashes, as seek 0.3 did. */
export function segments(value: string): string[] {
  return value.replace(/^\/+|\/+$/g, "").split("/");
}

/** The URL of a route: the address, its base path kept, then `/v1/` and each segment percent-encoded. */
export function routeUrl(address: string, route: string[]): URL {
  const { url, prefix } = base(address);
  return new URL(`${url.origin}${prefix}/v1/${route.map(encodeURIComponent).join("/")}`);
}

/** Whether a URL keeps the address's origin and base path. */
export function withinBase(address: string, target: URL): boolean {
  const { url, prefix } = base(address);
  return target.origin === url.origin && (prefix === "" || target.pathname === prefix || target.pathname.startsWith(`${prefix}/`));
}

interface Reply {
  status: number;
  location?: string;
  body?: string;
}

/** Opens a CONNECT tunnel through the configured proxy to host:port. */
function tunnel(proxy: string, host: string, port: number, ca: string[], timeout: AbortSignal): Promise<Socket> {
  const proxyUrl = new URL(proxy);
  const client = proxyUrl.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const authority = `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
    const request = client.request({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port) || (proxyUrl.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: authority,
      headers: { host: authority },
      agent: false,
      signal: timeout,
      ...(proxyUrl.protocol === "https:" ? { ca, rejectUnauthorized: true } : {}),
    });
    request.once("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new VaultError(`the Vault proxy ${redactUrl(proxyUrl.origin)} refused the tunnel: HTTP ${response.statusCode}`));
        return;
      }
      resolve(socket);
    });
    request.once("error", reject);
    request.end();
  });
}

async function send(block: VaultBlock, method: "GET" | "POST", url: URL, headers: Record<string, string>, body: string | undefined, timeout: AbortSignal): Promise<Reply> {
  const { socketPath } = base(block.address!);
  const secure = url.protocol === "https:";
  const port = Number(url.port) || (secure ? 443 : 80);
  const ca = block.trust?.ca ?? [];
  let socket: Socket | undefined;
  if (block.proxy && !socketPath) socket = await tunnel(block.proxy, url.hostname, port, ca, timeout);
  const servername = isIP(url.hostname) ? undefined : url.hostname;
  const options: https.RequestOptions = {
    method,
    path: `${url.pathname}${url.search}`,
    headers: { ...headers, ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}) },
    agent: false,
    signal: timeout,
    ...(socketPath ? { socketPath } : { host: url.hostname, port }),
    ...(secure ? { ca, rejectUnauthorized: true, ...(servername ? { servername } : {}) } : {}),
  };
  if (socket) {
    const tunnelled = socket;
    options.createConnection = secure
      ? () => tls.connect({ socket: tunnelled, ca, rejectUnauthorized: true, ...(servername ? { servername } : {}) })
      : () => tunnelled;
  }
  const client = secure ? https : http;
  try {
    return await exchange(client, options, body);
  } finally {
    // The tunnel belongs to this one request; nothing else may keep it, or the process, open.
    socket?.destroy();
  }
}

function exchange(client: typeof http | typeof https, options: https.RequestOptions, body: string | undefined): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const request = client.request(options, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        // The body of a failed call can hold anything; it is never read.
        response.destroy();
        resolve({ status, ...(typeof response.headers.location === "string" ? { location: response.headers.location } : {}) });
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      response.once("error", reject);
    });
    request.once("error", reject);
    request.end(body);
  });
}

/** One Vault call, following redirects only within the address's origin and base path. */
async function call(block: VaultBlock, method: "GET" | "POST", route: string[], headers: Record<string, string>, body?: string): Promise<unknown> {
  const address = block.address!;
  let url = routeUrl(address, route);
  const label = `vault ${method} ${url.pathname}`;
  const allowed = method === "GET" ? READ_REDIRECTS : LOGIN_REDIRECTS;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  for (let redirects = 0; ; redirects++) {
    if (!withinBase(address, url)) {
      throw new VaultError(`${label} refused to send to ${redactUrl(url.origin + url.pathname)}, outside the configured server and base path`);
    }
    let reply: Reply;
    try {
      reply = await send(block, method, url, headers, body, timeout);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      const reason = timeout.aborted ? `timed out after ${TIMEOUT_MS / 1000}s` : ((error as NodeJS.ErrnoException).code ?? (error as Error).message);
      throw new VaultError(`${label} failed: ${reason}`);
    }
    if (reply.status >= 300 && reply.status < 400) {
      if (!allowed.has(reply.status) || reply.location === undefined) {
        throw new VaultError(`${label} answered HTTP ${reply.status}, which seek does not follow`, reply.status);
      }
      if (redirects >= MAX_REDIRECTS) throw new VaultError(`${label} was redirected more than ${MAX_REDIRECTS} times`, reply.status);
      const target = new URL(reply.location, url);
      if (!withinBase(address, target)) {
        throw new VaultError(
          `${label} was redirected (HTTP ${reply.status}) to ${redactUrl(target.origin + target.pathname)}, outside the configured server and base path; seek refused it`,
          reply.status,
        );
      }
      url = target;
      continue;
    }
    if (reply.status < 200 || reply.status >= 300) throw new VaultError(`${label} failed: HTTP ${reply.status}`, reply.status);
    try {
      return reply.body ? JSON.parse(reply.body) : {};
    } catch {
      throw new VaultError(`${label} returned invalid JSON`);
    }
  }
}

export type LocalResolver = (source: LocalSource, label: string) => Promise<string>;

export class VaultClient {
  private readonly logins = new Map<string, Promise<string>>();
  private readonly reads = new Map<string, Promise<Record<string, unknown>>>();

  constructor(private readonly resolveLocal: LocalResolver) {}

  /** Reads one field of a KV secret. */
  async field(block: VaultBlock, label: string): Promise<string> {
    const data = await this.read(block, label);
    const value = data[block.key];
    if (typeof value !== "string") throw new VaultError(`the Vault secret ${block.mount}/${block.path} has no text field ${block.key}`);
    const trimmed = value.trim();
    if (!trimmed) throw new VaultError(`the field ${block.key} of the Vault secret ${block.mount}/${block.path} is empty`);
    return trimmed;
  }

  private read(block: VaultBlock, label: string): Promise<Record<string, unknown>> {
    const auth = block.auth!;
    const key = JSON.stringify([
      block.server,
      block.namespace ?? "",
      segments(block.mount),
      block.kvVersion,
      segments(block.path),
      block.caCert ?? "",
      block.proxy ?? "",
      auth.id,
    ]);
    let pending = this.reads.get(key);
    if (!pending) {
      pending = this.readOnce(block, auth, label).finally(() => this.reads.delete(key));
      this.reads.set(key, pending);
    }
    return pending;
  }

  private async readOnce(block: VaultBlock, auth: BoundAuth, label: string): Promise<Record<string, unknown>> {
    const route = block.kvVersion === 2 ? [...segments(block.mount), "data", ...segments(block.path)] : [...segments(block.mount), ...segments(block.path)];
    const attempt = async () => {
      const headers = this.headers(block);
      const token = await this.token(block, auth, label);
      if (token !== undefined) headers["X-Vault-Token"] = token;
      return (await call(block, "GET", route, headers)) as { data?: Record<string, unknown> & { data?: Record<string, unknown> } };
    };
    let body;
    try {
      body = await attempt();
    } catch (error) {
      // An AppRole token may have expired: log in again once and retry.
      if (!(error instanceof VaultError) || error.status !== 403 || auth.mode !== "approle") throw error;
      this.logins.delete(this.loginKey(block, auth));
      body = await attempt();
    }
    const data = block.kvVersion === 2 ? body.data?.data : body.data;
    if (!data || typeof data !== "object") throw new VaultError(`vault returned no data for ${block.mount}/${block.path}`);
    return data;
  }

  private headers(block: VaultBlock): Record<string, string> {
    return {
      accept: "application/json",
      host: block.address!.startsWith("unix://") ? "localhost" : new URL(block.address!).host,
      ...(block.namespace ? { "X-Vault-Namespace": block.namespace } : {}),
    };
  }

  private loginKey(block: VaultBlock, auth: BoundAuth): string {
    return JSON.stringify([auth.id, block.server, block.namespace ?? "", block.caCert ?? "", block.proxy ?? ""]);
  }

  private async token(block: VaultBlock, auth: BoundAuth, label: string): Promise<string | undefined> {
    switch (auth.mode) {
      case "none":
        return undefined;
      case "token":
        // A token file is read again before each read, so a rotated token takes effect.
        return await this.resolveLocal(auth.token!, `${label}: vault.auth.token`);
      case "approle": {
        const key = this.loginKey(block, auth);
        let login = this.logins.get(key);
        if (!login) {
          login = this.login(block, auth, label);
          login.catch(() => this.logins.delete(key));
          this.logins.set(key, login);
        }
        return await login;
      }
    }
  }

  private async login(block: VaultBlock, auth: BoundAuth, label: string): Promise<string> {
    const secretId = await this.resolveLocal(auth.secretId!, `${label}: vault.auth.secret-id`);
    const headers = { ...this.headers(block), "content-type": "application/json" };
    const body = JSON.stringify({ role_id: auth.roleId, secret_id: secretId });
    const reply = (await call(block, "POST", ["auth", ...segments(auth.mount), "login"], headers, body)) as { auth?: { client_token?: string } };
    const token = reply.auth?.client_token;
    if (!token) throw new VaultError("the Vault AppRole login returned no client token");
    return token;
  }
}
