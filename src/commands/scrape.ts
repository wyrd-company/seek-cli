import { Command } from "commander";
import { emit, emitText } from "../lib/output.ts";
import { exaContents } from "../providers/exa.ts";
import { parallelScrape } from "../providers/parallel.ts";
import { firecrawlScrape } from "../providers/firecrawl.ts";

export function registerScrapeCommand(program: Command): void {
  const scrape = program
    .command("scrape")
    .description("Targeted page extraction — clean text, markdown, or JSON from a known URL.");

  scrape
    .command("exa")
    .description(
      "Best for instant, bulk parsing. Retrieves clean, stripped page text optimized for LLM token windows.",
    )
    .argument("<urls...>", "One or more URLs to fetch")
    .option(
      "-c, --chars <n>",
      "Max characters per page",
      (v) => parseInt(v, 10),
      50_000,
    )
    .option("--json", "Emit raw JSON response")
    .action(async (urls: string[], opts) => {
      const data = await exaContents(urls, { maxCharacters: opts.chars });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const blocks = data.results.map((r) => {
        const header = `# ${r.title ?? r.url}\n${r.url}\n`;
        return header + "\n" + (r.text ?? "(no text returned)");
      });
      emitText(blocks.join("\n\n---\n\n"));
    });

  scrape
    .command("parallel")
    .description(
      "Best for gated or enterprise data. Intelligent web agent that can navigate logins and paywalls.",
    )
    .argument("<url>", "URL to extract")
    .option(
      "--objective <text>",
      "Custom extraction objective (default: full page text as Markdown)",
    )
    .option("--json", "Emit raw JSON response")
    .action(async (url: string, opts) => {
      const data = await parallelScrape(url, { objective: opts.objective });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const content =
        typeof data.output.content === "string"
          ? data.output.content
          : JSON.stringify(data.output.content, null, 2);
      emitText(content);
    });

  scrape
    .command("firecrawl")
    .description(
      "Turn any live URL into clean, structured Markdown or JSON.",
    )
    .argument("<url>", "URL to scrape")
    .option(
      "-f, --format <formats>",
      "Comma-separated formats: markdown,html,rawHtml,links",
      "markdown",
    )
    .option("--full", "Include nav/footer/sidebars (disables onlyMainContent)", false)
    .option("--wait <ms>", "Wait N ms for JS to render before scraping", (v) => parseInt(v, 10))
    .option("--json", "Emit raw JSON response")
    .action(async (url: string, opts) => {
      const formats = (opts.format as string).split(",").map((f) => f.trim()) as Array<
        "markdown" | "html" | "rawHtml" | "links"
      >;
      const data = await firecrawlScrape(url, {
        formats,
        onlyMainContent: !opts.full,
        waitFor: opts.wait,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      if (!data.success) {
        emitText(`Firecrawl error: ${data.error ?? "(unknown)"}`);
        process.exitCode = 1;
        return;
      }
      const d = data.data ?? {};
      if (d.markdown) emitText(d.markdown);
      else if (d.html) emitText(d.html);
      else if (d.links) emitText(d.links.join("\n"));
      else emitText(JSON.stringify(d, null, 2));
    });
}
