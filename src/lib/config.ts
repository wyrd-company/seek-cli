/**
 * The configuration loader: reads one configuration's files, environment
 * variables and flags, validates each layer, merges them, binds every Vault
 * `auth` mapping to its server and validates the result, as
 * docs/specifications/configuration.yml and
 * docs/technical-designs/secret-resolution.yml describe. Loading never reads
 * a secret: it returns each secret as its source.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve as resolvePath } from "node:path";
import {
  envName,
  flagName,
  properties,
  refName,
  resolve,
  settings,
  stdinFlag,
  type ConfigurationKind,
  type Leaf,
  type Schema,
} from "./settings.ts";
import { buildTrust, type Trust } from "./trust.ts";
import { redactUrl } from "./redact.ts";

export type Origin =
  | { kind: "default" }
  | { kind: "unset" }
  | { kind: "file"; file: string }
  | { kind: "env"; name: string }
  | { kind: "flag"; name: string };

export function describeOrigin(origin: Origin): string {
  switch (origin.kind) {
    case "file":
      return origin.file;
    case "env":
    case "flag":
      return origin.name;
    default:
      return origin.kind;
  }
}

/** One flag the command line supplied: a setting's flag or alias, or a `--<secret>-stdin` flag. */
export interface FlagValue {
  name: string;
  value: string | boolean;
}

export interface LoadOptions {
  kind: ConfigurationKind;
  env?: Record<string, string | undefined>;
  flags?: FlagValue[];
  /** The `--config` path, when given. */
  config?: string;
  cwd?: string;
  home?: string;
  /** The directory of the system files; `/etc/seek` outside tests. */
  systemDir?: string;
  /** Reads standard input for a `--<secret>-stdin` flag. */
  readStdin?: () => string;
}

interface Layer {
  kind: "default" | "file" | "env" | "flag";
  file?: string;
  /** The directory relative paths in this layer start from. */
  dir: string;
  data: Record<string, unknown>;
  /** For the environment and flag layers, the variable or flag that set each leaf. */
  names: Map<string, string>;
  /** In the environment layer, the token alias that built `vault.auth` and its family's address. */
  aliasToken?: { name: string; address?: string };
}

export type LocalSource =
  | { kind: "value"; value: string }
  | { kind: "file"; file: string }
  | { kind: "command"; argv: string[]; cwd: string; timeout: string; timeoutMs: number };

export interface BoundAuth {
  mode: "token" | "approle" | "none";
  mount: string;
  roleId?: string;
  token?: LocalSource;
  secretId?: LocalSource;
  declaredIn: Origin;
  /** Identifies the mapping: the layer and path that declared it. */
  id: string;
  /** The normalized server it is bound to, or undefined when unbound. */
  boundTo?: string;
}

export interface VaultBlock {
  address?: string;
  /** The normalized address, which identifies the server. */
  server?: string;
  namespace?: string;
  mount: string;
  kvVersion: 1 | 2;
  path: string;
  key: string;
  caCert?: string;
  proxy?: string;
  auth?: BoundAuth;
  trust?: Trust;
}

export type Source = LocalSource | { kind: "vault"; vault: VaultBlock };

export interface EffectiveSecret {
  path: string;
  origin: Origin;
  source?: Source;
}

export interface PlainSetting {
  path: string;
  value?: string | number | boolean;
  origin: Origin;
}

export interface Configuration {
  kind: ConfigurationKind;
  /** The files that were loaded, from lowest to highest precedence. */
  files: string[];
  /** Every configuration error; empty when the configuration is valid. */
  errors: string[];
  /** True when a layer failed validation, so nothing was merged. */
  layerErrors: boolean;
  plain: Map<string, PlainSetting>;
  secrets: Map<string, EffectiveSecret>;
  /** The top-level Vault login, after the merge. */
  vaultAuth?: { auth: BoundAuth; origin: Origin };
  /** The default user or server file, which messages name. */
  defaultFile: string;
}

export class ConfigurationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join("\n"));
    this.name = "ConfigurationError";
  }
}

/** Throws a ConfigurationError when the configuration has any error. */
export function assertValid(configuration: Configuration): Configuration {
  if (configuration.errors.length > 0) throw new ConfigurationError(configuration.errors);
  return configuration;
}

// ---------- Files ----------

