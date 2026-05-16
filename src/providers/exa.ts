import { requireEnv } from "../lib/env.ts";
import { request, poll } from "../lib/http.ts";

const BASE_URL = "https://api.exa.ai";

function headers(): Record<string, string> {
  const key = requireEnv("EXA_API_KEY", "exa");
  return { "x-api-key": key };
}

export type ExaSearchType =
  | "auto"
  | "fast"
  | "neural"
  | "instant"
  | "deep-lite"
  | "deep"
  | "deep-reasoning";

export interface ExaResult {
  id?: string;
  url: string;
  title?: string | null;
  score?: number;
  publishedDate?: string;
  author?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
  highlightScores?: number[];
  image?: string;
  favicon?: string;
}

export interface ExaSearchResponse {
  results: ExaResult[];
  autopromptString?: string;
  resolvedSearchType?: string;
  requestId?: string;
  output?: unknown;
  costDollars?: Record<string, unknown>;
}

export interface ExaSearchOptions {
  type?: ExaSearchType;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  category?: string;
  systemPrompt?: string;
  additionalQueries?: string[];
  userLocation?: string;
  includeText?: boolean;
  maxCharacters?: number;
}

export async function exaSearch(
  query: string,
  opts: ExaSearchOptions = {},
): Promise<ExaSearchResponse> {
  const contents: Record<string, unknown> = {
    highlights: { numSentences: 3 },
  };
  if (opts.includeText) {
    contents.text = { maxCharacters: opts.maxCharacters ?? 2000 };
  }
  const body: Record<string, unknown> = {
    query,
    type: opts.type ?? "auto",
    numResults: opts.numResults ?? 10,
    contents,
  };
  if (opts.includeDomains) body.includeDomains = opts.includeDomains;
  if (opts.excludeDomains) body.excludeDomains = opts.excludeDomains;
  if (opts.startPublishedDate) body.startPublishedDate = opts.startPublishedDate;
  if (opts.endPublishedDate) body.endPublishedDate = opts.endPublishedDate;
  if (opts.category) body.category = opts.category;
  if (opts.systemPrompt) body.systemPrompt = opts.systemPrompt;
  if (opts.additionalQueries) body.additionalQueries = opts.additionalQueries;
  if (opts.userLocation) body.userLocation = opts.userLocation;

  return await request<ExaSearchResponse>(`${BASE_URL}/search`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 90_000,
  });
}

export interface ExaContentsResponse {
  results: ExaResult[];
  requestId?: string;
  costDollars?: Record<string, unknown>;
  statuses?: Array<{ id: string; status: string; source?: string }>;
}

export interface ExaContentsOptions {
  maxCharacters?: number;
  summary?: boolean | { query?: string };
  subpages?: number;
  livecrawl?: "always" | "fallback" | "never" | "auto";
  maxAgeHours?: number;
}

export async function exaContents(
  urls: string[],
  opts: ExaContentsOptions = {},
): Promise<ExaContentsResponse> {
  const body: Record<string, unknown> = {
    urls,
    text: { maxCharacters: opts.maxCharacters ?? 50_000 },
  };
  if (opts.summary !== undefined) {
    body.summary = typeof opts.summary === "boolean" ? opts.summary : opts.summary;
  }
  if (opts.subpages != null) body.subpages = opts.subpages;
  if (opts.livecrawl) body.livecrawl = opts.livecrawl;
  if (opts.maxAgeHours != null) body.maxAgeHours = opts.maxAgeHours;

  return await request<ExaContentsResponse>(`${BASE_URL}/contents`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 120_000,
  });
}

// ---------- Research (POST /research/v1) ----------

export type ExaResearchModel = "exa-research-fast" | "exa-research" | "exa-research-pro";

export interface ExaResearchTask {
  research_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
  model: ExaResearchModel | string;
  instructions: string;
  created_at?: string;
  output?: unknown;
  cost_dollars?: Record<string, unknown>;
  error?: { message?: string } | null;
}

export interface ExaResearchOptions {
  model?: ExaResearchModel;
  outputSchema?: Record<string, unknown>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProgress?: (task: ExaResearchTask) => void;
}

const RESEARCH_TERMINAL = new Set(["completed", "failed", "cancelled"]);

export async function exaResearch(
  instructions: string,
  opts: ExaResearchOptions = {},
): Promise<ExaResearchTask> {
  const body: Record<string, unknown> = {
    instructions,
    model: opts.model ?? "exa-research",
  };
  if (opts.outputSchema) body.outputSchema = opts.outputSchema;

  const created = await request<ExaResearchTask>(`${BASE_URL}/research/v1`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 60_000,
  });

  return await poll(
    () =>
      request<ExaResearchTask>(
        `${BASE_URL}/research/v1/${encodeURIComponent(created.research_id)}`,
        { headers: headers(), timeoutMs: 60_000 },
      ),
    (t) => RESEARCH_TERMINAL.has(t.status),
    {
      intervalMs: opts.pollIntervalMs ?? 5_000,
      timeoutMs: opts.timeoutMs ?? 20 * 60_000,
      onTick: opts.onProgress,
    },
  );
}
