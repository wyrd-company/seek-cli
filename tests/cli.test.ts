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

  test("web brave help documents search and answers subcommands", () => {
    const result = cli(["web", "brave", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("search [options] <query...>");
    expect(result.stdout).toContain("answers [options] <query...>");
  });

  test("web brave answers help documents answers-specific flags", () => {
    const result = cli(["web", "brave", "answers", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--citations");
    expect(result.stdout).toContain("--entities");
    expect(result.stdout).not.toContain("--research");
  });

  test("research brave help exposes deep research without a research toggle", () => {
    const result = cli(["research", "brave", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Brave Answers Deep Research");
    expect(result.stdout).toContain("--citations");
    expect(result.stdout).toContain("--entities");
    expect(result.stdout).not.toContain("--research");
    expect(result.stdout).toContain("synchronous");
    expect(result.stdout).not.toContain("\n  --async");
  });

  test("research google help documents interactive planning flags", () => {
    const result = cli(["research", "google", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--interactive");
    expect(result.stdout).toContain("--planner <provider>");
    expect(result.stdout).toContain("--async");
    expect(result.stdout).toContain(
      "Instruction incorporated into the Deep Research input",
    );
    expect(result.stdout).not.toContain("Optional system instruction");
  });

  test("research lifecycle help documents status, get, and async providers", () => {
    const root = cli(["research", "--help"]);
    const parallel = cli(["research", "parallel", "--help"]);
    const perplexity = cli(["research", "perplexity", "--help"]);

    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("status [options] <provider> <job-id>");
    expect(root.stdout).toContain("get [options] <provider> <job-id>");
    expect(parallel.stdout).toContain("--async");
    expect(perplexity.stdout).toContain("--async");
  });

  test("research lifecycle rejects unsupported providers before network access", () => {
    const brave = cli(["research", "status", "brave", "job-1"]);
    const unknown = cli(["research", "get", "unknown", "job-1", "--json"]);

    expect(brave.exitCode).toBe(1);
    expect(brave.stderr).toContain("Brave research is synchronous");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("Use: google, parallel, perplexity");
  });

  test("research lifecycle accepts opaque ids beginning with a hyphen", () => {
    const result = cli(["research", "status", "google", "--", "-opaque"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing API key for google");
    expect(result.stderr).not.toContain("unknown option");
  });

  test("google interactive planning runs before async submission", () => {
    const result = cli([
      "research",
      "google",
      "compare archival storage materials",
      "--interactive",
      "--planner",
      "manual",
      "--async",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--interactive requires a TTY");
    expect(result.stderr).not.toContain("Missing API key");
  });

  test("missing provider keys fail before a network request and suggest alternatives", () => {
    const result = cli(["web", "parallel", "hello"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing API key for parallel");
    expect(result.stderr).toContain("Other `seek web` providers you can try:");
    expect(result.stderr).toContain("seek web exa");
  });
});
