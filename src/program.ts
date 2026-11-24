import { Command, Help } from "commander";
import skill from "../skills/seek/SKILL.md" with { type: "text" };
import packageMetadata from "../package.json" with { type: "json" };
import { registerWebCommand } from "./commands/web.ts";
import { registerResearchCommand } from "./commands/research.ts";
import { registerScrapeCommand } from "./commands/scrape.ts";
import { registerConfigCommand } from "./commands/config.ts";
import { registerServeCommand } from "./commands/serve.ts";
import { addConfigurationOptions, CONFIGURATION_GROUP } from "./lib/options.ts";

/**
 * Help layout: descriptions align after the command's own terms, as Commander
 * lays them out, and a longer term, such as a configuration flag, prints its
 * description on the next line.
 */
const HELP_LAYOUT: Partial<Help> = {
  padWidth(cmd: Command, helper: Help): number {
    const terms = [
      ...helper.visibleOptions(cmd).filter((o) => o.helpGroupHeading !== CONFIGURATION_GROUP).map((o) => helper.optionTerm(o)),
      ...helper.visibleGlobalOptions(cmd).map((o) => helper.optionTerm(o)),
      ...helper.visibleArguments(cmd).map((a) => helper.argumentTerm(a)),
      ...helper.visibleCommands(cmd).map((c) => helper.subcommandTerm(c)),
    ];
    return Math.max(0, ...terms.map((t) => helper.displayWidth(t)));
  },
  formatItem(term: string, termWidth: number, description: string, helper: Help): string {
    if (!description || helper.displayWidth(term) <= termWidth) return Help.prototype.formatItem.call(helper, term, termWidth, description, helper);
    const indent = "      ";
    const wrapped = helper.boxWrap(description, (helper.helpWidth ?? 80) - indent.length);
    return `  ${term}\n${indent}${wrapped.replace(/\n/g, `\n${indent}`)}`;
  },
};

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
    .showHelpAfterError()
    .configureHelp(HELP_LAYOUT);

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

  // Configuration flags follow each command's own options, so they are added last.
  const leaves = (command: Command): Command[] =>
    command.commands.length === 0 ? [command] : command.commands.flatMap(leaves);
  for (const group of program.commands) {
    if (["web", "research", "scrape"].includes(group.name())) for (const leaf of leaves(group)) addConfigurationOptions(leaf, ["client"]);
    if (group.name() === "serve") addConfigurationOptions(group, ["server"]);
    if (group.name() === "config") {
      for (const leaf of group.commands) {
        addConfigurationOptions(leaf, ["client", "server"], { settings: ["show", "validate"].includes(leaf.name()) });
      }
    }
  }

  return program;
}
