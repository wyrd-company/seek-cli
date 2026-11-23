---
title: Choosing a provider
product: seek
order: 11
---

Each provider answers in its own way, at its own speed and cost, so the
choice of provider shapes the answer more than any option does. This page
describes what each provider offers through seek. Every provider needs its own
key; see [Set up provider keys](config.md).

| Provider | Commands | What it is good at |
| --- | --- | --- |
| Parallel | `web`, `research`, `scrape` | Dense, LLM-ready excerpts; research with strict JSON output; focused extraction |
| Exa | `web`, `scrape` | Finding pages by meaning; bulk page text |
| Brave Search | `web brave search` | Real-time results from an independent web index |
| Brave Answers | `web brave answers`, `research brave` | AI answers with sources; quick research |
| Perplexity | `web perplexity`, `research perplexity` | Short cited answers; long-form briefings |
| Google Gemini | `research google` | Long, planned research with a detailed, cited report |
| Firecrawl | `scrape firecrawl` | Any live page as Markdown, HTML, links, a screenshot or extracted JSON |

When you are not sure, Parallel is a good start for `web` and `research`,
and Firecrawl for `scrape`.

## Search

- **Parallel** returns excerpts written for a language model, and one query
  can stand in for several keyword searches. It suits an agent that needs
  broad context in one call.
- **Exa** searches by meaning, so it finds papers, companies or posts that
  match a concept even when they share no keywords with the query. It can
  restrict results to a category and a publication window.
- **Brave Search** returns snippets from Brave's own index, with freshness
  and country filters: a good source of current facts.
- **Brave Answers** and **Perplexity** write one answer and list its sources,
  for a reader who wants the answer rather than a list of pages.

## Research

Research providers differ most in time and depth:

| Provider | Typical time | Resumable job |
| --- | --- | --- |
| Brave | Seconds | No |
| Perplexity | 1 to 3 minutes | Yes |
| Parallel | 15 seconds to 25 minutes, by processor | Yes |
| Google | 5 to 20 minutes | Yes |

- **Parallel** chooses its depth by processor, from `core-fast` to `ultra`;
  the `-fast` processors trade freshness of data for speed. With `--schema`,
  it returns JSON in the shape a schema file describes, with the sources for
  each field, which suits work that must be audited.
- **Google** runs the Gemini Deep Research agent, which plans, searches and
  writes a long report. With `--interactive`, a planner drafts a plan for
  you to approve or revise before the research starts.
- **Perplexity** writes a polished briefing with inline citations, with a
  reasoning effort of `low`, `medium` or `high`.
- **Brave** answers in one streaming response, so it is the quickest, and it
  has no job to check later. `seek research brave` lists `--citations`, but
  Brave's research mode does not accept it, and the command stops with an
  error before it sends the request.

When `--country` or `--language` is left out of a Brave command, seek sends
neither, and Brave applies its own defaults.

## Extraction

- **Exa** returns the text of many pages at once, stripped for a model's
  context window.
- **Parallel** returns excerpts focused on an objective you give, with each
  page's publish date, and can include each page's full Markdown.
- **Firecrawl** renders one live page, including its JavaScript, and returns
  the formats you ask for, or JSON that a model extracts with your prompt.

## When a key is missing

A provider command without its key stops before calling anything, names the
variable to set, and lists the other providers of the same group, marking
those that have no key yet, so you can switch to one you already have.
