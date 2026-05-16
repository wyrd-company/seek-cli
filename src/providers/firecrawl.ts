import { requireEnv } from "../lib/env.ts";
import { request } from "../lib/http.ts";

const BASE_URL = "https://api.firecrawl.dev";

function headers(): Record<string, string> {
  const key = requireEnv("FIRECRAWL_API_KEY", "firecrawl");
  return { Authorization: `Bearer ${key}` };
}

export interface FirecrawlScrapeData {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  json?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface FirecrawlScrapeResponse {
  success: boolean;
  data?: FirecrawlScrapeData;
  error?: string;
}

export interface FirecrawlOptions {
  formats?: Array<"markdown" | "html" | "rawHtml" | "links" | "screenshot">;
  onlyMainContent?: boolean;
  waitFor?: number;
  timeoutMs?: number;
}

export async function firecrawlScrape(
  url: string,
  opts: FirecrawlOptions = {},
): Promise<FirecrawlScrapeResponse> {
  const body: Record<string, unknown> = {
    url,
    formats: opts.formats ?? ["markdown"],
    onlyMainContent: opts.onlyMainContent ?? true,
  };
  if (opts.waitFor) body.waitFor = opts.waitFor;

  return await request(`${BASE_URL}/v2/scrape`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });
}
