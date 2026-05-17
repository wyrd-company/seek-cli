import { requireEnv } from "../lib/env.ts";
import { request, poll } from "../lib/http.ts";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_DEEP_RESEARCH_AGENT = "deep-research-pro-preview-12-2025";
const API_REVISION = "2026-05-20";

function headers(): Record<string, string> {
  const key = requireEnv("GEMINI_API_KEY", "google");
  return {
    "x-goog-api-key": key,
    "Api-Revision": API_REVISION,
  };
}

export type InteractionStatus =
  | "in_progress"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled";

export interface InteractionContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface InteractionStep {
  type:
    | "user_input"
    | "model_output"
    | "thought"
    | "function_call"
    | "function_result"
    | "google_search_result"
    | "url_context_result"
    | "code_execution_result"
    | "file_search_result"
    | string;
  index: number;
  content?: InteractionContentBlock[];
  [key: string]: unknown;
}

export interface Interaction {
  id: string;
  status: InteractionStatus;
  steps?: InteractionStep[];
  outputs?: Array<{ text?: string; [key: string]: unknown }>;
  usage?: { total_tokens?: number };
  error?: { message?: string; code?: string };
}

export interface InteractionCreateBody {
  agent?: string;
  model?: string;
  input: string;
  background?: boolean;
  system_instruction?: string;
  tools?: Array<Record<string, unknown>>;
  previous_interaction_id?: string;
}

export async function createInteraction(body: InteractionCreateBody): Promise<Interaction> {
  return await request<Interaction>(`${BASE_URL}/interactions`, {
    method: "POST",
    headers: headers(),
    body,
    timeoutMs: 60_000,
  });
}

export async function getInteraction(id: string): Promise<Interaction> {
  return await request<Interaction>(
    `${BASE_URL}/interactions/${encodeURIComponent(id)}`,
    { headers: headers(), timeoutMs: 60_000 },
  );
}

const TERMINAL_STATUSES: ReadonlySet<InteractionStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export interface DeepResearchOptions {
  agent?: typeof DEFAULT_DEEP_RESEARCH_AGENT | string;
  systemInstruction?: string;
  onProgress?: (interaction: Interaction) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export async function googleDeepResearch(
  query: string,
  opts: DeepResearchOptions = {},
): Promise<Interaction> {
  const created = await createInteraction({
    agent: opts.agent ?? DEFAULT_DEEP_RESEARCH_AGENT,
    input: query,
    background: true,
    system_instruction: opts.systemInstruction,
  });

  return await poll(
    () => getInteraction(created.id),
    (i) => TERMINAL_STATUSES.has(i.status),
    {
      intervalMs: opts.pollIntervalMs ?? 10_000,
      timeoutMs: opts.timeoutMs ?? 30 * 60_000,
      onTick: opts.onProgress,
    },
  );
}

export function extractReportText(interaction: Interaction): string {
  const outputs = interaction.outputs ?? [];
  const lastTextOutput = outputs
    .slice()
    .reverse()
    .find((o) => typeof o.text === "string");
  if (lastTextOutput?.text) return lastTextOutput.text;

  const steps = interaction.steps ?? [];
  const modelOutputs = steps.filter((s) => s.type === "model_output");
  if (modelOutputs.length === 0) return "";
  const last = modelOutputs[modelOutputs.length - 1];
  return (last.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

export function extractCitations(interaction: Interaction): string[] {
  const urls = new Set<string>();
  for (const step of interaction.steps ?? []) {
    const blocks = step.content ?? [];
    for (const block of blocks) {
      collectUrls(block, urls);
    }
    if (Array.isArray((step as Record<string, unknown>).citations)) {
      for (const c of (step as Record<string, unknown>).citations as unknown[]) {
        collectUrls(c, urls);
      }
    }
  }
  return [...urls];
}

function collectUrls(value: unknown, out: Set<string>): void {
  if (!value) return;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, out);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((k === "uri" || k === "url") && typeof v === "string" && /^https?:\/\//i.test(v)) {
        out.add(v);
      } else {
        collectUrls(v, out);
      }
    }
  }
}

export function summarizeProgress(interaction: Interaction): string {
  const steps = interaction.steps ?? [];
  const tally: Record<string, number> = {};
  for (const s of steps) tally[s.type] = (tally[s.type] ?? 0) + 1;
  const parts = Object.entries(tally).map(([k, v]) => `${k}=${v}`);
  return `${interaction.status} | ${parts.join(", ") || "no steps yet"}`;
}
