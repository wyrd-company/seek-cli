import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { createProgram } from "../src/program.ts";
import { EXIT, EXIT_STATUSES } from "../src/lib/exit-status.ts";

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
    const paragraph = spec.description.split("\n\n").find((p) => p.startsWith("The root commands are"));
    if (!paragraph) throw new Error("The command-line specification is missing its command tree paragraph");
    const names = (list: string) => [...list.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
    const [root] = paragraph.split(".");
    const documentedPaths = names(root!);
    for (const [, parent, children] of paragraph.matchAll(/Under `([^`]+)` are ([^.]+)\./g)) {
      documentedPaths.push(...names(children!).map((name) => `${parent} ${name}`));
    }
    expect(documentedPaths.sort()).toEqual(tree.map(([path]) => path.join(" ")).sort());
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

describe("EXIT_STATUSES", () => {
  test("is the only source of the codes seek exits with", () => {
    const literal = /process\.exit\(\s*\d|process\.exitCode\s*=\s*\d/;
    const files = new Bun.Glob("src/**/*.ts").scanSync(".");
    const offenders = [...files].filter((file) => literal.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    expect(new Set(EXIT_STATUSES.map((s) => s.code)).size).toBe(EXIT_STATUSES.length);
  });

  test("names the codes the CLI exits with", () => {
    const run = (args: string[]) =>
      Bun.spawnSync({
        cmd: [process.execPath, "run", "src/index.ts", ...args],
        cwd: process.cwd(),
        env: {
          ...process.env,
          XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "seek-exit-test-")),
          SEEK_SERVER_URL: "",
          PARALLEL_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      }).exitCode;
    expect(run(["--version"])).toBe(EXIT.success);
    expect(run(["web", "nope"])).toBe(EXIT.failure);
    expect(run(["web", "parallel", "synthetic query"])).toBe(EXIT.missingProviderKey);
  });
});
