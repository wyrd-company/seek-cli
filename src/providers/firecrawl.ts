import { requireEnv } from "../lib/env.ts";
import { request } from "../lib/http.ts";

const BASE_URL = "https://api.firecrawl.dev";

function headers(): Record<string, string> {
  const key = requireEnv("FIRECRAWL_API_KEY", "firecrawl");
  return { Authorization: `Bearer ${key}` };
}

export type FirecrawlFormatName =
  | "markdown"
  | "html"
  | "rawHtml"
  | "links"
  | "summary"
  | "screenshot"
  | "video"
  | "audio";

export type FirecrawlFormat =
  | FirecrawlFormatName
  | { type: "json"; prompt?: string; schema?: Record<string, unknown> }
  | { type: "screenshot"; fullPage?: boolean; quality?: number }
  | { type: "changeTracking"; modes?: Array<"git-diff" | "json"> };

export interface FirecrawlDocumentMetadata {
  title?: string;
  description?: string;
  language?: string;
  sourceURL?: string;
  url?: string;
  statusCode?: number;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  [key: string]: unknown;
}

export interface FirecrawlDocument {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  json?: unknown;
  summary?: string;
  screenshot?: string;
  video?: string;
  audio?: string;
  answer?: string;
  highlights?: string;
  metadata?: FirecrawlDocumentMetadata;
  warning?: string;
}

export interface FirecrawlScrapeResponse {
  success: boolean;
  data?: FirecrawlDocument;
  error?: string;
}

export interface FirecrawlScrapeOptions {
  formats?: FirecrawlFormat[];
  onlyMainContent?: boolean;
  waitFor?: number;
  mobile?: boolean;
  timeout?: number;
  includeTags?: string[];
  excludeTags?: string[];
  blockAds?: boolean;
  proxy?: "basic" | "stealth" | "enhanced" | "auto";
  maxAge?: number;
  removeBase64Images?: boolean;
  fastMode?: boolean;
}

export async function firecrawlScrape(
  url: string,
  opts: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResponse> {
  const body: Record<string, unknown> = {
    url,
    formats: opts.formats ?? ["markdown"],
  };
  if (opts.onlyMainContent !== undefined) body.onlyMainContent = opts.onlyMainContent;
  if (opts.waitFor != null) body.waitFor = opts.waitFor;
  if (opts.mobile !== undefined) body.mobile = opts.mobile;
  if (opts.timeout != null) body.timeout = opts.timeout;
  if (opts.includeTags) body.includeTags = opts.includeTags;
  if (opts.excludeTags) body.excludeTags = opts.excludeTags;
  if (opts.blockAds !== undefined) body.blockAds = opts.blockAds;
  if (opts.proxy) body.proxy = opts.proxy;
  if (opts.maxAge != null) body.maxAge = opts.maxAge;
  if (opts.removeBase64Images !== undefined) body.removeBase64Images = opts.removeBase64Images;
  if (opts.fastMode !== undefined) body.fastMode = opts.fastMode;

  return await request<FirecrawlScrapeResponse>(`${BASE_URL}/v2/scrape`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: opts.timeout != null ? opts.timeout + 5_000 : 120_000,
  });
}
