---
title: Set up provider keys
product: seek
order: 3
---

Give seek the API key of each provider you want to use, in the environment
or in seek's configuration file, and check which keys it finds. You need a
key only for the providers you use. To use a seek server that holds the keys
instead, see [Use a seek server from the CLI](connect-to-a-server.md).

![Terminal recording: seek config init creates the configuration file, and seek config show lists each key with its source and a masked value.](assets/config.gif)

## Find the variable for your provider

| Provider | Variable | Commands |
| --- | --- | --- |
| Parallel | `PARALLEL_API_KEY` | `seek web parallel`, `seek research parallel`, `seek scrape parallel` |
| Exa | `EXA_API_KEY` | `seek web exa`, `seek scrape exa` |
| Brave Search | `BRAVE_SEARCH_API_KEY` | `seek web brave search` |
| Brave Answers | `BRAVE_ANSWERS_API_KEY` | `seek web brave answers`, `seek research brave` |
| Perplexity | `PERPLEXITY_API_KEY` | `seek web perplexity`, `seek research perplexity` |
| Google Gemini | `GEMINI_API_KEY` | `seek research google` |
| Firecrawl | `FIRECRAWL_API_KEY` | `seek scrape firecrawl` |

Brave issues separate keys for its Search and Answers APIs. The
[configuration reference](reference/configuration.md) describes every
variable.

## Set a key for one shell session

Export the variable. Replace `<exa-api-key>` with the key from your provider
account:

```sh
export EXA_API_KEY=<exa-api-key>
```

A variable in the environment takes precedence over the configuration file.

## Keep keys in the configuration file

1. Create the file. seek writes it with a placeholder for every key, readable
   only by you:

   ```sh
   seek config init
   ```

   ```text
   Created /home/<you>/.config/seek/config.json
   Edit the file and fill in keys for the providers you want to use.
   ```

   The file is `$XDG_CONFIG_HOME/seek/config.json`, or
   `~/.config/seek/config.json` when `XDG_CONFIG_HOME` is not set. If the file
   exists, `seek config init` stops; add `--force` to replace it.

2. Open the file and fill in the keys you have. Leave the others empty or
   remove them. A file with two keys looks like
   [config.json](examples/config.json):

   ```json
   {
     "EXA_API_KEY": "<exa-api-key>",
     "PARALLEL_API_KEY": "<parallel-api-key>"
   }
   ```

## Check which keys seek finds

```sh
seek config show
```

Each line names a key, where seek found it (`env`, `config`, or `—` for
neither) and a masked value:

```text
config: /home/<you>/.config/seek/config.json

  PARALLEL_API_KEY       —    (unset)    [parallel]
  EXA_API_KEY            env  exa-…1234    [exa]
  BRAVE_SEARCH_API_KEY   —    (unset)    [brave search]
  BRAVE_ANSWERS_API_KEY  —    (unset)    [brave answers]
  PERPLEXITY_API_KEY     —    (unset)    [perplexity]
  GEMINI_API_KEY         —    (unset)    [google]
  FIRECRAWL_API_KEY      —    (unset)    [firecrawl]
```

A command whose key is missing stops with exit status 2, names the variable
to set, and lists the other providers of its group, marking those without a
key. [How seek finds keys and tokens](credentials.md) explains the order seek
reads them in.
