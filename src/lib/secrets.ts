/**
 * Reads secrets from their configured sources: a value, a file, a credential
 * helper or a field of a Vault or OpenBao KV secret. Each secret resolves from
 * its one source; a failure names the source and never the secret.
 */
import { readFileSync } from "node:fs";
import type { Configuration, LocalSource, Source } from "./config.ts";
import { VaultClient, VaultError } from "./vault.ts";

/** A configured source that failed to resolve. */
export class SecretSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretSourceError";
  }
}

/** How a helper appears in errors and in `seek config show`: its program and number of arguments. */
export function describeHelper(argv: readonly string[]): string {
  const count = argv.length - 1;
  return `helper ${argv[0]} (${count} argument${count === 1 ? "" : "s"})`;
}

export function describeSource(source: Source): string {
  switch (source.kind) {
    case "value":
      return "value";
    case "file":
      return `file ${source.file}`;
    case "command":
      return describeHelper(source.argv);
    case "vault":
      return `Vault secret ${source.vault.mount}/${source.vault.path} field ${source.vault.key}`;
  }
}

async function runHelper(source: Extract<LocalSource, { kind: "command" }>, label: string): Promise<string> {
  const helper = describeHelper(source.argv);
  let child: Bun.Subprocess<"inherit", "pipe", "ignore">;
  try {
    // A helper's diagnostics can repeat its arguments or the secret, so its stderr is discarded.
    child = Bun.spawn(source.argv, { cwd: source.cwd, stdin: "inherit", stdout: "pipe", stderr: "ignore" });
  } catch {
    throw new SecretSourceError(`${label}: ${helper} could not be started`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The timeout stops the helper and fails at once, without waiting for it or its output to end.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new SecretSourceError(`${label}: ${helper} timed out after ${source.timeout}`));
    }, source.timeoutMs);
  });
  try {
    const [output, status] = await Promise.race([Promise.all([new Response(child.stdout).text(), child.exited]), deadline]);
    if (status !== 0) throw new SecretSourceError(`${label}: ${helper} exited with status ${status}`);
    const secret = output.trim();
    if (!secret) throw new SecretSourceError(`${label}: ${helper} printed nothing`);
    return secret;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a value, file or helper source. */
export async function resolveLocal(source: LocalSource, label: string): Promise<string> {
  switch (source.kind) {
    case "value": {
      if (!source.value) throw new SecretSourceError(`${label}: the value is empty`);
      return source.value;
    }
    case "file": {
      let text: string;
      try {
        text = readFileSync(source.file, "utf8");
      } catch (error) {
        throw new SecretSourceError(`${label}: file ${source.file} cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"})`);
      }
      const secret = text.trim();
      if (!secret) throw new SecretSourceError(`${label}: file ${source.file} is empty`);
      return secret;
    }
    case "command":
      return await runHelper(source, label);
  }
}

/** Resolves the secrets of one loaded configuration, sharing one Vault client. */
export class SecretResolver {
  readonly vault: VaultClient;

  constructor(readonly configuration: Configuration) {
    this.vault = new VaultClient(resolveLocal);
  }

  /** Whether a secret has a source in any layer. */
  configured(path: string): boolean {
    return this.configuration.secrets.get(path)?.source !== undefined;
  }

  /** Resolves one secret; undefined when it has no source. */
  async resolve(path: string): Promise<string | undefined> {
    const source = this.configuration.secrets.get(path)?.source;
    if (!source) return undefined;
    if (source.kind !== "vault") return await resolveLocal(source, path);
    try {
      return await this.vault.field(source.vault, path);
    } catch (error) {
      if (error instanceof SecretSourceError) throw error;
      if (error instanceof VaultError) throw new SecretSourceError(`${path}: ${error.message}`);
      throw new SecretSourceError(`${path}: ${describeSource(source)}: ${(error as Error).message}`);
    }
  }
}
