---
seek-cli: major
seek-docs: minor
---

Follow [Upgrade from seek 0.3](https://wyrd.foo/docs/seek/upgrade-from-0-3/) before updating a client, server or container. Move `config.json` settings to `~/.config/seek/client.yml` or `/etc/seek/server.yml`, and replace old provider key variables and `SEEK_SERVER_TOKEN` with the new setting names. Each provider key and client token has one source: a value, a file, a credential helper, or a Vault or OpenBao field. The guide maps the retired Vault variables and covers explicit proxies and redirects within the configured Vault origin and base path. Use `seek config validate` to check settings and `seek config show --json` for redacted output in scripts. Both commands leave secrets unread.
