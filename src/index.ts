#!/usr/bin/env bun
import type { Command } from "commander";
import { createProgram } from "./program.ts";
import { EXIT } from "./lib/exit-status.ts";
import { HttpError } from "./lib/http.ts";
import { MissingEnvError } from "./lib/env.ts";
import { KNOWN_KEYS, loadConfig } from "./lib/config.ts";
import { remoteServerUrl } from "./lib/upstreams.ts";

process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") process.stderr.write(`error: ${err.message}\n`);
  process.exit(EXIT.failure);
});

const program = createProgram();

let activeCommand: Command | null = null;
program.hook("preAction", (_thisCommand, actionCommand) => {
  activeCommand = actionCommand;
});

function providerHasKey(cmd: Command): boolean {
  const scopedName = cmd.parent ? `${cmd.parent.name()}:${cmd.name()}` : cmd.name();
  const entry = KNOWN_KEYS.find(([, p]) => p === scopedName) ??
    KNOWN_KEYS.find(([, p]) => p === cmd.name());
  if (!entry) return true;
  // A seek server holds the keys; assume every provider is available.
  if (remoteServerUrl() !== null) return true;
  const [envVar] = entry;
  if (process.env[envVar]) return true;
  return Boolean(loadConfig()[envVar]);
}

function printAlternatives(cmd: Command): void {
  const parent = cmd.parent;
  if (!parent) return;
  const siblings = parent.commands.filter(
    (c) => c.name() !== cmd.name() && c.name() !== "help",
  );
  if (siblings.length === 0) return;
  const ranked = siblings
    .map((s) => ({ cmd: s, configured: providerHasKey(s) }))
    .sort((a, b) => Number(b.configured) - Number(a.configured));
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
  if (err instanceof MissingEnvError) {
    process.stderr.write(`error: ${err.message}\n`);
    if (activeCommand) printAlternatives(activeCommand);
    process.exit(EXIT.missingProviderKey);
  }
  if (err instanceof HttpError) {
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
