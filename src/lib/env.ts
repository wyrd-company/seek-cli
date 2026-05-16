export class MissingEnvError extends Error {
  constructor(varName: string, provider: string) {
    super(
      `Missing environment variable ${varName}. Set it to use the ${provider} provider.\n` +
        `  export ${varName}=...`,
    );
    this.name = "MissingEnvError";
  }
}

export function requireEnv(name: string, provider: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new MissingEnvError(name, provider);
  }
  return value;
}
