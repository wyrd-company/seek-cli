---
title: How seek finds keys and tokens
product: seek
order: 12
---

seek needs one secret per call: a provider key when the CLI calls a provider
itself, or a client token when it calls a seek server. Each secret is one
setting, such as `providers.exa.api-key` or `server.token`, and names exactly
one source, so seek never guesses where a secret came from.

## Two modes

The CLI runs in one of two modes, chosen by `server.url`:

| Mode | When | The CLI sends | Who holds provider keys |
| --- | --- | --- | --- |
| Direct mode | `server.url` is not set, or is empty | The provider key, to the provider | The CLI's machine |
| Server mode | `server.url` is set | The client token, `server.token`, to the seek server | The seek server |

In server mode the CLI does not use local provider keys. The server removes
the client's token and adds the provider key, so a machine that runs seek in
server mode never sees a provider key, and taking a token away from one
client does not touch any provider account.

## Two configurations, in layers

The client and the server each have their own configuration. The client
reads `/etc/seek/client.yml` and then `~/.config/seek/client.yml` (or
`$XDG_CONFIG_HOME/seek/client.yml`); `seek serve` reads
`/etc/seek/server.yml`. `--config` or `SEEK_CONFIG` names one file in place
of these. Settings then come from environment variables and from flags:

| Layer, lowest first | Example |
| --- | --- |
| Built-in defaults | `vault.mount` is `secret` |
| The configuration files | `providers: { exa: { api-key: { file: ~/.config/seek/secrets/exa } } }` |
| Environment variables | `SEEK_PROVIDERS_EXA_API_KEY_FILE=/run/secrets/exa` |
| Flags | `--providers-exa-api-key-file /run/secrets/exa` |

Each higher layer overrides the settings it sets. A secret's source is
replaced whole, so an environment variable that names a file for a key
replaces a helper the file named, rather than mixing the two. Each
environment variable is `SEEK_` and the setting's path, and each flag `--`
and the path. The only other variables that set a setting are `BAO_ADDR`,
`VAULT_ADDR`, `BAO_NAMESPACE`, `VAULT_NAMESPACE`, `BAO_TOKEN` and
`VAULT_TOKEN`, shared with the Vault and OpenBao tools, `BAO_*` before
`VAULT_*`.

## Sources

A secret is the `value` itself, a `file` that holds it, a `command` that
prints it, or a field of a Vault or OpenBao KV secret (`vault`). seek removes
surrounding whitespace from every secret it reads, and an empty secret is a
failure. A failed source stops a command with exit status 1 and a message
that names the source, never the secret; seek does not fall back to another
source.

- **The client** resolves a secret only when a command needs it: in direct
  mode the key of the provider it calls, and in server mode the client token.
- **The server** resolves every configured secret before it starts, so it
  never runs on secrets it could not read. It resolves each again after
  `server.secret-refresh-seconds`, and when a later read fails it logs a
  warning and keeps the value it has, so a short outage does not stop it.

`seek config show` and `seek config validate` describe sources without
reading them: they run no helper, read no secret file and contact no Vault,
and they print each literal secret as `<redacted>`.

## Vault and OpenBao

Vault and OpenBao share one API. A `vault` source names the `path` and `key`
of one field, and takes its server, namespace, mount, certificate authority,
proxy and login from the top-level `vault` settings unless its own block sets
them. Logins are `token`, `approle` or `none`. A login is used only for the
server it was declared beside, so a `BAO_TOKEN` exported for one server never
reaches another: seek refuses such a configuration, naming both servers,
before it reads any credential.

seek builds each Vault connection from these settings alone. It ignores
`VAULT_CACERT`, `VAULT_SKIP_VERIFY` and the other variables the Vault tools
read, and the `HTTP_PROXY` family. It always verifies the server's
certificate and name. It trusts `vault.ca-cert` when set, and otherwise the
authorities seek's runtime trusts by default, including `NODE_EXTRA_CA_CERTS`,
`SSL_CERT_FILE` and `SSL_CERT_DIR`, as read when the configuration loads. It
follows a redirect only within the configured server and base path. A token
file is read again before each secret read, so a token that Vault Agent
rotates takes effect without a restart. Vault errors name the method, the
path and the status, never a secret.

## Tokens and rotation

A client sends its whole `server.token` as one bearer token. The server
accepts each entry of its own comma-separated `server.tokens`, so a new
token can be added, given to clients, and the old one removed, without
downtime.

The [configuration reference](reference/configuration.md) lists every
setting. [Set up provider keys](config.md),
[Use a seek server from the CLI](connect-to-a-server.md) and
[Run a seek server](server.md) give the steps.
