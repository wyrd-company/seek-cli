import { requireEnv } from "../lib/env.ts";
import { request, poll } from "../lib/http.ts";

const BASE_URL = "https://api.parallel.ai";

function headers(): Record<string, string> {
  const key = requireEnv("PARALLEL_API_KEY", "parallel");
  return { "x-api-key": key };
}

export interface ParallelSearchOptions {
  objective?: string;
  maxResults?: number;
  maxCharsPerResult?: number;
  processor?: "base" | "pro";
}

export interface ParallelSearchResult {
  url: string;
  title: string;
  excerpts: string[];
}

export async function parallelSearch(
  query: string,
  opts: ParallelSearchOptions = {},
): Promise<{ search_id: string; results: ParallelSearchResult[] }> {
  return await request(`${BASE_URL}/v1beta/search`, {
    method: "POST",
    headers: headers(),
    body: {
      objective: opts.objective ?? query,
      search_queries: [query],
      processor: opts.processor ?? "base",
      max_results: opts.maxResults ?? 10,
      max_chars_per_result: opts.maxCharsPerResult ?? 1500,
    },
    timeoutMs: 90_000,
  });
}

export interface ParallelTaskRun {
  run_id: string;
  status: string;
  is_active: boolean;
  processor: string;
  warnings?: unknown;
  error?: unknown;
}

export interface ParallelTaskResult {
  run: ParallelTaskRun;
  output: {
    type: string;
    content: unknown;
    basis?: Array<{ field: string; citations: Array<{ url: string; title?: string }> }>;
  };
}

export async function parallelTaskRun(
  input: string | Record<string, unknown>,
  opts: {
    processor?: "lite" | "base" | "core" | "pro" | "ultra";
    schema?: Record<string, unknown>;
  } = {},
): Promise<ParallelTaskResult> {
  const body: Record<string, unknown> = {
    input,
    processor: opts.processor ?? "core",
  };
  if (opts.schema) {
    body.task_spec = {
      output_schema: {
        type: "json",
        json_schema: opts.schema,
      },
    };
  }
  const run = await request<ParallelTaskRun>(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 60_000,
  });

  const finished = await poll(
    () =>
      request<ParallelTaskRun>(`${BASE_URL}/v1/tasks/runs/${run.run_id}`, {
        headers: headers(),
      }),
    (r) => !r.is_active,
    { intervalMs: 5_000, timeoutMs: 25 * 60_000 },
  );

  if (finished.status !== "completed") {
    throw new Error(
      `Parallel task ${finished.run_id} ended with status ${finished.status}: ${JSON.stringify(
        finished.error ?? "(no error detail)",
      )}`,
    );
  }

  const output = await request<ParallelTaskResult["output"]>(
    `${BASE_URL}/v1/tasks/runs/${run.run_id}/result`,
    { headers: headers() },
  );

  return { run: finished, output };
}

export async function parallelScrape(
  url: string,
  opts: { objective?: string } = {},
): Promise<ParallelTaskResult> {
  const objective =
    opts.objective ??
    `Visit the page at ${url} and return its full text content as clean Markdown, including any data behind login portals or paywalls.`;
  return await parallelTaskRun(objective, { processor: "core" });
}
