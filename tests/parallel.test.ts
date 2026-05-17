import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { parallelExtract, parallelSearch } from "../src/providers/parallel.ts";

const originalFetch = globalThis.fetch;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = [input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]];
type FetchMock = ReturnType<typeof mock>;

function fetchCalls(fetchMock: FetchMock): FetchCall[] {
  return fetchMock.mock.calls as unknown as FetchCall[];
}

function firstFetchCall(fetchMock: FetchMock): FetchCall {
  const call = fetchCalls(fetchMock)[0];
  expect(call).toBeDefined();
  return call;
}

function requestBody(fetchMock: ReturnType<typeof mock>): Record<string, unknown> {
  const init = firstFetchCall(fetchMock)[1];
  expect(init).toBeDefined();
  expect(typeof init?.body).toBe("string");
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  process.env.PARALLEL_API_KEY = "test-parallel-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.PARALLEL_API_KEY;
});

describe("parallelSearch", () => {
  test("builds the expected search payload", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ search_id: "search-1", results: [] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await parallelSearch("latest battery recycling regulations", {
      objective: "Find current regulatory summaries",
      mode: "basic",
      maxResults: 3,
      maxCharsPerResult: 750,
      maxCharsTotal: 2000,
      sourcePolicy: { include_domains: ["epa.gov"] },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = firstFetchCall(fetchMock);
    expect(firstFetchCall(fetchMock)[0]).toBe("https://api.parallel.ai/v1/search");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "x-api-key": "test-parallel-key" },
    });
    expect(requestBody(fetchMock)).toEqual({
      objective: "Find current regulatory summaries",
      search_queries: ["latest battery recycling regulations"],
      mode: "basic",
      max_chars_total: 2000,
      advanced_settings: {
        max_results: 3,
        excerpt_settings: {
          max_chars_per_result: 750,
        },
        source_policy: { include_domains: ["epa.gov"] },
      },
    });
  });
});

describe("parallelExtract", () => {
  test("keeps minimal extract requests small", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ extract_id: "extract-1", results: [], errors: [] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await parallelExtract(["https://example.com"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = firstFetchCall(fetchMock);
    expect(firstFetchCall(fetchMock)[0]).toBe("https://api.parallel.ai/v1/extract");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "x-api-key": "test-parallel-key" },
    });
    expect(requestBody(fetchMock)).toEqual({
      urls: ["https://example.com"],
    });
  });

  test("nests extract-only controls under advanced_settings", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ extract_id: "extract-2", results: [], errors: [] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await parallelExtract(["https://example.com/invoice"], {
      objective: "Extract the latest invoice table",
      searchQueries: ["invoice table line items"],
      fullContent: true,
      maxCharsPerResult: 1200,
      maxCharsTotal: 5000,
      fetchPolicy: { max_age_seconds: 3600, timeout_seconds: 30 },
      sourcePolicy: { exclude_domains: ["example.net"] },
    });

    expect(requestBody(fetchMock)).toEqual({
      urls: ["https://example.com/invoice"],
      objective: "Extract the latest invoice table",
      search_queries: ["invoice table line items"],
      max_chars_total: 5000,
      advanced_settings: {
        full_content: true,
        excerpt_settings: {
          max_chars_per_result: 1200,
        },
        fetch_policy: {
          max_age_seconds: 3600,
          timeout_seconds: 30,
        },
      },
      source_policy: { exclude_domains: ["example.net"] },
    });
  });
});