export function userConfigDir(env: Record<string, string | undefined>, home: string): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && isAbsolute(xdg)) return join(xdg, "seek");
  return join(home, ".config", "seek");
}

export function defaultFile(kind: ConfigurationKind, env: Record<string, string | undefined>, home: string, systemDir = "/etc/seek"): string {
  return kind === "client" ? join(userConfigDir(env, home), "client.yml") : join(systemDir, "server.yml");
}

function expandPath(value: string, dir: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return isAbsolute(value) ? normalize(value) : resolvePath(dir, value);
}

/** The `--config` or `SEEK_CONFIG` path, absolute, or undefined. */
export function explicitConfig(options: Pick<LoadOptions, "config" | "env" | "cwd" | "home">): string | undefined {
  const env = options.env ?? process.env;
  const raw = options.config ?? env.SEEK_CONFIG?.trim();
  if (raw === undefined || raw === "") return undefined;
  return expandPath(raw, options.cwd ?? process.cwd(), options.home ?? homedir());
}

/** The file `seek config path` prints and `seek config init` writes. */
export function targetFile(options: Pick<LoadOptions, "kind" | "config" | "env" | "cwd" | "home" | "systemDir">): string {
  const env = options.env ?? process.env;
  return explicitConfig(options) ?? defaultFile(options.kind, env, options.home ?? homedir(), options.systemDir);
}

function readLayerFile(file: string, errors: string[]): Layer | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    errors.push(`${file}: cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"})`);
    return undefined;
  }
  let data: unknown;
  try {
    data = Bun.YAML.parse(text);
  } catch (error) {
    const line = (error as { line?: number }).line;
    errors.push(`${file}: is not valid YAML${line ? ` (line ${line})` : ""}`);
    return undefined;
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object" || Array.isArray(data)) {
    errors.push(`${file}: expected a mapping of settings at the top level`);
    return undefined;
  }
  return { kind: "file", file, dir: join(file, ".."), data: data as Record<string, unknown>, names: new Map() };
}

// ---------- Environment and flags ----------

function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path.at(-1)!] = value;
}

