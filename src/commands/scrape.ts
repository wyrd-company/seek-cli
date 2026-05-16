import { Command } from "commander";
import { emit, emitText } from "../lib/output.ts";
import { exaContents } from "../providers/exa.ts";
import { parallelExtract } from "../providers/parallel.ts";
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
      "Best for enterprise extract jobs. Hits Parallel's /v1/extract endpoint — returns clean markdown excerpts (and optional full content) plus publish dates per URL.",
    )
    .argument("<urls...>", "One or more URLs to extract")
    .option("--full", "Include full markdown content, not just excerpts", false)
    .option(
      "-c, --chars <n>",
      "Max characters per excerpt block",
      (v) => parseInt(v, 10),
    )
    .option(
      "--max-total <n>",
      "Max characters total across all URLs",
      (v) => parseInt(v, 10),
    )
    .option(
      "--max-age <seconds>",
      "Reuse cached content up to N seconds old (default: provider decides)",
      (v) => parseInt(v, 10),
    )
    .option("--json", "Emit raw JSON response")
    .action(async (urls: string[], opts) => {
      const data = await parallelExtract(urls, {
        fullContent: opts.full,
        maxCharsPerResult: opts.chars,
        maxCharsTotal: opts.maxTotal,
        fetchPolicy: opts.maxAge != null ? { max_age_seconds: opts.maxAge } : undefined,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const blocks = data.results.map((r) => {
        const header = `# ${r.title ?? r.url}\n${r.url}` +
          (r.publish_date ? `\npublished: ${r.publish_date}` : "");
        const body = r.full_content ?? (r.excerpts ?? []).join("\n\n…\n\n") ?? "(no content returned)";
        return `${header}\n\n${body}`;
      });
      const errors = data.errors.length
        ? "\n\nErrors:\n" + data.errors.map((e) => `  ${e.url}: ${e.error ?? "(unknown)"}`).join("\n")
        : "";
      emitText(blocks.join("\n\n---\n\n") + errors);
    });

  scrape
    .command("firecrawl")
    .description(
      "Turn any live URL into clean, structured Markdown, HTML, JSON, summary, or screenshot via Firecrawl v2.",
    )
    .argument("<url>", "URL to scrape")
    .option(
      "-f, --format <formats>",
      "Comma-separated formats: markdown,html,rawHtml,links,summary,screenshot,video,audio",
      "markdown",
    )
    .option(
      "--json-prompt <text>",
      "Add a JSON format with this LLM extraction prompt (produces data.json)",
    )
    .option("--full", "Include nav/footer/sidebars (disables onlyMainContent)", false)
    .option("--wait <ms>", "Wait N ms for JS to render before scraping", (v) => parseInt(v, 10))
    .option("--mobile", "Render as a mobile viewport", false)
    .option("--block-ads", "Block ads / trackers during render", false)
    .option(
      "--proxy <mode>",
      "Proxy mode: basic | stealth | enhanced | auto (for geo or anti-bot pages)",
    )
    .option(
      "--max-age <ms>",
      "Reuse cached scrape up to N ms old (cheaper, near-instant)",
      (v) => parseInt(v, 10),
    )
    .option("--json", "Emit raw JSON response")
    .action(async (url: string, opts) => {
      const formats = (opts.format as string)
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean) as Array<
        "markdown" | "html" | "rawHtml" | "links" | "summary" | "screenshot" | "video" | "audio"
      >;
      const formatOpts: Array<unknown> = [...formats];
      if (opts.jsonPrompt) {
        formatOpts.push({ type: "json", prompt: opts.jsonPrompt });
      }
      const data = await firecrawlScrape(url, {
        formats: formatOpts as never,
        onlyMainContent: !opts.full,
        waitFor: opts.wait,
        mobile: opts.mobile,
        blockAds: opts.blockAds,
        proxy: opts.proxy,
        maxAge: opts.maxAge,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      if (!data.success) {
        process.stderr.write(`Firecrawl error: ${data.error ?? "(unknown)"}\n`);
        process.exitCode = 1;
        return;
      }
      const d = data.data ?? {};
      if (d.markdown) emitText(d.markdown);
      else if (d.summary) emitText(d.summary);
      else if (d.html) emitText(d.html);
      else if (d.links) emitText(d.links.join("\n"));
      else if (d.json !== undefined) emitText(JSON.stringify(d.json, null, 2));
      else if (d.screenshot) emitText(d.screenshot);
      else emitText(JSON.stringify(d, null, 2));
    });
}
