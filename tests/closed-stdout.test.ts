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
  const readerClosed = join(directory, "reader-closed");
  const result = Bun.spawnSync(
    [
      "bash",
      "-c",
      `
        mkfifo "$2" || exit
        trap 'rm -f "$2"' EXIT
        {
          printf 'ready\\n'
          # Wait until the reader has closed its pipe before Seek writes.
          IFS= read -r _ < "$2" || exit
          exec "$1" config show
        } | {
          IFS= read -r line || exit
          exec 0<&-
          printf '%s\\n' "$line"
          printf 'closed\\n' > "$2"
        }
        exit "\${PIPESTATUS[0]}"
      `,
      "seek-closed-stdout",
      binary,
      readerClosed,
    ],
    { env: { XDG_CONFIG_HOME: directory }, timeout: 5_000 },
  );

  expect(result.stdout.toString()).toBe("ready\n");
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
