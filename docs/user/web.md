---
title: Search the web
product: seek
order: 4
---

Run a real-time web search with one of seek's search providers, and get the
results as text or JSON. You need the provider's key (see
[Set up provider keys](config.md)) or a seek server (see
[Use a seek server from the CLI](connect-to-a-server.md)).

![Terminal recording: seek web parallel prints two numbered results with titles, URLs and excerpts, then seek web exa prints results with scores.](assets/web-search.gif)

## 1. Pick the command

| You want | Command | Key |
| --- | --- | --- |
| Dense excerpts for an agent, for a broad question | `seek web parallel` | `providers.parallel.api-key` |
| Pages found by meaning, such as papers or companies | `seek web exa` | `providers.exa.api-key` |
| Pages from Brave's own index, with a freshness window | `seek web brave search` | `providers.brave-search.api-key` |
| One AI answer with sources, from Brave | `seek web brave answers` | `providers.brave-answers.api-key` |
| One short answer with citations, from Perplexity | `seek web perplexity` | `providers.perplexity.api-key` |

[Choosing a provider](providers.md) explains the trade-offs.

## 2. Run the search

Put the query after the command. Quote it, or seek joins the words for you:

```sh
seek web parallel "how do honeybees make honey"
```

`parallel`, `exa` and `brave search` print numbered results, each with its
title, URL and text; `exa` adds a relevance score. `brave answers` and
`perplexity` print an answer followed by its citations.

## 3. Narrow the search

Each provider has its own options. Common ones:

```sh
seek web parallel "how do honeybees make honey" -n 3 -c 400
seek web exa "papers on honeybee foraging" --category "research paper" --start 2024-01-01
seek web brave search "honey harvest season" --fresh pw --country GB
seek web perplexity "how do honeybees make honey" --recency month
```

- `-n` sets the number of results for `parallel`, `exa` and `brave search`.
- `-c` caps the characters of each `parallel` excerpt.
- `--category`, `--start` and `--end` restrict `exa` to a category and a
  publication window.
- `--fresh` takes `pd`, `pw`, `pm` or `py` (past day, week, month or year)
  for `brave search`.
- `--recency` takes `hour`, `day`, `week` or `month` for `perplexity`.

The [command reference](reference/commands/seek-web.md) lists every option of
each search command, with its default.

## 4. Get JSON for a script or an agent

Add `--json` to print the provider's own response:

```sh
seek web exa "papers on honeybee foraging" --json
```

The response is the provider's format, unchanged: each provider's results
have their own fields.

## Check the result

A search that succeeds prints its results, or `(no results)`, and exits with
status 0. A missing key exits with status 2 and names the variable to set; a
provider error exits with status 1 and prints the HTTP status the provider
returned.
