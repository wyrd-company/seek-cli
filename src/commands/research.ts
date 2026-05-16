import { Command } from "commander";
import { readFileSync } from "node:fs";
import { emit, emitText, renderCitations } from "../lib/output.ts";
import { parallelTaskRun } from "../providers/parallel.ts";
import {
  googleDeepResearch,
  extractReportText,
  extractCitations as extractGoogleCitations,
  summarizeProgress,
} from "../providers/google.ts";
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
      "Best for corporate and scientific intelligence. Runs the Gemini Deep Research agent — autonomous, multi-step web research that returns a full report with citations.",
    )
    .argument("<query...>", "Research question")
    .option(
      "--max",
      "Use deep-research-max-preview-04-2026 (slower, more comprehensive). Default is the faster preview agent.",
      false,
    )
    .option("--agent <name>", "Override the agent id explicitly")
    .option(
      "--system <text>",
      "Optional system instruction (e.g. \"act as an equity research analyst\")",
    )
    .option("--quiet", "Suppress polling progress on stderr", false)
    .option("--json", "Emit raw JSON interaction object")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const agent =
        opts.agent ??
        (opts.max ? "deep-research-max-preview-04-2026" : "deep-research-preview-04-2026");

      if (!opts.quiet) {
        process.stderr.write(`Starting Gemini Deep Research (${agent}) — this typically takes 5-20 minutes.\n`);
      }

      const interaction = await googleDeepResearch(query, {
        agent,
        systemInstruction: opts.system,
        onProgress: opts.quiet
          ? undefined
          : (i) => process.stderr.write(`  [${new Date().toISOString()}] ${summarizeProgress(i)}\n`),
      });

      if (interaction.status !== "completed") {
        process.stderr.write(
          `\nresearch ended with status=${interaction.status}` +
            (interaction.error?.message ? `: ${interaction.error.message}` : "") +
            "\n",
        );
        if (opts.json) emit(interaction, { json: true });
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        emit(interaction, { json: true });
        return;
      }
      const text = extractReportText(interaction);
      const citations = extractGoogleCitations(interaction);
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
