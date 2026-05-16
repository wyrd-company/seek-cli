import { requireEnv } from "../lib/env.ts";
import { request } from "../lib/http.ts";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content: { parts: GeminiPart[]; role: string };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri: string; title?: string } }>;
    webSearchQueries?: string[];
  };
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: Record<string, number>;
}

export interface GoogleResearchOptions {
  model?: string;
  systemPrompt?: string;
}

export async function googleResearch(
  query: string,
  opts: GoogleResearchOptions = {},
): Promise<GeminiResponse> {
  const apiKey = requireEnv("GEMINI_API_KEY", "google");
  const model = opts.model ?? "gemini-2.5-pro";

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: query }] }],
    tools: [{ google_search: {} }],
  };
  if (opts.systemPrompt) {
    body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
  }

  return await request(
    `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      body,
      timeoutMs: 15 * 60_000,
    },
  );
}

export function extractText(res: GeminiResponse): string {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

export function extractCitations(res: GeminiResponse): string[] {
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return chunks
    .map((c) => c.web?.uri)
    .filter((u): u is string => typeof u === "string");
}
