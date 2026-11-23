import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UPSTREAMS, type UpstreamId, type UpstreamSpec } from "../src/lib/upstreams.ts";
import { SecretResolver } from "../src/server/secrets.ts";
import { startServer } from "../src/server/server.ts";
import { compileDefinitions, EXAMPLES, validateExample } from "../scripts/docs/validate.ts";
import { createProgram } from "../src/program.ts";
import type { Command } from "commander";
import { createPracticeServer, practiceResponse, practiceState } from "../docs/user/examples/practice-server.mjs";

// The published walkthroughs, run as written against the practice server and
// the real seek server, and the documentation check's guards, each broken on
// purpose in a copy of the repository.

const ROOT = join(import.meta.dir, "..");
const QUERY = "how do honeybees make honey";

function page(name: string): string {
  return readFileSync(join(ROOT, "docs/user", name), "utf8");
}

/** The fenced blocks of a page, with their language; a block indented in a list loses its indent. */
function blocks(markdown: string): Array<{ language: string; content: string }> {
  return [...markdown.matchAll(/^( *)```(\w*)\n([\s\S]*?)\n\1```$/gm)].map((m) => ({
    language: m[2]!,
    content: m[3]!
      .split("\n")
      .map((line) => line.slice(m[1]!.length))
      .join("\n"),
  }));
}

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without blocking this process, which may be serving the request. */
async function run(cmd: string[], options: { cwd?: string; env: Record<string, string> }): Promise<Run> {
  const child = Bun.spawn({ cmd, cwd: options.cwd ?? ROOT, env: options.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, stderr };
}

/** Asserts that the page shows `command` in a sh block and `output` in a block of its own. */
function expectPageShows(name: string, command: string | null, output: string): void {
  const shown = blocks(page(name));
  if (command !== null) {
    expect(shown.some((b) => b.language === "sh" && b.content.split("\n").includes(command)), `${name} shows \`${command}\``).toBe(true);
  }
  const trimmed = output.replace(/\n+$/, "");
  const found = shown.some((b) => b.language !== "sh" && b.content === trimmed);
  if (!found) throw new Error(`${name} does not show this output of ${command ?? "the step"}:\n${trimmed}`);
}

/** Splits a command line written in a page: words, and double-quoted words. */
function words(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "seek-docs-home-"));
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, LANG: "C.UTF-8", ...extra };
}

function seek(command: string, env: Record<string, string>): Promise<Run> {
  const [name, ...args] = words(command);
  expect(name).toBe("seek");
  return run([process.execPath, "run", join(ROOT, "src/index.ts"), ...args], { env });
}

interface Practice {
  url: string;
  close(): void;
}