export function getAt(source: unknown, path: readonly string[]): unknown {
  let node = source;
  for (const key of path) {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Converts a text value from an environment variable or flag to the setting's type. */
function convert(leaf: Leaf, raw: string): { value?: unknown; error?: string } {
  switch (leaf.type) {
    case "string":
      return { value: raw };
    case "integer":
      return /^-?\d+$/.test(raw) ? { value: Number(raw) } : { error: "expected an integer" };
    case "number":
      return raw !== "" && Number.isFinite(Number(raw)) ? { value: Number(raw) } : { error: "expected a number" };
    case "boolean":
      return raw === "true" ? { value: true } : raw === "false" ? { value: false } : { error: "expected true or false" };
    case "array":
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return { value: parsed };
      } catch {
        // reported below
      }
      return { error: "expected a JSON array of strings" };
  }
}

function environmentLayer(kind: ConfigurationKind, env: Record<string, string | undefined>, cwd: string, errors: string[]): Layer {
  const layer: Layer = { kind: "env", dir: cwd, data: {}, names: new Map() };
  const derivedAuth = settings(kind).leaves.some((leaf) => leaf.dotted.startsWith("vault.auth.") && env[leaf.env] !== undefined);
  for (const leaf of settings(kind).leaves) {
    let name: string | undefined;
    let raw: string | undefined;
    if (env[leaf.env] !== undefined) {
      name = leaf.env;
      raw = env[leaf.env]!.trim();
    } else {
      for (const alias of leaf.envAliases) {
        const value = env[alias]?.trim();
        if (value) {
          name = alias;
          raw = value;
          break;
        }
      }
    }
    if (name === undefined || raw === undefined) continue;
    const { value, error } = convert(leaf, raw);
    if (error) {
      errors.push(`${leaf.dotted}: ${error} (${name})`);
      continue;
    }
    setAt(layer.data, leaf.path, value);
    layer.names.set(leaf.dotted, name);
  }
  if (!derivedAuth) {
    const auth = settings(kind).mappings.find((m) => m.dotted === "vault.auth")!;
    for (const alias of auth.envAliases) {
      const token = env[alias]?.trim();
      if (!token) continue;
      setAt(layer.data, auth.path, { mode: "token", token: { value: token } });
      for (const leaf of ["vault.auth.mode", "vault.auth.token.value"]) layer.names.set(leaf, alias);
      const family = alias.split("_")[0];
      const address = env[`${family}_ADDR`]?.trim();
      layer.aliasToken = { name: alias, ...(address ? { address } : {}) };
      break;
    }
  }
  return layer;
}

/** The flags of a configuration: each setting's flag and aliases, and each secret's stdin flag. */
export interface FlagDefinition {
  flag: string;
  leaf?: Leaf;
  /** For a negated boolean flag such as `--no-auth`, the value it sets. */
  negate?: boolean;
  alias?: boolean;
  stdin?: string;
}

export function flagDefinitions(kind: ConfigurationKind): FlagDefinition[] {
  const out: FlagDefinition[] = [];
  for (const leaf of settings(kind).leaves) {
    if (leaf.flag === null) continue;
    out.push({ flag: leaf.flag, leaf });
    if (leaf.type === "boolean") out.push({ flag: leaf.flag.replace(/^--/, "--no-"), leaf, negate: true });
    for (const alias of leaf.flagAliases) {
      out.push({ flag: alias, leaf, alias: true, ...(alias.startsWith("--no-") && leaf.type === "boolean" ? { negate: true } : {}) });
    }
  }
  for (const secret of settings(kind).secrets) out.push({ flag: stdinFlag(secret), stdin: secret });
  return out;
}

function flagLayer(options: LoadOptions, cwd: string, errors: string[]): Layer {
  const layer: Layer = { kind: "flag", dir: cwd, data: {}, names: new Map() };
  const definitions = new Map(flagDefinitions(options.kind).map((d) => [d.flag, d]));
  const given = options.flags ?? [];
  // A derived flag wins over an alias of the same setting, as a derived variable does.
  const ordered = [...given].sort((a, b) => Number(Boolean(definitions.get(b.name)?.alias)) - Number(Boolean(definitions.get(a.name)?.alias)));
  const stdin = given.filter((f) => definitions.get(f.name)?.stdin);
  if (stdin.length > 1) {
    errors.push(`${stdin.map((f) => f.name).join(", ")}: a run reads at most one secret from standard input`);
  }
  for (const flag of ordered) {
    const definition = definitions.get(flag.name);
    if (!definition) {
      errors.push(`${flag.name}: is not a flag of the ${options.kind} configuration`);
      continue;
    }
    if (definition.stdin) {
      if (stdin.length > 1) continue;
      const read = options.readStdin ?? (() => readFileSync(0, "utf8"));
      setAt(layer.data, definition.stdin.split("."), { value: read().trim() });
      layer.names.set(`${definition.stdin}.value`, flag.name);
      continue;
    }
    const leaf = definition.leaf!;
    if (layer.names.has(leaf.dotted)) continue;
    let value: unknown;
    if (leaf.type === "boolean") {
      value = definition.negate ? false : true;
    } else {
      const converted = convert(leaf, String(flag.value));
      if (converted.error) {
        errors.push(`${leaf.dotted}: ${converted.error} (${flag.name})`);
        continue;
      }
      value = converted.value;
    }
    setAt(layer.data, leaf.path, value);
    layer.names.set(leaf.dotted, flag.name);
  }
  return layer;
}

// ---------- Validation of one layer ----------

const EXPECTED: Record<string, string> = {
  "vault-address":
    "an https:// or http:// URL, which may end in a base path, or unix:// and an absolute socket path, with no user name, password, query or fragment",
  "vault-proxy": "an http:// or https:// URL with a host and optional port only, with no user name, password, path, query or fragment",
  "vault-mount": "a path of non-empty segments, none of them `.` or `..`",
  duration: "a whole number followed by ms, s, m or h, such as 10s",
};

function isUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:[^\s]*$/i.test(value) && URL.canParse(value);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  return `a ${typeof value}`;
}

class LayerValidator {
  constructor(
    private readonly layer: Layer,
    private readonly report: (path: string, message: string) => void,
  ) {}

  check(value: unknown, node: Schema, path: string[]): void {
    const def = refName(node);
    if (def === "secret" || def === "local-secret") return this.secret(value, def, path);
    if (def === "vault-auth") return this.auth(value, path);
    this.value(value, resolve(node), path, def);
  }

