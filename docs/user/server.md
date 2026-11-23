---
title: Run a seek server
product: seek
order: 8
---

Run `seek serve`, or its container image, on a machine that holds the
provider keys, so that CLIs elsewhere call providers through it with a client
token. [How the seek server proxies provider calls](server-proxy.md) explains
what the server does with each request.

![Terminal recording: seek serve starts with a synthetic client token, prints its address and the providers it has keys for, and curl reads its health check.](assets/server.gif)

## 1. Choose a client token

Clients send this token with every request. Generate one:

```sh
openssl rand -hex 32
```

To rotate tokens without downtime, give the server a comma-separated list,
such as `<new-token>,<old-token>`, then remove the old one when no client
uses it.

## 2. Give the server its keys

The server reads each provider key and `SEEK_SERVER_TOKEN` from its
environment, then from a Vault or OpenBao KV secret when `SEEK_VAULT_PATH` is
set, then from its configuration file. Use whichever source you keep secrets
in:

- **Environment:** set `SEEK_SERVER_TOKEN` and the provider keys. Replace the
  example values with your secrets.

  ```sh
  export SEEK_SERVER_TOKEN='<client-token>'
  export EXA_API_KEY='<exa-api-key>'
  ```
- **Configuration file:** the same keys in `~/.config/seek/config.json` (see
  [Set up provider keys](config.md)).
- **Vault or OpenBao:** store the keys as fields of one KV secret, then point
  the server at it. This example uses an OpenBao CLI already authenticated to
  write to the secret path.

  ```sh
  export BAO_ADDR=https://bao.internal.example
  bao kv put secret/seek EXA_API_KEY='<exa-api-key>' SEEK_SERVER_TOKEN='<client-token>'
  export SEEK_VAULT_PATH=seek
  export SEEK_VAULT_ROLE_ID='<role-id>'
  export SEEK_VAULT_SECRET_ID_FILE=/run/secrets/seek-secret-id
  ```

  With the Vault CLI, set `VAULT_ADDR` and use `vault kv put`. For either
  service, keep the provider keys and `SEEK_SERVER_TOKEN` out of the server's
  environment so the server reads them from the secret you configured.

  The server authenticates with AppRole (`SEEK_VAULT_ROLE_ID` and a secret
  ID), a token file (`SEEK_VAULT_TOKEN_FILE`, which suits a Vault Agent that
  rotates the token) or a token (`VAULT_TOKEN` or `BAO_TOKEN`), in that
  order. It reads the secret before it starts and stops if that read fails;
  later reads, every 300 seconds unless `SEEK_VAULT_REFRESH_SECONDS` says
  otherwise, keep the last values when they fail. For a private certificate
  authority, set `NODE_EXTRA_CA_CERTS` to its bundle. The
  [configuration reference](reference/configuration.md) lists every
  `SEEK_VAULT_*` variable.

## 3. Start the server

```sh
seek serve --host 0.0.0.0 --port 8787
```

```text
seek serve: listening on http://0.0.0.0:8787
seek serve: providers with keys: exa
```

The server binds `127.0.0.1:8787` unless `--host` and `--port`, or
`SEEK_SERVER_HOST` and `SEEK_SERVER_PORT`, say otherwise. It does not start
without a client token unless you pass `--no-auth`, which only a trusted
network should use. It logs each request on stderr, without keys or tokens.

The server speaks plain HTTP. Put it behind TLS, such as a reverse proxy, an
ingress or a service mesh, whenever clients reach it over a network.

## Or run the container image

The image `ghcr.io/wyrd-company/seek-server` runs `seek serve` for
`linux/amd64` and `linux/arm64`, tagged with each release version. It binds
`0.0.0.0:8787`, runs as a non-root user and reads an optional configuration
file at `/config/seek/config.json`.

```sh
docker run --rm -p 8787:8787 \
  -e SEEK_SERVER_TOKEN='<client-token>' \
  -e EXA_API_KEY='<exa-api-key>' \
  ghcr.io/wyrd-company/seek-server:latest
```

## Check that it works

From a client machine:

```sh
curl -s 'http://<server-host>:8787/healthz'
```

```text
{"status":"ok"}
```

Then point a CLI at it, as [Use a seek server from the CLI](connect-to-a-server.md)
describes. A request for a provider the server has no key for returns HTTP
503 and names the variable to set.
