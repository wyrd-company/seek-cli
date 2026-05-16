import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, "seek");
  return join(homedir(), ".config", "seek");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

let cached: Record<string, string> | null = null;

export function loadConfig(): Record<string, string> {
  if (cached !== null) return cached;
  const path = configPath();
  if (!existsSync(path)) {
    cached = {};
    return cached;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      process.stderr.write(`warning: ${path} is not a JSON object — ignoring.\n`);
      cached = {};
      return cached;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    cached = out;
    return cached;
  } catch (err) {
    process.stderr.write(
      `warning: failed to read ${path}: ${(err as Error).message}\n`,
    );
    cached = {};
    return cached;
  }
}

export function resetConfigCache(): void {
  cached = null;
}

export const KNOWN_KEYS: ReadonlyArray<readonly [envVar: string, provider: string]> = [
  ["PARALLEL_API_KEY", "parallel"],
  ["EXA_API_KEY", "exa"],
  ["BRAVE_API_KEY", "brave"],
  ["PERPLEXITY_API_KEY", "perplexity"],
  ["GEMINI_API_KEY", "google"],
  ["FIRECRAWL_API_KEY", "firecrawl"],
];
