import { Command } from "commander";
import { closeSync, existsSync, linkSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  loadConfiguration,
  targetFile,
  type BoundAuth,
  type Configuration,
  type LocalSource,
  type Origin,
  type Source,
} from "../lib/config.ts";
import { configurationFlags } from "../lib/options.ts";
import { REDACTED, redactUrl } from "../lib/redact.ts";
import { settings, type ConfigurationKind } from "../lib/settings.ts";
import { describeHelper } from "../lib/secrets.ts";
import { EXIT } from "../lib/exit-status.ts";

// ---------- config init ----------

function template(kind: ConfigurationKind, file: string): string {
  const providers = Object.keys(settingsProviders(kind));
  const lines = [
    `# seek ${kind} configuration: ${file}`,
    "# Every setting also has an environment variable and a flag, such as",
    "# SEEK_PROVIDERS_EXA_API_KEY_FILE and --providers-exa-api-key-file.",
    "# Each secret names one source: value, file, command or vault.",
    `# Check this file with \`seek config validate${kind === "server" ? " --server" : ""}\` and \`seek config show${kind === "server" ? " --server" : ""}\`.`,
    "",
  ];
  if (kind === "client") {
    lines.push(
      "# Call providers through a seek server instead of directly:",
      "# server:",
      "#   url: https://seek.internal.example",
      "#   token:",
      "#     file: ~/.config/seek/secrets/seek-client-token",
      "",
    );
  } else {
    lines.push(
      "# Where the server listens and the client tokens it accepts:",
      "# server:",
      "#   host: 127.0.0.1",
      "#   port: 8787",
      "#   tokens:",
      "#     file: /run/secrets/seek-client-tokens",
      "",
    );
  }
  lines.push("# The API key of each provider you use:", "# providers:");
  for (const provider of providers) {
    lines.push(`#   ${provider}:`, "#     api-key:", `#       file: ${kind === "client" ? "~/.config/seek/secrets" : "/run/secrets"}/${provider}`);
  }
  lines.push(
    "",
    "# Defaults for every secret read from Vault or OpenBao, such as",
    "#   api-key:",
    "#     vault: { path: seek, key: EXA_API_KEY }",
    "# vault:",
    "#   address: https://bao.internal.example",
    "#   auth:",
    "#     mode: token",
    "#     token:",
    "#       file: ~/.vault-token",
    "",
  );
  return lines.join("\n");
}

function settingsProviders(kind: ConfigurationKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const secret of settings(kind).secrets) {
    const match = /^providers\.([^.]+)\.api-key$/.exec(secret);
    if (match) out[match[1]!] = true;
  }
  return out;
}

/**
 * Writes the template to a new private file beside the target and publishes
 * it: with a hard link, which fails when the target exists, or with `--force`
 * by renaming it over the target. A failure removes the new file and leaves
 * any existing target unchanged.
 */
