# Seek CLI (`seek`)

Agent-friendly CLI for web search, deep research, and targeted scraping across
popular APIs.

Built with [Bun](https://bun.sh) + TypeScript. Each command groups providers by
intent so an agent (or human) can pick the right trade-off between speed, cost,
and output type.

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
seek config init        # writes a mode-0600 config template
seek config path        # print the resolved path
seek config show        # show which keys are configured (values masked)
```

The config file is a flat JSON object whose keys match the env var names, so
you can mix and match without learning a second schema:

```json
{
  "EXA_API_KEY": "sk-…",
  "PERPLEXITY_API_KEY": "pplx-…"
}
```

## Command map

```text
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
│   ├── status         Inspect one resumable research job without waiting
│   ├── get            Retrieve one completed research job without waiting
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
seek web parallel "compare common roof materials" -n 5
seek web exa "papers on archival paper longevity" \
  --category "research paper" --text
seek web brave search "seasonal garden preparation guidance" --fresh pw
seek web brave answers "compare common bookbinding stitches" --citations
seek web perplexity "compare natural fibers for basket weaving"

# Deep research
seek research brave "compare common methods for preserving paper records" \
  --citations
seek research parallel "compare three soil amendments for container gardens" \
  --schema ./schema.json --processor pro
seek research google "compare common methods for preserving paper records"
seek research google "compare insulation materials for a small workshop" \
  --interactive --planner perplexity
seek research perplexity "compare traditional bookbinding methods"

# Scrape
seek scrape exa https://example.com https://example.org
seek scrape parallel https://app.example.com/dashboard \
  --objective "Extract the latest invoice table"
seek scrape firecrawl https://example.com -f markdown,links
```

Provider and research-lifecycle leaf commands support `--json`. Existing
blocking provider commands emit their raw provider response. Async submission,
status, and result commands emit the normalized lifecycle envelope described
below, including the raw provider payload.

## Resumable research jobs

Google, Parallel, and Perplexity research can run without keeping the local
`seek` process alive. The provider owns the durable remote job; retain both the
provider and opaque job id printed by submission.

```sh
# Submit and return as soon as the provider accepts the job
seek research google \
  "compare common methods for preserving paper records" --async

# Inspect once; this command never polls
seek research status google job-opaque-123

# Retrieve once; this returns non-zero immediately when the job is not complete
seek research get google job-opaque-123
```

The same lifecycle works with `parallel` and `perplexity`. Google interactive
planning still finishes before submission:

```sh
seek research google "compare insulation materials for a small workshop" \
  --interactive --planner manual --async
```

Brave remains synchronous because its streaming research endpoint does not
expose a resumable job id. It intentionally has no `--async` option.

Use `--json` for automation:

```sh
seek research parallel "compare three soil amendments for container gardens" \
  --async --json
seek research status parallel job-opaque-456 --json
seek research get parallel job-opaque-456 --json
```

Async submission and `status --json` use this stable envelope:

```json
{
  "locator": {
    "provider": "parallel",
    "jobId": "job-opaque-456"
  },
  "status": "running",
  "providerStatus": "running",
  "terminal": false,
  "providerPayload": {}
}
```

- `locator.provider` and `locator.jobId` form the durable, provider-qualified
  locator. Job ids are opaque and are not assumed to be globally unique.
- `status` is one of `queued`, `running`, `action-required`, `completed`,
  `incomplete`, `failed`, `cancelled`, or `unknown`. Google `incomplete` is a
  terminal state distinct from provider failure; its raw partial payload
  remains available in `providerPayload`.
- `providerStatus` retains the provider's native status string.
- `providerPayload` retains the complete status response. Failed jobs may also
  include `failure` with provider details.
- Completed `get --json` adds `result` with normalized `text` and `citations`.
  Parallel also adds `providerResult`, the raw response from its result
  endpoint.

`status` exits successfully whenever lookup succeeds, including for failed
jobs. `get` exits non-zero for queued, running, action-required, incomplete,
failed, cancelled, or unknown states and never waits for a state change.

## CI and release

Run the same checks as CI locally:

```sh
bun run ci
```

Build release archives locally:

```sh
RUN_CI=0 bun run release
```

Pushing a version tag such as `0.1.0` runs the release workflow. It builds
macOS/Linux ARM64 and x86_64 tarballs, publishes them to the GitHub release,
then updates `Formula/seek-cli.rb` in
`github.com/wyrd-company/homebrew-tools`.

The tap publish job expects an SSH deploy key in the repository secret
`FORMULAE_PUBLISH_KEY` with write access to
`wyrd-company/homebrew-tools`.
