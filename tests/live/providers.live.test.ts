import { describe, expect, test } from "bun:test";
import { braveAnswers, braveSearch, extractBraveAnswerText } from "../../src/providers/brave.ts";
import { exaContents, exaSearch } from "../../src/providers/exa.ts";
import { firecrawlScrape, type FirecrawlScrapeOptions } from "../../src/providers/firecrawl.ts";
import { HttpError } from "../../src/lib/http.ts";
import { extractReportText, googleDeepResearch } from "../../src/providers/google.ts";
import { parallelExtract, parallelSearch } from "../../src/providers/parallel.ts";
import {
  perplexityDeepResearch,
  perplexitySearch,
  type PerplexityDeepResearchOptions,
} from "../../src/providers/perplexity.ts";
import { recordLiveArtifact } from "./artifacts.ts";

const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";
const RUN_LONG_LIVE = process.env.RUN_LONG_LIVE_TESTS === "1";

function liveTest(
  name: string,
  envVar: string,
  fn: () => Promise<void>,
): void {
  if (!RUN_LIVE) return;
  if (!process.env[envVar]) {
    test.skip(`${name} (${envVar} not set)`, () => {});
    return;
  }
  test(name, fn, { timeout: 120_000 });
}

function longLiveTest(
  name: string,
  envVar: string,
  fn: () => Promise<void>,
): void {
  if (!RUN_LIVE) return;
  if (!RUN_LONG_LIVE) {
    test.skip(`${name} (set RUN_LONG_LIVE_TESTS=1 to run)`, () => {});
    return;
  }
  if (!process.env[envVar]) {
    test.skip(`${name} (${envVar} not set)`, () => {});
    return;
  }
  test(name, fn, { timeout: 15 * 60_000 });
}

