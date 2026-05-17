import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_KEY_ENV_VARS = [
  "PARALLEL_API_KEY",
  "EXA_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "BRAVE_ANSWERS_API_KEY",
  "PERPLEXITY_API_KEY",
  "GEMINI_API_KEY",
  "FIRECRAWL_API_KEY",
];

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function cli(args: string[]): CliResult {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of API_KEY_ENV_VARS) env[key] = "";
  env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "seek-cli-test-"));

  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "src/index.ts", ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("CLI smoke tests", () => {
  test("scrape parallel help documents the objective flag", () => {
    const result = cli(["scrape", "parallel", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--objective <text>");
    expect(result.stdout).toContain("--max-age <seconds>");
  });

  test("research parallel help exposes json as an opt-in flag", () => {
    const result = cli(["research", "parallel", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--json");
    expect(result.stdout).not.toContain("(default: true)");
  });

  test("research brave help documents answers-specific flags", () => {
    const result = cli(["research", "brave", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--research");
    expect(result.stdout).toContain("--citations");
    expect(result.stdout).toContain("--entities");
  });

  test("research google help documents interactive planning flags", () => {
    const result = cli(["research", "google", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--interactive");
    expect(result.stdout).toContain("--planner <provider>");
  });

  test("missing provider keys fail before a network request and suggest alternatives", () => {
    const result = cli(["web", "parallel", "hello"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing API key for parallel");
    expect(result.stderr).toContain("Other `seek web` providers you can try:");
    expect(result.stderr).toContain("seek web exa");
  });
});
