import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ARTIFACT_ROOT = ".test-artifacts/live";
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|token|secret|password|credential)/i;

export interface LiveArtifactInput {
  name: string;
  provider: string;
  operation: string;
  request: unknown;
  startedAt: string;
  durationMs: number;
  response?: unknown;
  error?: unknown;
}

export function saveLiveArtifactsEnabled(): boolean {
  return process.env.SAVE_LIVE_ARTIFACTS === "1";
}

export async function recordLiveArtifact<T>(
  input: {
    name: string;
    provider: string;
    operation: string;
    request: unknown;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  try {
    const response = await fn();
    writeLiveArtifact({
      ...input,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      response,
    });
    return response;
  } catch (err) {
    writeLiveArtifact({
      ...input,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error: serializeError(err),
    });
    throw err;
  }
}

function writeLiveArtifact(input: LiveArtifactInput): void {
  if (!saveLiveArtifactsEnabled()) return;
  const dir = join(process.cwd(), ARTIFACT_ROOT, RUN_ID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug(input.name)}.json`);
  writeFileSync(path, JSON.stringify(redact(input), null, 2) + "\n");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const record: Record<string, unknown> = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  for (const [key, value] of Object.entries(err)) {
    record[key] = value;
  }
  return record;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(nested);
  }
  return out;
}
