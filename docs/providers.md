---
docs: true
title: Providers
order: 4
---

seek is a thin, uniform layer over several provider APIs. Commands are grouped
by intent (search, research, scrape); within a command you pick the provider
whose trade-offs fit your query. Every provider requires its own API key — see
[Configuration](config).

| Provider      | Commands                         | Best for                                                        |
| ------------- | -------------------------------- | --------------------------------------------------------------- |
| Parallel      | `web`, `research`, `scrape`      | Dense, LLM-ready context; strict-JSON deep research; extraction |
| Exa           | `web`, `scrape`                  | Neural semantic search; bulk clean page text                    |
| Brave Search  | `web brave search`               | Real-time facts from an independent global index                |
| Brave Answers | `web brave answers`, `research brave` | AI answers with verifiable sources; deep research           |
| Perplexity    | `web`, `research`                | Short cited answers; polished long-form briefings               |
| Google/Gemini | `research google`                | Long-horizon, Google-grounded reports                           |
| Firecrawl     | `scrape firecrawl`               | Clean Markdown/HTML/JSON/screenshots from any live URL          |

## Parallel

The most versatile provider — used by all three commands.

- **web** — returns relevant excerpts optimized for LLMs, replacing multiple
  keyword searches with a single call for broad or complex queries.
- **research** — Parallel Deep Research with tunable processor depth
  (`core-fast` … `ultra`) and optional strict JSON output via a schema file.
  Best for B2B and data-ops work where output must be auditable. Supports
  resumable `--async` submission plus later `research status` and `research
  get` calls.
- **scrape** — the `/v1/extract` endpoint returns clean markdown excerpts (and
  optional full content) plus publish dates, and can authenticate through
  logins and paywalls.

## Exa

Neural semantic search that finds pages by meaning rather than keywords.

- **web** — best for conceptual queries; supports search types
  (`auto` … `deep-reasoning`), category filters, and date windows.
- **scrape** — bulk page parsing that returns stripped text optimized for LLM
  token windows.

## Brave

Brave exposes two separate APIs, provisioned and keyed independently.

- **Brave Search** (`web brave search`) — clean, structured snippets from an
  independent global web index; best for real-time consumer facts, with
  optional freshness and country filters.
- **Brave Answers** (`web brave answers`, `research brave`) — AI-generated
  answers backed by verifiable sources. The same endpoint powers deep research
  when the research flag is enabled. Research remains synchronous because the
  streaming endpoint does not expose a resumable job id.

## Perplexity

Synthesizes the web into cited answers.

- **web** — short, conversational answers with citations; model, recency,
  search mode (`web`/`academic`), and domain filters are configurable.
- **research** — Sonar Deep Research (async job) for polished long-form
  briefings with inline citations and a tunable reasoning-effort level.
  Supports resumable submission and later status/result retrieval.

## Google (Gemini)

- **research google** — the Gemini Deep Research Agent autonomously plans,
  executes, and synthesizes multi-step research into a detailed, cited report.
  Runs can take several minutes; resumable submission and an interactive
  plan-approval mode are available. With `--interactive --async`, the plan is
  approved before the provider job is submitted.

## Resumable provider jobs

Google, Parallel, and Perplexity expose durable provider jobs. `seek research
<provider> <query> --async` returns a provider-qualified locator without
polling. `seek research status <provider> <job-id>` and `seek research get
<provider> <job-id>` reconnect directly to that remote job; no local daemon or
job-history database is involved. See [Research](research) for command examples
and the JSON lifecycle contract.

## Firecrawl

- **scrape firecrawl** — turns any live URL into clean Markdown, HTML, raw
  HTML, links, a summary, a screenshot, or LLM-extracted JSON, with controls
  for JS rendering, mobile viewport, ad blocking, proxy modes, and caching.

## Choosing a provider

- Not sure which to use? Start with **Parallel** for `web` and `research`, and
  **Firecrawl** for `scrape`.
- Running a command without the matching key prints the missing-key error plus
  a ranked list of sibling providers, marking which ones you already have keys
  for.
