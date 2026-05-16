import { requireEnv } from "../lib/env.ts";
import { request } from "../lib/http.ts";

const BASE_URL = "https://api.perplexity.ai";

function headers(): Record<string, string> {
  const key = requireEnv("PERPLEXITY_API_KEY", "perplexity");
  return {
    Authorization: `Bearer ${key}`,
  };
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
    message: { role: string; content: string };
  }>;
  usage?: Record<string, number>;
}

export interface PerplexityOptions {
  model?: string;
  systemPrompt?: string;
  searchRecency?: "day" | "week" | "month" | "year";
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export async function perplexityChat(
  query: string,
  opts: PerplexityOptions = {},
): Promise<PerplexityResponse> {
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: query });

  const body: Record<string, unknown> = {
    model: opts.model ?? "sonar",
    messages,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.searchRecency) body.search_recency_filter = opts.searchRecency;
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;

  const isDeep = (opts.model ?? "").includes("deep-research");
  return await request(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: isDeep ? 25 * 60_000 : 90_000,
  });
}

export async function perplexitySearch(query: string, opts: PerplexityOptions = {}) {
  return await perplexityChat(query, { ...opts, model: opts.model ?? "sonar" });
}

export async function perplexityDeepResearch(query: string, opts: PerplexityOptions = {}) {
  return await perplexityChat(query, {
    ...opts,
    model: opts.model ?? "sonar-deep-research",
    reasoningEffort: opts.reasoningEffort ?? "medium",
  });
}
