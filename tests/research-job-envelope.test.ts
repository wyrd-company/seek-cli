import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ASYNC_RESEARCH_PROVIDERS,
  retrieveResearchJob,
  snapshotGoogleJob,
  snapshotParallelJob,
  snapshotPerplexityJob,
  type AsyncResearchProvider,
  type ResearchJobSnapshot,
} from "../src/lib/research-jobs.ts";
import type { Interaction } from "../src/providers/google.ts";
import type { TaskRun } from "../src/providers/parallel.ts";
import type { PerplexityAsyncJob } from "../src/providers/perplexity.ts";

// research-job-envelope.schema.json is the contract; these tests bind it to src/lib/research-jobs.ts.

interface StatusDefinition {
  const: string;
  description: string;
}
const schema = JSON.parse(
  readFileSync("docs/specifications/research-job-envelope.schema.json", "utf8"),
) as {
  properties: Record<string, { properties?: Record<string, { enum?: string[] }>; oneOf?: StatusDefinition[] }>;
  allOf: Array<{ if: { properties: { status: { enum: string[] } } } }>;
};

const statuses = schema.properties.status!.oneOf!;
const terminalStatuses = schema.allOf[0]!.if.properties.status.enum;
const PROVIDER_NAMES: Record<string, AsyncResearchProvider> = {
  Google: "google",
  Parallel: "parallel",
  Perplexity: "perplexity",
};

function snapshotFor(provider: AsyncResearchProvider, providerStatus: string): ResearchJobSnapshot {
  switch (provider) {
    case "google":
      return snapshotGoogleJob({ id: "synthetic-job", status: providerStatus } as Interaction);
    case "parallel":
      return snapshotParallelJob({ run_id: "synthetic-job", status: providerStatus } as TaskRun);
    case "perplexity":
      return snapshotPerplexityJob({ id: "synthetic-job", status: providerStatus } as PerplexityAsyncJob);
  }
}

/** Provider statuses named in each normalized status's description, as provider -> status -> normalized. */
function namedProviderStatuses(): Map<AsyncResearchProvider, Map<string, string>> {
  const named = new Map<AsyncResearchProvider, Map<string, string>>(
    ASYNC_RESEARCH_PROVIDERS.map((p) => [p, new Map()]),
  );
  for (const status of statuses) {
    for (const m of status.description.matchAll(/(Google|Parallel|Perplexity)((?:,? `[^`]+`)+)/g)) {
      for (const providerStatus of m[2]!.matchAll(/`([^`]+)`/g)) {
        named.get(PROVIDER_NAMES[m[1]!]!)!.set(providerStatus[1]!, status.const);
      }
    }
  }
  return named;
}

/** The provider statuses each normalize function in the source has a case for. */
function mappedProviderStatuses(provider: AsyncResearchProvider): Set<string> {
  const source = readFileSync("src/lib/research-jobs.ts", "utf8");
  const name = `normalize${provider[0]!.toUpperCase()}${provider.slice(1)}Status`;
  const body = source.slice(source.indexOf(`function ${name}`)).split("\n}\n")[0]!;
  return new Set([...body.matchAll(/case "([^"]+)":/g)].map((m) => m[1]!));
}

describe("research-job-envelope.schema.json", () => {
  test("enumerates the resumable providers", () => {
    expect(schema.properties.locator!.properties!.provider!.enum).toEqual([...ASYNC_RESEARCH_PROVIDERS]);
  });

  test("each named provider status normalizes to the status that names it", () => {
    const named = namedProviderStatuses();
    for (const [provider, mapping] of named) {
      expect(mapping.size).toBeGreaterThan(0);
      for (const [providerStatus, normalized] of mapping) {
        expect(snapshotFor(provider, providerStatus).status).toBe(normalized as never);
      }
    }
  });

  test("names every provider status the code maps", () => {
    const named = namedProviderStatuses();
    for (const provider of ASYNC_RESEARCH_PROVIDERS) {
      expect(new Set(named.get(provider)!.keys())).toEqual(mappedProviderStatuses(provider));
    }
  });

  test("maps an unnamed status to unknown, and Perplexity statuses case-insensitively", () => {
    for (const provider of ASYNC_RESEARCH_PROVIDERS) {
      expect(snapshotFor(provider, "synthetic-unmapped").status).toBe("unknown");
    }
    expect(snapshotFor("perplexity", "created").status).toBe("queued");
  });

  test("marks exactly the documented statuses terminal", () => {
    const reachable = new Set(["unknown"]);
    for (const [provider, mapping] of namedProviderStatuses()) {
      for (const providerStatus of mapping.keys()) {
        const snapshot = snapshotFor(provider, providerStatus);
        reachable.add(snapshot.status);
        expect(snapshot.terminal).toBe(terminalStatuses.includes(snapshot.status));
      }
    }
    expect(reachable).toEqual(new Set(statuses.map((s) => s.const)));
    for (const status of statuses) {
      expect(status.description.includes("Terminal.")).toBe(terminalStatuses.includes(status.const));
    }
  });
});

describe("research job envelopes conform to research-job-envelope.schema.json", () => {
  const originalFetch = globalThis.fetch;
  const savedServer = process.env.SEEK_SERVER_URL;
  const keys = ["GEMINI_API_KEY", "PARALLEL_API_KEY", "PERPLEXITY_API_KEY"];
  beforeEach(() => {
    delete process.env.SEEK_SERVER_URL;
    for (const key of keys) process.env[key] = "synthetic-key";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of keys) delete process.env[key];
    if (savedServer !== undefined) process.env.SEEK_SERVER_URL = savedServer;
  });

  function respond(...bodies: unknown[]): void {
    globalThis.fetch = (async () => Response.json(bodies.shift())) as unknown as typeof fetch;
  }

  function expectConforms(envelope: Record<string, unknown>): void {
    for (const key of Object.keys(envelope)) expect(Object.keys(schema.properties)).toContain(key);
    expect(envelope.terminal).toBe(terminalStatuses.includes(envelope.status as string));
    if ("result" in envelope) expect(envelope.status).toBe("completed");
    if ("providerResult" in envelope) {
      expect("result" in envelope).toBe(true);
      expect((envelope.locator as { provider: string }).provider).toBe("parallel");
    }
    for (const key of Object.keys(envelope.locator as object)) expect(["provider", "jobId"]).toContain(key);
  }

  test("for completed and unfinished jobs of each provider", async () => {
    const run = { run_id: "synthetic-run", status: "completed", is_active: false };
    respond(run, { run, output: { type: "text", content: "synthetic", basis: [] } });
    expectConforms({ ...(await retrieveResearchJob("parallel", "synthetic-run")) });

    respond({ id: "synthetic-interaction", status: "completed", outputs: [{ text: "synthetic" }] });
    expectConforms({ ...(await retrieveResearchJob("google", "synthetic-interaction")) });

    respond({ id: "synthetic-job", status: "COMPLETED", response: { choices: [] } });
    expectConforms({ ...(await retrieveResearchJob("perplexity", "synthetic-job")) });

    respond({ id: "synthetic-interaction", status: "failed", error: { message: "synthetic failure" } });
    expectConforms({ ...(await retrieveResearchJob("google", "synthetic-interaction")) });

    respond({ ...run, status: "running", is_active: true, errors: [{ message: "synthetic warning" }] });
    expectConforms({ ...(await retrieveResearchJob("parallel", "synthetic-run")) });

    respond({ id: "synthetic-job", status: "FAILED", error_message: "synthetic failure" });
    expectConforms({ ...(await retrieveResearchJob("perplexity", "synthetic-job")) });
  });
});
