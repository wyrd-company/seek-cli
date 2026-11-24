# Changelog

## 0.1.2

### Features

- Follow [Upgrade from seek 0.3](https://wyrd.foo/docs/seek/upgrade-from-0-3/) before updating a client, server or container. Move `config.json` settings to `~/.config/seek/client.yml` or `/etc/seek/server.yml`, and replace old provider key variables and `SEEK_SERVER_TOKEN` with the new setting names. Each provider key and client token has one source: a value, a file, a credential helper, or a Vault or OpenBao field. The guide maps the retired Vault variables and covers explicit proxies and redirects within the configured Vault origin and base path. Use `seek config validate` to check settings and `seek config show --json` for redacted output in scripts. Both commands leave secrets unread.

### Fixes

- Organize the published guides for users, administrators, and developers, and group the command, configuration, and API references together. Find the 0.3 upgrade guide under Users or from the client and server setup guides.

## 0.1.1

### Features

- Organize the published docs by audience and kind, with a search tutorial that needs no API key, focused guides for search, research jobs, extraction, keys, servers and the agent skill, explanations of providers, credentials and research jobs, a developer tutorial for the server API, and reference generated from seek's definitions with downloadable copies, examples and recordings.

### Fixes

- Use Bun 1.4.4 or later for source installs and the refreshed dependency lockfile.
