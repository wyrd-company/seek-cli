import { configPath, loadConfig } from "./config.ts";

export class MissingEnvError extends Error {
  constructor(varName: string, provider: string) {
    super(
      `Missing API key for ${provider}. Set the ${varName} environment variable, ` +
        `or add it to ${configPath()}.\n` +
        `  export ${varName}=...\n` +
        `  # or: seek config init   (then edit the file)`,
    );
    this.name = "MissingEnvError";
  }
}

export function requireEnv(name: string, provider: string): string {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  const fromConfig = loadConfig()[name];
  if (fromConfig && fromConfig.trim() !== "") return fromConfig;
  throw new MissingEnvError(name, provider);
}
