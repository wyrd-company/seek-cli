# Changelog

## 0.4.0

### Breaking

- Follow [Upgrade from seek 0.3](https://wyrd.foo/docs/seek/upgrade-from-0-3/) before updating a client, server or container. Move `config.json` settings to `~/.config/seek/client.yml` or `/etc/seek/server.yml`, and replace old provider key variables and `SEEK_SERVER_TOKEN` with the new setting names. Each provider key and client token has one source: a value, a file, a credential helper, or a Vault or OpenBao field. The guide maps the retired Vault variables and covers explicit proxies and redirects within the configured Vault origin and base path. Use `seek config validate` to check settings and `seek config show --json` for redacted output in scripts. Both commands leave secrets unread.

### Fixes

- Keep the existing failure status and suppress the broken-pipe diagnostic when a reader closes stdout early.
- Show only provider commands in missing-key suggestions for Seek research. The job commands `status` and `get` are omitted.

## 0.3.2

### Features

- Read the client token for a Seek server from Vault or OpenBao.
- Print the bundled Seek agent skill with `seek skill`.

### Fixes

- Use Bun 1.4.4 or later for source installs and the refreshed dependency lockfile.

## 0.3.1

### Fixes

- Adopt Intentional as the version and release authority; release versions now come from intents, `package.json` is a committed projection, and release tags remain bare SemVer.

## 0.3.0

### Features

- `seek serve` runs seek as a back-end, so that provider API keys stay on one server. The `seek-server` container image packages it.

## 0.2.0

### Features

- Deep research jobs are resumable: start a job, then check its status or get its report later by job id.
- Add the `seek` agent skill with provider-selection guidance.

### Fixes

- Google research composes the instructions into the input.
- Research commands keep provider job ids unchanged.
- Research jobs report their terminal states consistently.

## 0.1.1

### Fixes

- The release workflow keeps the full tag when it reads the version.

## 0.1.0

### Features

- Initial release: `web`, `research`, and `scrape` commands over multiple provider APIs.
- Read API keys from `~/.config/seek/config.json`. When a key is missing, show the sibling providers that can do the same job.
- `--objective` option for `web` and `scrape`.
