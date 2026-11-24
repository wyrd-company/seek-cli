/**
 * The configuration flags of a command, generated from the schemas: every
 * setting's flag and its aliases, each secret's `--<secret>-stdin`, and
 * `--config`, listed in help under `Configuration options` after the
 * command's own options.
 */
import { Command, Option } from "commander";
import { flagDefinitions, type FlagDefinition, type FlagValue } from "./config.ts";
import type { ConfigurationKind, Leaf } from "./settings.ts";

export const CONFIGURATION_GROUP = "Configuration options:";

const definitionsByCommand = new WeakMap<Command, Map<string, FlagDefinition[]>>();
const kindsByCommand = new WeakMap<Command, ConfigurationKind[]>();

/** The configurations a command reads: none, the client's, the server's, or either for `seek config`. */
export function configurationKinds(command: Command): ConfigurationKind[] {
  return kindsByCommand.get(command) ?? [];
}

function placeholder(leaf: Leaf): string {
  const last = leaf.path.at(-1)!;
  if (leaf.type === "array") return "<json>";
  if (leaf.type === "integer" || leaf.type === "number") return "<number>";
  if (last === "file" || last === "ca-cert") return "<path>";
  if (last === "url" || last === "address" || last === "proxy") return "<url>";
  if (last === "timeout") return "<duration>";
  return `<${last}>`;
}

function describe(definition: FlagDefinition): string {
  if (definition.stdin) return `Read ${definition.stdin} from standard input for this run`;
  const leaf = definition.leaf!;
  if (definition.alias) {
    const target = definition.negate ? leaf.flag!.replace(/^--/, "--no-") : leaf.flag!;
    return `Alias of ${target}`;
  }
  if (definition.negate) return `Set ${leaf.dotted} to false`;
  const env = [leaf.env, ...leaf.envAliases].join(", ");
  const extra = leaf.type === "array" ? " as a JSON array" : "";
  return `Set ${leaf.dotted}${extra} (env: ${env})`;
}

/** The option a definition declares; a value flag takes its placeholder, a boolean flag none. */
function option(definition: FlagDefinition): Option {
  const takesValue = definition.leaf !== undefined && definition.leaf.type !== "boolean";
  const term = takesValue ? `${definition.flag} ${placeholder(definition.leaf!)}` : definition.flag;
  return new Option(term, describe(definition)).helpGroup(CONFIGURATION_GROUP);
}

/**
 * Adds `--config` and the configuration flags of the given configurations to a
 * command. A command that only names a file, such as `seek config path`, takes
 * `--config` alone.
 */
export function addConfigurationOptions(command: Command, kinds: ConfigurationKind[], options: { settings?: boolean } = {}): Command {
  const byFlag = new Map<string, FlagDefinition>();
  if (options.settings !== false) {
    for (const kind of kinds) for (const definition of flagDefinitions(kind)) if (!byFlag.has(definition.flag)) byFlag.set(definition.flag, definition);
  }
  command.addOption(new Option("--config <path>", "Read this configuration file in place of the default files (env: SEEK_CONFIG)").helpGroup(CONFIGURATION_GROUP));
  const byAttribute = new Map<string, FlagDefinition[]>();
  for (const definition of byFlag.values()) {
    const declared = option(definition);
    command.addOption(declared);
    const attribute = declared.attributeName();
    byAttribute.set(attribute, [...(byAttribute.get(attribute) ?? []), definition]);
  }
  definitionsByCommand.set(command, byAttribute);
  kindsByCommand.set(command, kinds);
  return command;
}

/** The configuration flags a parsed command was given, and its `--config` path. */
export function configurationFlags(command: Command): { config?: string; flags: FlagValue[] } {
  const byAttribute = definitionsByCommand.get(command);
  const flags: FlagValue[] = [];
  if (!byAttribute) return { flags };
  for (const [attribute, definitions] of byAttribute) {
    if (command.getOptionValueSource(attribute) !== "cli") continue;
    const value = command.getOptionValue(attribute) as string | boolean;
    // A positive and a negated boolean flag share one attribute; the value says which was given.
    const definition = definitions.length === 1 ? definitions[0]! : definitions.find((d) => Boolean(d.negate) === (value === false))!;
    flags.push({ name: definition.flag, value });
  }
  const config = command.getOptionValueSource("config") === "cli" ? (command.getOptionValue("config") as string) : undefined;
  return { ...(config !== undefined ? { config } : {}), flags };
}
