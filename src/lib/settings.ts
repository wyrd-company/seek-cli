/**
 * The settings seek reads, derived from the configuration schemas in
 * docs/specifications/. Every environment variable and flag that sets a
 * setting comes from here, so the schemas stay the single source of names.
 */
import clientSchema from "../../docs/specifications/configuration.client.schema.json" with { type: "json" };
import serverSchema from "../../docs/specifications/configuration.server.schema.json" with { type: "json" };
import secretsSchema from "../../docs/specifications/configuration.secrets.schema.json" with { type: "json" };

export type ConfigurationKind = "client" | "server";

// biome-ignore lint: the schemas are plain JSON.
export type Schema = Record<string, any>;

export const SCHEMAS: Readonly<Record<ConfigurationKind, Schema>> = { client: clientSchema, server: serverSchema };
export const SECRETS_SCHEMA: Schema = secretsSchema;

/** The names no setting may take: meta-options and their environment variable. */
export const RESERVED_FLAGS: readonly string[] = ["--config", "-c", "--help", "-h", "--version", "-V"];
export const RESERVED_ENV: readonly string[] = ["SEEK_CONFIG"];

/** Shared definitions whose mapping replaces a lower layer's mapping whole. */
const WHOLE = new Set(["secret", "local-secret", "vault-auth"]);

export type ScalarType = "string" | "integer" | "number" | "boolean" | "array";

/** One scalar setting, or a `command` array, at its YAML path. */
export interface Leaf {
  path: string[];
  dotted: string;
  type: ScalarType;
  /** The schema of the value, with its `$ref` resolved. */
  schema: Schema;
  description: string;
  env: string;
  envAliases: string[];
  /** The derived flag, or null for a `value`, which has none. */
  flag: string | null;
  flagAliases: string[];
  default?: unknown;
  /** The dotted path of the outermost mapping that holds this leaf and replaces whole, when it is inside one. */
  mapping?: string;
}

/** A setting whose value is a whole mapping: a secret, a local credential or a Vault `auth`. */
export interface Mapping {
  path: string[];
  dotted: string;
  description: string;
  def: "secret" | "local-secret" | "vault-auth";
  envAliases: string[];
}

export interface Settings {
  kind: ConfigurationKind;
  schema: Schema;
  leaves: readonly Leaf[];
  mappings: readonly Mapping[];
  /** The dotted paths of the secrets: provider keys and the client token or server tokens. */
  secrets: readonly string[];
}

/** The `$defs` name a reference points to in the shared schema, or undefined. */
export function refName(node: Schema | undefined): string | undefined {
  const ref = node?.$ref;
  if (typeof ref !== "string") return undefined;
  const match = /#\/\$defs\/([^/]+)$/.exec(ref);
  return match?.[1];
}

/** Resolves a reference into the shared definitions; other schemas are returned as they are. */
export function resolve(node: Schema): Schema {
  let current = node;
  for (let name = refName(current); name !== undefined; name = refName(current)) {
    const target = SECRETS_SCHEMA.$defs[name];
    if (!target) throw new Error(`unresolved $ref ${current.$ref}`);
    current = target;
  }
  return current;
}

/** The properties of an object schema, merged across the branches of a `oneOf`. */
export function properties(node: Schema): Array<[string, Schema]> {
  const resolved = resolve(node);
  if (resolved.properties) return Object.entries(resolved.properties as Record<string, Schema>);
  const seen = new Map<string, Schema>();
  for (const branch of (resolved.oneOf ?? []) as Schema[]) {
    for (const [name, property] of properties(branch)) {
      if (!seen.has(name)) seen.set(name, property);
    }
  }
  return [...seen];
}

/** The `const` values of `mode` across the branches of a Vault `auth` mapping. */
export function authModes(): string[] {
  return (SECRETS_SCHEMA.$defs["vault-auth"].oneOf as Schema[]).map((b) => resolve(b).properties.mode.const as string);
}

export function envName(path: readonly string[]): string {
  return `SEEK_${path.join("_").toUpperCase().replaceAll("-", "_")}`;
}

export function flagName(path: readonly string[]): string {
  return `--${path.join("-")}`;
}

function scalarType(schema: Schema): ScalarType | undefined {
  if (schema.type === "array") return "array";
  if (schema.type === "string" || schema.const !== undefined) return "string";
  if (schema.type === "integer" || schema.type === "number" || schema.type === "boolean") return schema.type;
  return undefined;
}

interface Building {
  leaves: Leaf[];
  mappings: Mapping[];
  secrets: string[];
}

function walk(node: Schema, path: string[], mapping: string | undefined, out: Building): void {
  const def = refName(node);
  const resolved = resolve(node);
  const dotted = path.join(".");
  if (def && WHOLE.has(def)) {
    out.mappings.push({ path, dotted, description: node.description ?? resolved.description ?? "", def: def as Mapping["def"], envAliases: node["x-env-aliases"] ?? [] });
    if (def === "secret") out.secrets.push(dotted);
    mapping ??= dotted;
  }
  const type = scalarType(resolved);
  if (type && path.length > 0) {
    const isValue = path.at(-1) === "value";
    out.leaves.push({
      path,
      dotted,
      type,
      schema: resolved,
      description: node.description ?? resolved.description ?? "",
      env: envName(path),
      envAliases: node["x-env-aliases"] ?? [],
      flag: isValue ? null : flagName(path),
      flagAliases: node["x-flag-aliases"] ?? [],
      ...(node.default !== undefined || resolved.default !== undefined ? { default: node.default ?? resolved.default } : {}),
      ...(mapping ? { mapping } : {}),
    });
    return;
  }
  for (const [name, property] of properties(resolved)) {
    if (name === "mode" && path.at(-1) === "auth") {
      walkMode([...path, name], mapping, out);
      continue;
    }
    walk(property, [...path, name], mapping, out);
  }
}

function walkMode(path: string[], mapping: string | undefined, out: Building): void {
  out.leaves.push({
    path,
    dotted: path.join("."),
    type: "string",
    schema: { type: "string", enum: authModes() },
    description: `How seek authenticates to the server: ${authModes().join(", ")}.`,
    env: envName(path),
    envAliases: [],
    flag: flagName(path),
    flagAliases: [],
    ...(mapping ? { mapping } : {}),
  });
}

const cache = new Map<ConfigurationKind, Settings>();

/** Every setting of one configuration, in schema order. */
export function settings(kind: ConfigurationKind): Settings {
  const cached = cache.get(kind);
  if (cached) return cached;
  const out = { kind, schema: SCHEMAS[kind], leaves: [] as Leaf[], mappings: [] as Mapping[], secrets: [] as string[] };
  walk(SCHEMAS[kind], [], undefined, out);
  // Every command and test shares this model, so nothing may reorder or change it.
  const frozen: Settings = Object.freeze({
    ...out,
    leaves: Object.freeze(out.leaves.map((leaf) => Object.freeze(leaf))),
    mappings: Object.freeze(out.mappings.map((mapping) => Object.freeze(mapping))),
    secrets: Object.freeze(out.secrets),
  });
  cache.set(kind, frozen);
  return frozen;
}

/** The flag that reads one secret from standard input, such as `--server-token-stdin`. */
export function stdinFlag(secret: string): string {
  return `${flagName(secret.split("."))}-stdin`;
}

/** The upstream ID of a provider key path such as `providers.exa.api-key`. */
export function providerOf(secret: string): string | undefined {
  return /^providers\.([^.]+)\.api-key$/.exec(secret)?.[1];
}
