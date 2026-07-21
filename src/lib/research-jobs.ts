import {
  extractCitations as extractGoogleCitations,
  extractReportText,
  getGoogleDeepResearch,
  type Interaction,
} from "../providers/google.ts";
import {
  getParallelTaskRun,
  getParallelTaskRunResult,
  type TaskRun,
  type TaskRunResult,
} from "../providers/parallel.ts";
import {
  getPerplexityDeepResearch,
  type PerplexityAsyncJob,
} from "../providers/perplexity.ts";

export const ASYNC_RESEARCH_PROVIDERS = [
  "google",
  "parallel",
  "perplexity",
] as const;

export type AsyncResearchProvider =
  (typeof ASYNC_RESEARCH_PROVIDERS)[number];

export type NormalizedResearchStatus =
  | "queued"
  | "running"
  | "action-required"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface ResearchJobLocator {
  provider: AsyncResearchProvider;
  jobId: string;
}

export interface ResearchJobFailure {
  message?: string;
  details?: unknown;
}

export interface ResearchJobSnapshot {
  locator: ResearchJobLocator;
  status: NormalizedResearchStatus;
  providerStatus: string;
  terminal: boolean;
  failure?: ResearchJobFailure;
  providerPayload: unknown;
}

export interface ResearchResult {
  text: string;
  citations: string[];
}

export interface ResearchJobResultSnapshot extends ResearchJobSnapshot {
  result?: ResearchResult;
  providerResult?: unknown;
}

export function parseAsyncResearchProvider(
  value: string,
): AsyncResearchProvider {
  if (value === "brave") {
    throw new Error(
      "Brave research is synchronous and does not expose resumable jobs. " +
        "Run `seek research brave <query>` instead.",
    );
  }
  if (ASYNC_RESEARCH_PROVIDERS.includes(value as AsyncResearchProvider)) {
    return value as AsyncResearchProvider;
  }
  throw new Error(
    `Unsupported async research provider '${value}'. Use: ${ASYNC_RESEARCH_PROVIDERS.join(", ")}.`,
  );
}

export function snapshotGoogleJob(
  interaction: Interaction,
): ResearchJobSnapshot {
  return snapshot(
    "google",
    interaction.id,
    interaction.status,
    normalizeGoogleStatus(interaction.status),
    interaction,
    interaction.error
      ? { message: interaction.error.message, details: interaction.error }
      : undefined,
  );
}

export function snapshotParallelJob(run: TaskRun): ResearchJobSnapshot {
  const details = run.error ?? run.errors;
  const message =
    run.error?.message ?? run.errors?.find((error) => error.message)?.message;
  return snapshot(
    "parallel",
    run.run_id,
    run.status,
    normalizeParallelStatus(run.status),
    run,
    details ? { message, details } : undefined,
  );
}

export function snapshotPerplexityJob(
  job: PerplexityAsyncJob,
): ResearchJobSnapshot {
  return snapshot(
    "perplexity",
    job.id,
    job.status,
    normalizePerplexityStatus(job.status),
    job,
    job.error_message
      ? { message: job.error_message, details: job.error_message }
      : undefined,
  );
}

export async function inspectResearchJob(
  provider: AsyncResearchProvider,
  jobId: string,
): Promise<ResearchJobSnapshot> {
  switch (provider) {
    case "google":
      return snapshotGoogleJob(await getGoogleDeepResearch(jobId));
    case "parallel":
      return snapshotParallelJob(await getParallelTaskRun(jobId));
    case "perplexity":
      return snapshotPerplexityJob(await getPerplexityDeepResearch(jobId));
  }
}

export async function retrieveResearchJob(
  provider: AsyncResearchProvider,
  jobId: string,
): Promise<ResearchJobResultSnapshot> {
  const current = await inspectResearchJob(provider, jobId);
  if (current.status !== "completed") return current;

  switch (provider) {
    case "google": {
      const interaction = current.providerPayload as Interaction;
      return {
        ...current,
        result: {
          text: extractReportText(interaction),
          citations: extractGoogleCitations(interaction),
        },
      };
    }
    case "parallel": {
      const providerResult = await getParallelTaskRunResult(jobId);
      return {
        ...current,
        result: parallelResult(providerResult),
        providerResult,
      };
    }
    case "perplexity": {
      const job = current.providerPayload as PerplexityAsyncJob;
      return {
        ...current,
        result: {
          text: job.response?.choices?.[0]?.message?.content ?? "",
          citations: job.response?.citations ?? [],
        },
      };
    }
  }
}

export function renderResearchSubmission(job: ResearchJobSnapshot): string {
  return renderResearchJob("Research job accepted.", job, true);
}

export function renderResearchStatus(job: ResearchJobSnapshot): string {
  return renderResearchJob("Research job status.", job, false);
}

export function renderResearchUnavailable(job: ResearchJobSnapshot): string {
  const heading =
    job.status === "failed" || job.status === "cancelled"
      ? "Research job did not complete successfully."
      : job.status === "action-required"
        ? "Research job requires action before it can complete."
        : "Research job is not complete.";
  return renderResearchJob(heading, job, true);
}

function normalizeGoogleStatus(status: string): NormalizedResearchStatus {
  switch (status) {
    case "in_progress":
      return "running";
    case "requires_action":
      return "action-required";
    case "completed":
      return "completed";
    case "failed":
    case "incomplete":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function normalizeParallelStatus(status: string): NormalizedResearchStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
    case "cancelling":
      return "running";
    case "action_required":
      return "action-required";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function normalizePerplexityStatus(status: string): NormalizedResearchStatus {
  switch (status.toUpperCase()) {
    case "CREATED":
      return "queued";
    case "IN_PROGRESS":
      return "running";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    default:
      return "unknown";
  }
}

function snapshot(
  provider: AsyncResearchProvider,
  jobId: string,
  providerStatus: string,
  status: NormalizedResearchStatus,
  providerPayload: unknown,
  failure?: ResearchJobFailure,
): ResearchJobSnapshot {
  return {
    locator: { provider, jobId },
    status,
    providerStatus,
    terminal: isTerminal(status),
    ...(failure ? { failure } : {}),
    providerPayload,
  };
}

function isTerminal(status: NormalizedResearchStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function parallelResult(result: TaskRunResult): ResearchResult {
  const text =
    typeof result.output.content === "string"
      ? result.output.content
      : JSON.stringify(result.output.content, null, 2);
  const citations = (result.output.basis ?? [])
    .flatMap((basis) => (basis.citations ?? []).map((citation) => citation.url))
    .filter((url, index, urls) => urls.indexOf(url) === index);
  return { text, citations };
}

function renderResearchJob(
  heading: string,
  job: ResearchJobSnapshot,
  includeCommands: boolean,
): string {
  const lines = [
    heading,
    `Provider: ${job.locator.provider}`,
    `Job ID: ${job.locator.jobId}`,
    `Status: ${job.status} (provider: ${job.providerStatus})`,
  ];
  if (job.failure?.message) lines.push(`Failure: ${job.failure.message}`);
  if (includeCommands) {
    const provider = quoteShellArg(job.locator.provider);
    const jobId = quoteShellArg(job.locator.jobId);
    lines.push(
      `Check status: seek research status ${provider} -- ${jobId}`,
      `Get result: seek research get ${provider} -- ${jobId}`,
    );
  }
  return lines.join("\n");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
