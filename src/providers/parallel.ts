import { requireEnv } from "../lib/env.ts";
import { request, poll } from "../lib/http.ts";

const BASE_URL = "https://api.parallel.ai";

function headers(): Record<string, string> {
  const key = requireEnv("PARALLEL_API_KEY", "parallel");
  return { "x-api-key": key };
}

// ---------- Search (POST /v1/search) ----------

export interface ParallelSearchOptions {
  objective?: string;
  mode?: "basic" | "advanced";
  maxResults?: number;
  maxCharsPerResult?: number;
  maxCharsTotal?: number;
  sourcePolicy?: { include_domains?: string[]; exclude_domains?: string[] };
  fetchPolicy?: { max_age_seconds?: number; timeout_seconds?: number };
  clientModel?: string;
  sessionId?: string;
}

export interface WebSearchResult {
  url: string;
  title?: string | null;
  excerpts?: string[] | null;
  publish_date?: string | null;
}

export interface SearchResult {
  search_id: string;
  results: WebSearchResult[];
  usage?: unknown;
  warnings?: unknown;
}

export async function parallelSearch(
  query: string,
  opts: ParallelSearchOptions = {},
): Promise<SearchResult> {
  const body: Record<string, unknown> = {
    objective: opts.objective ?? query,
    search_queries: [query],
  };
  if (opts.mode) body.mode = opts.mode;
  if (opts.maxCharsTotal != null) body.max_chars_total = opts.maxCharsTotal;
  if (opts.clientModel) body.client_model = opts.clientModel;
  if (opts.sessionId) body.session_id = opts.sessionId;

  const advancedSettings: Record<string, unknown> = {};
  if (opts.maxResults != null) advancedSettings.max_results = opts.maxResults;
  if (opts.maxCharsPerResult != null) {
    advancedSettings.excerpt_settings = {
      max_chars_per_result: opts.maxCharsPerResult,
    };
  }
  if (opts.sourcePolicy) advancedSettings.source_policy = opts.sourcePolicy;
  if (opts.fetchPolicy) advancedSettings.fetch_policy = opts.fetchPolicy;
  if (Object.keys(advancedSettings).length > 0) {
    body.advanced_settings = advancedSettings;
  }

  return await request<SearchResult>(`${BASE_URL}/v1/search`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 90_000,
  });
}

// ---------- Extract (POST /v1/extract) ----------

export interface ParallelExtractOptions {
  objective?: string;
  searchQueries?: string[];
  fullContent?: boolean;
  maxCharsPerResult?: number;
  maxCharsTotal?: number;
  fetchPolicy?: { max_age_seconds?: number; timeout_seconds?: number };
  sourcePolicy?: { include_domains?: string[]; exclude_domains?: string[] };
}

export interface ExtractResult {
  url: string;
  title?: string | null;
  excerpts?: string[] | null;
  full_content?: string | null;
  publish_date?: string | null;
}

export interface ExtractError {
  url: string;
  error?: string | null;
  [key: string]: unknown;
}

export interface ExtractResponse {
  extract_id: string;
  results: ExtractResult[];
  errors: ExtractError[];
  usage?: unknown;
  warnings?: unknown;
}

export async function parallelExtract(
  urls: string[],
  opts: ParallelExtractOptions = {},
): Promise<ExtractResponse> {
  const body: Record<string, unknown> = { urls };
  if (opts.objective) body.objective = opts.objective;
  if (opts.searchQueries) body.search_queries = opts.searchQueries;
  if (opts.maxCharsTotal != null) body.max_chars_total = opts.maxCharsTotal;
  const advancedSettings: Record<string, unknown> = {};
  if (opts.fullContent !== undefined) advancedSettings.full_content = opts.fullContent;
  if (opts.maxCharsPerResult != null) {
    advancedSettings.excerpt_settings = {
      max_chars_per_result: opts.maxCharsPerResult,
    };
  }
  if (opts.fetchPolicy) advancedSettings.fetch_policy = opts.fetchPolicy;
  if (Object.keys(advancedSettings).length > 0) {
    body.advanced_settings = advancedSettings;
  }
  if (opts.sourcePolicy) body.source_policy = opts.sourcePolicy;

  return await request<ExtractResponse>(`${BASE_URL}/v1/extract`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 120_000,
  });
}

// ---------- Tasks (POST /v1/tasks/runs) ----------

export type TaskStatus =
  | "queued"
  | "action_required"
  | "running"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface TaskRun {
  run_id: string;
  interaction_id: string;
  status: TaskStatus;
  is_active: boolean;
  processor: string;
  created_at: string | null;
  modified_at: string | null;
  error?: { message?: string; [key: string]: unknown } | null;
  warnings?: unknown;
}

export interface Citation {
  url: string;
  title?: string | null;
  excerpts?: string[] | null;
}

export interface FieldBasis {
  field: string;
  reasoning: string;
  citations?: Citation[];
  confidence?: string | null;
}

export interface TaskRunTextOutput {
  type: "text";
  content: string;
  basis: FieldBasis[];
}

export interface TaskRunJsonOutput {
  type: "json";
  content: Record<string, unknown>;
  basis: FieldBasis[];
  output_schema?: Record<string, unknown> | null;
}

export interface TaskRunResult {
  run: TaskRun;
  output: TaskRunTextOutput | TaskRunJsonOutput;
}

export interface TaskRunOptions {
  processor?: "lite" | "base" | "core" | "pro" | "ultra" | string;
  schema?: Record<string, unknown>;
  inputDescription?: string;
  enableEvents?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProgress?: (run: TaskRun) => void;
}

export async function parallelTaskRun(
  input: string | Record<string, unknown>,
  opts: TaskRunOptions = {},
): Promise<TaskRunResult> {
  const body: Record<string, unknown> = {
    input,
    processor: opts.processor ?? "core",
  };
  if (opts.schema || opts.inputDescription) {
    const taskSpec: Record<string, unknown> = {};
    if (opts.schema) {
      taskSpec.output_schema = { type: "json", json_schema: opts.schema };
    }
    if (opts.inputDescription) {
      taskSpec.input_schema = { type: "text", description: opts.inputDescription };
    }
    body.task_spec = taskSpec;
  }
  if (opts.enableEvents !== undefined) body.enable_events = opts.enableEvents;

  const created = await request<TaskRun>(`${BASE_URL}/v1/tasks/runs`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 60_000,
  });

  const finished = await poll(
    () =>
      request<TaskRun>(`${BASE_URL}/v1/tasks/runs/${encodeURIComponent(created.run_id)}`, {
        headers: headers(),
      }),
    (r) => !r.is_active,
    {
      intervalMs: opts.pollIntervalMs ?? 5_000,
      timeoutMs: opts.timeoutMs ?? 25 * 60_000,
      onTick: opts.onProgress,
    },
  );

  if (finished.status !== "completed") {
    throw new Error(
      `Parallel task ${finished.run_id} ended with status=${finished.status}` +
        (finished.error?.message ? `: ${finished.error.message}` : ""),
    );
  }

  return await request<TaskRunResult>(
    `${BASE_URL}/v1/tasks/runs/${encodeURIComponent(created.run_id)}/result`,
    { headers: headers(), timeoutMs: 60_000 },
  );
}

export function summarizeRunProgress(run: TaskRun): string {
  return `${run.status} (run_id=${run.run_id})`;
}
