#!/usr/bin/env bun
import type { Command } from "commander";
import { createProgram } from "./program.ts";
import { EXIT } from "./lib/exit-status.ts";
import { HttpError } from "./lib/http.ts";
import { assertValid, ConfigurationError, loadConfiguration } from "./lib/config.ts";
import { configurationFlags, configurationKinds } from "./lib/options.ts";
import { SecretSourceError } from "./lib/secrets.ts";
import { clientContext, MissingProviderKeyError, useClientConfiguration, type UpstreamId } from "./lib/upstreams.ts";

process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") process.stderr.write(`error: ${err.message}\n`);
  process.exit(EXIT.failure);
});

const program = createProgram();

let activeCommand: Command | null = null;
program.hook("preAction", (_thisCommand, actionCommand) => {
  activeCommand = actionCommand;
  const kinds = configurationKinds(actionCommand);
  // Provider commands load the client configuration once, before their action runs.
  if (kinds.length === 1 && kinds[0] === "client") {
    useClientConfiguration(assertValid(loadConfiguration({ kind: "client", ...configurationFlags(actionCommand) })));
  }
});

/** The upstream whose key each provider command needs, keyed as `<parent>:<command>` or `<command>`. */
const KEYED_COMMANDS: ReadonlyArray<readonly [scope: string, upstream: UpstreamId]> = [
  ["parallel", "parallel"],
  ["exa", "exa"],
  ["web:brave", "brave-search"],
  ["research:brave", "brave-answers"],
  ["perplexity", "perplexity"],
  ["google", "google"],
  ["firecrawl", "firecrawl"],
];

function providerKey(cmd: Command): UpstreamId | undefined {
  const scopedName = cmd.parent ? `${cmd.parent.name()}:${cmd.name()}` : cmd.name();
  const entry = KEYED_COMMANDS.find(([scope]) => scope === scopedName) ??
    KEYED_COMMANDS.find(([scope]) => scope === cmd.name());
  return entry?.[1];
}

function providerHasKey(upstream: UpstreamId | undefined): boolean {
  if (upstream === undefined) return true;
  return clientContext().hasKey(upstream);
}

function printAlternatives(cmd: Command): void {
  const parent = cmd.parent;
  if (!parent) return;
  const ranked = parent.commands
    .filter((s) => s !== cmd && s.name() !== "help")
    .map((s) => ({ cmd: s, key: providerKey(s) }))
    .filter(({ key }) => parent.name() !== "research" || key !== undefined)
    .map(({ cmd, key }) => ({ cmd, configured: providerHasKey(key) }))
    .sort((a, b) => Number(b.configured) - Number(a.configured));
  if (ranked.length === 0) return;
  process.stderr.write(`\nOther \`seek ${parent.name()}\` providers you can try:\n`);
  const width = Math.max(...ranked.map((r) => r.cmd.name().length));
  for (const { cmd: s, configured } of ranked) {
    const pad = " ".repeat(width - s.name().length);
    const tag = configured ? "" : "  (no key set)";
    process.stderr.write(
      `  seek ${parent.name()} ${s.name()}${pad}  — ${s.description()}${tag}\n`,
    );
  }
}

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof MissingProviderKeyError) {
    process.stderr.write(`error: ${err.message}\n`);
    if (activeCommand) printAlternatives(activeCommand);
    process.exit(EXIT.missingProviderKey);
  }
  if (err instanceof ConfigurationError) {
    for (const line of err.errors) process.stderr.write(`error: ${line}\n`);
    process.exit(EXIT.failure);
  }
  if (err instanceof HttpError || err instanceof SecretSourceError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(EXIT.failure);
  }
  if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(EXIT.failure);
  }
  process.stderr.write(`error: ${String(err)}\n`);
  process.exit(EXIT.failure);
});
