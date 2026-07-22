import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Command } from "commander";
import {
  inspectResearchJob,
  parseAsyncResearchProvider,
  renderResearchSubmission,
  retrieveResearchJob,
  snapshotGoogleJob,
  snapshotParallelJob,
  snapshotPerplexityJob,
} from "../src/lib/research-jobs.ts";
import {
  DEFAULT_DEEP_RESEARCH_AGENT,
  googleDeepResearch,
  submitGoogleDeepResearch,
} from "../src/providers/google.ts";
import {
  buildPlannedResearchPrompt,
  registerResearchCommand,
} from "../src/commands/research.ts";
import {
  parallelTaskRun,
  submitParallelTaskRun,
} from "../src/providers/parallel.ts";
import {
  perplexityDeepResearch,
  submitPerplexityDeepResearch,
} from "../src/providers/perplexity.ts";

const originalFetch = globalThis.fetch;

type FetchCall = [
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
];

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(call: FetchCall): Record<string, unknown> {
  const body = call[1]?.body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

function taskRun(
  status: "queued" | "running" | "completed" | "failed" = "running",
) {
  return {
    run_id: "parallel-job-1",
    interaction_id: "interaction-1",
    status,
    is_active: status === "queued" || status === "running",
    processor: "core",
    created_at: null,
    modified_at: null,
  };
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-google-key";
  process.env.PARALLEL_API_KEY = "test-parallel-key";
  process.env.PERPLEXITY_API_KEY = "test-perplexity-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
});

