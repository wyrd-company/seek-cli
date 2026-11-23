import { loadConfig } from "../lib/config.ts";
import type { VaultSecretSource } from "./vault.ts";

/**
 * Resolves Seek secrets: process env first, then
 * Vault/OpenBao when configured, then the seek config file.
 */
export class SecretResolver {
  constructor(
    private readonly vault: Pick<VaultSecretSource, "get"> | null = null,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly config: () => Record<string, string> = loadConfig,
  ) {}

  async get(name: string): Promise<string | undefined> {
    const fromEnv = this.env[name]?.trim();
    if (fromEnv) return fromEnv;
    const fromVault = (await this.vault?.get(name))?.trim();
    if (fromVault) return fromVault;
    const fromConfig = this.config()[name]?.trim();
    return fromConfig || undefined;
  }

  /** Accepted client tokens; SEEK_SERVER_TOKEN may hold a comma-separated list for rotation. */
  async serverTokens(): Promise<string[]> {
    const raw = (await this.get("SEEK_SERVER_TOKEN")) ?? "";
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }
}
