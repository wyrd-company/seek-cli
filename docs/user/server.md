---
title: Server mode
order: 8
product: seek
---

`seek serve` runs seek as a back-end that holds the provider API keys. Point
the CLI at it and provider calls go through the server, so the machines
running the CLI (devcontainers, CI runners, agent sandboxes) never need
provider keys. They only need the server URL and a client token that you can
revoke.

```text
seek CLI ──(SEEK_SERVER_TOKEN)──▶ seek serve ──(provider API key)──▶ provider API
                                     ▲
                                     └── keys from env, config file, or Vault/OpenBao
```

The server is a narrow authenticated proxy. It only forwards to the fixed
provider hosts seek already uses. It removes the client's credentials and adds
the provider key. Requests, responses, and streaming (Brave Answers) pass
through unchanged, so every command, `--json` output, and the resumable
research lifecycle work the same way in either mode.

## Using a server from the CLI

Set these in the environment or in the config file:

| Env var / config key | Meaning                                            |
| -------------------- | -------------------------------------------------- |
| `SEEK_SERVER_URL`    | Base URL of the server, e.g. `https://seek.internal` |
| `SEEK_SERVER_TOKEN`  | Client token the server accepts                    |

```sh
export SEEK_SERVER_URL=https://seek.internal
export SEEK_SERVER_TOKEN=...
seek web exa "papers on archival paper longevity"
seek config show        # shows the server and notes local keys are ignored
```

When `SEEK_SERVER_URL` is set, local provider keys are ignored. If the server
has no key for a provider, the command fails with HTTP 503 and the message
names the missing variable.

## Running the server

```sh
SEEK_SERVER_TOKEN=$(openssl rand -hex 32) \
EXA_API_KEY=... \
seek serve --host 0.0.0.0 --port 8787
```

| Option / env var                       | Default     |
| -------------------------------------- | ----------- |
| `--host` / `SEEK_SERVER_HOST`          | `127.0.0.1` (`0.0.0.0` in the image) |
| `--port` / `SEEK_SERVER_PORT`          | `8787`      |
| `--no-auth`                            | off         |

The server will not start without a `SEEK_SERVER_TOKEN` unless you pass
`--no-auth`. `SEEK_SERVER_TOKEN` can be a comma-separated list, so you can
rotate tokens without downtime. Clients send it as `Authorization: Bearer
<token>`.

The server speaks plain HTTP. Put it behind TLS (a reverse proxy, ingress, or
service mesh) whenever clients reach it over a network.

Endpoints:

- `GET /healthz` returns `{"status":"ok"}` without authentication.
- `/v1/proxy/<provider>/<path>` forwards to the provider. `<provider>` is one of
  `parallel`, `exa`, `brave-search`, `brave-answers`, `perplexity`, `google`,
  or `firecrawl`.

Each request is logged to stderr (method, provider, path, status, duration).
Keys and tokens are never logged.

## Where the server finds keys

For every secret, including `SEEK_SERVER_TOKEN`, the server checks in order:

1. Process environment.
2. Vault / OpenBao, when configured.
3. The seek config file (`$XDG_CONFIG_HOME/seek/config.json`).

### Vault / OpenBao

Vault and OpenBao share the same API, so either works. The server reads one
KV path whose keys match seek's variable names (`EXA_API_KEY`,
`SEEK_SERVER_TOKEN`, …):

```sh
bao kv put secret/seek EXA_API_KEY=... PERPLEXITY_API_KEY=... SEEK_SERVER_TOKEN=...
```

| Env var                       | Meaning                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `SEEK_VAULT_PATH`             | Secret path within the mount, e.g. `seek`. Setting it turns Vault on. |
| `VAULT_ADDR` / `BAO_ADDR`     | Server address (`SEEK_VAULT_ADDR` overrides both)         |
| `SEEK_VAULT_MOUNT`            | KV mount, default `secret`                                |
| `SEEK_VAULT_KV_VERSION`       | `2` (default) or `1`                                      |
| `VAULT_NAMESPACE` / `BAO_NAMESPACE` | Namespace, if any                                   |
| `SEEK_VAULT_REFRESH_SECONDS`  | How long to cache secrets before re-reading, default `300` |

Authentication uses the first of these that is configured:

1. **AppRole:** `SEEK_VAULT_ROLE_ID` plus `SEEK_VAULT_SECRET_ID` or
   `SEEK_VAULT_SECRET_ID_FILE`. Set `SEEK_VAULT_APPROLE_MOUNT` if the mount is
   not `approle`. The server logs in again when its token is rejected.
2. **Token file:** `SEEK_VAULT_TOKEN_FILE`. The file is re-read on every
   refresh, which suits a Vault Agent sidecar that rotates the token.
3. **Token:** `VAULT_TOKEN` / `BAO_TOKEN`.

The server reads Vault at startup and exits if the read fails. After that, a
failed refresh logs a warning and the server keeps using the last secrets it
read. For a private CA, set `NODE_EXTRA_CA_CERTS` to the CA bundle path.

## Container image

The server ships as `ghcr.io/wyrd-company/seek-server`, built for
`linux/amd64` and `linux/arm64` and tagged with each release version.

```sh
docker run --rm -p 8787:8787 \
  -e VAULT_ADDR=https://vault.internal \
  -e SEEK_VAULT_PATH=seek \
  -e SEEK_VAULT_ROLE_ID=... -e SEEK_VAULT_SECRET_ID=... \
  ghcr.io/wyrd-company/seek-server:latest
```

The image runs as a non-root user on a distroless base. It reads an optional
config file from `/config/seek/config.json`.
