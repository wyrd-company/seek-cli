---
title: Use a seek server from the CLI
product: seek
order: 7
---

Point the CLI at a seek server, so that the server holds the provider keys
and this machine holds only the server's address and a client token. You need
the server's URL and a client token from whoever runs it (see
[Run a seek server](server.md)).

![Terminal recording: after exporting SEEK_SERVER_URL and SEEK_SERVER_TOKEN, seek config show names the server and the token's source, and a search returns results through it.](assets/connect.gif)

## 1. Set the server and the token

Replace `<client-token>` with the token you were given:

```sh
export SEEK_SERVER_URL=https://seek.internal.example
export SEEK_SERVER_TOKEN=<client-token>
```

To keep them, put the same two keys in the configuration file instead, as in
[client-config.json](examples/client-config.json):

```json
{
  "SEEK_SERVER_URL": "https://seek.internal.example",
  "SEEK_SERVER_TOKEN": "<client-token>"
}
```

A variable in the environment takes precedence over the file.

## 2. Or read the token from Vault or OpenBao

Leave `SEEK_SERVER_TOKEN` unset and name the KV secret that holds it in a
`SEEK_SERVER_TOKEN` field. For OpenBao with token authentication:

```sh
export SEEK_SERVER_URL=https://seek.internal.example
unset SEEK_SERVER_TOKEN
export BAO_ADDR=https://bao.internal.example
export SEEK_VAULT_PATH=clients/my-seek-cli
export BAO_TOKEN=<openbao-token>
```

For Vault, set `VAULT_ADDR` and `VAULT_TOKEN` instead. seek reads the secret
from the `secret` KV version 2 mount unless `SEEK_VAULT_MOUNT` and
`SEEK_VAULT_KV_VERSION` say otherwise, and also authenticates with a token
file or AppRole; the [configuration reference](reference/configuration.md)
lists each `SEEK_VAULT_*` variable. seek reads Vault only when a command
calls the server and no `SEEK_SERVER_TOKEN` is in the environment, and a
failed read stops the command.

## 3. Check the setup

```sh
seek config show
```

The second line names the server and where the token comes from: `env`,
`Vault/OpenBao configured` or `config`.

```text
config: /home/<you>/.config/seek/config.json
server: https://seek.internal.example (token: env)
  Provider calls go through the server; local keys below are not used.
```

Then run any command, such as
`seek web parallel "how do honeybees make honey"`. It prints results as it
does with a local key.

## If a command fails

- `HTTP 401` means the server did not accept the token.
- `HTTP 503` with `seek server has no API key configured for <provider>`
  means the server has no key for that provider. The message names the
  variable the server needs.

To go back to local keys, unset `SEEK_SERVER_URL` and remove it from the
configuration file. [How seek finds keys and tokens](credentials.md) explains
the order seek reads each source in.