  private where(path: string[]): string {
    return path.join(".") || "(top level)";
  }

  private value(value: unknown, schema: Schema, path: string[], def: string | undefined): void {
    const at = this.where(path);
    if (schema.anyOf && schema.type === "string" && typeof value === "string") {
      const passes = (schema.anyOf as Schema[]).some((branch) => this.passes(value, { type: "string", ...branch }));
      if (!passes) this.report(at, path.join(".") === "server.url" ? "expected an http:// or https:// URL, or an empty value" : "is not an accepted value");
      return;
    }
    if (schema.type === "object" || schema.properties) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        this.report(at, `expected a mapping, got ${typeName(value)}`);
        return;
      }
      const known = new Map(properties(schema));
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        const property = known.get(key);
        if (!property) {
          this.report([...path, key].join("."), "is not a setting");
          continue;
        }
        this.check(inner, property, [...path, key]);
      }
      for (const required of (schema.required ?? []) as string[]) {
        if ((value as Record<string, unknown>)[required] === undefined) this.report(at, `is missing ${required}`);
      }
      return;
    }
    const problem = this.problem(value, schema, def);
    if (problem) this.report(at, problem);
  }

  private passes(value: unknown, schema: Schema): boolean {
    return this.problem(value, schema, undefined) === undefined;
  }

  private problem(value: unknown, schema: Schema, def: string | undefined): string | undefined {
    const expected = def ? EXPECTED[def] : undefined;
    if (schema.const !== undefined) return value === schema.const ? undefined : `expected ${JSON.stringify(schema.const)}`;
    if (schema.enum && !(schema.enum as unknown[]).includes(value)) return `expected one of ${(schema.enum as unknown[]).join(", ")}`;
    switch (schema.type) {
      case "string": {
        if (typeof value !== "string") return `expected a string, got ${typeName(value)}`;
        if (schema.minLength !== undefined && value.length < schema.minLength) return "must not be empty";
        if (schema.maxLength !== undefined && value.length > schema.maxLength) return "must be empty";
        if (schema.format === "uri" && !isUri(value)) return `expected ${expected ?? "a URI"}`;
        if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) return `expected ${expected ?? `a value matching ${schema.pattern}`}`;
        return undefined;
      }
      case "integer":
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) return `expected ${schema.type === "integer" ? "an integer" : "a number"}, got ${typeName(value)}`;
        if (schema.type === "integer" && !Number.isInteger(value)) return "expected an integer";
        if (schema.minimum !== undefined && value < schema.minimum) return `expected at least ${schema.minimum}`;
        if (schema.maximum !== undefined && value > schema.maximum) return `expected at most ${schema.maximum}`;
        return undefined;
      }
      case "boolean":
        return typeof value === "boolean" ? undefined : `expected true or false, got ${typeName(value)}`;
      case "array": {
        if (!Array.isArray(value)) return `expected a list, got ${typeName(value)}`;
        if (schema.minItems !== undefined && value.length < schema.minItems) return "must not be empty";
        for (const item of value) {
          const inner = this.problem(item, schema.items ?? {}, undefined);
          if (inner) return `each item: ${inner}`;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  private secret(value: unknown, def: "secret" | "local-secret", path: string[]): void {
    const at = this.where(path);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.report(at, `expected a source mapping, got ${typeName(value)}`);
      return;
    }
    const keys = def === "secret" ? ["value", "file", "command", "vault"] : ["value", "file", "command"];
    const record = value as Record<string, unknown>;
    const sources = keys.filter((key) => record[key] !== undefined);
    if (sources.length === 0) {
      if (record.timeout !== undefined) this.report(at, "sets timeout without command");
      else this.report(at, `sets no source; expected exactly one of ${keys.join(", ")}`);
      return;
    }
    if (sources.length > 1) {
      this.report(at, `sets ${sources.length} sources (${sources.join(", ")}); expected exactly one`);
      return;
    }
    if (sources[0] !== "command" && record.timeout !== undefined) {
      this.report(at, "sets timeout without command");
      return;
    }
    const branch = (resolve({ $ref: `#/$defs/${def}` }).oneOf as Schema[]).find((b) => (resolve(b).required as string[]).includes(sources[0]!))!;
    this.value(value, resolve(branch), path, undefined);
  }

  private auth(value: unknown, path: string[]): void {
    const at = this.where(path);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      this.report(at, `expected an auth mapping, got ${typeName(value)}`);
      return;
    }
    const mode = (value as Record<string, unknown>).mode;
    const branches = (resolve({ $ref: "#/$defs/vault-auth" }).oneOf as Schema[]).map(resolve);
    if (mode === undefined) {
      this.report(at, "sets no mode; expected mode token, approle or none");
      return;
    }
    const branch = branches.find((b) => b.properties.mode.const === mode);
    if (!branch) {
      this.report(`${at}.mode`, "expected token, approle or none");
      return;
    }
    const known = new Map(Object.entries(branch.properties as Record<string, Schema>));
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (!known.has(key)) this.report(`${at}.${key}`, `is not a setting of mode ${String(mode)}`);
    }
    for (const [key, property] of known) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner === undefined) continue;
      if (key === "mode") continue;
      this.check(inner, property, [...path, key]);
    }
    for (const required of branch.required as string[]) {
      if ((value as Record<string, unknown>)[required] === undefined) this.report(at, `is missing ${required} for mode ${String(mode)}`);
    }
  }
}