export function writeTemplate(target: string, content: string, force: boolean, beforePublish: () => void = () => {}): void {
  const directory = dirname(target);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const staged = join(directory, `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(staged, "wx", 0o600);
  try {
    try {
      writeSync(fd, content);
    } finally {
      closeSync(fd);
    }
    beforePublish();
    if (force) renameSync(staged, target);
    else linkSync(staged, target);
  } finally {
    if (existsSync(staged)) unlinkSync(staged);
  }
}

// ---------- config show ----------

type Json = Record<string, unknown>;

function layerJson(origin: Origin): Json {
  switch (origin.kind) {
    case "file":
      return { kind: "file", file: origin.file };
    case "env":
    case "flag":
      return { kind: origin.kind, name: origin.name };
    default:
      return { kind: origin.kind };
  }
}

function localJson(source: LocalSource): Json {
  switch (source.kind) {
    case "value":
      return { value: REDACTED };
    case "file":
      return { file: source.file };
    case "command":
      return { command: { program: source.argv[0], arguments: source.argv.length - 1 }, timeout: source.timeout };
  }
}

function authJson(auth: BoundAuth): Json {
  return {
    mode: auth.mode,
    ...(auth.mode === "approle" ? { mount: auth.mount } : {}),
    ...(auth.roleId !== undefined ? { "role-id": REDACTED } : {}),
    ...(auth.token ? { token: localJson(auth.token) } : {}),
    ...(auth.secretId ? { "secret-id": localJson(auth.secretId) } : {}),
    "declared-in": layerJson(auth.declaredIn),
  };
}

function sourceJson(source: Source): Json {
  if (source.kind !== "vault") return localJson(source);
  const v = source.vault;
  return {
    vault: {
      ...(v.address ? { address: redactUrl(v.address) } : {}),
      ...(v.namespace !== undefined ? { namespace: v.namespace } : {}),
      mount: v.mount,
      "kv-version": v.kvVersion,
      path: v.path,
      key: v.key,
      ...(v.caCert ? { "ca-cert": v.caCert } : {}),
      ...(v.proxy ? { proxy: redactUrl(v.proxy) } : {}),
      ...(v.auth ? { auth: authJson(v.auth) } : {}),
      ...(v.trust ? { trust: v.trust.inputs } : {}),
    },
  };
}

const URL_SETTINGS = new Set(["server.url", "vault.address", "vault.proxy"]);

/** Every setting in schema order: plain settings, then each secret and the top-level login where they first appear. */
export function showJson(configuration: Configuration): Json {
  const entries: Json[] = [];
  const emitted = new Set<string>();
  for (const leaf of settings(configuration.kind).leaves) {
    if (!leaf.mapping) {
      const plain = configuration.plain.get(leaf.dotted)!;
      const value = typeof plain.value === "string" && URL_SETTINGS.has(leaf.dotted) ? redactUrl(plain.value) : plain.value;
      entries.push({ path: leaf.dotted, ...(value !== undefined ? { value } : {}), layer: layerJson(plain.origin) });
      continue;
    }
    if (emitted.has(leaf.mapping)) continue;
    emitted.add(leaf.mapping);
    if (leaf.mapping === "vault.auth") {
      const top = configuration.vaultAuth;
      entries.push({ path: "vault.auth", ...(top ? { auth: authJson(top.auth) } : {}), layer: layerJson(top?.origin ?? { kind: "unset" }) });
      continue;
    }
    const secret = configuration.secrets.get(leaf.mapping)!;
    entries.push({ path: secret.path, ...(secret.source ? { source: sourceJson(secret.source) } : {}), layer: layerJson(secret.origin) });
  }
  return { configuration: configuration.kind, files: configuration.files, settings: entries, warnings: [] };
}

function layerText(layer: Json): string {
  return layer.kind === "file" ? `file ${layer.file}` : layer.kind === "env" || layer.kind === "flag" ? `${layer.kind} ${layer.name}` : String(layer.kind);
}

function localText(source: Json): string {
  if (source.value !== undefined) return `value ${REDACTED}`;
  if (source.file !== undefined) return `file ${source.file}`;
  const command = source.command as { program: string; arguments: number };
  return `${describeHelper([command.program, ...Array(command.arguments).fill("")])}, timeout ${source.timeout}`;
}

function authText(auth: Json): string {
  const parts = [String(auth.mode)];
  if (auth.mount !== undefined) parts.push(`mount ${auth.mount}`);
  if (auth["role-id"] !== undefined) parts.push(`role-id ${REDACTED}`);
  if (auth.token) parts.push(`token ${localText(auth.token as Json)}`);
  if (auth["secret-id"]) parts.push(`secret-id ${localText(auth["secret-id"] as Json)}`);
  return `${parts.join(", ")}  (declared in ${layerText(auth["declared-in"] as Json)})`;
}

export function showText(json: Json): string {
  const lines = [`seek ${json.configuration} configuration`, `files: ${(json.files as string[]).join(", ") || "(none)"}`, ""];
  for (const entry of json.settings as Json[]) {
    const layer = `  (${layerText(entry.layer as Json)})`;
    if (entry.path === "vault.auth") {
      lines.push(entry.auth ? `vault.auth = ${authText(entry.auth as Json)}` : `vault.auth${layer}`);
      continue;
    }
    if ("source" in entry || /api-key$|^server\.tokens?$/.test(String(entry.path))) {
      const source = entry.source as Json | undefined;
      if (!source) {
        lines.push(`${entry.path}${layer}`);
      } else if (!source.vault) {
        lines.push(`${entry.path} = ${localText(source)}${layer}`);
      } else {
        const vault = source.vault as Json;
        lines.push(`${entry.path} = vault${layer}`);
        for (const field of ["address", "namespace", "mount", "kv-version", "path", "key", "ca-cert", "proxy"]) {
          if (vault[field] === undefined) continue;
          lines.push(`    ${field}: ${field === "namespace" && vault[field] === "" ? "(root)" : vault[field]}`);
        }
        lines.push(`    auth: ${vault.auth ? authText(vault.auth as Json) : "(none bound to this server)"}`);
        for (const input of (vault.trust as Json[] | undefined) ?? []) {
          const count = Number(input.certificates);
          lines.push(`    trust: ${input.input}${input.path ? ` ${input.path}` : ""} (${count} certificate${count === 1 ? "" : "s"})`);
        }
      }
      continue;
    }
    lines.push(entry.value === undefined ? `${entry.path}${layer}` : `${entry.path} = ${entry.value === "" ? '""' : entry.value}${layer}`);
  }
  return `${lines.join("\n")}\n`;
}

// ---------- Commands ----------

function kindOf(opts: { server?: boolean }): ConfigurationKind {
  return opts.server ? "server" : "client";
}

function reportErrors(configuration: Configuration): void {
  for (const error of configuration.errors) process.stderr.write(`error: ${error}\n`);
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description(
      "Inspect and create seek's configuration: the client's, or with --server the server's. Never reads a secret.",
    );

  config
    .command("path")
    .description("Print the configuration file that seek config init writes.")
    .option("--server", "Use the server configuration")
    .action((opts: { server?: boolean }, command: Command) => {
      const { config: explicit } = configurationFlags(command);
      process.stdout.write(`${targetFile({ kind: kindOf(opts), ...(explicit !== undefined ? { config: explicit } : {}) })}\n`);
    });

  config
    .command("init")
    .description("Write a commented template of the configuration file, created with mode 0600.")
    .option("--server", "Use the server configuration")
    .option("--force", "Replace an existing file")
    .action((opts: { server?: boolean; force?: boolean }, command: Command) => {
      const { config: explicit } = configurationFlags(command);
      const kind = kindOf(opts);
      const path = targetFile({ kind, ...(explicit !== undefined ? { config: explicit } : {}) });
      try {
        writeTemplate(path, template(kind, path), Boolean(opts.force));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        process.stderr.write(
          code === "EEXIST"
            ? `error: ${path} already exists. Re-run with --force to replace it.\n`
            : `error: cannot write ${path} (${code ?? (error as Error).message}); any existing file is unchanged.\n`,
        );
        process.exitCode = EXIT.failure;
        return;
      }
      process.stdout.write(
        `Created ${path}\nUncomment the settings you use, then check them with seek config validate${kind === "server" ? " --server" : ""}.\n`,
      );
    });

  config
    .command("show")
    .description("Show each effective setting and the layer that supplied it; secrets appear as their redacted source.")
    .option("--server", "Use the server configuration")
    .option("--json", "Print the object configuration.show.schema.json defines")
    .action((opts: { server?: boolean; json?: boolean }, command: Command) => {
      const configuration = loadConfiguration({ kind: kindOf(opts), ...configurationFlags(command) });
      if (!configuration.layerErrors) {
        const json = showJson(configuration);
        // One write per line, so a reader that closes the pipe early stops seek with status 1.
        const text = opts.json ? `${JSON.stringify(json, null, 2)}\n` : showText(json);
        for (const line of text.split(/(?<=\n)/)) process.stdout.write(line);
      }
      reportErrors(configuration);
      if (configuration.errors.length > 0) process.exitCode = EXIT.failure;
    });

  config
    .command("validate")
    .description("Validate the configuration; exit 0 when it passes and 1 otherwise.")
    .option("--server", "Use the server configuration")
    .action((opts: { server?: boolean }, command: Command) => {
      const configuration = loadConfiguration({ kind: kindOf(opts), ...configurationFlags(command) });
      reportErrors(configuration);
      if (configuration.errors.length > 0) {
        process.exitCode = EXIT.failure;
        return;
      }
      const files = configuration.files.length > 0 ? configuration.files.join(", ") : "no file";
      process.stdout.write(`The seek ${configuration.kind} configuration is valid (${files}).\n`);
    });
}
