#!/usr/bin/env bun
import { Command } from "commander";
import { registerWebCommand } from "./commands/web.ts";
import { registerResearchCommand } from "./commands/research.ts";
import { registerScrapeCommand } from "./commands/scrape.ts";
import { HttpError } from "./lib/http.ts";
import { MissingEnvError } from "./lib/env.ts";

const program = new Command();

program
  .name("seek")
  .description(
    "Agent-friendly CLI for web search, deep research, and targeted scraping across popular APIs.",
  )
  .version("0.1.0")
  .showHelpAfterError();

registerWebCommand(program);
registerResearchCommand(program);
registerScrapeCommand(program);

let activeCommand: Command | null = null;
program.hook("preAction", (_thisCommand, actionCommand) => {
  activeCommand = actionCommand;
});

function printAlternatives(cmd: Command): void {
  const parent = cmd.parent;
  if (!parent) return;
  const siblings = parent.commands.filter(
    (c) => c.name() !== cmd.name() && c.name() !== "help",
  );
  if (siblings.length === 0) return;
  process.stderr.write(`\nOther \`seek ${parent.name()}\` providers you can try:\n`);
  const width = Math.max(...siblings.map((s) => s.name().length));
  for (const s of siblings) {
    const pad = " ".repeat(width - s.name().length);
    process.stderr.write(
      `  seek ${parent.name()} ${s.name()}${pad}  — ${s.description()}\n`,
    );
  }
}

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof MissingEnvError) {
    process.stderr.write(`error: ${err.message}\n`);
    if (activeCommand) printAlternatives(activeCommand);
    process.exit(2);
  }
  if (err instanceof HttpError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
  if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`error: ${String(err)}\n`);
  process.exit(1);
});
