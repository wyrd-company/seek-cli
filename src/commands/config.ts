import { Command } from "commander";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { configDir, configPath, KNOWN_KEYS, loadConfig, resetConfigCache } from "../lib/config.ts";

function maskKey(value: string): string {
  if (value.length <= 8) return "********";
  return value.slice(0, 4) + "…" + value.slice(-4);
}

function providerLabel(provider: string): string {
  if (provider === "web:brave") return "brave search";
  if (provider === "research:brave") return "brave answers";
  return provider;
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description(
      "Manage seek's config file. Stores API keys so you don't have to export env vars each session.",
    );

  config
    .command("path")
    .description("Print the resolved config file path.")
    .action(() => {
      process.stdout.write(configPath() + "\n");
    });

  config
    .command("init")
    .description("Create a template config file with placeholders for every known API key.")
    .option("--force", "Overwrite an existing config file")
    .action((opts) => {
      const path = configPath();
      if (existsSync(path) && !opts.force) {
        process.stderr.write(
          `Config already exists at ${path}. Re-run with --force to overwrite.\n`,
        );
        process.exitCode = 1;
        return;
      }
      mkdirSync(configDir(), { recursive: true, mode: 0o700 });
      const template: Record<string, string> = {};
      for (const [k] of KNOWN_KEYS) template[k] = "";
      writeFileSync(path, JSON.stringify(template, null, 2) + "\n", { mode: 0o600 });
      chmodSync(path, 0o600);
      resetConfigCache();
      process.stdout.write(
        `Created ${path}\nEdit the file and fill in keys for the providers you want to use.\n`,
      );
    });

  config
    .command("show")
    .description("Show which API keys are configured (values are masked).")
    .action(() => {
      const fromConfig = loadConfig();
      const rows = KNOWN_KEYS.map(([envVar, provider]) => {
        const envValue = process.env[envVar];
        const cfgValue = fromConfig[envVar];
        const source = envValue ? "env" : cfgValue ? "config" : "—";
        const value = envValue || cfgValue || "";
        return {
          envVar,
          provider,
          source,
          display: value ? maskKey(value) : "(unset)",
          providerLabel: providerLabel(provider),
        };
      });
      const varWidth = Math.max(...rows.map((r) => r.envVar.length));
      const srcWidth = Math.max(...rows.map((r) => r.source.length));
      process.stdout.write(`config: ${configPath()}\n\n`);
      for (const r of rows) {
        const pad = " ".repeat(varWidth - r.envVar.length);
        const srcPad = " ".repeat(srcWidth - r.source.length);
        process.stdout.write(
          `  ${r.envVar}${pad}  ${r.source}${srcPad}  ${r.display}    [${r.providerLabel}]\n`,
        );
      }
    });
}