function layerLabel(layer: Layer, path: string): string {
  if (layer.kind === "file") return layer.file!;
  const names = [...layer.names].filter(([leaf]) => leaf === path || leaf.startsWith(`${path}.`) || path.startsWith(`${leaf}.`)).map(([, name]) => name);
  return [...new Set(names)].join(", ") || layer.kind;
}

function validateLayer(kind: ConfigurationKind, layer: Layer, errors: string[]): void {
  const validator = new LayerValidator(layer, (path, message) => errors.push(`${path}: ${message} (${layerLabel(layer, path)})`));
  validator.check(layer.data, settings(kind).schema, []);
}

// ---------- Merge ----------

interface Chosen {
  layer: number;
  value: unknown;
}

function pick(layers: Layer[], path: readonly string[], upTo = layers.length - 1): Chosen | undefined {
  for (let index = upTo; index >= 0; index--) {
    const value = getAt(layers[index]!.data, path);
    if (value !== undefined) return { layer: index, value };
  }
  return undefined;
}

function originOf(layers: Layer[], chosen: Chosen | undefined, dotted: string): Origin {
  if (!chosen) return { kind: "unset" };
  const layer = layers[chosen.layer]!;
  if (layer.kind === "default") return { kind: "default" };
  if (layer.kind === "file") return { kind: "file", file: layer.file! };
  const name = layer.names.get(dotted) ?? [...layer.names].find(([leaf]) => leaf.startsWith(`${dotted}.`))?.[1] ?? layer.kind;
  return { kind: layer.kind, name };
}

/** A Vault address reduced to what identifies its server. */
export function normalizeServer(address: string): string {
  if (address.startsWith("unix://")) return `unix://${normalize(address.slice("unix://".length))}`;
  const url = new URL(address);
  const port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return `${url.protocol}//${url.hostname.toLowerCase()}${port ? `:${port}` : ""}${url.pathname.replace(/\/+$/, "")}`;
}

function timeoutMs(timeout: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(timeout)!;
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] as "ms" | "s" | "m" | "h"];
  return Number(match[1]) * scale;
}

function localSource(raw: Record<string, unknown>, layer: Layer, home: string): LocalSource {
  if (raw.value !== undefined) return { kind: "value", value: String(raw.value).trim() };
  if (raw.file !== undefined) return { kind: "file", file: expandPath(String(raw.file), layer.dir, home) };
  const argv = [...(raw.command as string[])];
  if (argv[0]!.includes("/") || argv[0]!.startsWith("~")) argv[0] = expandPath(argv[0]!, layer.dir, home);
  const timeout = (raw.timeout as string | undefined) ?? "10s";
  return { kind: "command", argv, cwd: layer.dir, timeout, timeoutMs: timeoutMs(timeout) };
}

