# Seek CLI (`seek`)

Agent-friendly CLI for web search, deep research, and targeted scraping across popular APIs.

Built with [Bun](https://bun.sh) + TypeScript. Each command groups providers by intent so an agent (or human) can pick the right trade-off between speed, cost, and output type.

## Install

With Homebrew:

```sh
brew install wyrd-company/tools/seek-cli
```

From source:

```sh
bun install
bun link            # exposes the `seek` binary on your PATH
# or run directly without linking:
bun run src/index.ts ...
```

To produce a single-file native binary:

```sh
bun run build       # -> dist/seek
```

## Authentication

Each provider reads its own API key. `seek` resolves them in this order:

1. Process environment variable (always wins — useful for CI and one-off overrides).
2. Config file at `$XDG_CONFIG_HOME/seek/config.json`, falling back to `~/.config/seek/config.json`.

| Provider      | Env var / config key    |
| ------------- | ----------------------- |
| Parallel      | `PARALLEL_API_KEY`      |
| Exa           | `EXA_API_KEY`           |
| Brave Search  | `BRAVE_SEARCH_API_KEY`  |
| Brave Answers | `BRAVE_ANSWERS_API_KEY` |
| Perplexity    | `PERPLEXITY_API_KEY`    |
| Google        | `GEMINI_API_KEY`        |
| Firecrawl     | `FIRECRAWL_API_KEY`     |

To set up the config file:

```sh
seek config init        # writes a template at ~/.config/seek/config.json (mode 0600)
seek config path        # print the resolved path
seek config show        # show which keys are configured (values masked)
```

The config file is a flat JSON object whose keys match the env var names, so you can mix and match without learning a second schema:

```json
{
  "EXA_API_KEY": "sk-…",
  "PERPLEXITY_API_KEY": "pplx-…"
}
```

## Command map

```
seek
├── web         Fast, real-time context retrieval
│   ├── parallel       Dense, LLM-ready context in one call (best for agents)
│   ├── exa            Neural semantic search (best for conceptual queries)
│   ├── brave
│   │   ├── search     Independent global web index (best for real-time facts)
│   │   └── answers    AI-generated answers backed by verifiable sources
│   └── perplexity     Short, conversational answer with citations
│
├── research    Autonomous, multi-step deep analysis
│   ├── brave          Brave Answers Deep Research
│   ├── parallel       Strict JSON output with auditable sources (B2B / data ops)
│   ├── google         Long-horizon, Google-grounded report (corporate / scientific)
│   └── perplexity     Polished long-form briefing with inline citations
│
└── scrape      Targeted raw page extraction
    ├── exa            Bulk page parsing optimized for LLM token windows
    ├── parallel       Web agent that can authenticate through logins and paywalls
    └── firecrawl      Clean Markdown / JSON / HTML from any live URL
```

## Examples

```sh
# Real-time search
seek web parallel "transformer inference cost in 2026" -n 5
seek web exa "papers on speculative decoding" --category "research paper" --text
seek web brave search "latest Anthropic model release" --fresh pw
seek web brave answers "what shipped in the latest Bun release?" --citations
seek web perplexity "what changed in the EU AI Act this month?"

# Deep research
seek research brave "what changed in the EU AI Act this month?" --citations
seek research parallel "list the top 10 EV battery manufacturers" \
  --schema ./schema.json --processor pro
seek research google "summarize the SEC investigation into ACME Corp"
seek research google "map the competitive landscape for open-weight speech models" \
  --interactive --planner perplexity
seek research perplexity "state of the small language model market"

# Scrape
seek scrape exa https://example.com https://example.org
seek scrape parallel https://app.example.com/dashboard --objective "Extract the latest invoice table"
seek scrape firecrawl https://example.com -f markdown,links
```

Every subcommand supports `--json` to emit the raw provider response — useful when piping into `jq` or another agent.

## CI and release

Run the same checks as CI locally:

```sh
bun run ci
```

Build release archives locally:

```sh
RUN_CI=0 bun run release
```

Pushing a version tag such as `0.1.0` runs the release workflow. It builds macOS/Linux ARM64 and x86_64 tarballs, publishes them to the GitHub release, then updates `Formula/seek-cli.rb` in `github.com/wyrd-company/homebrew-tools`.

The tap publish job expects an SSH deploy key in the repository secret `FORMULAE_PUBLISH_KEY` with write access to `wyrd-company/homebrew-tools`.
