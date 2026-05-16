export interface HttpOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, statusText: string, body: string, url: string) {
    super(`HTTP ${status} ${statusText} from ${url}: ${truncate(body, 500)}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export async function request<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers: opts.headers,
      signal: controller.signal,
    };
    if (opts.body !== undefined) {
      if (typeof opts.body === "string") {
        init.body = opts.body;
      } else {
        init.body = JSON.stringify(opts.body);
        init.headers = { "content-type": "application/json", ...(init.headers ?? {}) };
      }
    }
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, res.statusText, text, url);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function poll<T>(
  fetcher: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (value: T) => void } = {},
): Promise<T> {
  const interval = opts.intervalMs ?? 4_000;
  const timeout = opts.timeoutMs ?? 10 * 60_000;
  const start = Date.now();
  while (true) {
    const value = await fetcher();
    if (isDone(value)) return value;
    opts.onTick?.(value);
    if (Date.now() - start > timeout) {
      throw new Error(`Polling timed out after ${Math.round(timeout / 1000)}s`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
