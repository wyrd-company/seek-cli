---
title: How seek finds keys and tokens
product: seek
order: 12
---

seek needs one secret per call: a provider key when the CLI calls a provider
itself, or a client token when it calls a seek server. Each secret has one
name everywhere, such as `EXA_API_KEY` or `SEEK_SERVER_TOKEN`, so a secret can
move from one source to another without any other change.

## Two modes

The CLI runs in one of two modes, chosen by `SEEK_SERVER_URL`:

| Mode | When | The CLI sends | Who holds provider keys |
| --- | --- | --- | --- |
| Direct mode | `SEEK_SERVER_URL` is not set | The provider key, to the provider | The CLI's machine |
| Server mode | `SEEK_SERVER_URL` is set | The client token, to the seek server | The seek server |

In server mode the CLI ignores local provider keys, and `seek config show`
says so. The server removes the client's token and adds the provider key, so
a machine that runs seek in server mode never sees a provider key, and taking
a token away from one client does not touch any provider account.

## Where each secret comes from

seek takes the first source that has a value; an empty or blank value counts
as unset.

| Secret | Read by | Sources, in order |
| --- | --- | --- |
| Provider key, such as `EXA_API_KEY` | The CLI in direct mode | Environment, configuration file |
| `SEEK_SERVER_TOKEN` | The CLI in server mode | Environment, Vault or OpenBao, configuration file |
| Provider keys and `SEEK_SERVER_TOKEN` | `seek serve` | Environment, Vault or OpenBao, configuration file |

The environment comes first so that a single run, a CI job or a container can
override a stored value. The configuration file,
`$XDG_CONFIG_HOME/seek/config.json` or `~/.config/seek/config.json`, is a flat
JSON object whose keys are the same variable names; seek reads its string
values and ignores the rest. A file that is not a JSON object gives a warning
and counts as empty.

## Vault and OpenBao

Vault and OpenBao share one API, and seek reads one KV secret from either,
named by `SEEK_VAULT_PATH`. The secret's fields have seek's variable names. A
server's secret holds provider keys and its client tokens; a client's secret
holds its one client token.

- **The server** reads the secret before it starts, so it never runs on
  secrets it could not read. It reads the secret again after the refresh
  interval, and when a later read fails it logs a warning and keeps the
  values it has, so a short Vault outage does not stop it.
- **The client** reads Vault only in server mode, and only when
  `SEEK_SERVER_TOKEN` is not in its environment, so a direct-mode command or
  a token in the environment never waits for Vault. A failed read stops the
  command.

Both authenticate with AppRole, a token file or a token, in that order. A
token file is read again before each secret read, so a token that Vault
Agent rotates takes effect without a restart. Vault errors name the method,
the path and the status, never a secret.

## Tokens and rotation

A client sends its whole `SEEK_SERVER_TOKEN` as one bearer token. The server
accepts each entry of its own comma-separated `SEEK_SERVER_TOKEN`, so a new
token can be added, given to clients, and the old one removed, without
downtime.

The [configuration reference](reference/configuration.md) lists every
variable. [Set up provider keys](config.md),
[Use a seek server from the CLI](connect-to-a-server.md) and
[Run a seek server](server.md) give the steps.
