import { Command } from "commander";
import { readFileSync } from "node:fs";
import { emit, emitText, renderCitations } from "../lib/output.ts";
import { parallelTaskRun } from "../providers/parallel.ts";
import { googleResearch, extractText, extractCitations } from "../providers/google.ts";
import { perplexityDeepResearch } from "../providers/perplexity.ts";

export function registerResearchCommand(program: Command): void {
  const research = program
    .command("research")
    .description(
      "Autonomous deep research — multi-step investigation that browses, verifies, and compiles reports.",
    );

  research
    .command("parallel")
    .description(
      "Best for data ops and B2B workflows. Maps deep research into a strict JSON schema with full source tracking.",
    )
    .argument("<query...>", "Research question or objective")
    .option(
      "--schema <path>",
      "Path to a JSON file describing the desired output schema (object with properties).",
    )
    .option(
      "--processor <name>",
      "Processor depth: lite | base | core | pro | ultra",
      "core",
    )
    .option("--json", "Emit raw JSON response", true)
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      let schema: Record<string, unknown> | undefined;
      if (opts.schema) {
        const raw = readFileSync(opts.schema, "utf8");
        schema = JSON.parse(raw);
      }
      const data = await parallelTaskRun(query, {
        processor: opts.processor,
        schema,
      });
      if (opts.json !== false) {
        emit(data, { json: true });
        return;
      }
      const content =
        typeof data.output.content === "string"
          ? data.output.content
          : JSON.stringify(data.output.content, null, 2);
      const citations = (data.output.basis ?? [])
        .flatMap((b) => b.citations.map((c) => c.url))
        .filter((v, i, a) => a.indexOf(v) === i);
      emitText(content + renderCitations(citations));
    });

  research
    .command("google")
    .description(
      "Best for corporate and scientific intelligence. Long-horizon, multi-source research grounded in Google Search.",
    )
    .argument("<query...>", "Research question")
    .option("--model <name>", "Gemini model id (default: gemini-2.5-pro)")
    .option(
      "--system <text>",
      "Optional system prompt — e.g. \"act as an equity research analyst\"",
    )
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await googleResearch(query, {
        model: opts.model,
        systemPrompt: opts.system,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const text = extractText(data);
      const citations = extractCitations(data);
      emitText(text + renderCitations(citations));
    });

  research
    .command("perplexity")
    .description(
      "Best for deep consumer or market briefings. Polished, long-form, inline-cited text reports.",
    )
    .argument("<query...>", "Research question")
    .option("--model <name>", "Override model (default: sonar-deep-research)")
    .option(
      "--effort <level>",
      "Reasoning effort: low | medium | high",
      "medium",
    )
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await perplexityDeepResearch(query, {
        model: opts.model,
        reasoningEffort: opts.effort,
      });
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const text = data.choices?.[0]?.message?.content ?? "";
      emitText(text + renderCitations(data.citations));
    });
}
