import { Command } from "commander";
import { assertValid, loadConfiguration } from "../lib/config.ts";
import { configurationFlags } from "../lib/options.ts";
import { UPSTREAMS } from "../lib/upstreams.ts";
import { EXIT } from "../lib/exit-status.ts";
import { redactUrl } from "../lib/redact.ts";
import { SecretStore } from "../server/secrets.ts";
import { startServer } from "../server/server.ts";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description(
      "Run a seek back-end that holds provider API keys and proxies CLI calls to providers.",
    )
    .action(async (_opts: unknown, command: Command) => {
      const configuration = assertValid(loadConfiguration({ kind: "server", ...configurationFlags(command) }));
      const plain = (path: string) => configuration.plain.get(path)?.value;

      const secrets = new SecretStore(configuration);
      await secrets.start();
      for (const secret of configuration.secrets.values()) {
        if (secret.source?.kind !== "vault") continue;
        const { vault } = secret.source;
        process.stderr.write(
          `seek serve: read ${secret.path} from vault ${redactUrl(vault.address!)} ${vault.mount}/${vault.path} ` +
            `(kv v${vault.kvVersion}, ${vault.auth!.mode} auth)\n`,
        );
      }

      const requireToken = plain("server.require-token") === true;
      if (requireToken && (await secrets.tokens()).length === 0) {
        throw new Error("server.tokens resolved to no token; set at least one client token, or set server.require-token to false (--no-auth) on a trusted network.");
      }
      if (!requireToken) {
        process.stderr.write("seek serve: warning: client authentication is disabled (server.require-token is false)\n");
      }

      const configured: string[] = [];
      for (const spec of Object.values(UPSTREAMS)) {
        if (await secrets.providerKey(spec.id)) configured.push(spec.id);
      }

      const server = startServer({
        hostname: String(plain("server.host")),
        port: Number(plain("server.port")),
        secrets,
        allowUnauthenticated: !requireToken,
      });
      process.stderr.write(
        `seek serve: listening on http://${server.hostname}:${server.port}\n` +
          `seek serve: providers with keys: ${configured.length > 0 ? configured.join(", ") : "(none)"}\n`,
      );

      const shutdown = () => {
        server.stop();
        process.exit(EXIT.success);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
