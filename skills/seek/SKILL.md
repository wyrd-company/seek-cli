---
name: seek
description: Use the `seek` CLI to search the web, run autonomous deep research, or scrape live URLs across multiple provider APIs (Parallel, Exa, Brave, Perplexity, Gemini, Firecrawl) from the shell. Use this skill whenever the user asks Claude to look something up online, fetch fresh facts, get citations, summarize a page, "research" a topic, compare vendors, gather sources, monitor news, extract data behind a paywall, screenshot a page, or pull clean markdown/JSON from a URL — even if they don't mention "seek" by name. Also use it when the user explicitly invokes `seek` or asks which provider to pick.
---

# Seek CLI

`seek` is an agent-friendly CLI that fans out to multiple search/research/scrape providers behind a single command tree. Picking the right subcommand matters more than tweaking flags: each provider has a different cost, latency, and output shape.

## Decision guide

Start by classifying the task into one of three buckets:

| Bucket | When | Latency |
|---|---|---|
| `seek web <provider>` | Real-time facts, fresh context for a prompt, single-shot lookup | <5s |
| `seek research <provider>` | Multi-step investigation, comparison, structured report, citations | 30s – 25 min |
| `seek scrape <provider>` | URL is already known and you want its content | <10s |

Then pick the provider based on the trade-off you care about (see tables below). When unsure, the defaults in **bold** are good starting points.

### `seek web` — fast lookups

| Provider | Best for | Notes |
|---|---|---|
| **`parallel`** | Agents and broad/complex queries that would otherwise need many keyword searches | Returns dense LLM-ready excerpts. Use `-n` to cap results, `-c` to cap chars per excerpt. |
| `exa` | Conceptual / semantic queries ("papers about X", "companies like Y") | Supports `--category` (research paper, news, company, github), `--text` for full snippets, `--start`/`--end` for date filtering. |
| `brave search` | Real-time consumer facts, news, local results | `--fresh pw` restricts to past week (`pd`/`pw`/`pm`/`py`). |
| `brave answers` | One AI answer with verifiable sources | Pass `--citations` to get inline citation tags. |
| `perplexity` | Short conversational answer with citations | `--recency week`, `--mode academic`, `--domains a.com,b.com` to constrain. |

### `seek research` — autonomous deep research

| Provider | Best for | Latency |
|---|---|---|
| `brave` | Surface-level deep research, fastest of the four | seconds |
| **`parallel`** | Structured/auditable output for B2B / data ops; supports `--schema <file>` for strict JSON | 30s – 25 min (depends on `--processor`) |
| `google` | Comprehensive, long-horizon Gemini Deep Research report; planning workflows | 5 – 20 min |
| `perplexity` | Polished long-form briefing with inline citations | 1 – 3 min |

For `research parallel`, `--processor` controls depth: `core-fast` (15-100s) → `core` (default) → `core2x` → `pro` (3-9m) → `ultra` (5-25m). `-fast` variants prioritize speed over freshness.

For `research google`, `--interactive --planner perplexity` lets you review and approve the plan before the (expensive) deep run kicks off — useful for important reports.

### `seek scrape` — pull content from known URLs

| Provider | Best for |
|---|---|
| **`firecrawl`** | Clean Markdown/HTML/JSON/screenshot from any live URL. `-f markdown,links` for combined formats. `--json-prompt "..."` to LLM-extract structured data. `--proxy stealth` for anti-bot pages. |
| `exa` | Bulk parsing of many URLs at once, token-window optimized. Pass multiple URLs as positional args. |
| `parallel` | Pages behind logins/paywalls or sites needing an objective ("Extract the latest invoice table"). |

## Always-available flags

- `--json` on every leaf command emits the raw provider response. **Use it when piping into `jq`, parsing fields, or feeding another tool** — the human-readable default is meant for terminal reading and will be harder to parse reliably.
- `-h` / `--help` works at every level (`seek`, `seek web`, `seek web brave`, etc.). When in doubt about a flag, prefer running `seek <path> --help` over guessing.

## Authentication

Each provider needs its own API key. `seek` resolves keys in this order:

