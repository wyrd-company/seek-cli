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

function providerKey(cmd: Command): string | undefined {
  const scopedName = cmd.parent ? `${cmd.parent.name()}:${cmd.name()}` : cmd.name();
  const entry = KNOWN_KEYS.find(([, p]) => p === scopedName) ??
    KNOWN_KEYS.find(([, p]) => p === cmd.name());
  return entry?.[0];
}

function providerHasKey(envVar: string | undefined): boolean {
  if (envVar === undefined) return true;
  // A seek server holds the keys; assume every provider is available.
  if (remoteServerUrl() !== null) return true;
  if (process.env[envVar]) return true;
  return Boolean(loadConfig()[envVar]);
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
