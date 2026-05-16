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

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof MissingEnvError) {
    process.stderr.write(`error: ${err.message}\n`);
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
