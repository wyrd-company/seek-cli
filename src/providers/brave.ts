import { requireEnv } from "../lib/env.ts";
import { request } from "../lib/http.ts";

const BASE_URL = "https://api.search.brave.com/res/v1";

function searchHeaders(): Record<string, string> {
  const key = requireEnv("BRAVE_SEARCH_API_KEY", "brave search");
  return {
    "X-Subscription-Token": key,
    Accept: "application/json",
  };
}

function answersHeaders(): Record<string, string> {
  const key = requireEnv("BRAVE_ANSWERS_API_KEY", "brave answers");
  return {
    "X-Subscription-Token": key,
    "content-type": "application/json",
    Accept: "application/json",
  };
}

export interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
  age?: string;
}

export interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
  news?: { results: BraveWebResult[] };
  videos?: { results: BraveWebResult[] };
  query?: { original: string };
}

export async function braveSearch(
  query: string,
  opts: { count?: number; country?: string; freshness?: "pd" | "pw" | "pm" | "py" } = {},
): Promise<BraveSearchResponse> {
  const params = new URLSearchParams({ q: query });
  params.set("count", String(opts.count ?? 10));
  if (opts.country) params.set("country", opts.country);
  if (opts.freshness) params.set("freshness", opts.freshness);
  return await request(`${BASE_URL}/web/search?${params.toString()}`, {
    headers: searchHeaders(),
    timeoutMs: 30_000,
  });
}

export interface BraveAnswersOptions {
  country?: string;
  language?: string;
  enableResearch?: boolean;
  enableCitations?: boolean;
  enableEntities?: boolean;
}

export interface BraveAnswersMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BraveAnswersResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    finish_reason?: string;
    message?: BraveAnswersMessage;
  }>;
  usage?: Record<string, unknown>;
  chunks?: unknown[];
  [key: string]: unknown;
}

export async function braveAnswers(
  query: string,
  opts: BraveAnswersOptions = {},
): Promise<BraveAnswersResponse> {
  if (opts.enableResearch && opts.enableCitations) {
    throw new Error("Brave Answers research mode does not support enableCitations.");
  }
  const body: Record<string, unknown> = {
    model: "brave",
    stream: true,
    messages: [{ role: "user", content: query }],
  };
  if (opts.country) body.country = opts.country;
  if (opts.language) body.language = opts.language;
  if (opts.enableResearch !== undefined) body.enable_research = opts.enableResearch;
  if (opts.enableCitations !== undefined) body.enable_citations = opts.enableCitations;
  if (opts.enableEntities !== undefined) body.enable_entities = opts.enableEntities;

  return await streamBraveAnswers(body, opts.enableResearch ? 5 * 60_000 : 90_000);
}

async function streamBraveAnswers(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<BraveAnswersResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: answersHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from Brave Answers: ${text}`);
    }

    const chunks = parseServerSentEvents(text);
    let id: string | undefined;
    let model: string | undefined;
    let finishReason: string | undefined;
    let content = "";
    for (const chunk of chunks) {
      if (typeof chunk !== "object" || chunk === null) continue;
      const record = chunk as Record<string, unknown>;
      if (typeof record.id === "string") id = record.id;
      if (typeof record.model === "string") model = record.model;
      const choice = (record.choices as Array<Record<string, unknown>> | undefined)?.[0];
      if (!choice) continue;
      if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (typeof delta?.content === "string") content += delta.content;
      const message = choice.message as Record<string, unknown> | undefined;
      if (typeof message?.content === "string") content += message.content;
    }

    const cleanedContent = normalizeBraveAnswerContent(content);
    return {
      id,
      model,
      choices: [
        {
          index: 0,
          finish_reason: finishReason,
          message: { role: "assistant", content: cleanedContent },
        },
      ],
      citations: extractBraveCitations(content),
      chunks,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseServerSentEvents(text: string): unknown[] {
  const chunks: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(data));
    } catch {
      chunks.push(data);
    }
  }
  if (chunks.length === 0) {
    try {
      chunks.push(JSON.parse(text));
    } catch {
      chunks.push(text);
    }
  }
  return chunks;
}

export function extractBraveAnswerText(response: BraveAnswersResponse): string {
  return response.choices?.[0]?.message?.content ?? "";
}

export function extractBraveCitations(text: string): string[] {
  const citations = new Set<string>();
  for (const match of text.matchAll(/<citation>(.*?)<\/citation>/gs)) {
    try {
      const citation = JSON.parse(match[1] ?? "") as { url?: unknown };
      if (typeof citation.url === "string") citations.add(citation.url);
    } catch {
      // Ignore malformed provider tags and keep the user-facing answer intact.
    }
  }
  return [...citations];
}

export function stripBraveAnswerTags(text: string): string {
  return text
    .replace(/<citation>.*?<\/citation>/gs, "")
    .replace(/<enum_item>.*?<\/enum_item>/gs, "")
    .replace(/<usage>.*?<\/usage>/gs, "")
    .replace(/<queries>.*?<\/queries>/gs, "")
    .replace(/<analyzing>.*?<\/analyzing>/gs, "")
    .replace(/<thinking>.*?<\/thinking>/gs, "")
    .replace(/<blindspots>.*?<\/blindspots>/gs, "")
    .replace(/<progress>.*?<\/progress>/gs, "")
    .replace(/<answer>.*?<\/answer>/gs, "")
    .trim();
}

function normalizeBraveAnswerContent(text: string): string {
  const answerMatches = [...text.matchAll(/<answer>(.*?)<\/answer>/gs)];
  const answer = answerMatches.at(-1)?.[1];
  if (answer) {
    try {
      const parsed = JSON.parse(answer) as { answer?: unknown };
      if (typeof parsed.answer === "string") return parsed.answer.trim();
    } catch {
      return answer.trim();
    }
  }
  return stripBraveAnswerTags(text);
}