1. Process env var (wins — useful for CI/one-offs).
2. `$XDG_CONFIG_HOME/seek/config.json` (falls back to `~/.config/seek/config.json`).

| Provider | Env var / config key |
|---|---|
| Parallel | `PARALLEL_API_KEY` |
| Exa | `EXA_API_KEY` |
| Brave Search | `BRAVE_SEARCH_API_KEY` |
| Brave Answers | `BRAVE_ANSWERS_API_KEY` |
| Perplexity | `PERPLEXITY_API_KEY` |
| Google (Gemini) | `GEMINI_API_KEY` |
| Firecrawl | `FIRECRAWL_API_KEY` |

Manage config with:

```sh
seek config init   # writes a template at ~/.config/seek/config.json (mode 0600)
seek config path   # print resolved path
seek config show   # show which keys are set (values masked)
```

If a command fails with a missing-key error, surface it to the user and point them at `seek config init` rather than retrying blindly.

## Examples

```sh
# Quick real-time search — broad question, agent-friendly excerpts
seek web parallel "transformer inference cost in 2026" -n 5

# Semantic / conceptual lookup with category filter and full text
seek web exa "papers on speculative decoding" --category "research paper" --text

# Fresh news from the past week
seek web brave search "latest Anthropic model release" --fresh pw

# AI-summarized answer with citations
seek web brave answers "what shipped in the latest Bun release?" --citations

# Quick conversational answer with citations, recent only
seek web perplexity "what changed in the EU AI Act this month?" --recency week

# Structured deep research — emit JSON conforming to a schema
seek research parallel "list the top 10 EV battery manufacturers" \
  --schema ./schema.json --processor pro

# Long-horizon Gemini Deep Research, plan first
seek research google "map the competitive landscape for open-weight speech models" \
  --interactive --planner perplexity

# Sonar Deep Research briefing
seek research perplexity "state of the small language model market" --effort high

# Bulk scrape many URLs to LLM-sized text
seek scrape exa https://example.com https://example.org -c 20000

# Authenticated extraction with an objective
seek scrape parallel https://app.example.com/dashboard \
  --objective "Extract the latest invoice table"

# Clean markdown + links from one page, with stealth proxy for anti-bot
seek scrape firecrawl https://example.com -f markdown,links --proxy stealth

# Structured LLM extraction via Firecrawl
seek scrape firecrawl https://news.example.com/article \
  --json-prompt "Extract {headline, author, published_date, summary}"
```

## Picking heuristics

- **"Just look something up"** → `seek web parallel` (or `perplexity` if the user wants a conversational summary).
- **"Find me papers / companies / repos about X"** → `seek web exa --category ...`.
- **"What's happening with X this week?"** → `seek web brave search --fresh pw` or `seek web perplexity --recency week`.
- **"Write me a report on X" / "Compare these vendors" / "Build a list of N entities with attributes"** → `seek research`. Choose `parallel --schema` if you want machine-readable rows, `google` for the most comprehensive report, `perplexity` for a polished briefing in a few minutes, `brave` if you want it cheap and fast.
- **"Get the content of this URL"** → `seek scrape firecrawl` for a single page (best default), `seek scrape exa` for many URLs at once, `seek scrape parallel` if it's behind auth or needs targeted extraction.
- **"Screenshot this page"** → `seek scrape firecrawl <url> -f screenshot`.

## When NOT to use seek

- The user is asking about the seek codebase itself (use file-reading tools, not the CLI).
- The user wants you to call an API they've already configured directly (e.g., a non-seek SDK).
- The URL is on localhost or an internal network — scrape providers won't reach it.
- You already have the answer with high confidence from the conversation or a known fact — don't burn an API call to confirm trivia.

## Output handling

Provider responses can be long. When the user wants the result piped into further processing, pass `--json` and parse with `jq`. When you're going to summarize the result yourself, the default text output is fine and easier to read in the terminal transcript. If a research command is running long, `seek research perplexity` and `seek research google` print polling progress to stderr by default — pass `--quiet` if that noise gets in the way of capturing stdout.
