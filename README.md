# Seek CLI (`seek`)

Agent-friendly CLI for web search, deep research, and targeted scraping across popular APIs.

Built with [Bun](https://bun.sh) + TypeScript. Each command groups providers by intent so an agent (or human) can pick the right trade-off between speed, cost, and output type.

## Install

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

Each provider reads its own API key from the environment. Set whichever you plan to use:

| Provider    | Env var              |
| ----------- | -------------------- |
| Parallel    | `PARALLEL_API_KEY`   |
| Exa         | `EXA_API_KEY`        |
| Brave       | `BRAVE_API_KEY`      |
| Perplexity  | `PERPLEXITY_API_KEY` |
| Google      | `GEMINI_API_KEY`     |
| Firecrawl   | `FIRECRAWL_API_KEY`  |

## Command map

```
seek
├── web         Fast, real-time context retrieval
│   ├── parallel       Dense, LLM-ready context in one call (best for agents)
│   ├── exa            Neural semantic search (best for conceptual queries)
│   ├── brave          Independent global web index (best for real-time facts)
│   └── perplexity     Short, conversational answer with citations
│
├── research    Autonomous, multi-step deep analysis
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
seek web brave "latest Anthropic model release" --fresh pw
seek web perplexity "what changed in the EU AI Act this month?"

# Deep research
seek research parallel "list the top 10 EV battery manufacturers" \
  --schema ./schema.json --processor pro
seek research google "summarize the SEC investigation into ACME Corp"
seek research perplexity "state of the small language model market"

# Scrape
seek scrape exa https://example.com https://example.org
seek scrape parallel https://app.example.com/dashboard --objective "Extract the latest invoice table"
seek scrape firecrawl https://example.com -f markdown,links
```

Every subcommand supports `--json` to emit the raw provider response — useful when piping into `jq` or another agent.
