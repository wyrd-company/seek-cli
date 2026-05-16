import { requireEnv } from "../lib/env.ts";
import { request, poll } from "../lib/http.ts";

const BASE_URL = "https://api.perplexity.ai";

function authHeaders(): Record<string, string> {
  const key = requireEnv("PERPLEXITY_API_KEY", "perplexity");
  return { Authorization: `Bearer ${key}` };
}

export type SearchRecency = "hour" | "day" | "week" | "month";
export type ReasoningEffort = "low" | "medium" | "high";

export interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PerplexityResponse {
  id: string;
  model: string;
  created: number;
  citations?: string[];
  search_results?: Array<{ title?: string; url: string; date?: string }>;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: PerplexityMessage;
  }>;
  usage?: Record<string, number>;
}

export interface PerplexityOptions {
  model?: string;
  systemPrompt?: string;
  searchRecency?: SearchRecency;
  searchDomainFilter?: string[];
  searchMode?: "web" | "academic";
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  returnImages?: boolean;
  returnRelatedQuestions?: boolean;
}

function buildBody(query: string, opts: PerplexityOptions): Record<string, unknown> {
  const messages: PerplexityMessage[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: query });

  const body: Record<string, unknown> = {
    model: opts.model ?? "sonar",
    messages,
  };
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.searchRecency) body.search_recency_filter = opts.searchRecency;
  if (opts.searchDomainFilter) body.search_domain_filter = opts.searchDomainFilter;
  if (opts.searchMode) body.search_mode = opts.searchMode;
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
  if (opts.returnImages) body.return_images = opts.returnImages;
  if (opts.returnRelatedQuestions)
    body.return_related_questions = opts.returnRelatedQuestions;
  return body;
}

export async function perplexitySearch(
  query: string,
  opts: PerplexityOptions = {},
): Promise<PerplexityResponse> {
  return await request(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body: buildBody(query, { ...opts, model: opts.model ?? "sonar" }),
    timeoutMs: 90_000,
  });
}

// ---------- Async deep research (long-running) ----------

export interface PerplexityAsyncJob {
  id: string;
  status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;
  model: string;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  failed_at?: number | null;
  response?: PerplexityResponse | null;
  error_message?: string | null;
}

export interface PerplexityDeepResearchOptions extends PerplexityOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProgress?: (job: PerplexityAsyncJob) => void;
}

const ASYNC_TERMINAL = new Set(["COMPLETED", "FAILED"]);

export async function perplexityDeepResearch(
  query: string,
  opts: PerplexityDeepResearchOptions = {},
): Promise<PerplexityAsyncJob> {
  const body = {
    request: buildBody(query, {
      ...opts,
      model: opts.model ?? "sonar-deep-research",
      reasoningEffort: opts.reasoningEffort ?? "medium",
    }),
  };

  const created = await request<PerplexityAsyncJob>(`${BASE_URL}/async/chat/completions`, {
    method: "POST",
    headers: authHeaders(),
    body,
    timeoutMs: 60_000,
  });

  return await poll(
    () =>
      request<PerplexityAsyncJob>(
        `${BASE_URL}/async/chat/completions/${encodeURIComponent(created.id)}`,
        { headers: authHeaders(), timeoutMs: 60_000 },
      ),
    (j) => ASYNC_TERMINAL.has(j.status),
    {
      intervalMs: opts.pollIntervalMs ?? 10_000,
      timeoutMs: opts.timeoutMs ?? 30 * 60_000,
      onTick: opts.onProgress,
    },
  );
}