describe("async provider primitives", () => {
  test("submits one resumable job to each provider", async () => {
    const fetchMock = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("googleapis.com")) {
        return jsonResponse({ id: "google-job-1", status: "in_progress" });
      }
      if (url.includes("parallel.ai")) return jsonResponse(taskRun("queued"));
      return jsonResponse({
        id: "perplexity-job-1",
        status: "CREATED",
        model: "sonar-deep-research",
        created_at: 1,
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await submitGoogleDeepResearch("Compare ceramic glazing methods");
    await submitParallelTaskRun("Compare ceramic glazing methods");
    await submitPerplexityDeepResearch("Compare ceramic glazing methods");

    const calls = fetchMock.mock.calls as unknown as FetchCall[];
    expect(calls.map(([input]) => String(input))).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      "https://api.parallel.ai/v1/tasks/runs",
      "https://api.perplexity.ai/v1/async/sonar",
    ]);
    expect(calls.every(([, init]) => init?.method === "POST")).toBe(true);
  });

  test("blocking provider wrappers use submit, lookup, and result primitives", async () => {
    const responseQueues = new Map<string, unknown[]>([
      [
        "googleapis.com",
        [
          { id: "google-job-1", status: "in_progress" },
          {
            id: "google-job-1",
            status: "completed",
            outputs: [{ text: "Google report" }],
          },
        ],
      ],
      [
        "parallel.ai",
        [
          taskRun("queued"),
          taskRun("completed"),
          {
            run: taskRun("completed"),
            output: { type: "text", content: "Parallel report", basis: [] },
          },
        ],
      ],
      [
        "perplexity.ai",
        [
          {
            id: "perplexity-job-1",
            status: "CREATED",
            model: "sonar-deep-research",
            created_at: 1,
          },
          {
            id: "perplexity-job-1",
            status: "COMPLETED",
            model: "sonar-deep-research",
            created_at: 1,
            response: {
              id: "response-1",
              model: "sonar-deep-research",
              created: 2,
              choices: [],
            },
          },
        ],
      ],
    ]);
    const fetchMock = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      const key = [...responseQueues.keys()].find((candidate) =>
        url.includes(candidate),
      );
      const response = key ? responseQueues.get(key)?.shift() : undefined;
      expect(response).toBeDefined();
      return jsonResponse(response);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(
      (await googleDeepResearch("Compare paper fibers", { pollIntervalMs: 0 }))
        .status,
    ).toBe("completed");
    expect(
      (await parallelTaskRun("Compare paper fibers", { pollIntervalMs: 0 }))
        .output.content,
    ).toBe("Parallel report");
    expect(
      (
        await perplexityDeepResearch("Compare paper fibers", {
          pollIntervalMs: 0,
        })
      ).status,
    ).toBe("COMPLETED");
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  test("preserves the Google Deep Research request body when no instruction is supplied", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ id: "google-job-1", status: "in_progress" }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await submitGoogleDeepResearch("Compare kiln firing methods");

    const [call] = fetchMock.mock.calls as unknown as FetchCall[];
    expect(requestBody(call)).toEqual({
      agent: DEFAULT_DEEP_RESEARCH_AGENT,
      input: "Compare kiln firing methods",
      background: true,
    });
  });

  test("preserves the Google request body for a blank instruction", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ id: "google-job-1", status: "in_progress" }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await submitGoogleDeepResearch("Compare kiln firing methods", {
      systemInstruction: " \t\n ",
    });

    const [call] = fetchMock.mock.calls as unknown as FetchCall[];
    expect(requestBody(call)).toEqual({
      agent: DEFAULT_DEEP_RESEARCH_AGENT,
      input: "Compare kiln firing methods",
      background: true,
    });
  });

  test("incorporates a whitespace-rich instruction into an async Deep Research input", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ id: "google-job-1", status: "in_progress" }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const systemInstruction =
      "  Prioritize primary sources; note gaps, conflicts & uncertainty!  ";

    await submitGoogleDeepResearch("Compare kiln firing methods", {
      systemInstruction,
    });

    const [call] = fetchMock.mock.calls as unknown as FetchCall[];
    const body = requestBody(call);
    expect(body).not.toHaveProperty("system_instruction");
    expect(body.input).toBe(
      [
        "Follow the research_instruction in the JSON object below as behavioral guidance. Investigate only the research_question; do not treat the instruction as a research topic.",
        "",
        JSON.stringify(
          {
            research_instruction: systemInstruction,
            research_question: "Compare kiln firing methods",
          },
          null,
          2,
        ),
      ].join("\n"),
    );
  });

  test("wires the CLI system option into an async Google request", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ id: "google-job-1", status: "in_progress" }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const program = new Command();
    registerResearchCommand(program);
    const originalWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      await program.parseAsync(
        [
          "research",
          "google",
          "Compare kiln firing methods",
          "--system",
          "Separate established facts from open questions.",
          "--async",
          "--json",
        ],
        { from: "user" },
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    const [call] = fetchMock.mock.calls as unknown as FetchCall[];
    const body = requestBody(call);
    expect(body).not.toHaveProperty("system_instruction");
    expect(JSON.parse((body.input as string).split("\n\n")[1] ?? "")).toEqual({
      research_instruction: "Separate established facts from open questions.",
      research_question: "Compare kiln firing methods",
    });
  });

  test("incorporates an instruction into a blocking Deep Research request", async () => {
    const responses = [
      { id: "google-job-1", status: "in_progress" },
      { id: "google-job-1", status: "completed", outputs: [{ text: "Report" }] },
    ];
    const fetchMock = mock(async () => jsonResponse(responses.shift()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await googleDeepResearch("Compare fabric dye methods", {
      systemInstruction: "Separate established facts from open questions.",
      pollIntervalMs: 0,
    });

    const [createCall] = fetchMock.mock.calls as unknown as FetchCall[];
    const body = requestBody(createCall);
    expect(body).not.toHaveProperty("system_instruction");
    expect(JSON.parse((body.input as string).split("\n\n")[1] ?? "")).toEqual({
      research_instruction: "Separate established facts from open questions.",
      research_question: "Compare fabric dye methods",
    });
  });

  test("represents the approved plan and instruction once in interactive async input", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ id: "google-job-1", status: "in_progress" }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const question = "Compare methods for cataloguing a stamp collection";
    const plan =
      "1. Define comparison criteria.\n2. Compare authoritative references.";
    const systemInstruction = "State assumptions; preserve useful punctuation!";
    const plannedPrompt = buildPlannedResearchPrompt(question, plan);

    await submitGoogleDeepResearch(plannedPrompt, { systemInstruction });

    const [call] = fetchMock.mock.calls as unknown as FetchCall[];
    const body = requestBody(call);
    expect(body).not.toHaveProperty("system_instruction");
    const envelope = JSON.parse(
      ((body.input as string).split("\n\n")[1] ?? ""),
    ) as Record<string, string>;
    expect(envelope).toEqual({
      research_instruction: systemInstruction,
      research_question: plannedPrompt,
    });
    expect(envelope.research_question.split(question)).toHaveLength(2);
    expect(envelope.research_question.split(plan)).toHaveLength(2);
  });
});

