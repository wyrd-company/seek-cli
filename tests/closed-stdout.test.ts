import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../src/lib/exit-status.ts";

const directory = mkdtempSync(join(tmpdir(), "seek-closed-stdout-"));
const binary = join(directory, "seek");

beforeAll(() => {
  const build = Bun.spawnSync([
    process.execPath, "build", "src/index.ts", "--compile", "--outfile", binary,
  ]);
  expect(build.stderr.toString()).toBe("");
  expect(build.exitCode).toBe(0);
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

test("the compiled CLI exits quietly when a reader closes stdout early", () => {
  const result = Bun.spawnSync(
    [
      "bash", "-c", '"$1" config show | head -n 1; exit "${PIPESTATUS[0]}"',
      "seek-closed-stdout", binary,
    ],
    {
      env: {
        XDG_CONFIG_HOME: directory,
        // Force the server line beyond the pipe buffer so head closes before seek finishes writing.
        SEEK_SERVER_URL: `https://example.invalid/${"x".repeat(96 * 1024)}`,
      },
    },
  );

  expect(result.stdout.toString()).toBe(`config: ${directory}/seek/config.json\n`);
  expect(result.exitCode).toBe(EXIT.failure);
  expect(result.stderr.toString()).toBe("");
});

test.skipIf(process.platform !== "linux")(
  "the compiled CLI reports a full device on stdout",
  () => {
    const result = Bun.spawnSync(
      ["bash", "-c", 'exec "$1" config show > /dev/full', "seek-full-stdout", binary],
      { env: { XDG_CONFIG_HOME: directory, LC_ALL: "C" } },
    );

    expect(result.exitCode).toBe(EXIT.failure);
    expect(result.stderr.toString()).toBe("error: ENOSPC: no space left on device, write\n");
  },
);
