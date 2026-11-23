import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { createProgram } from "../src/program.ts";

function walk(command: Command, path: string[] = []): Array<[string[], Command]> {
  return [
    [path, command],
    ...command.commands.flatMap((child) => walk(child, [...path, child.name()])),
  ];
}

function helpFromCli(path: string[]): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/index.ts", ...path, "--help"],
    cwd: process.cwd(),
    env: { ...process.env, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "seek-program-test-")) },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: new TextDecoder().decode(result.stdout) };
}

describe("createProgram", () => {
  test("is the command tree the CLI runs, command by command", () => {
    const commands = walk(createProgram());
    expect(commands.length).toBeGreaterThan(20);
    for (const [path, command] of commands) {
      // A piped CLI wraps help at 80 columns; match it whatever the test's terminal is.
      let help = "";
      command.configureOutput({ getOutHelpWidth: () => 80, writeOut: (text) => (help += text) });
      command.outputHelp();
      const cli = helpFromCli(path);
      expect(cli.exitCode).toBe(0);
      expect(cli.stdout).toBe(help);
    }
  }, 60_000);
});
