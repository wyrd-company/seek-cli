/**
 * The certificate list a Vault connection trusts, built when the
 * configuration loads: the `ca-cert` file, or the inputs Bun's default store
 * reads (`us_get_default_ca_store` in Bun's root_certs.cpp), so that trust is
 * what seek 0.3 had and what `seek config show` reports, and does not change
 * until the next load.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

export type TrustInputName =
  | "ca-cert"
  | "bundled"
  | "NODE_EXTRA_CA_CERTS"
  | "SSL_CERT_FILE"
  | "built-in file"
  | "SSL_CERT_DIR"
  | "built-in directory"
  | "system";

export interface TrustInput {
  input: TrustInputName;
  path?: string;
  certificates: number;
}

export interface Trust {
  inputs: TrustInput[];
  /** The PEM certificates, passed as `ca` to every TLS connection. */
  ca: string[];
}

/** Bun's built-in OpenSSL locations. */
export const BUILT_IN_FILE = "/etc/ssl/cert.pem";
export const BUILT_IN_DIRECTORY = "/etc/ssl/certs";

/** OpenSSL's directory lookup opens only files named by a subject hash, such as `8d19b80a.0`. */
const HASHED = /^[0-9a-f]{8}\.\d+$/i;

export function pemCertificates(text: string): string[] {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

function readPem(path: string): string[] {
  try {
    return pemCertificates(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

function readHashedDirectory(path: string): string[] {
  let names: string[];
  try {
    names = readdirSync(path).filter((name) => HASHED.test(name)).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => readPem(join(path, name)));
}

export function buildTrust(caCert: string | undefined, env: Record<string, string | undefined>): Trust {
  if (caCert !== undefined) {
    let text: string;
    try {
      text = readFileSync(caCert, "utf8");
    } catch (error) {
      throw new Error(`the certificate file ${caCert} cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"})`);
    }
    const ca = pemCertificates(text);
    if (ca.length === 0) throw new Error(`the certificate file ${caCert} holds no PEM certificate`);
    return { inputs: [{ input: "ca-cert", path: caCert, certificates: ca.length }], ca };
  }
  const inputs: TrustInput[] = [];
  const ca: string[] = [];
  const add = (input: TrustInputName, certificates: string[], path?: string) => {
    inputs.push({ input, ...(path ? { path } : {}), certificates: certificates.length });
    ca.push(...certificates);
  };
  add("bundled", tls.getCACertificates("bundled"));
  const extra = env.NODE_EXTRA_CA_CERTS?.trim();
  if (extra) add("NODE_EXTRA_CA_CERTS", readPem(extra), extra);
  const file = env.SSL_CERT_FILE?.trim();
  if (file) add("SSL_CERT_FILE", readPem(file), file);
  else {
    const builtIn = readPem(BUILT_IN_FILE);
    if (builtIn.length > 0) add("built-in file", builtIn, BUILT_IN_FILE);
  }
  const directories = env.SSL_CERT_DIR?.trim();
  if (directories) {
    for (const directory of directories.split(":").filter(Boolean)) add("SSL_CERT_DIR", readHashedDirectory(directory), directory);
  } else {
    const builtIn = readHashedDirectory(BUILT_IN_DIRECTORY);
    if (builtIn.length > 0) add("built-in directory", builtIn, BUILT_IN_DIRECTORY);
  }
  if (env.NODE_USE_SYSTEM_CA?.trim() === "1") add("system", tls.getCACertificates("system"));
  return { inputs, ca };
}
