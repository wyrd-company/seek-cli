import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { createProgram } from "../src/program.ts";
import { CONFIGURATION_GROUP } from "../src/lib/options.ts";
import { RESERVED_ENV, RESERVED_FLAGS, settings, type ConfigurationKind } from "../src/lib/settings.ts";
import { compileDefinitions } from "../scripts/docs/validate.ts";

// The configuration schemas are the contract. These tests derive every
// environment variable and flag from the schemas, with the rule the
// specification states, and bind them to the loader and to the options the
// program declares.

type Schema = Record<string, any>;

const read = (name: string): Schema => JSON.parse(readFileSync(`docs/specifications/${name}`, "utf8")) as Schema;
const shared = read("configuration.secrets.schema.json");
const schemas: Record<ConfigurationKind, Schema> = {
  client: read("configuration.client.schema.json"),
  server: read("configuration.server.schema.json"),
};

function deref(node: Schema): Schema {
  while (typeof node.$ref === "string") node = shared.$defs[node.$ref.split("/").pop()!];
  return node;
}

interface Derived {
  path: string;
  env: string[];
  flags: string[];
}

/** Every scalar path of a schema, its derived variable and flag, and the aliases annotated beside it. */
function derive(node: Schema, path: string[] = [], out: Derived[] = [], aliases: Schema = {}): Derived[] {
  const resolved = deref(node);
  const isScalar = ["string", "integer", "number", "boolean", "array"].includes(resolved.type) || resolved.const !== undefined;
  if (path.length > 0 && isScalar) {
    const dotted = path.join(".");
    const flag = `--${path.join("-")}`;
    out.push({
      path: dotted,
      env: [`SEEK_${path.join("_").toUpperCase().replaceAll("-", "_")}`, ...(aliases["x-env-aliases"] ?? [])],
      flags: path.at(-1) === "value" ? [] : [flag, ...(resolved.type === "boolean" ? [flag.replace(/^--/, "--no-")] : []), ...(aliases["x-flag-aliases"] ?? [])],
    });
    return out;
  }
  const branches: Schema[] = resolved.properties ? [resolved] : (resolved.oneOf ?? []).map(deref);
  const seen = new Set<string>();
  for (const branch of branches) {
    for (const [name, property] of Object.entries((branch.properties ?? {}) as Record<string, Schema>)) {
      if (seen.has(name)) continue;
      seen.add(name);
      derive(property, [...path, name], out, property);
    }
  }
  return out;
}

const derived = { client: derive(schemas.client), server: derive(schemas.server) };
const secretPaths = (kind: ConfigurationKind) =>
  Object.entries(schemas[kind].properties.server.properties as Record<string, Schema>)
    .filter(([, p]) => p.$ref?.endsWith("/secret"))
    .map(([name]) => `server.${name}`)
    .concat(Object.keys(shared.$defs.providers.properties).map((id) => `providers.${id}.api-key`));

function walk(command: Command, path: string[] = []): Array<[string[], Command]> {
  return [[path, command], ...command.commands.flatMap((child) => walk(child, [...path, child.name()]))];
}

function configurationFlags(command: Command): string[] {
  return command.options.filter((o) => o.helpGroupHeading === CONFIGURATION_GROUP).map((o) => o.long!);
}

function expectedFlags(kind: ConfigurationKind): string[] {
  return [...derived[kind].flatMap((d) => d.flags), ...secretPaths(kind).map((s) => `--${s.replaceAll(".", "-")}-stdin`)];
}

