import { Command } from "commander";
import skill from "../skills/seek/SKILL.md" with { type: "text" };
import packageMetadata from "../package.json" with { type: "json" };
import { registerWebCommand } from "./commands/web.ts";
import { registerResearchCommand } from "./commands/research.ts";
import { registerScrapeCommand } from "./commands/scrape.ts";
import { registerConfigCommand } from "./commands/config.ts";
import { registerServeCommand } from "./commands/serve.ts";

/**
 * Builds the seek command tree. These Commander declarations are the
 * authoritative definition of the command line; `src/index.ts` runs them.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("seek")
    .description(
      "Agent-friendly CLI for web search, deep research, and targeted scraping across popular APIs.",
    )
    .version(packageMetadata.version)
    .showHelpAfterError();

  program
    .command("skill")
    .description("Print the bundled Seek skill")
    .action(() => {
      process.stdout.write(skill);
    });

  registerWebCommand(program);
  registerResearchCommand(program);
  registerScrapeCommand(program);
  registerConfigCommand(program);
  registerServeCommand(program);

  return program;
}
