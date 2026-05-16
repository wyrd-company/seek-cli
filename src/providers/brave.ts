import { requireEnv } from "../lib/env.ts";
import { request } from "../lib/http.ts";

const BASE_URL = "https://api.search.brave.com/res/v1";

function headers(): Record<string, string> {
  const key = requireEnv("BRAVE_API_KEY", "brave");
  return {
    "X-Subscription-Token": key,
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
    headers: headers(),
    timeoutMs: 30_000,
  });
}
