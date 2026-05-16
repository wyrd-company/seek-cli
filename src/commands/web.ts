import { Command } from "commander";
import { emit, emitText, renderSearchResults, renderCitations } from "../lib/output.ts";
import { parallelSearch } from "../providers/parallel.ts";
import { exaSearch } from "../providers/exa.ts";
import { braveSearch } from "../providers/brave.ts";
import { perplexitySearch } from "../providers/perplexity.ts";

export function registerWebCommand(program: Command): void {
  const web = program
    .command("web")
    .description("Real-time web search — fast, low-cost context for prompts and chatbots.");

  web
    .command("parallel")
    .description(
      "Best for AI agents. Returns dense, LLM-ready context snippets in a single call — no extra scrape step.",
    )
    .argument("<query...>", "Search query")
    .option("-n, --num <number>", "Max results", (v) => parseInt(v, 10), 10)
    .option("-c, --chars <number>", "Max chars per result excerpt", (v) => parseInt(v, 10), 1500)
    .option("--objective <text>", "Objective passed to the ranker (defaults to the query)")
    .option("--processor <name>", "Processor: base | pro", "base")
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await parallelSearch(query, {
        maxResults: opts.num,
        maxCharsPerResult: opts.chars,
        objective: opts.objective,
        processor: opts.processor,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      emitText(
        renderSearchResults(
          data.results.map((r) => ({
            title: r.title ?? undefined,
            url: r.url,
            content: (r.excerpts ?? []).join("\n\n"),
          })),
        ),
      );
    });

  web
    .command("exa")
    .description(
      "Best for conceptual queries. Neural semantic search — finds pages by meaning, not just keywords.",
    )
    .argument("<query...>", "Search query")
    .option("-n, --num <number>", "Number of results", (v) => parseInt(v, 10), 10)
    .option(
      "-t, --type <type>",
      "Search type: auto | fast | neural | instant | deep-lite | deep | deep-reasoning",
      "auto",
    )
    .option("--category <name>", "Restrict to a category (e.g. research paper, news, company, github)")
    .option("--text", "Include full page text snippets", false)
    .option("--start <date>", "Only pages published on/after this date (YYYY-MM-DD)")
    .option("--end <date>", "Only pages published on/before this date (YYYY-MM-DD)")
    .option(
      "--system <text>",
      "System prompt to bias the search (sources to prefer, novelty, etc.)",
    )
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await exaSearch(query, {
        numResults: opts.num,
        type: opts.type,
        category: opts.category,
        includeText: opts.text,
        startPublishedDate: opts.start,
        endPublishedDate: opts.end,
        systemPrompt: opts.system,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      emitText(
        renderSearchResults(
          data.results.map((r) => ({
            title: r.title ?? undefined,
            url: r.url,
            score: r.score,
            content: r.text ?? (r.highlights ?? []).join("\n…\n"),
          })),
        ),
      );
    });

  web
    .command("brave")
    .description(
      "Best for real-time consumer facts. Clean, structured snippets from an independent global web index.",
    )
    .argument("<query...>", "Search query")
    .option("-n, --num <number>", "Number of results", (v) => parseInt(v, 10), 10)
    .option("--country <cc>", "Two-letter country code (e.g. US, GB)")
    .option(
      "--fresh <window>",
      "Freshness window: pd (past day), pw (week), pm (month), py (year)",
    )
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await braveSearch(query, {
        count: opts.num,
        country: opts.country,
        freshness: opts.fresh,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const results = (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));
      emitText(renderSearchResults(results));
    });

  web
    .command("perplexity")
    .description(
      "Best for quick, human-readable summaries. Synthesizes the web into a short, conversational answer with citations.",
    )
    .argument("<query...>", "Question or query")
    .option("--model <name>", "Override model (default: sonar; sonar-pro, sonar-reasoning, etc. also work)")
    .option("--recency <window>", "Restrict sources by recency: hour | day | week | month")
    .option("--mode <mode>", "Search mode: web (default) | academic")
    .option(
      "--domains <list>",
      "Comma-separated allow-list of domains",
      (v: string) => v.split(",").map((d) => d.trim()).filter(Boolean),
    )
    .option("--max-tokens <n>", "Cap response tokens", (v) => parseInt(v, 10))
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await perplexitySearch(query, {
        model: opts.model,
        searchRecency: opts.recency,
        searchMode: opts.mode,
        searchDomainFilter: opts.domains,
        maxTokens: opts.maxTokens,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const text = data.choices?.[0]?.message?.content ?? "";
      emitText(text + renderCitations(data.citations));
    });
}
