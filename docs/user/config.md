---
title: Set up provider keys
product: seek
order: 3
---

Give seek the API key of each provider you want to use, for one shell session
or in seek's configuration file, and check which keys it finds. You need a
key only for the providers you use. To use a seek server that holds the keys
instead, see [Use a seek server from the CLI](connect-to-a-server.md).
Coming from seek 0.3? [Upgrade from seek 0.3](upgrade-from-0-3.md) lists
what to rename.

![Terminal recording: seek config init writes the configuration file, and seek config show lists each setting with the layer that set it and the Exa key's source redacted.](assets/config.gif)

## Find the setting for your provider

Each provider's key is one setting, `providers.<provider>.api-key`. Its
environment variables are named after it:

| Provider | Setting | Environment variable for the key itself | Commands |
| --- | --- | --- | --- |
| Parallel | `providers.parallel.api-key` | `SEEK_PROVIDERS_PARALLEL_API_KEY_VALUE` | `seek web parallel`, `seek research parallel`, `seek scrape parallel` |
| Exa | `providers.exa.api-key` | `SEEK_PROVIDERS_EXA_API_KEY_VALUE` | `seek web exa`, `seek scrape exa` |
| Brave Search | `providers.brave-search.api-key` | `SEEK_PROVIDERS_BRAVE_SEARCH_API_KEY_VALUE` | `seek web brave search` |
| Brave Answers | `providers.brave-answers.api-key` | `SEEK_PROVIDERS_BRAVE_ANSWERS_API_KEY_VALUE` | `seek web brave answers`, `seek research brave` |
| Perplexity | `providers.perplexity.api-key` | `SEEK_PROVIDERS_PERPLEXITY_API_KEY_VALUE` | `seek web perplexity`, `seek research perplexity` |
| Google Gemini | `providers.google.api-key` | `SEEK_PROVIDERS_GOOGLE_API_KEY_VALUE` | `seek research google` |
| Firecrawl | `providers.firecrawl.api-key` | `SEEK_PROVIDERS_FIRECRAWL_API_KEY_VALUE` | `seek scrape firecrawl` |

Brave issues separate keys for its Search and Answers APIs. A key names one
source: the key itself (`value`), a file that holds it (`file`), a credential
helper that prints it (`command`), or a field of a Vault or OpenBao secret
(`vault`). Each source has its own variable, such as
`SEEK_PROVIDERS_EXA_API_KEY_FILE`, and, except `value`, its own flag, such as
`--providers-exa-api-key-file`. The
[configuration reference](reference/configuration.md) lists every setting.

## Set a key for one shell session

Export the variable. Replace `<exa-api-key>` with the key from your provider
account:

```sh
export SEEK_PROVIDERS_EXA_API_KEY_VALUE=<exa-api-key>
```

A variable takes precedence over the configuration file, and a flag over
both.

## Keep keys in the configuration file

1. Create the file. seek writes a commented template, readable only by you:

   ```sh
   seek config init
   ```

   ```text
   Created /home/<you>/.config/seek/client.yml
   Uncomment the settings you use, then check them with seek config validate.
   ```

   The file is `$XDG_CONFIG_HOME/seek/client.yml`, or
   `~/.config/seek/client.yml` when `XDG_CONFIG_HOME` is not set. If the file
   exists, `seek config init` stops; add `--force` to replace it.

2. Name a source for each key you have. Keep each key in a file of its own,
   or read it from your password manager's command-line tool. A file with two
   keys looks like [client.yml](examples/client.yml):

   ```yaml
   providers:
     exa:
       api-key:
         file: ~/.config/seek/secrets/exa
     parallel:
       api-key:
         command: ["op", "read", "op://Private/Parallel/credential"]
   ```

   A relative `file` path starts in the configuration file's folder. seek
   runs a `command` without a shell and reads the key from what it prints.

3. Check the file:

   ```sh
   seek config validate
   ```

   ```text
   The seek client configuration is valid (/home/<you>/.config/seek/client.yml).
   ```

   An unknown setting, a wrong type or a key with two sources fails with exit
   status 1, naming the setting and the file, variable or flag that set it.

## Check which keys seek finds

```sh
seek config show
```

Each line names a setting, its value or source, and the layer that set it.
Secrets appear as their source, never their value:

```text
seek client configuration
files: /home/<you>/.config/seek/client.yml

server.url  (unset)
server.token  (unset)
providers.parallel.api-key  (unset)
providers.exa.api-key = value <redacted>  (env SEEK_PROVIDERS_EXA_API_KEY_VALUE)
providers.brave-search.api-key  (unset)
providers.brave-answers.api-key  (unset)
providers.perplexity.api-key  (unset)
providers.google.api-key  (unset)
providers.firecrawl.api-key  (unset)
vault.address  (unset)
vault.namespace  (unset)
vault.mount = secret  (default)
vault.kv-version = 2  (default)
vault.ca-cert  (unset)
vault.proxy  (unset)
vault.auth  (unset)
```

`seek config show` and `seek config validate` never read a key file, run a
helper or contact Vault. Scripts read the same information with
`seek config show --json`.

A command whose key is missing stops with exit status 2, names the setting
and its variables, and lists the other providers of its group, marking those
without a key. [How seek finds keys and tokens](credentials.md) explains the
layers seek reads.
