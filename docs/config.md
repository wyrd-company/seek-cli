---
docs: true
title: Configuration
order: 3
---

Each provider reads its own API key. You only need keys for the providers you
actually use — an unconfigured provider fails with a clear message and suggests
alternatives you do have keys for.

## API keys

| Provider      | Env var / config key    | Used by                          |
| ------------- | ----------------------- | -------------------------------- |
| Parallel      | `PARALLEL_API_KEY`      | `web`, `research`, `scrape`      |
| Exa           | `EXA_API_KEY`           | `web`, `scrape`                  |
| Brave Search  | `BRAVE_SEARCH_API_KEY`  | `web brave search`               |
| Brave Answers | `BRAVE_ANSWERS_API_KEY` | `web brave answers`, `research brave` |
| Perplexity    | `PERPLEXITY_API_KEY`    | `web perplexity`, `research perplexity` |
| Google/Gemini | `GEMINI_API_KEY`        | `research google`                |
| Firecrawl     | `FIRECRAWL_API_KEY`     | `scrape firecrawl`               |

Brave splits into two keys: the Search API and the Answers API are billed and
provisioned separately, so `web brave search` and `web brave answers`
(and `research brave`) can be configured independently.

## Resolution order

For each key, seek resolves the first source that has a non-empty value:

1. **Process environment variable** — always wins. Useful for CI and one-off
   overrides.
2. **Config file** — a flat JSON object at the resolved config path.

```bash
export PARALLEL_API_KEY=…
export EXA_API_KEY=…
```

## Config file

The config path is resolved as:

1. `$XDG_CONFIG_HOME/seek/config.json` when `XDG_CONFIG_HOME` is set.
2. `~/.config/seek/config.json` otherwise.

The file is a flat JSON object whose keys match the env var names above, so you
never learn a second schema:

```json
{
  "EXA_API_KEY": "…",
  "PERPLEXITY_API_KEY": "…"
}
```

Only string values are read; non-string values are ignored. If the file is not
valid JSON (or not a JSON object), seek prints a warning and continues as if no
config file were present.

## Managing the config file

The `config` command group manages this file:

```bash
seek config path        # print the resolved config file path
seek config init        # write a template with a placeholder for every key
seek config init --force  # overwrite an existing config file
seek config show        # show which keys are set, their source, and masked values
```

- `config init` creates the config directory (mode `0700`) and writes the file
  with mode `0600`. It fails if the file already exists unless `--force` is
  given.
- `config show` lists every known key, whether its value came from `env`,
  `config`, or is unset (`—`), and a masked preview of the value.