async function startPractice(): Promise<Practice> {
  const server = createPracticeServer({ log: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** A real seek server whose upstreams are the practice server's synthetic provider answers. */
function startRealServer(): { url: string; close(): void } {
  const state = practiceState();
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const [, provider = "", ...rest] = url.pathname.split("/");
      const text = await req.text();
      const answer = practiceResponse(state, req.method, provider, `/${rest.join("/")}`, text ? JSON.parse(text) : {});
      return Response.json(answer.body, { status: answer.status });
    },
  });
  const upstreams = Object.fromEntries(
    Object.values(UPSTREAMS).map((spec) => [spec.id, { ...spec, baseUrl: `http://127.0.0.1:${upstream.port}/${spec.id}` }]),
  ) as Record<UpstreamId, UpstreamSpec>;
  const server = startServer({
    hostname: "127.0.0.1",
    port: 0,
    secrets: new SecretResolver(null, { SEEK_SERVER_TOKEN: "practice-token", EXA_API_KEY: "exa-synthetic-key", PARALLEL_API_KEY: "parallel-synthetic-key" }, () => ({})),
    upstreams,
    log: () => {},
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    close: () => {
      server.stop(true);
      upstream.stop(true);
    },
  };
}

describe("Run your first search", () => {
  test("the practice server starts as the page shows", async () => {
    const started = Bun.spawn({
      cmd: [process.execPath, "docs/user/examples/practice-server.mjs"],
      cwd: ROOT,
      env: { ...cleanEnv(), PORT: "0" },
      stdout: "pipe",
    });
    const reader = started.stdout.getReader();
    let text = "";
    while (!text.includes("client token")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    started.kill();
    const shown = text.replace(/127\.0\.0\.1:\d+/, "127.0.0.1:8788");
    expectPageShows("first-search.md", "node practice-server.mjs", shown);
    expectPageShows("server-client.md", "node practice-server.mjs", shown);
  });

  for (const target of ["the practice server", "a real seek server"] as const) {
    test(`each search prints what the page shows, through ${target}`, async () => {
      const server = target === "the practice server" ? await startPractice() : startRealServer();
      try {
        const env = cleanEnv({ SEEK_SERVER_URL: server.url, SEEK_SERVER_TOKEN: "practice-token" });
        for (const command of [`seek web parallel "${QUERY}"`, `seek web parallel "${QUERY}" -n 1 --json`]) {
          const step = await seek(command, env);
          expect(step.exitCode).toBe(0);
          expectPageShows("first-search.md", command, step.stdout);
        }
      } finally {
        server.close();
      }
    });
  }
});

describe("Run a research job", () => {
  test("submission, two status lookups and the result print what the page shows", async () => {
    const server = await startPractice();
    try {
      const env = cleanEnv({ SEEK_SERVER_URL: server.url, SEEK_SERVER_TOKEN: "practice-token" });
      const steps: Array<[string, number]> = [
        [`seek research parallel "${QUERY}" --async`, 0],
        ["seek research status parallel -- trun_practice_1", 0],
        ["seek research status parallel -- trun_practice_1", 0],
        ["seek research get parallel -- trun_practice_1", 0],
      ];
      for (const [command, exitCode] of steps) {
        const step = await seek(command, env);
        expect(step.exitCode).toBe(exitCode);
        expectPageShows("research.md", command, step.stdout);
      }
    } finally {
      server.close();
    }
  });

  test("the envelope examples are what seek prints", async () => {
    const server = await startPractice();
    try {
      const env = cleanEnv({ SEEK_SERVER_URL: server.url, SEEK_SERVER_TOKEN: "practice-token" });
      const submitted = await seek(`seek research parallel "${QUERY}" --async --json`, env);
      expect(submitted.stdout).toBe(page("examples/research-job-submitted.json"));
      const early = await seek("seek research get --json parallel -- trun_practice_1", env);
      expect(early.exitCode).toBe(1);
      expect(JSON.parse(early.stdout).status).toBe("running");
      const result = await seek("seek research get --json parallel -- trun_practice_1", env);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(page("examples/research-job-result.json"));
    } finally {
      server.close();
    }
  });
});

describe("Track a research job from a script", () => {
  test("the page's script, run with bash and jq, prints what the page shows", async () => {
    expect(Bun.which("jq"), "jq is required to run this documentation test").not.toBeNull();
    const server = await startPractice();
    const bin = mkdtempSync(join(tmpdir(), "seek-docs-bin-"));
    writeFileSync(join(bin, "seek"), `#!/bin/sh\nexec "${process.execPath}" run "${join(ROOT, "src/index.ts")}" "$@"\n`, { mode: 0o755 });
    // The script waits 30 seconds between lookups; the test does not.
    writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    try {
      const script = blocks(page("script-research-jobs.md"))
        .filter((b) => b.language === "sh")
        .map((b) => b.content)
        .join("\n");
      const env = cleanEnv({ SEEK_SERVER_URL: server.url, SEEK_SERVER_TOKEN: "practice-token" });
      const step = await run(["bash", "-euo", "pipefail", "-c", script], { env: { ...env, PATH: `${bin}:${env.PATH}` } });
      expect(step.stderr).toBe("");
      expect(step.exitCode).toBe(0);
      expectPageShows("script-research-jobs.md", null, step.stdout);
    } finally {
      server.close();
      rmSync(bin, { recursive: true, force: true });
    }
  });

  test("the polling example stops on a request failure and bounds a pending job", async () => {
    const poll = blocks(page("script-research-jobs.md"))
      .find((block) => block.language === "sh" && block.content.includes("seek research status"))!.content;
    const env = cleanEnv();
    const failed = await run(["bash", "-c", `
      seek() { echo "synthetic request failure" >&2; return 1; }
      sleep() { echo "unexpected retry" >&2; exit 99; }
      provider=parallel job_id=trun_practice_1
      ${poll}
    `], { env });
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr.trim()).toBe("synthetic request failure");

    const pending = await run(["bash", "-c", `
      seek() { printf '%s\\n' '{"terminal":false}'; }
      sleep() { :; }
      provider=parallel job_id=trun_practice_1
      ${poll}
    `], { env });
    expect(pending.exitCode).toBe(1);
    expect(pending.stderr.trim()).toBe("Job has no final status after 20 checks.");
  });
});

describe("Extract the content of a page", () => {
  test("seek scrape exa prints what the page shows", async () => {
    const server = await startPractice();
    try {
      const command = "seek scrape exa https://example.com/honey";
      const step = await seek(command, cleanEnv({ SEEK_SERVER_URL: server.url, SEEK_SERVER_TOKEN: "practice-token" }));
      expect(step.exitCode).toBe(0);
      expectPageShows("scrape.md", command, step.stdout);
    } finally {
      server.close();
    }
  });
});

describe("Call a seek server from your code", () => {
  const runtimes = [process.execPath, ...(Bun.which("node") ? [Bun.which("node")!] : [])];
  for (const target of ["the practice server", "a real seek server"] as const) {
    test(`the example client prints what the page shows, through ${target}`, async () => {
      const server = target === "the practice server" ? await startPractice() : startRealServer();
      try {
        for (const runtime of runtimes) {
          for (const [token, exitCode] of [["practice-token", 0], ["wrong-token", 1]] as const) {
            const step = await run([runtime, "docs/user/examples/server-client.mjs", QUERY], {
              env: cleanEnv({ SEEK_SERVER_URL: server.url, SEEK_SERVER_TOKEN: token }),
            });
            expect(step.exitCode).toBe(exitCode);
            expectPageShows("server-client.md", `node server-client.mjs "${QUERY}"`, step.stdout);
          }
        }
      } finally {
        server.close();
      }
    });
  }
});

describe("Set up provider keys and use a server", () => {
  test("seek config init and seek config show print what the page shows", async () => {
    const env = cleanEnv({ EXA_API_KEY: "exa-synthetic-key-1234" });
    const placeholder = (text: string) => text.replaceAll(env.HOME!, "/home/<you>");
    const init = await seek("seek config init", env);
    expect(init.exitCode).toBe(0);
    expectPageShows("config.md", "seek config init", placeholder(init.stdout));
    const show = await seek("seek config show", env);
    expectPageShows("config.md", "seek config show", placeholder(show.stdout));
  });

  test("seek config show names the server as the page shows", async () => {
    const env = cleanEnv({ SEEK_SERVER_URL: "https://seek.internal.example", SEEK_SERVER_TOKEN: "synthetic-client-token" });
    const show = await seek("seek config show", env);
    const head = show.stdout.replaceAll(env.HOME!, "/home/<you>").split("\n").slice(0, 3).join("\n");
    expectPageShows("connect-to-a-server.md", "seek config show", head);
  });

  test("seek serve starts and answers its health check as the page shows", async () => {
    const env = cleanEnv({ SEEK_SERVER_TOKEN: "synthetic-client-token", EXA_API_KEY: "exa-synthetic-key-1234" });
    const server = Bun.spawn({
      cmd: [process.execPath, "run", join(ROOT, "src/index.ts"), "serve", "--host", "0.0.0.0", "--port", "0"],
      cwd: ROOT,
      env,
      stderr: "pipe",
    });
    try {
      const reader = server.stderr.getReader();
      let text = "";
      while (!text.includes("providers with keys")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      const port = /0\.0\.0\.0:(\d+)/.exec(text)?.[1];
      expectPageShows("server.md", "seek serve --host 0.0.0.0 --port 8787", text.replace(`0.0.0.0:${port}`, "0.0.0.0:8787"));
      const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).text();
      expectPageShows("server.md", "curl -s http://<server-host>:8787/healthz", health);
    } finally {
      server.kill();
    }
  });

  test("seek skill prints the start the page shows", async () => {
    const step = await seek("seek skill", cleanEnv());
    expect(step.stdout).toBe(readFileSync(join(ROOT, "skills/seek/SKILL.md"), "utf8"));
    expectPageShows("agent-skill.md", "seek skill", step.stdout.split("\n").slice(0, 4).join("\n"));
  });
});

describe("command lines in the pages", () => {
  /** Each `seek …` command in a page's sh blocks, cut at the shell syntax that ends it. */
  function seekCommands(markdown: string): string[] {
    const found: string[] = [];
    for (const block of blocks(markdown).filter((b) => b.language === "sh")) {
      const text = block.content.replace(/\\\n\s*/g, " ");
      // A command starts a line, a command substitution, or follows a shell keyword or operator.
      for (const match of text.matchAll(/(?:^[ \t]*|\$\(|(?:until|if|then|do|&&|\||;)[ \t]+)(seek(?=\s|$)[^|;&)>\n]*)/gm)) {
        found.push(match[1]!.replace(/<<<.*$/, "").trim());
      }
    }
    return found;
  }

  function parser(): Command {
    const program = createProgram();
    const walk = (command: Command) => {
      command.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
      if (command.commands.length === 0) command.action(() => {});
      command.commands.forEach(walk);
    };
    walk(program);
    return program;
  }

  test("every seek command a page shows parses with seek's own definitions", () => {
    const pages = [...new Bun.Glob("**/*.md").scanSync(join(ROOT, "docs/user"))].filter((f) => !f.startsWith("reference/"));
    const problems: string[] = [];
    let count = 0;
    for (const file of pages) {
      for (const command of seekCommands(page(file))) {
        count++;
        try {
          parser().parse(words(command).slice(1), { from: "user" });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code !== "commander.helpDisplayed" && code !== "commander.version") problems.push(`${file}: ${command}: ${(error as Error).message}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThanOrEqual(30);
  });

  test("a command with an option seek does not have fails", () => {
    expect(() => parser().parse(["web", "exa", "query", "--no-such-option"], { from: "user" })).toThrow("unknown option");
  });
});

describe("invalid fixtures fail validation with the expected error", () => {
  const validators = compileDefinitions(ROOT);
  const cases: Array<[string, { kind: "schema"; definition: string }, string]> = [
    ["configuration.file.schema.json/server-url-not-a-uri.json", { kind: "schema", definition: "configuration.file.schema.json" }, '/SEEK_SERVER_URL must match format "uri"'],
    ["configuration.file.schema.json/key-not-a-string.json", { kind: "schema", definition: "configuration.file.schema.json" }, "/EXA_API_KEY must be string"],
    ["configuration.environment.schema.json/kv-version-3.json", { kind: "schema", definition: "configuration.environment.schema.json" }, "/SEEK_VAULT_KV_VERSION must be equal to one of the allowed values"],
    ["research-job-envelope.schema.json/terminal-mismatch.json", { kind: "schema", definition: "research-job-envelope.schema.json" }, "/terminal must be equal to constant"],
    ["research-job-envelope.schema.json/result-before-completion.json", { kind: "schema", definition: "research-job-envelope.schema.json" }, "/status must be equal to constant"],
    ["research-job-envelope.schema.json/unknown-provider.json", { kind: "schema", definition: "research-job-envelope.schema.json" }, "/locator/provider must be equal to one of the allowed values"],
  ];
  for (const [fixture, check, error] of cases) {
    test(fixture, () => {
      const value = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/invalid", fixture), "utf8"));
      expect(validateExample(validators, check, value)).toContain(error);
    });
  }

  test("an HTTP API response with the wrong shape", () => {
    const value = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/invalid/http-api.openapi.yml/health-not-ok.json"), "utf8"));
    expect(validateExample(validators, { kind: "openapi", method: "get", path: "/healthz", status: "200" }, value)).toContain("/status must be equal to constant");
  });

  test("every published JSON example validates", () => {
    for (const [example, check] of Object.entries(EXAMPLES)) {
      if (check.kind === "script") continue;
      expect(validateExample(validators, check, JSON.parse(page(example))), example).toBe("");
    }
  });
});

// ---------- Guards: each mutation must make `bun run docs:check` fail ----------

const COPIED = ["docs", "src", "scripts", "skills", "tests", "package.json", "tsconfig.json"];

function copyRepository(): string {
  const copy = mkdtempSync(join(tmpdir(), "seek-docs-mutation-"));
  for (const entry of COPIED) cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
  return copy;
}

function edit(copy: string, file: string, from: string | RegExp, to: string): void {
  const path = join(copy, file);
  const text = readFileSync(path, "utf8");
  const next = text.replace(from, to);
  if (next === text) throw new Error(`mutation did not change ${file}`);
  writeFileSync(path, next);
}

async function runCheck(copy: string, env: Record<string, string> = {}): Promise<{ exitCode: number; output: string }> {
  const result = await run([process.execPath, "scripts/docs/check.ts"], { cwd: copy, env: { ...cleanEnv(), ...env } });
  return { exitCode: result.exitCode, output: result.stdout + result.stderr };
}

interface Mutation {
  name: string;
  apply(copy: string): void;
  expect: string;
}

const MUTATIONS: Mutation[] = [
  {
    name: "a command definition changes without regenerating",
    apply: (c) => edit(c, "src/commands/web.ts", '"Max chars per result excerpt"', '"Max characters per result excerpt"'),
    expect: "reference: docs/user/reference/commands/seek-web-parallel.md: differs from its definition",
  },
  {
    name: "an exit status changes without regenerating",
    apply: (c) => edit(c, "src/lib/exit-status.ts", '"The command completed."', '"The command finished."'),
    expect: "reference: docs/user/reference/commands/seek.md: differs from its definition",
  },
  {
    name: "a JSON Schema definition changes without regenerating",
    apply: (c) => edit(c, "docs/specifications/research-job-envelope.schema.json", "The provider that owns the job.", "The provider that holds the job."),
    expect: "reference: docs/user/reference/research-job-envelope.schema.json: differs from its definition",
  },
  {
    name: "the OpenAPI definition changes without regenerating",
    apply: (c) => edit(c, "docs/specifications/http-api.openapi.yml", "summary: Exa search", "summary: Exa web search"),
    expect: "reference: docs/user/reference/http-api.md: differs from its definition",
  },
  {
    name: "generation fails",
    apply: (c) => edit(c, "docs/specifications/http-api.openapi.yml", '"#/components/responses/Unauthorized"', '"#/components/responses/Missing"'),
    expect: "reference: docs/user/reference: generation failed: unresolved $ref #/components/responses/Missing",
  },
  {
    name: "a generated page is edited by hand",
    apply: (c) => edit(c, "docs/user/reference/commands/seek-skill.md", "Print the bundled Seek skill", "Print the Seek skill"),
    expect: "reference: docs/user/reference/commands/seek-skill.md: differs from its definition",
  },
  {
    name: "a generated page is missing",
    apply: (c) => rmSync(join(c, "docs/user/reference/commands/seek-config-path.md")),
    expect: "reference: docs/user/reference/commands/seek-config-path.md: is missing",
  },
  {
    name: "an obsolete generated page remains",
    apply: (c) => writeFileSync(join(c, "docs/user/reference/commands/seek-old.md"), "---\ntitle: seek old\nproduct: seek\n---\n"),
    expect: "reference: docs/user/reference/commands/seek-old.md: is not generated",
  },
  {
    name: "an example does not validate",
    apply: (c) => edit(c, "docs/user/examples/client-config.json", '"https://seek.internal.example"', '"not a url"'),
    expect: 'examples: docs/user/examples/client-config.json: does not validate: /SEEK_SERVER_URL must match format "uri"',
  },
  {
    name: "a link names a page that does not exist",
    apply: (c) => edit(c, "docs/user/web.md", "(providers.md)", "(provider.md)"),
    expect: "links to a page that does not exist: provider.md",
  },
  {
    name: "a fragment names no heading",
    apply: (c) => edit(c, "docs/user/web.md", "(providers.md)", "(providers.md#no-such-heading)"),
    expect: "fragment #no-such-heading names no heading of providers.md",
  },
  {
    name: "a download does not exist",
    apply: (c) => edit(c, "docs/user/config.md", "(examples/config.json)", "(examples/missing.json)"),
    expect: "download does not exist: examples/missing.json",
  },
  {
    name: "a page links to a design document by relative path",
    apply: (c) => edit(c, "docs/user/web.md", "(providers.md)", "(../specifications/command-line.yml)"),
    expect: "links to a design document or private file: ../specifications/command-line.yml",
  },
  {
    name: "a page links to a design document by GitHub URL",
    apply: (c) => edit(c, "docs/user/web.md", "(providers.md)", "(https://github.com/wyrd-company/seek-cli/blob/main/docs/specifications/command-line.yml)"),
    expect: "links to a design document: https://github.com/wyrd-company/seek-cli/blob/main/docs/specifications/command-line.yml",
  },
  {
    name: "a listed asset is used by no page and named by no product field",
    apply: (c) => {
      writeFileSync(join(c, "docs/user/assets/unused.png"), "synthetic");
      edit(c, "docs/user/docs.yml", "  - assets/demo.gif\n", "  - assets/demo.gif\n  - assets/unused.png\n");
    },
    expect: "lists assets/unused.png, but no seek page links to it by its relative path and no product field names it",
  },
  {
    name: "an asset loses its only owning-page link",
    apply: (c) => edit(c, "docs/user/connect-to-a-server.md", "[client-config.json](examples/client-config.json)", "client-config.json"),
    expect: "lists examples/client-config.json, but no seek page links to it by its relative path and no product field names it",
  },
  {
    name: "a published example is not listed in assets",
    apply: (c) => edit(c, "docs/user/docs.yml", "  - examples/config.json\n", ""),
    expect: "assets: docs/user/examples/config.json: is published with the docs but not listed in docs.yml assets",
  },
  {
    name: "a page has two homes in nav",
    apply: (c) => edit(c, "docs/user/docs.yml", "pages: [server-proxy]", "pages: [server-proxy, web]"),
    expect: "web has more than one home",
  },
];

describe("docs:check guards", () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const copy of copies) rmSync(copy, { recursive: true, force: true });
  });

  test("an unchanged copy passes, with the server host and port set in the environment", async () => {
    const copy = copyRepository();
    copies.push(copy);
    const result = await runCheck(copy, { SEEK_SERVER_HOST: "0.0.0.0", SEEK_SERVER_PORT: "9999" });
    expect(result.output).toContain("docs:check: passed");
    expect(result.exitCode).toBe(0);
  }, 30_000);

  for (const mutation of MUTATIONS) {
    test(`fails when ${mutation.name}`, async () => {
      const copy = copyRepository();
      copies.push(copy);
      mutation.apply(copy);
      const result = await runCheck(copy);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain(mutation.expect);
      expect(result.output).toContain("docs:check: FAILED");
      expect(result.output).not.toContain("docs:check: passed");
    }, 30_000);
  }
});
