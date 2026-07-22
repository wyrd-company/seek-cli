---
name: seek
description: >-
  Use the `seek` CLI to search the web, run autonomous deep research, or scrape
  live URLs across provider APIs. Use this skill for fresh facts, citations,
  page summaries, research, comparisons, monitoring, extraction, screenshots,
  clean markdown/JSON, explicit `seek` requests, and provider selection.
---

# Seek CLI

`seek` is an agent-friendly CLI that fans out to multiple search, research, and
scrape providers behind a single command tree. Picking the right subcommand
matters more than tweaking flags: each provider has a different cost, latency,
and output shape.

## Decision guide

Start by classifying the task into one of three buckets:

| Bucket | When | Latency |
|---|---|---|
| `seek web <provider>` | Real-time facts, fresh context for a prompt, single-shot lookup | <5s |
| `seek research <provider>` | Multi-step investigation, comparison, structured report, citations | 30s – 25 min |
| `seek scrape <provider>` | URL is already known and you want its content | <10s |

Then pick the provider based on the trade-off you care about. When unsure, the
defaults in **bold** are good starting points.

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

Google, Parallel, and Perplexity support resumable jobs. Add `--async` to
submit without polling, then use `seek research status <provider> <job-id>` and
`seek research get <provider> <job-id>`. Brave remains synchronous because its
streaming endpoint does not expose a resumable job id.

Treat each job id as opaque and retain it with its provider. Lifecycle JSON
uses `locator.provider`, `locator.jobId`, `status`, `providerStatus`, `terminal`,
and `providerPayload`; failed jobs may add `failure`, and completed results add
`result` (`text` and `citations`). Parallel results may also add
`providerResult`. Normalized status is `queued`, `running`, `action-required`,
`completed`, `incomplete`, `failed`, `cancelled`, or `unknown`. Google
`incomplete` is terminal but is not provider failure. `status` performs one
lookup and exits successfully when lookup succeeds; `get` performs one lookup,
never waits, and exits non-zero unless the job is completed.

For `research parallel`, `--processor` controls depth: `core-fast` (15-100s) →
`core` (default) → `core2x` → `pro` (3-9m) → `ultra` (5-25m). `-fast`
variants prioritize speed over freshness.

For `research google`, `--interactive --planner perplexity` lets you review and
approve the plan before submission. Combining it with `--async` returns the
accepted interaction locator after approval instead of polling.

### `seek scrape` — pull content from known URLs

| Provider | Best for |
|---|---|
| **`firecrawl`** | Clean Markdown/HTML/JSON/screenshot from any live URL. `-f markdown,links` for combined formats. `--json-prompt "..."` to LLM-extract structured data. `--proxy stealth` for anti-bot pages. |
| `exa` | Bulk parsing of many URLs at once, token-window optimized. Pass multiple URLs as positional args. |
| `parallel` | Pages behind logins/paywalls or sites needing an objective ("Extract the latest invoice table"). |

## Always-available flags

- `--json` on existing blocking provider commands emits the raw response.
  Async submission, status, and result commands emit a normalized lifecycle
  envelope containing the provider-qualified locator, normalized and native
  statuses, and raw provider payload. **Use JSON when piping into `jq`, parsing
  fields, or feeding another tool.**
- `-h` / `--help` works at every level (`seek`, `seek web`, `seek web brave`,
  etc.). When in doubt, run `seek <path> --help`.

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

If a command fails with a missing-key error, surface it to the user and point
them at `seek config init`.

## Examples

```sh
# Quick real-time search — broad question, agent-friendly excerpts
seek web parallel "compare common roof materials" -n 5

# Semantic / conceptual lookup with category filter and full text
seek web exa "papers on archival paper longevity" \
  --category "research paper" --text

# Fresh news from the past week
seek web brave search "seasonal garden preparation guidance" --fresh pw

# AI-summarized answer with citations
seek web brave answers "compare common bookbinding stitches" --citations

# Quick conversational answer with citations, recent only
seek web perplexity "compare natural fibers for basket weaving" --recency week

# Structured deep research — emit JSON conforming to a schema
seek research parallel "compare three soil amendments for container gardens" \
  --schema ./schema.json --processor pro

# Long-horizon Gemini Deep Research, plan first
seek research google "compare insulation materials for a small workshop" \
  --interactive --planner perplexity

# Sonar Deep Research briefing
seek research perplexity "compare traditional bookbinding methods" --effort high

# Submit a resumable job, then reconnect without local polling
seek research parallel "compare traditional bookbinding methods" --async
seek research status parallel job-opaque-123
seek research get parallel job-opaque-123

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

- **"Just look something up"** → `seek web parallel` (or `perplexity` for a
  conversational summary).
- **"Find papers, companies, or repositories about X"** →
  `seek web exa --category ...`.
- **"What's happening with X this week?"** →
  `seek web brave search --fresh pw` or
  `seek web perplexity --recency week`.
- **"Write a report" / "Compare vendors" / "Build structured rows"** →
  `seek research`. Choose `parallel --schema` for machine-readable rows,
  `google` for the most comprehensive report, `perplexity` for a polished
  briefing, or `brave` for speed and lower cost.
- **"Get the content of this URL"** → `seek scrape firecrawl` for one page,
  `seek scrape exa` for many URLs, or `seek scrape parallel` for authenticated
  or targeted extraction.
- **"Screenshot this page"** → `seek scrape firecrawl <url> -f screenshot`.

## When NOT to use seek

- The user is asking about the seek codebase itself. Use file-reading tools.
- The user wants a configured API called directly instead of through `seek`.
- The URL is on localhost or an internal network. Providers cannot reach it.
- The answer is already known with high confidence; avoid an unnecessary call.

## Output handling

Provider responses can be long. For downstream processing, pass `--json` and
parse with `jq`. For summaries, default text is easier to read. Blocking
`seek research perplexity` and `seek research google` print polling progress to
stderr; pass `--quiet` when capturing stdout.
