import { Command } from "commander";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { emit, emitText, renderCitations } from "../lib/output.ts";
import { parallelTaskRun } from "../providers/parallel.ts";
import {
  googleDeepResearch,
  DEFAULT_DEEP_RESEARCH_AGENT,
  extractReportText,
  extractCitations as extractGoogleCitations,
  summarizeProgress,
} from "../providers/google.ts";
import {
  braveAnswers,
  extractBraveAnswerText,
  extractBraveCitations,
  stripBraveAnswerTags,
} from "../providers/brave.ts";
import { perplexityDeepResearch, perplexitySearch } from "../providers/perplexity.ts";

type PlannerProvider = "perplexity" | "brave" | "manual";

interface PlanSession {
  plan: string;
  finalPrompt: string;
}

export function registerResearchCommand(program: Command): void {
  const research = program
    .command("research")
    .description(
      "Autonomous deep research — multi-step investigation that browses, verifies, and compiles reports.",
    );

  research
    .command("brave")
    .description(
      "Best for grounded answer generation. Uses Brave Answers with optional multi-search research mode.",
    )
    .argument("<query...>", "Research question")
    .option("--country <cc>", "Two-letter country code for grounding (default: us)")
    .option("--language <code>", "Response language (default: en)")
    .option("--research", "Enable multi-search research mode", false)
    .option("--citations", "Request provider citation tags", false)
    .option("--entities", "Request provider entity tags", false)
    .option("--json", "Emit raw JSON response")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const data = await braveAnswers(query, {
        country: opts.country,
        language: opts.language,
        enableResearch: opts.research,
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
    .option("--json", "Emit raw JSON response")
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
      if (opts.json) {
        emit(data, { json: true });
        return;
      }
      const content =
        typeof data.output.content === "string"
          ? data.output.content
          : JSON.stringify(data.output.content, null, 2);
      const citations = (data.output.basis ?? [])
        .flatMap((b) => (b.citations ?? []).map((c) => c.url))
        .filter((v, i, a) => a.indexOf(v) === i);
      emitText(content + renderCitations(citations));
    });

  research
    .command("google")
    .description(
      "Best for corporate and scientific intelligence. Runs the Gemini Deep Research agent — autonomous, multi-step web research that returns a full report with citations.",
    )
    .argument("<query...>", "Research question")
    .option("--agent <name>", `Override the agent id (default: ${DEFAULT_DEEP_RESEARCH_AGENT})`)
    .option(
      "--system <text>",
      "Optional system instruction (e.g. \"act as an equity research analyst\")",
    )
    .option("--interactive", "Review and approve a research plan before starting Deep Research", false)
    .option("--planner <provider>", "Planner for --interactive: perplexity | brave | manual", "perplexity")
    .option("--quiet", "Suppress polling progress on stderr", false)
    .option("--json", "Emit raw JSON interaction object")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");
      const agent = opts.agent ?? DEFAULT_DEEP_RESEARCH_AGENT;
      const finalPrompt = opts.interactive
        ? (await runPlanApproval(query, opts.planner)).finalPrompt
        : query;

      if (!opts.quiet) {
        process.stderr.write(`Starting Gemini Deep Research (${agent}) — this typically takes 5-20 minutes.\n`);
      }

      const interaction = await googleDeepResearch(finalPrompt, {
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
      "Best for deep consumer or market briefings. Runs Sonar Deep Research as an async job (sync calls time out) and polls until the polished, inline-cited report is ready.",
    )
    .argument("<query...>", "Research question")
    .option("--model <name>", "Override model (default: sonar-deep-research)")
    .option(
      "--effort <level>",
      "Reasoning effort: low | medium | high",
      "medium",
    )
    .option("--quiet", "Suppress polling progress on stderr", false)
    .option("--json", "Emit raw JSON async job object")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");

      if (!opts.quiet) {
        process.stderr.write("Starting Perplexity Sonar Deep Research (async).\n");
      }

      const job = await perplexityDeepResearch(query, {
        model: opts.model,
        reasoningEffort: opts.effort,
        onProgress: opts.quiet
          ? undefined
          : (j) =>
              process.stderr.write(
                `  [${new Date().toISOString()}] status=${j.status}\n`,
              ),
      });

      if (job.status !== "COMPLETED") {
        process.stderr.write(
          `\nresearch ended with status=${job.status}` +
            (job.error_message ? `: ${job.error_message}` : "") +
            "\n",
        );
        if (opts.json) emit(job, { json: true });
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        emit(job, { json: true });
        return;
      }
      const text = job.response?.choices?.[0]?.message?.content ?? "";
      emitText(text + renderCitations(job.response?.citations));
    });
}

