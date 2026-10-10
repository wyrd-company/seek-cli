import { Command } from "commander";
import { UPSTREAMS } from "../lib/upstreams.ts";
import { SecretResolver } from "../server/secrets.ts";
import { startServer } from "../server/server.ts";
import { VaultSecretSource, vaultConfigFromEnv } from "../server/vault.ts";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description(
      "Run a seek back-end that holds provider API keys and proxies CLI calls to providers.",
    )
    .option("--host <host>", "Interface to bind (env: SEEK_SERVER_HOST)", process.env.SEEK_SERVER_HOST || "127.0.0.1")
    .option("--port <port>", "Port to listen on (env: SEEK_SERVER_PORT)", process.env.SEEK_SERVER_PORT || "8787")
    .option("--no-auth", "Accept requests without a SEEK_SERVER_TOKEN (trusted networks only)")
    .action(async (opts: { host: string; port: string; auth: boolean }) => {
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid port '${opts.port}'.`);
      }

      const vaultConfig = vaultConfigFromEnv();
      const vault = vaultConfig ? new VaultSecretSource(vaultConfig) : null;
      if (vault) {
        await vault.refresh();
        process.stderr.write(`seek serve: reading secrets from vault ${vault.describe()}\n`);
      }
      const secrets = new SecretResolver(vault);

      if (opts.auth && (await secrets.serverTokens()).length === 0) {
        throw new Error(
          "No SEEK_SERVER_TOKEN configured. Set it in the environment, Vault, or the config file, " +
            "or pass --no-auth to run without client authentication.",
        );
      }
      if (!opts.auth) {
        process.stderr.write("seek serve: warning: client authentication is disabled (--no-auth)\n");
      }

      const configured: string[] = [];
      for (const spec of Object.values(UPSTREAMS)) {
        if (await secrets.get(spec.envVar)) configured.push(spec.id);
      }

      const server = startServer({
        hostname: opts.host,
        port,
        secrets,
        allowUnauthenticated: !opts.auth,
      });
      process.stderr.write(
        `seek serve: listening on http://${server.hostname}:${server.port}\n` +
          `seek serve: providers with keys: ${configured.length > 0 ? configured.join(", ") : "(none)"}\n`,
      );

      const shutdown = () => {
        server.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