describe("live provider smoke tests", () => {
  if (!RUN_LIVE) {
    test("skipped by default", () => {
      expect(process.env.RUN_LIVE_TESTS).not.toBe("1");
    });
  }

  liveTest("Parallel search returns results", "PARALLEL_API_KEY", async () => {
    const request = {
      query: "example domain",
      options: { maxResults: 1, maxCharsPerResult: 300 },
    };
    const data = await recordLiveArtifact(
      {
        name: "parallel-search",
        provider: "parallel",
        operation: "search",
        request,
      },
      () => parallelSearch(request.query, request.options),
    );

    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]?.url).toMatch(/^https?:\/\//);
  });

  liveTest("Parallel extract returns a result", "PARALLEL_API_KEY", async () => {
    const request = {
      urls: ["https://example.com"],
      options: { maxCharsPerResult: 500, maxCharsTotal: 1000 },
    };
    const data = await recordLiveArtifact(
      {
        name: "parallel-extract",
        provider: "parallel",
        operation: "extract",
        request,
      },
      () => parallelExtract(request.urls, request.options),
    );

    expect(data.results.length + data.errors.length).toBeGreaterThan(0);
  });

  liveTest("Exa search returns results", "EXA_API_KEY", async () => {
    const request = { query: "example domain", options: { numResults: 1 } };
    const data = await recordLiveArtifact(
      {
        name: "exa-search",
        provider: "exa",
        operation: "search",
        request,
      },
      () => exaSearch(request.query, request.options),
    );

    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]?.url).toMatch(/^https?:\/\//);
  });

  liveTest("Exa contents extracts example.com", "EXA_API_KEY", async () => {
    const request = {
      urls: ["https://example.com"],
      options: { maxCharacters: 1000 },
    };
    const data = await recordLiveArtifact(
      {
        name: "exa-contents",
        provider: "exa",
        operation: "contents",
        request,
      },
      () => exaContents(request.urls, request.options),
    );

    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]?.url).toMatch(/^https?:\/\//);
  });

  liveTest("Brave search returns results", "BRAVE_SEARCH_API_KEY", async () => {
    const request = { query: "example domain", options: { count: 1 } };
    const data = await recordLiveArtifact(
      {
        name: "brave-search",
        provider: "brave",
        operation: "search",
        request,
      },
      () => braveSearch(request.query, request.options),
    );

    expect((data.web?.results ?? []).length).toBeGreaterThan(0);
    expect(data.web?.results[0]?.url).toMatch(/^https?:\/\//);
  });

  liveTest("Brave answers returns grounded text", "BRAVE_ANSWERS_API_KEY", async () => {
    const request = {
      query: "What is example.com? Answer in one sentence.",
      options: {
        enableResearch: true,
      },
    };
    const data = await recordLiveArtifact(
      {
        name: "brave-answers",
        provider: "brave",
        operation: "answers",
        request,
      },
      () => braveAnswers(request.query, request.options),
    );

    expect(extractBraveAnswerText(data).length).toBeGreaterThan(0);
    expect(extractBraveAnswerText(data)).not.toContain("<usage>");
  });

  liveTest("Perplexity search returns an answer", "PERPLEXITY_API_KEY", async () => {
    const request = {
      query: "What is example.com? Answer in one sentence.",
      options: { maxTokens: 80 },
    };
    const data = await recordLiveArtifact(
      {
        name: "perplexity-search",
        provider: "perplexity",
        operation: "search",
        request,
      },
      () => perplexitySearch(request.query, request.options),
    );

    expect(data.choices[0]?.message.content.length ?? 0).toBeGreaterThan(0);
  });

  liveTest("Firecrawl scrape returns markdown", "FIRECRAWL_API_KEY", async () => {
    const request = {
      url: "https://example.com",
      options: { formats: ["markdown"], maxAge: 60 * 60 * 1000 } satisfies FirecrawlScrapeOptions,
    };
    const data = await recordLiveArtifact(
      {
        name: "firecrawl-scrape",
        provider: "firecrawl",
        operation: "scrape",
        request,
      },
      () => firecrawlScrape(request.url, request.options),
    );

    expect(data.success).toBe(true);
    expect(data.data?.markdown?.length ?? 0).toBeGreaterThan(0);
  });

  longLiveTest("Google Deep Research completes a short report", "GEMINI_API_KEY", async () => {
    const request = {
      query: "In two short sentences, explain what example.com is. Keep the report brief.",
      options: { pollIntervalMs: 15_000, timeoutMs: 12 * 60_000 },
    };
    let interaction;
    try {
      interaction = await recordLiveArtifact(
        {
          name: "google-deep-research",
          provider: "google",
          operation: "deep-research",
          request,
        },
        () => googleDeepResearch(request.query, request.options),
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        throw new Error(
          "Google Deep Research live test reached the Gemini Interactions endpoint, " +
            "but this GEMINI_API_KEY is not permitted to use v1beta/interactions. " +
            "Enable Gemini Deep Research / Interactions API access for this key, " +
            "or unset RUN_LONG_LIVE_TESTS to skip long research smoke tests.",
        );
      }
      throw err;
    }

    expect(interaction.status).toBe("completed");
    expect(extractReportText(interaction).length).toBeGreaterThan(0);
  });

  longLiveTest("Perplexity Deep Research completes a short report", "PERPLEXITY_API_KEY", async () => {
    const request = {
      query: "In two short sentences, explain what example.com is. Keep the report brief.",
      options: {
        reasoningEffort: "low",
        pollIntervalMs: 15_000,
        timeoutMs: 12 * 60_000,
      } satisfies PerplexityDeepResearchOptions,
    };
    const job = await recordLiveArtifact(
      {
        name: "perplexity-deep-research",
        provider: "perplexity",
        operation: "deep-research",
        request,
      },
      () => perplexityDeepResearch(request.query, request.options),
    );

    expect(job.status).toBe("COMPLETED");
    expect(job.response?.choices?.[0]?.message.content.length ?? 0).toBeGreaterThan(0);
  });
});
