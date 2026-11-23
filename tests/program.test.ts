import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
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

describe("command-line.yml", () => {
  const spec = Bun.YAML.parse(readFileSync("docs/specifications/command-line.yml", "utf8")) as {
    description: string;
  };
  const tree = walk(createProgram()).filter(([path]) => path.length > 0);

  test("names every command in the tree, and only those", () => {
    const paragraph = spec.description.split("\n\n").find((p) => p.startsWith("The tree has"))!;
    const named = new Set([...paragraph.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((t) => !t.startsWith("-")));
    const paths = tree.map(([path]) => path);
    for (const path of paths) {
      const last = path.at(-1)!;
      const lastTwo = path.slice(-2).join(" ");
      expect(named.has(last) || named.has(lastTwo)).toBe(true);
    }
    for (const token of named) {
      expect(paths.some((path) => path.at(-1) === token || path.slice(-2).join(" ") === token)).toBe(true);
    }
  });

  test("every provider command takes --json", () => {
    const groups = new Set(["web", "research", "scrape"]);
    const leaves = tree.filter(([path, command]) => groups.has(path[0]!) && command.commands.length === 0);
    expect(leaves.length).toBe(14);
    for (const [, command] of leaves) {
      expect(command.options.some((option) => option.long === "--json")).toBe(true);
    }
  });
});
