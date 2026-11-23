/** Where seek's documentation lives. This module imports nothing from src/, so the check can report a generator that fails to load. */
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");
export const USER_DIR = "docs/user";
export const REFERENCE_DIR = "docs/user/reference";
export const SPECIFICATIONS_DIR = "docs/specifications";
export const CAPTURES_DIR = "docs/captures";

/** The definitions published as copies under docs/user/reference/, each linked from the page generated from it. */
export const DEFINITIONS = {
  httpApi: "http-api.openapi.yml",
  configurationFile: "configuration.file.schema.json",
  configurationEnvironment: "configuration.environment.schema.json",
  researchJobEnvelope: "research-job-envelope.schema.json",
} as const;

/** Every file under a directory, by sorted posix path relative to it. */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}