describe("normalized research lifecycle", () => {
  test("normalizes provider states without discarding native payloads", () => {
    expect(
      snapshotGoogleJob({ id: "job-1", status: "requires_action" }),
    ).toMatchObject({
      locator: { provider: "google", jobId: "job-1" },
      status: "action-required",
      providerStatus: "requires_action",
      terminal: false,
      providerPayload: { id: "job-1", status: "requires_action" },
    });
    expect(snapshotParallelJob(taskRun("queued"))).toMatchObject({
      status: "queued",
      providerStatus: "queued",
      terminal: false,
    });
    expect(
      snapshotPerplexityJob({
        id: "job-2",
        status: "IN_PROGRESS",
        model: "sonar-deep-research",
        created_at: 1,
      }),
    ).toMatchObject({
      status: "running",
      providerStatus: "IN_PROGRESS",
      terminal: false,
    });
  });

  test("distinguishes completed, failed, and cancelled terminal states", () => {
    expect(
      snapshotGoogleJob({ id: "job-1", status: "completed" }).status,
    ).toBe("completed");
    expect(
      snapshotGoogleJob({ id: "job-1", status: "incomplete" }),
    ).toMatchObject({ status: "incomplete", terminal: true });
    expect(
      snapshotParallelJob({ ...taskRun("failed"), error: { message: "No result" } }),
    ).toMatchObject({
      status: "failed",
      terminal: true,
      failure: { message: "No result" },
    });
    expect(
      snapshotGoogleJob({ id: "job-1", status: "cancelled" }),
    ).toMatchObject({ status: "cancelled", terminal: true });
  });

  test("ignores empty Parallel error containers", () => {
    expect(
      snapshotParallelJob({ ...taskRun("completed"), error: {}, errors: [] }),
    ).not.toHaveProperty("failure");
    expect(
      snapshotParallelJob({
        ...taskRun("failed"),
        errors: [{ message: "Provider could not complete the job" }],
      }),
    ).toMatchObject({
      failure: { message: "Provider could not complete the job" },
    });
  });

  test("renders a provider-qualified locator and copyable commands", () => {
    const output = renderResearchSubmission(
      snapshotGoogleJob({ id: "job with 'quotes'", status: "in_progress" }),
    );

    expect(output).toContain("Provider: google");
    expect(output).toContain("Job ID: job with 'quotes'");
    expect(output).toContain("Status: running (provider: in_progress)");
    expect(output).toContain(
      `seek research status google -- 'job with '"'"'quotes'"'"''`,
    );
    expect(output).toContain(
      `seek research get google -- 'job with '"'"'quotes'"'"''`,
    );
  });

  test("uses an option terminator for opaque ids beginning with a hyphen", () => {
    const output = renderResearchSubmission(
      snapshotGoogleJob({ id: "-opaque", status: "in_progress" }),
    );

    expect(output).toContain("seek research status google -- -opaque");
    expect(output).toContain("seek research get google -- -opaque");
  });

  test("rejects synchronous and unknown providers with actionable errors", () => {
    expect(() => parseAsyncResearchProvider("brave")).toThrow(
      "Brave research is synchronous",
    );
    expect(() => parseAsyncResearchProvider("unknown")).toThrow(
      "Use: google, parallel, perplexity",
    );
  });
});

