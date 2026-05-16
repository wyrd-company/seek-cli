import { requireEnv } from "../lib/env.ts";
import { request } from "../lib/http.ts";

const BASE_URL = "https://api.exa.ai";

function headers(): Record<string, string> {
  const key = requireEnv("EXA_API_KEY", "exa");
  return { "x-api-key": key };
}

export interface ExaSearchResult {
  id: string;
  url: string;
  title?: string;
  score?: number;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  autopromptString?: string;
  requestId?: string;
}

export async function exaSearch(
  query: string,
  opts: {
    type?: "neural" | "keyword" | "auto";
    numResults?: number;
    includeText?: boolean;
    category?: string;
  } = {},
): Promise<ExaSearchResponse> {
  const body: Record<string, unknown> = {
    query,
    type: opts.type ?? "auto",
    numResults: opts.numResults ?? 10,
  };
  if (opts.category) body.category = opts.category;
  if (opts.includeText) {
    body.contents = { text: { maxCharacters: 2000 }, highlights: { numSentences: 3 } };
  } else {
    body.contents = { highlights: { numSentences: 3 } };
  }
  return await request(`${BASE_URL}/search`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 60_000,
  });
}

export interface ExaContentsResponse {
  results: ExaSearchResult[];
  requestId?: string;
}

export async function exaContents(
  urls: string[],
  opts: { includeText?: boolean; maxCharacters?: number } = {},
): Promise<ExaContentsResponse> {
  return await request(`${BASE_URL}/contents`, {
    method: "POST",
    headers: headers(),
    body: {
      urls,
      text: { maxCharacters: opts.maxCharacters ?? 50_000 },
      livecrawl: "always",
    },
    timeoutMs: 90_000,
  });
}
