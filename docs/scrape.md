---
docs: true
title: scrape
order: 7
---

Targeted page extraction — clean text, Markdown, or JSON from URLs you already
have. Pick a provider subcommand.

```bash
seek scrape <provider> <url...> [options]
```

Providers: `exa`, `parallel`, `firecrawl`.

## scrape exa

Bulk parsing — retrieves clean, stripped page text optimized for LLM token
windows. Accepts multiple URLs.

```bash
seek scrape exa https://example.com https://example.org
```

| Option            | Description                            |
| ----------------- | -------------------------------------- |
| `-c, --chars <n>` | Max characters per page (default 50000) |
| `--json`          | Emit raw JSON response                 |

Output: one Markdown block per URL (title, URL, text), separated by `---`.

## scrape parallel

Enterprise extraction via Parallel's `/v1/extract` endpoint — clean markdown
excerpts (and optional full content) plus publish dates per URL. Can
authenticate through logins and paywalls. Accepts multiple URLs.

```bash
seek scrape parallel https://app.example.com/dashboard \
  --objective "Extract the latest invoice table"
```

| Option              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `--objective <text>`| Focus excerpts on a natural-language extraction goal  |
| `--full`            | Include full markdown content, not just excerpts      |
| `-c, --chars <n>`   | Max characters per excerpt block                      |
| `--max-total <n>`   | Max characters total across all URLs                  |
| `--max-age <secs>`  | Reuse cached content up to N seconds old              |
| `--json`            | Emit raw JSON response                               |

Output: one block per URL (title, URL, publish date, content), with any
per-URL errors listed at the end.

## scrape firecrawl

Turn a single live URL into clean Markdown, HTML, JSON, a summary, or a
screenshot via Firecrawl v2.

```bash
seek scrape firecrawl https://example.com -f markdown,links
```

| Option                | Description                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `-f, --format <list>` | Comma-separated: `markdown`, `html`, `rawHtml`, `links`, `summary`, `screenshot`, `video`, `audio` (default `markdown`) |
| `--json-prompt <text>`| Add a JSON format with this LLM extraction prompt (produces `data.json`)|
| `--full`              | Include nav/footer/sidebars (disables `onlyMainContent`)                |
| `--wait <ms>`         | Wait N ms for JS to render before scraping                              |
| `--mobile`            | Render as a mobile viewport                                             |
| `--block-ads`         | Block ads / trackers during render                                      |
| `--proxy <mode>`      | Proxy mode: `basic` \| `stealth` \| `enhanced` \| `auto`                |
| `--max-age <ms>`      | Reuse cached scrape up to N ms old (cheaper, near-instant)              |
| `--json`              | Emit raw JSON response                                                 |

Takes a single URL. Output: the first available rendered format (markdown,
then summary, html, links, JSON, or screenshot).
