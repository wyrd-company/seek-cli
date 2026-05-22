import { Command } from "commander";
import { emit, emitText, renderSearchResults, renderCitations } from "../lib/output.ts";
import { parallelSearch } from "../providers/parallel.ts";
import { exaSearch } from "../providers/exa.ts";
import { 
  braveSearch, 
  braveAnswers,
  extractBraveAnswerText,
  extractBraveCitations,
  stripBraveAnswerTags,
} from "../providers/brave.ts";
import { perplexitySearch } from "../providers/perplexity.ts";

export function registerWebCommand(program: Command): void {
  const web = program
    .command("web")
    .description("Real-time web search — fast, low-cost context for prompts and chatbots.");

  web
    .command("parallel")
    .description(
      "Parallel returns relevant excerpts optimized for LLMs, replacing multiple keyword searches with a single call for broad or complex queries.",
    )
    .argument("<query...>", "Search query")
    .option("-n, --num <number>", "Max results", (v) => parseInt(v, 10), 10)
    .option("-c, --chars <number>", "Max chars per result excerpt", (v) => parseInt(v, 10), 1500)
    .option("--objective <text>", "Objective passed to the ranker (defaults to the query)")
    .option("--mode <name>", "Search mode: basic | advanced")
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await parallelSearch(query, {
        maxResults: opts.num,
        maxCharsPerResult: opts.chars,
        objective: opts.objective,
        mode: opts.mode,
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

  const brave = 
    web
    .command("brave")
    .description(
      "Best for real-time consumer facts. Clean, structured snippets from an independent global web index.",
    );

  brave
    .command("search")
    .description("Search from a large index of web pages with optional local and rich data enrichments, with results intended for human consumption.")
    .copyInheritedSettings(brave)
    .argument("<query...>", "Search query")
    .option("-n, --num <number>", "Number of results", (v) => parseInt(v, 10), 10)
    .option(
      "--fresh <window>",
      "Freshness window: pd (past day), pw (week), pm (month), py (year)",
    )
    .option("--country <cc>", "Two-letter country code (e.g. US, GB)")
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

  brave
    .command("answers")
    .description("Brave Answers provides state-of-the-art AI-generated answers backed by verifiable sources from the web. ")
    .copyInheritedSettings(brave)
    .argument("<query...>", "Answers query")
    .option("--language <code>", "Response language (default: en)")
    .option("--citations", "Request provider citation tags", false)
    .option("--entities", "Request provider entity tags", false)
    .option("--country <cc>", "Two-letter country code (e.g. US, GB)")
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await braveAnswers(query, {
        country: opts.country,
        language: opts.language,
        enableResearch: false,
        enableCitations: opts.citations,
        enableEntities: opts.entities,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const text = extractBraveAnswerText(data);
      const citations = Array.isArray(data.citations)
        ? (data.citations as string[])
        : extractBraveCitations(text);
      emitText(stripBraveAnswerTags(text) + renderCitations(citations));
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
