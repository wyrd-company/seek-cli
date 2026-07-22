---
docs: true
title: web
order: 5
---

Real-time web search — fast, low-cost context for prompts and chatbots. Pick a
provider subcommand; each returns rendered results, or raw JSON with `--json`.

```bash
seek web <provider> "<query...>" [options]
```

Providers: `parallel`, `exa`, `brave search`, `brave answers`, `perplexity`.

## web parallel

Relevant excerpts optimized for LLMs — one call replaces several keyword
searches for broad or complex queries.

```bash
seek web parallel "compare common roof materials" -n 5
```

| Option              | Description                                      |
| ------------------- | ------------------------------------------------ |
| `-n, --num <n>`     | Max results (default 10)                          |
| `-c, --chars <n>`   | Max chars per result excerpt (default 1500)       |
| `--objective <text>`| Objective passed to the ranker (defaults to query)|
| `--mode <name>`     | Search mode: `basic` \| `advanced`                |
| `--json`            | Emit raw JSON response                            |

Output: ranked list of title, URL, and excerpt text.

## web exa

Neural semantic search — finds pages by meaning, best for conceptual queries.

```bash
seek web exa "papers on archival paper longevity" \
  --category "research paper" --text
```

| Option               | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `-n, --num <n>`      | Number of results (default 10)                                       |
| `-t, --type <type>`  | `auto` \| `fast` \| `neural` \| `instant` \| `deep-lite` \| `deep` \| `deep-reasoning` (default `auto`) |
| `--category <name>`  | Restrict to a category (e.g. research paper, news, company, github)  |
| `--text`             | Include full page text snippets                                      |
| `--start <date>`     | Only pages published on/after `YYYY-MM-DD`                           |
| `--end <date>`       | Only pages published on/before `YYYY-MM-DD`                          |
| `--system <text>`    | System prompt to bias the search (sources to prefer, novelty, etc.)  |
| `--json`             | Emit raw JSON response                                              |

Output: ranked list of title, URL, score, and text/highlights.

## web brave search

Clean, structured snippets from an independent global web index — best for
real-time facts. Uses `BRAVE_SEARCH_API_KEY`.

```bash
seek web brave search "seasonal garden preparation guidance" --fresh pw
```

| Option              | Description                                            |
| ------------------- | ----------------------------------------------------- |
| `-n, --num <n>`     | Number of results (default 10)                         |
| `--fresh <window>`  | Freshness: `pd` (day) \| `pw` (week) \| `pm` (month) \| `py` (year) |
| `--country <cc>`    | Two-letter country code (e.g. US, GB)                  |
| `--json`            | Emit raw JSON response                                |

Output: list of title, URL, and snippet.

## web brave answers

AI-generated answers backed by verifiable sources. Uses `BRAVE_ANSWERS_API_KEY`.

```bash
seek web brave answers "compare common bookbinding stitches" --citations
```

| Option              | Description                          |
| ------------------- | ------------------------------------ |
| `--language <code>` | Response language (default `en`)      |
| `--citations`       | Request provider citation tags        |
| `--entities`        | Request provider entity tags          |
| `--country <cc>`    | Two-letter country code               |
| `--json`            | Emit raw JSON response               |

Output: answer text with a citations list appended.

## web perplexity

Synthesizes the web into a short, conversational answer with citations.

```bash
seek web perplexity "compare natural fibers for basket weaving"
```

| Option                 | Description                                              |
| ---------------------- | ------------------------------------------------------- |
| `--model <name>`       | Override model (default `sonar`; e.g. `sonar-pro`, `sonar-reasoning`) |
| `--recency <window>`   | Restrict sources by recency: `hour` \| `day` \| `week` \| `month` |
| `--mode <mode>`        | Search mode: `web` (default) \| `academic`               |
| `--domains <list>`     | Comma-separated allow-list of domains                    |
| `--max-tokens <n>`     | Cap response tokens                                      |
| `--json`               | Emit raw JSON response                                  |

Output: answer text with a citations list appended.