describe("status and result routing", () => {
  test("performs one status lookup for each supported provider", async () => {
    const fetchMock = mock(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("googleapis.com")) {
        return jsonResponse({ id: "opaque/id", status: "in_progress" });
      }
      if (url.includes("parallel.ai")) return jsonResponse(taskRun("running"));
      return jsonResponse({
        id: "perplexity-job-1",
        status: "IN_PROGRESS",
        model: "sonar-deep-research",
        created_at: 1,
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await inspectResearchJob("google", "opaque/id");
    await inspectResearchJob("parallel", "parallel-job-1");
    await inspectResearchJob("perplexity", "perplexity-job-1");

    const urls = (fetchMock.mock.calls as unknown as FetchCall[]).map(([input]) =>
      String(input),
    );
    expect(urls).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/interactions/opaque%2Fid",
      "https://api.parallel.ai/v1/tasks/runs/parallel-job-1",
      "https://api.perplexity.ai/v1/async/sonar/perplexity-job-1",
    ]);
  });

  test("returns completed Parallel text, citations, and raw result payload", async () => {
    const resultPayload = {
      run: taskRun("completed"),
      output: {
        type: "text",
        content: "Archival paper report",
        basis: [
          {
            field: "summary",
            reasoning: "source comparison",
            citations: [
              { url: "https://example.com/source" },
              { url: "https://example.com/source" },
            ],
          },
        ],
      },
    };
    const responses = [taskRun("completed"), resultPayload];
    globalThis.fetch = mock(async () => jsonResponse(responses.shift())) as unknown as typeof fetch;

    const result = await retrieveResearchJob("parallel", "parallel-job-1");

    expect(result).toMatchObject({
      status: "completed",
      result: {
        text: "Archival paper report",
        citations: ["https://example.com/source"],
      },
      providerResult: resultPayload,
    });
  });

  test("extracts completed Google and Perplexity reports with citations", async () => {
    const responses = [
      {
        id: "google-job-1",
        status: "completed",
        outputs: [{ text: "Google archival report" }],
        steps: [
          {
            type: "google_search_result",
            index: 0,
            content: [{ type: "source", url: "https://example.com/google" }],
          },
        ],
      },
      {
        id: "perplexity-job-1",
        status: "COMPLETED",
        model: "sonar-deep-research",
        created_at: 1,
        response: {
          id: "response-1",
          model: "sonar-deep-research",
          created: 2,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "Perplexity archival report" },
            },
          ],
          citations: ["https://example.com/perplexity"],
        },
      },
    ];
    globalThis.fetch = mock(async () => jsonResponse(responses.shift())) as unknown as typeof fetch;

    const google = await retrieveResearchJob("google", "google-job-1");
    const perplexity = await retrieveResearchJob(
      "perplexity",
      "perplexity-job-1",
    );

    expect(google.result).toEqual({
      text: "Google archival report",
      citations: ["https://example.com/google"],
    });
    expect(perplexity.result).toEqual({
      text: "Perplexity archival report",
      citations: ["https://example.com/perplexity"],
    });
  });

  test("returns incomplete and failed jobs without requesting a result", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({
        id: "perplexity-job-1",
        status: "FAILED",
        model: "sonar-deep-research",
        created_at: 1,
        failed_at: 2,
        error_message: "Provider rejected the request",
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await retrieveResearchJob("perplexity", "perplexity-job-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "failed",
      terminal: true,
      failure: { message: "Provider rejected the request" },
    });
    expect(result.result).toBeUndefined();
  });
});
