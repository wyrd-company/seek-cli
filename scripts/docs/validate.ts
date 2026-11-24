/**
 * Validation of seek's definitions and of the examples published with the
 * docs, with the Ajv in the lockfile: JSON Schema 2020-12, strict mode.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFINITIONS, ROOT } from "./paths.ts";

type Schema = Record<string, any>;

/** How the check proves an example in docs/user/examples/ holds. */
export type ExampleCheck =
  | { kind: "schema"; definition: string }
  | { kind: "openapi"; method: string; path: string; status: string }
  | { kind: "script"; test: string };

/** Every published example and the definition it must validate against, or the test that runs it. */
export const EXAMPLES: Record<string, ExampleCheck> = {
  "examples/client.yml": { kind: "schema", definition: DEFINITIONS.configurationClient },
  "examples/client-with-server.yml": { kind: "schema", definition: DEFINITIONS.configurationClient },
  "examples/server.yml": { kind: "schema", definition: DEFINITIONS.configurationServer },
  "examples/research-job-submitted.json": { kind: "schema", definition: DEFINITIONS.researchJobEnvelope },
  "examples/research-job-result.json": { kind: "schema", definition: DEFINITIONS.researchJobEnvelope },
  "examples/health.response.json": { kind: "openapi", method: "get", path: "/healthz", status: "200" },
  "examples/unauthorized.response.json": { kind: "openapi", method: "post", path: "/v1/proxy/exa/search", status: "401" },
  "examples/practice-server.mjs": { kind: "script", test: "tests/documentation.test.ts" },
  "examples/server-client.mjs": { kind: "script", test: "tests/documentation.test.ts" },
};

/** An RFC 3986 URI with a scheme, as `format: uri` requires. */
function isUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:[^\s]*$/i.test(value) && URL.canParse(value);
}

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("uri", isUri);
  // OpenAPI's own schema keywords, and the configuration schemas' alias annotations.
  ajv.addVocabulary(["example", "xml", "externalDocs", "discriminator", "x-env-aliases", "x-flag-aliases"]);
  return ajv;
}

export function readSpecificationJson(name: string, root = ROOT): Schema {
  return JSON.parse(readFileSync(join(root, "docs/specifications", name), "utf8")) as Schema;
}

export function readOpenApi(root = ROOT): Schema {
  return Bun.YAML.parse(readFileSync(join(root, "docs/specifications", DEFINITIONS.httpApi), "utf8")) as Schema;
}

/** A JSON Schema for one OpenAPI schema, with the document's components as its $defs. */
export function openApiSchema(document: Schema, schema: Schema): Schema {
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [
          key,
          key === "$ref" && typeof inner === "string" ? inner.replace("#/components/schemas/", "#/$defs/") : rewrite(inner),
        ]),
      );
    }
    return value;
  };
  return { $defs: rewrite(document.components?.schemas ?? {}), ...(rewrite(schema) as Schema) };
}

function resolveRef(document: Schema, value: Schema): Schema {
  let current = value;
  while (current && typeof current.$ref === "string") {
    current = current.$ref
      .slice(2)
      .split("/")
      .reduce((node: any, key: string) => node?.[key], document);
  }
  return current;
}

/** The JSON schema of one operation's response, or an error naming what is missing. */
export function responseSchema(document: Schema, method: string, path: string, status: string): Schema {
  const operation = document.paths?.[path]?.[method];
  if (!operation) throw new Error(`${method.toUpperCase()} ${path} is not in ${DEFINITIONS.httpApi}`);
  const response = operation.responses?.[status];
  if (!response) throw new Error(`${method.toUpperCase()} ${path} has no ${status} response`);
  const media = resolveRef(document, response).content?.["application/json"];
  if (!media?.schema) throw new Error(`${method.toUpperCase()} ${path} ${status} has no application/json schema`);
  return openApiSchema(document, media.schema);
}

export function describeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

export interface Validators {
  ajv: Ajv2020;
  schemas: Map<string, ValidateFunction>;
  openapi: Schema;
}

/** The JSON Schema definitions: the shared configuration shapes first, which the others refer to. */
export const JSON_SCHEMAS = [
  DEFINITIONS.configurationSecrets,
  DEFINITIONS.configurationClient,
  DEFINITIONS.configurationServer,
  DEFINITIONS.configurationShow,
  DEFINITIONS.researchJobEnvelope,
] as const;

/** Compiles every JSON Schema definition; throws with the definition's name when one does not compile. */
export function compileDefinitions(root = ROOT): Validators {
  const ajv = createAjv();
  const schemas = new Map<string, ValidateFunction>();
  try {
    ajv.addSchema(readSpecificationJson(DEFINITIONS.configurationSecrets, root));
  } catch (error) {
    throw new Error(`${DEFINITIONS.configurationSecrets} does not compile: ${(error as Error).message}`);
  }
  for (const name of JSON_SCHEMAS) {
    try {
      schemas.set(name, name === DEFINITIONS.configurationSecrets ? ajv.getSchema(name)! : ajv.compile(readSpecificationJson(name, root)));
    } catch (error) {
      throw new Error(`${name} does not compile: ${(error as Error).message}`);
    }
  }
  return { ajv, schemas, openapi: readOpenApi(root) };
}

/** Validation errors of a JSON value against an example's declared definition; empty when it is valid. */
export function validateExample(validators: Validators, check: ExampleCheck, value: unknown): string {
  if (check.kind === "script") return "";
  const validate =
    check.kind === "schema"
      ? validators.schemas.get(check.definition)
      : validators.ajv.compile(responseSchema(validators.openapi, check.method, check.path, check.status));
  if (!validate) return `no compiled definition ${(check as { definition: string }).definition}`;
  return validate(value) ? "" : describeErrors(validate.errors) || "invalid";
}

/** Each inline `example` in the OpenAPI document that does not validate against its schema. */
export function invalidOpenApiExamples(validators: Validators): string[] {
  const failures: string[] = [];
  const document = validators.openapi;
  const visit = (where: string, media: Schema | undefined) => {
    if (!media || media.example === undefined || !media.schema) return;
    const validate = validators.ajv.compile(openApiSchema(document, media.schema));
    if (!validate(media.example)) failures.push(`${where}: ${describeErrors(validate.errors)}`);
  };
  for (const [name, response] of Object.entries((document.components?.responses ?? {}) as Record<string, Schema>)) {
    for (const [type, media] of Object.entries((response.content ?? {}) as Record<string, Schema>)) visit(`components/responses/${name} ${type}`, media);
  }
  for (const [path, item] of Object.entries((document.paths ?? {}) as Record<string, Schema>)) {
    for (const [method, operation] of Object.entries(item as Record<string, Schema>)) {
      for (const [status, response] of Object.entries((operation.responses ?? {}) as Record<string, Schema>)) {
        if (response.$ref) continue;
        for (const [type, media] of Object.entries((response.content ?? {}) as Record<string, Schema>)) {
          visit(`${method.toUpperCase()} ${path} ${status} ${type}`, media);
        }
      }
    }
  }
  return failures;
}
