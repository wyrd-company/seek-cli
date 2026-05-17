import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  braveAnswers,
  braveSearch,
  extractBraveCitations,
  stripBraveAnswerTags,
} from "../src/providers/brave.ts";

const originalFetch = globalThis.fetch;

type FetchCall = [input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]];
type FetchMock = ReturnType<typeof mock>;

function firstFetchCall(fetchMock: FetchMock): FetchCall {
  const call = fetchMock.mock.calls[0] as unknown as FetchCall | undefined;
  expect(call).toBeDefined();
  return call as FetchCall;
}

function requestBody(fetchMock: FetchMock): Record<string, unknown> {
  const init = firstFetchCall(fetchMock)[1];
  expect(typeof init?.body).toBe("string");
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  process.env.BRAVE_SEARCH_API_KEY = "test-brave-search-key";
  process.env.BRAVE_ANSWERS_API_KEY = "test-brave-answers-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_ANSWERS_API_KEY;
});

describe("braveSearch", () => {
  test("uses the search subscription key", async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ web: { results: [] } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await braveSearch("example domain", { count: 1, country: "US" });

    const [url, init] = firstFetchCall(fetchMock);
    expect(String(url)).toContain("/web/search?");
    expect(init?.headers).toMatchObject({
      "X-Subscription-Token": "test-brave-search-key",
    });
  });
});

describe("braveAnswers", () => {
  test("uses the answers subscription key and streams research requests", async () => {
    const fetchMock = mock(async () =>
      new Response(
        [
          'data: {"id":"answer-1","model":"brave","choices":[{"delta":{"content":"Hello "}}]}',
          'data: {"choices":[{"delta":{"content":"world<citation>{\\"url\\":\\"https://example.com\\"}</citation><usage>{\\"cost\\":0.01}</usage>"}}]}',
          "data: [DONE]",
          "",
        ].join("\n"),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await braveAnswers("summarize example.com", {
      country: "US",
      language: "en",
      enableResearch: true,
      enableEntities: true,
    });

    const [, init] = firstFetchCall(fetchMock);
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "X-Subscription-Token": "test-brave-answers-key",
      },
    });
    expect(requestBody(fetchMock)).toEqual({
      model: "brave",
      stream: true,
      messages: [{ role: "user", content: "summarize example.com" }],
      country: "US",
      language: "en",
      enable_research: true,
      enable_entities: true,
    });
    expect(data.choices?.[0]?.message?.content).toBe("Hello world");
    expect(data.citations).toEqual(["https://example.com"]);
  });

  test("extracts citations and strips provider tags", () => {
    const tagged =
      'Answer <citation>{"number":1,"url":"https://example.com"}</citation>' +
      '<usage>{"X-Request-Total-Cost":0.01}</usage>' +
      '<thinking>{"debug":true}</thinking>';

    expect(extractBraveCitations(tagged)).toEqual(["https://example.com"]);
    expect(stripBraveAnswerTags(tagged)).toBe("Answer");
  });

  test("normalizes research-mode answer tags", async () => {
    const fetchMock = mock(async () =>
      new Response(
        [
          'data: {"id":"answer-1","model":"brave","choices":[{"delta":{"content":"<thinking>{\\"debug\\":true}</thinking>"}}]}',
          'data: {"choices":[{"delta":{"content":"<answer>{\\"answer\\":\\"example.com is a reserved documentation domain.\\"}</answer>"}}]}',
          "data: [DONE]",
          "",
        ].join("\n"),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await braveAnswers("summarize example.com", {
      enableResearch: true,
    });

    expect(data.choices?.[0]?.message?.content).toBe(
      "example.com is a reserved documentation domain.",
    );
  });

  test("rejects citations with research mode before making a request", async () => {
    const fetchMock = mock(async () => new Response("{}"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      braveAnswers("summarize example.com", {
        enableResearch: true,
        enableCitations: true,
      }),
    ).rejects.toThrow("research mode does not support enableCitations");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