function boundAuth(raw: Record<string, unknown>, layer: Layer, layerIndex: number, path: string, home: string, boundTo: string | undefined): BoundAuth {
  const mode = raw.mode as BoundAuth["mode"];
  const declaredIn: Origin = layer.kind === "file" ? { kind: "file", file: layer.file! } : { kind: layer.kind as "env" | "flag", name: layerLabel(layer, path).split(", ")[0]! };
  return {
    mode,
    mount: String(raw.mount ?? "approle"),
    ...(raw["role-id"] !== undefined ? { roleId: String(raw["role-id"]).trim() } : {}),
    ...(raw.token !== undefined ? { token: localSource(raw.token as Record<string, unknown>, layer, home) } : {}),
    ...(raw["secret-id"] !== undefined ? { secretId: localSource(raw["secret-id"] as Record<string, unknown>, layer, home) } : {}),
    declaredIn,
    id: `${layerIndex}:${path}`,
    ...(boundTo ? { boundTo } : {}),
  };
}

const CONNECTION_FIELDS = ["address", "namespace", "mount", "kv-version", "ca-cert", "proxy"] as const;

/** Loads one configuration. Errors are collected, not thrown; see `assertValid`. */
export function loadConfiguration(options: LoadOptions): Configuration {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const systemDir = options.systemDir ?? "/etc/seek";
  const kind = options.kind;
  const errors: string[] = [];
  const configuration: Configuration = {
    kind,
    files: [],
    errors,
    layerErrors: false,
    plain: new Map(),
    secrets: new Map(),
    defaultFile: defaultFile(kind, env, home, systemDir),
  };

  const defaults: Layer = { kind: "default", dir: cwd, data: {}, names: new Map() };
  for (const leaf of settings(kind).leaves) {
    if (!leaf.mapping && leaf.default !== undefined) setAt(defaults.data, leaf.path, leaf.default);
  }
  const layers: Layer[] = [defaults];

  const explicit = explicitConfig({ ...options, env, cwd, home });
  const candidates = explicit ? [explicit] : kind === "client" ? [join(systemDir, "client.yml"), configuration.defaultFile] : [configuration.defaultFile];
  for (const file of candidates) {
    if (!explicit && !existsSync(file)) continue;
    if (explicit && !existsSync(file)) {
      errors.push(`${file}: the configuration file does not exist`);
      continue;
    }
    if (statSync(file).isDirectory()) {
      errors.push(`${file}: is a directory, not a configuration file`);
      continue;
    }
    const layer = readLayerFile(file, errors);
    if (layer) {
      layers.push(layer);
      configuration.files.push(file);
    }
  }
  layers.push(environmentLayer(kind, env, cwd, errors));
  layers.push(flagLayer({ ...options, env }, cwd, errors));

  for (const layer of layers.slice(1)) validateLayer(kind, layer, errors);
  if (errors.length > 0) {
    configuration.layerErrors = true;
    return configuration;
  }

  const model = settings(kind);
  for (const leaf of model.leaves) {
    if (leaf.mapping) continue;
    const chosen = pick(layers, leaf.path);
    const value = chosen?.value as string | number | boolean | undefined;
    configuration.plain.set(leaf.dotted, { path: leaf.dotted, ...(value !== undefined ? { value } : {}), origin: originOf(layers, chosen, leaf.dotted) });
  }
  const serverUrl = configuration.plain.get("server.url");
  if (typeof serverUrl?.value === "string") serverUrl.value = serverUrl.value.replace(/\/+$/, "");

  const topAddress = (upTo?: number) => pick(layers, ["vault", "address"], upTo)?.value as string | undefined;
  const topAuthPick = pick(layers, ["vault", "auth"]);
  let topAuth: BoundAuth | undefined;
  if (topAuthPick) {
    const layer = layers[topAuthPick.layer]!;
    const aliasBound = layer.aliasToken && layer.names.get("vault.auth.mode") === layer.aliasToken.name ? layer.aliasToken.address : undefined;
    const address = aliasBound ?? topAddress(topAuthPick.layer);
    topAuth = boundAuth(topAuthPick.value as Record<string, unknown>, layer, topAuthPick.layer, "vault.auth", home, address ? normalizeServer(address) : undefined);
    configuration.vaultAuth = { auth: topAuth, origin: originOf(layers, topAuthPick, "vault.auth") };
  }

  const trustCache = new Map<string, Trust>();
  const trustFor = (caCert: string | undefined, where: string): Trust | undefined => {
    const cacheKey = caCert ?? "";
    if (!trustCache.has(cacheKey)) {
      try {
        trustCache.set(cacheKey, buildTrust(caCert, env));
      } catch (error) {
        errors.push(`${where}: ${(error as Error).message}`);
        return undefined;
      }
    }
    return trustCache.get(cacheKey);
  };

  for (const secret of model.secrets) {
    const chosen = pick(layers, secret.split("."));
    const origin = originOf(layers, chosen, secret);
    const entry: EffectiveSecret = { path: secret, origin };
    configuration.secrets.set(secret, entry);
    if (!chosen) continue;
    const layer = layers[chosen.layer]!;
    const raw = chosen.value as Record<string, unknown>;
    if (raw.vault === undefined) {
      entry.source = localSource(raw, layer, home);
      continue;
    }
    const own = raw.vault as Record<string, unknown>;
    const field = (name: (typeof CONNECTION_FIELDS)[number]): { value: unknown; layer: Layer } | undefined => {
      if (own[name] !== undefined) return { value: own[name], layer };
      const top = pick(layers, ["vault", name]);
      return top ? { value: top.value, layer: layers[top.layer]! } : undefined;
    };
    const address = (field("address")?.value as string | undefined)?.replace(/\/+$/, "");
    const caCertField = field("ca-cert");
    const caCert = caCertField ? expandPath(String(caCertField.value), caCertField.layer.dir, home) : undefined;
    const namespace = field("namespace")?.value as string | undefined;
    const proxy = field("proxy")?.value as string | undefined;
    const block: VaultBlock = {
      ...(address ? { address, server: normalizeServer(address) } : {}),
      ...(namespace !== undefined ? { namespace } : {}),
      mount: String(field("mount")?.value ?? "secret"),
      kvVersion: Number(field("kv-version")?.value ?? 2) as 1 | 2,
      path: String(own.path),
      key: String(own.key),
      ...(caCert ? { caCert } : {}),
      ...(proxy ? { proxy: proxy.replace(/\/+$/, "") } : {}),
    };
    let auth: BoundAuth | undefined;
    if (own.auth !== undefined) {
      const ownAddress = (own.address as string | undefined) ?? topAddress(chosen.layer);
      auth = boundAuth(own.auth as Record<string, unknown>, layer, chosen.layer, `${secret}.vault.auth`, home, ownAddress ? normalizeServer(ownAddress) : undefined);
    } else {
      auth = topAuth;
    }
    const where = `${secret}.vault`;
    if (!block.server) {
      errors.push(`${where}: has no Vault address; set vault.address, or address in the secret's own vault block (${describeOrigin(origin)})`);
    } else if (!auth) {
      errors.push(`${where}: has no auth mapping for ${redactUrl(block.server)}; set vault.auth, or auth in the secret's own vault block (${describeOrigin(origin)})`);
    } else if (auth.boundTo !== block.server) {
      errors.push(
        `${where}: uses the auth mapping declared in ${describeOrigin(auth.declaredIn)}, which is ${auth.boundTo ? `bound to ${redactUrl(auth.boundTo)}` : "unbound"}, ` +
          `but the block's server is ${redactUrl(block.server)}; give the secret its own vault address and auth, or declare the auth mapping beside that server`,
      );
    } else {
      block.auth = auth;
    }
    const trust = block.server ? trustFor(caCert, caCertField && own["ca-cert"] === undefined ? "vault.ca-cert" : `${where}.ca-cert`) : undefined;
    if (trust) block.trust = trust;
    entry.source = { kind: "vault", vault: block };
  }

  if (kind === "server" && configuration.plain.get("server.require-token")?.value === true && !configuration.secrets.get("server.tokens")?.source) {
    errors.push(missingSecretMessage("server.tokens", configuration) + " Or set server.require-token to false (--no-auth) on a trusted network.");
  }
  return configuration;
}

/** The message for a secret with no source: its path, its main variables and the file to add it to. */
export function missingSecretMessage(secret: string, configuration: Pick<Configuration, "defaultFile" | "kind">): string {
  const path = secret.split(".");
  const variables = [envName([...path, "value"]), envName([...path, "file"])];
  return (
    `${secret} has no source. Set ${variables[0]} or ${variables[1]}, ` +
    `pass ${flagName([...path, "file"])}, or add ${secret} to ${configuration.defaultFile}` +
    (configuration.kind === "client" ? " (seek config init writes a template)." : ".")
  );
}
