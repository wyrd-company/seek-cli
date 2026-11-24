---
seek-cli: major
seek-docs: minor
---

seek now reads YAML configuration: `~/.config/seek/client.yml` for the CLI and `/etc/seek/server.yml` for `seek serve`, then environment variables and flags derived from each setting, such as `SEEK_PROVIDERS_EXA_API_KEY_FILE` and `--providers-exa-api-key-file`. Each provider key and client token names one source: a value, a file, a credential helper, or a field of a Vault or OpenBao secret bound to its own server. `seek config validate` checks the configuration and `seek config show --json` prints it for scripts, both without reading a secret. This breaks seek 0.3 setups: `config.json`, the provider key variables such as `EXA_API_KEY`, `SEEK_SERVER_TOKEN` and the retired `SEEK_VAULT_*` variables are no longer read, Vault ignores the proxy variables, and a Vault redirect outside the configured server is refused. The new Upgrade from seek 0.3 guide lists each change.
