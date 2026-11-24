---
title: Upgrade from seek 0.3
product: seek
order: 9
---

Move a seek 0.3 client or server to this release's configuration. This
release reads only YAML configuration files and the variable names derived
from them. It ignores seek 0.3's JSON file and its old variable names, and
says nothing about them, so do these steps before you upgrade a machine that
uses them. A command that lacks a key then reports it with exit status 2, and
a server without a client token refuses to start.

## 1. Rename the variables you export

Wherever you set them, in a shell profile, a CI job, a systemd unit or
`docker run -e`, rename these variables. A `_FILE` or `_COMMAND` variable
can take the place of each `_VALUE` one.

| seek 0.3 | This release |
| --- | --- |
| `PARALLEL_API_KEY` | `SEEK_PROVIDERS_PARALLEL_API_KEY_VALUE` |
| `EXA_API_KEY` | `SEEK_PROVIDERS_EXA_API_KEY_VALUE` |
| `BRAVE_SEARCH_API_KEY` | `SEEK_PROVIDERS_BRAVE_SEARCH_API_KEY_VALUE` |
| `BRAVE_ANSWERS_API_KEY` | `SEEK_PROVIDERS_BRAVE_ANSWERS_API_KEY_VALUE` |
| `PERPLEXITY_API_KEY` | `SEEK_PROVIDERS_PERPLEXITY_API_KEY_VALUE` |
| `GEMINI_API_KEY` | `SEEK_PROVIDERS_GOOGLE_API_KEY_VALUE` |
| `FIRECRAWL_API_KEY` | `SEEK_PROVIDERS_FIRECRAWL_API_KEY_VALUE` |
| `SEEK_SERVER_TOKEN`, for a client | `SEEK_SERVER_TOKEN_VALUE` |
| `SEEK_SERVER_TOKEN`, for a server | `SEEK_SERVER_TOKENS_VALUE` |

`SEEK_SERVER_URL`, `SEEK_SERVER_HOST`, `SEEK_SERVER_PORT`,
`SEEK_VAULT_MOUNT`, `SEEK_VAULT_KV_VERSION`, `XDG_CONFIG_HOME` and the
`BAO_*` and `VAULT_*` address, namespace and token variables keep their
names. A key exported once for seek and for a provider's own SDK is now
exported under both names.

## 2. Move a client's JSON file to YAML

seek 0.3 kept keys in `~/.config/seek/config.json` (or under
`$XDG_CONFIG_HOME`). Write `~/.config/seek/client.yml` instead:

1. Run `seek config init` for a commented template.
2. Give each key in the JSON file a source under its setting:
   `SEEK_SERVER_URL` becomes `server.url`, `SEEK_SERVER_TOKEN` becomes
   `server.token`, and each provider key becomes
   `providers.<provider>.api-key`, where `GEMINI_API_KEY` is
   `providers.google` and the two Brave keys are `providers.brave-search` and
   `providers.brave-answers`. Leave out keys the JSON file left empty. Keep
   each key in a file of its own rather than in the configuration:

   ```yaml
   server:
     url: https://seek.internal.example
     token:
       file: ~/.config/seek/secrets/seek-client-token
   providers:
     exa:
       api-key:
         file: ~/.config/seek/secrets/exa
   ```
3. Delete `config.json`.

A `client.yml` written with the 0.3 flat keys, such as `EXA_API_KEY`, fails
with exit status 1, naming the unknown key.

## 3. Move a server's settings to /etc/seek/server.yml

A server reads `/etc/seek/server.yml`, or the file `--config` names. Give it
the server's own settings: each provider key as for a client, and
`SEEK_SERVER_TOKEN` as `server.tokens`. Leave `SEEK_SERVER_URL` out; it is a
client setting, and the server file has no `server.url`.

For the container image, mount the file at `/etc/seek/server.yml` in place
of `/config/seek/config.json`, and rename `-e SEEK_SERVER_TOKEN` and
`-e EXA_API_KEY` as in step 1. An image run with the old names refuses to
start once it pulls this release, including through its `latest` tag.

## 4. Move Vault and OpenBao settings

seek 0.3 read one KV secret, named by `SEEK_VAULT_PATH`, whose fields were
the variable names. Now each secret names its own field:

