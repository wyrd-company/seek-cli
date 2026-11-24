/** Helpers the tests share. */
import type { ServerSecrets } from "../src/server/secrets.ts";
import { splitTokens } from "../src/server/secrets.ts";
import type { UpstreamId } from "../src/lib/upstreams.ts";

/** Fixed server secrets: the comma-separated client tokens and each provider's key. */
export function staticSecrets(tokens: string, providers: Partial<Record<UpstreamId, string>> = {}): ServerSecrets {
  return {
    tokens: async () => splitTokens(tokens),
    providerKey: async (id) => providers[id],
  };
}

/** The derived variable of a provider key's `value`, such as SEEK_PROVIDERS_EXA_API_KEY_VALUE. */
export function providerKeyVariable(id: UpstreamId): string {
  return `SEEK_PROVIDERS_${id.toUpperCase().replaceAll("-", "_")}_API_KEY_VALUE`;
}