async function runPlanApproval(
  query: string,
  planner: string,
): Promise<PlanSession> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("--interactive requires a TTY.");
  }
  const provider = parsePlanner(planner);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let plan = await createPlan(query, provider);
    while (true) {
      process.stdout.write("\nProposed research plan:\n\n");
      process.stdout.write(plan.trim() + "\n\n");
      const action = (await rl.question("Approve, revise, or quit? [a/r/q] ")).trim().toLowerCase();
      if (action === "" || action === "a" || action === "approve") {
        return {
          plan,
          finalPrompt: buildPlannedResearchPrompt(query, plan),
        };
      }
      if (action === "q" || action === "quit") {
        throw new Error("Research cancelled before Deep Research started.");
      }
      if (action === "r" || action === "revise") {
        const revision = await rl.question("Revision instructions: ");
        plan = await revisePlan(query, plan, revision, provider);
        continue;
      }
      process.stdout.write("Please enter a, r, or q.\n");
    }
  } finally {
    rl.close();
  }
}

function parsePlanner(value: string): PlannerProvider {
  if (value === "perplexity" || value === "brave" || value === "manual") return value;
  throw new Error(`Unknown planner '${value}'. Use: perplexity, brave, or manual.`);
}

async function createPlan(query: string, provider: PlannerProvider): Promise<string> {
  if (provider === "manual") {
    return "1. Clarify the research objective and scope.\n2. Identify authoritative sources.\n3. Compare findings across sources.\n4. Produce a cited report with uncertainties and open questions.";
  }
  const prompt = planPrompt(query);
  if (provider === "brave") {
    const response = await braveAnswers(prompt, { enableResearch: true });
    return extractBraveAnswerText(response);
  }
  const response = await perplexitySearch(prompt, {
    model: "sonar",
    maxTokens: 900,
  });
  return response.choices?.[0]?.message.content ?? "";
}

async function revisePlan(
  query: string,
  currentPlan: string,
  revision: string,
  provider: PlannerProvider,
): Promise<string> {
  if (provider === "manual") {
    return currentPlan.trim() + `\n\nRevision note: ${revision.trim()}`;
  }
  const prompt =
    planPrompt(query) +
    "\n\nCurrent plan:\n" +
    currentPlan +
    "\n\nRevise the plan using this feedback:\n" +
    revision;
  if (provider === "brave") {
    const response = await braveAnswers(prompt, { enableResearch: true });
    return extractBraveAnswerText(response);
  }
  const response = await perplexitySearch(prompt, {
    model: "sonar",
    maxTokens: 900,
  });
  return response.choices?.[0]?.message.content ?? currentPlan;
}

function planPrompt(query: string): string {
  return [
    "Create a concise research plan for a deep research agent.",
    "Do not answer the research question yet.",
    "Return 4-7 numbered steps, including source strategy, verification approach, and expected report structure.",
    "Keep the plan actionable and compact.",
    "",
    `Research question: ${query}`,
  ].join("\n");
}

function buildPlannedResearchPrompt(query: string, plan: string): string {
  return [
    query,
    "",
    "Use this approved research plan. Follow it unless the evidence strongly suggests a better route, and call out any meaningful deviations in the final report.",
    "",
    plan,
  ].join("\n");
}