| seek 0.3 | This release |
| --- | --- |
| `SEEK_VAULT_PATH=team/seek` | a `vault` source on each secret, `{ path: team/seek, key: EXA_API_KEY }`, with the old variable name as `key` |
| `SEEK_VAULT_ADDR` | `vault.address` |
| `SEEK_VAULT_ROLE_ID`, `SEEK_VAULT_SECRET_ID_FILE`, `SEEK_VAULT_APPROLE_MOUNT` | `vault.auth` with `mode: approle`, `role-id`, `secret-id: { file: ... }` and `mount` |
| `SEEK_VAULT_SECRET_ID` | a secret ID file, or `SEEK_VAULT_AUTH_SECRET_ID_VALUE` with `SEEK_VAULT_AUTH_MODE=approle` and `SEEK_VAULT_AUTH_ROLE_ID` |
| `SEEK_VAULT_TOKEN_FILE` | `vault.auth` with `mode: token` and `token: { file: ... }` |
| `SEEK_VAULT_REFRESH_SECONDS` | the server's `server.secret-refresh-seconds` |

For example, a server that used AppRole:

```yaml
server:
  tokens:
    vault: { path: team/seek, key: SEEK_SERVER_TOKEN }
providers:
  exa:
    api-key:
      vault: { path: team/seek, key: EXA_API_KEY }
vault:
  address: https://bao.internal.example
  auth:
    mode: approle
    role-id: <role-id>
    secret-id:
      file: /srv/seek/secrets/approle-id
```

- **Paths and mounts** keep working as written: seek still removes leading
  and trailing slashes, so `/team/seek/` and `team/seek` are the same. An
  empty segment inside one, such as `team//seek`, now fails validation.
- **Relative credential files** were relative to the service's working
  directory. In a configuration file they start from the file's folder, so
  write the absolute path, such as `/srv/seek/secrets/approle-id` for
  `secrets/approle-id` run from `/srv/seek`. Credential files can be reused
  as they are: seek removes surrounding whitespace, as seek 0.3 did.
- **Private certificate authorities** keep working from
  `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR` or their built-in
  locations, read when the configuration loads, so a change takes effect at
  the next command or server restart. `vault.ca-cert` replaces them all for
  its server.
- **One source each.** seek 0.3 fell back to the JSON file when a Vault field
  was missing or blank. Now a secret has one source, and a failed source is an
  error; keep the field set, or choose the source you want.

## 5. Check exported BAO_* and VAULT_* variables

Every environment variable now outranks the configuration files, `BAO_*`
outranks `VAULT_*`, and a derived `SEEK_VAULT_AUTH_*` variable outranks the
token variables. A login is used only for the server it was declared beside.

- **A set exported for another server**, such as a workspace's own OpenBao:
  clear the whole set from seek's environment, its address, token and
  namespace together, because a token left without its address binds to the
  file's server and replaces its login. Or give each secret its own `vault`
  block with its `address`, its `auth`, and a `namespace` whenever the
  exported set has one (`namespace: ""` for the root namespace); no variable
  overrides a block's own fields.
- **A `BAO_TOKEN` or `VAULT_TOKEN` exported for the same server** that the
  file logs in to replaces that login. Unset it for seek, set the login with
  the `SEEK_VAULT_AUTH_*` variables, or put `auth` on each secret's own
  `vault` block.
- **`VAULT_TOKEN` beside different `BAO_ADDR` and `VAULT_ADDR`** fails
  validation until the pair matches.

## 6. Proxies and redirects

seek 0.3 reached Vault through any proxy `HTTP_PROXY`, `HTTPS_PROXY` or
`ALL_PROXY` named, with any user name and password in it. seek now ignores
those variables for Vault. Set `vault.proxy` to the proxy's
`http://host:port`; a proxy that needs a password is not supported, so give
seek a direct route or a proxy without one. Provider calls still use the
proxy variables.

seek follows a Vault redirect only within the address's origin and base
path. A setup that relied on a redirect to another node, such as a standby
redirecting to the active node, fails with an error naming the refused
target until `vault.address` names the final address, such as the active
node, a load balancer or a node that forwards requests.

## 7. Update scripts

`seek config path` names the YAML file, and `seek config init` writes YAML.
A script that parsed `seek config show` reads `seek config show --json`
instead, whose shape the
[configuration reference](reference/configuration.md) describes.

## Check the result

```sh
seek config validate
seek config show
```

For a server, add `--server`. Each Vault source shows its address, its
namespace, its login mode and the layer that declared the login.

After updating a client, [check which keys seek finds](config.md#check-which-keys-seek-finds)
or [check its connection to a seek server](connect-to-a-server.md#3-check-the-setup).
After updating a server, [start it and check its health](server.md#3-start-the-server).