describe("names derived from the configuration schemas", () => {
  for (const kind of ["client", "server"] as const) {
    test(`the ${kind} loader reads exactly the derived variables and flags`, () => {
      const model = settings(kind);
      expect(model.leaves.map((l) => l.dotted)).toEqual(derived[kind].map((d) => d.path));
      expect(model.leaves.map((l) => [l.env, ...l.envAliases])).toEqual(derived[kind].map((d) => d.env));
      expect(model.secrets.sort()).toEqual(secretPaths(kind).sort());
    });

    test(`every ${kind} name is unique and none is reserved`, () => {
      const env = derived[kind].flatMap((d) => d.env);
      const flags = expectedFlags(kind);
      expect(new Set(env).size).toBe(env.length);
      expect(new Set(flags).size).toBe(flags.length);
      for (const name of RESERVED_ENV) expect(env).not.toContain(name);
      for (const name of RESERVED_FLAGS) expect(flags).not.toContain(name);
      expect(RESERVED_FLAGS).toEqual(["--config", "-c", "--help", "-h", "--version", "-V"]);
    });
  }

  test("each scalar of a secret's own vault and auth blocks has a variable and a flag", () => {
    const client = derived.client.map((d) => d.path);
    expect(client).toContain("providers.exa.api-key.vault.address");
    expect(client).toContain("providers.exa.api-key.vault.auth.role-id");
    const roleId = derived.client.find((d) => d.path === "providers.exa.api-key.vault.auth.role-id")!;
    expect(roleId.flags).toEqual(["--providers-exa-api-key-vault-auth-role-id"]);
    expect(derived.client.find((d) => d.path === "providers.exa.api-key.vault.address")!.env).toEqual(["SEEK_PROVIDERS_EXA_API_KEY_VAULT_ADDRESS"]);
    expect(derived.client.find((d) => d.path === "providers.brave-search.api-key.file")!.env).toEqual(["SEEK_PROVIDERS_BRAVE_SEARCH_API_KEY_FILE"]);
    expect(derived.client.filter((d) => d.path.endsWith(".value")).every((d) => d.flags.length === 0)).toBe(true);
  });

  test("the only aliases are the Vault and OpenBao variables and the three server flags", () => {
    const envAliases = [...derived.client, ...derived.server].flatMap((d) => d.env.filter((e) => !e.startsWith("SEEK_")));
    expect(new Set(envAliases)).toEqual(new Set(["BAO_ADDR", "VAULT_ADDR", "BAO_NAMESPACE", "VAULT_NAMESPACE"]));
    expect(schemas.client.properties.vault.$ref).toBeDefined();
    expect(shared.$defs.vault.properties.auth["x-env-aliases"]).toEqual(["BAO_TOKEN", "VAULT_TOKEN"]);
    const flagAliases = derived.server.flatMap((d) => d.flags.filter((f) => !f.startsWith(`--${d.path.replaceAll(".", "-")}`) && !f.startsWith(`--no-${d.path.replaceAll(".", "-")}`)));
    expect(flagAliases).toEqual(["--host", "--port", "--no-auth"]);
  });
});

describe("the program declares the derived flags", () => {
  const tree = walk(createProgram()).filter(([path]) => path.length > 0);
  const byPath = new Map(tree.map(([path, command]) => [path.join(" "), command]));

  test("every provider command takes the client configuration's flags, and only those", () => {
    const leaves = tree.filter(([path, command]) => ["web", "research", "scrape"].includes(path[0]!) && command.commands.length === 0);
    expect(leaves.length).toBe(14);
    for (const [, command] of leaves) {
      expect(configurationFlags(command)).toEqual(["--config", ...expectedFlags("client")]);
      const own = command.options.filter((o) => o.helpGroupHeading !== CONFIGURATION_GROUP).flatMap((o) => [o.long, o.short]);
      for (const flag of expectedFlags("client")) expect(own).not.toContain(flag);
    }
  });

  test("seek serve takes the server configuration's flags", () => {
    expect(configurationFlags(byPath.get("serve")!)).toEqual(["--config", ...expectedFlags("server")]);
  });

  test("seek config show and validate take both configurations' flags; path and init take --config", () => {
    const union = [...new Set([...expectedFlags("client"), ...expectedFlags("server")])];
    for (const name of ["show", "validate"]) expect(configurationFlags(byPath.get(`config ${name}`)!).sort()).toEqual(["--config", ...union].sort());
    for (const name of ["path", "init"]) expect(configurationFlags(byPath.get(`config ${name}`)!)).toEqual(["--config"]);
  });

  test("seek skill reads no configuration", () => {
    expect(configurationFlags(byPath.get("skill")!)).toEqual([]);
  });

  test("--help lists the configuration flags after the command's own options", () => {
    const exa = byPath.get("web exa")!;
    let help = "";
    exa.configureOutput({ getOutHelpWidth: () => 80, writeOut: (text) => (help += text) });
    exa.outputHelp();
    const own = help.indexOf("\nOptions:\n");
    const configuration = help.indexOf(`\n${CONFIGURATION_GROUP}\n`);
    expect(own).toBeGreaterThan(0);
    expect(configuration).toBeGreaterThan(own);
    for (const flag of expectedFlags("client")) expect(help.slice(configuration)).toContain(`  ${flag}`);
    expect(help.split("\n").every((line) => line.length <= 80)).toBe(true);
  });
});

describe("the configuration definitions", () => {
  const validators = compileDefinitions();

  test("compile under Ajv strict mode with the alias annotations registered", () => {
    for (const name of ["configuration.client.schema.json", "configuration.server.schema.json", "configuration.show.schema.json"]) {
      expect(validators.schemas.get(name)).toBeDefined();
    }
  });

  test("their own examples validate", () => {
    for (const name of ["configuration.client.schema.json", "configuration.server.schema.json", "configuration.show.schema.json"]) {
      const validate = validators.schemas.get(name)!;
      const examples = read(name).examples as unknown[];
      expect(examples.length).toBeGreaterThan(0);
      for (const example of examples) expect(validate(example), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  test("the defaults the loader applies are the schema defaults", () => {
    const server = settings("server").leaves.filter((l) => !l.mapping && l.default !== undefined);
    expect(Object.fromEntries(server.map((l) => [l.dotted, l.default]))).toEqual({
      "server.host": "127.0.0.1",
      "server.port": 8787,
      "server.require-token": true,
      "server.secret-refresh-seconds": 300,
      "vault.mount": "secret",
      "vault.kv-version": 2,
    });
  });
});
