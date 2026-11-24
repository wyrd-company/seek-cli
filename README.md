<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/user/assets/logo-dark.svg">
    <img src="docs/user/assets/logo.svg" alt="seek icon" width="160">
  </picture>
</p>

# Seek CLI (`seek`)

Agent-friendly CLI for web search, deep research, and targeted scraping across
popular APIs.

Run `seek skill` to print the bundled Seek skill for use by an agent.

Read the documentation at [wyrd.foo/docs/seek](https://wyrd.foo/docs/seek/):
start with [Run your first search](docs/user/first-search.md), which needs no
API key.

Built with [Bun](https://bun.sh) + TypeScript. Each command groups providers by
intent so an agent (or human) can pick the right trade-off between speed, cost,
and output type.

![seek command-line demo](docs/user/assets/demo.gif)

## Install

With Homebrew:

```sh
brew install wyrd-company/tools/seek-cli
```

From source with Bun 1.4.4 or later:

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

Each provider reads its own API key, the setting `providers.<provider>.api-key`.
The CLI reads its client configuration from `/etc/seek/client.yml`, then
`$XDG_CONFIG_HOME/seek/client.yml` (falling back to
`~/.config/seek/client.yml`), then environment variables, then flags, each
layer overriding the one before. Each setting's variable is `SEEK_` and its
path, and its flag `--` and its path.

| Provider      | Setting                          | Variable for the key itself                  |
| ------------- | -------------------------------- | -------------------------------------------- |
| Parallel      | `providers.parallel.api-key`      | `SEEK_PROVIDERS_PARALLEL_API_KEY_VALUE`      |
| Exa           | `providers.exa.api-key`           | `SEEK_PROVIDERS_EXA_API_KEY_VALUE`           |
| Brave Search  | `providers.brave-search.api-key`  | `SEEK_PROVIDERS_BRAVE_SEARCH_API_KEY_VALUE`  |
| Brave Answers | `providers.brave-answers.api-key` | `SEEK_PROVIDERS_BRAVE_ANSWERS_API_KEY_VALUE` |
| Perplexity    | `providers.perplexity.api-key`    | `SEEK_PROVIDERS_PERPLEXITY_API_KEY_VALUE`    |
| Google        | `providers.google.api-key`        | `SEEK_PROVIDERS_GOOGLE_API_KEY_VALUE`        |
| Firecrawl     | `providers.firecrawl.api-key`     | `SEEK_PROVIDERS_FIRECRAWL_API_KEY_VALUE`     |

Each key names one source: the key itself (`value`), a `file`, a credential
helper (`command`) or a field of a Vault or OpenBao KV secret (`vault`):

```yaml
providers:
  exa:
    api-key:
      file: ~/.config/seek/secrets/exa
  perplexity:
    api-key:
      command: ["op", "read", "op://Private/Perplexity/credential"]
```

```sh
seek config init        # writes a commented, mode-0600 template
seek config path        # print the file config init writes
seek config validate    # check the configuration
seek config show        # show each setting and its layer, secrets redacted
```

Upgrading from seek 0.3, which read `config.json` and variables such as
`EXA_API_KEY`? See [docs/user/upgrade-from-0-3.md](docs/user/upgrade-from-0-3.md).

## Server mode

To keep provider keys out of devcontainers and other client machines, run
`seek serve` (or the `ghcr.io/wyrd-company/seek-server` image) somewhere
central and point the CLI at it:

```sh
export SEEK_SERVER_URL=https://seek.internal
export SEEK_SERVER_TOKEN_VALUE=...
```

To read the client token from Vault or OpenBao, name its field in the client
configuration:

```yaml
server:
  url: https://seek.internal
  token:
    vault:
      path: clients/my-seek-cli
      key: SEEK_SERVER_TOKEN
vault:
  address: https://bao.internal
  auth:
    mode: token
    token:
      file: ~/.vault-token
```

A Vault login is used only for the server it was declared beside, so a
`BAO_TOKEN` exported for another server never reaches this one. The server
reads its own configuration, `/etc/seek/server.yml`, with the client tokens it
accepts as `server.tokens`. See [docs/user/server.md](docs/user/server.md).

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
seek research brave "compare common methods for preserving paper records"
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

Build release archives locally (no tag, publish, or version change):

```sh
RUN_CI=0 bun run release
```

### Versioning and releasing

[Intentional](https://github.com/wyrd-company/intentional) is the only version
and release mechanism for this repo. Do not edit `version` in `package.json` by
hand and do not create release tags by hand. `package.json` is a committed
projection of the release version; the release version itself lives in bare
`X.Y.Z` Git tags (no `v` prefix).

1. `intentional add --release-unit seek-cli:<major|minor|patch> --message "..."`
   records an intent with each user-visible change. Commit it with the change.
2. `intentional status` shows pending intents and the computed next version.
3. `intentional plan > release-plan.json` emits the digest-bound release plan.
4. `intentional apply` bumps `package.json`, writes `CHANGELOG.md`, and consumes
   the included intents. Commit the result.
5. `intentional tag --plan release-plan.json` creates the annotated release tag
   on that commit. `intentional check` validates configuration and intents.

Pushing the tag runs the release workflow. It builds macOS/Linux ARM64 and
x86_64 tarballs, publishes them to the GitHub release, then updates
`Formula/seek-cli.rb` in `github.com/wyrd-company/homebrew-tools`.
`scripts/release.sh` only builds and publishes artifacts. It reads the version
from `package.json` and refuses to run when the pushed tag differs from it.

The tap publish job expects an SSH deploy key in the repository secret
`FORMULAE_PUBLISH_KEY` with write access to
`wyrd-company/homebrew-tools`.

### Public docs

The public docs are `docs/user/` (`docs.yml` and the pages), and they publish to
[wyrd.foo](https://wyrd.foo/tools/seek/). `bun run docs:reference` regenerates
the reference in `docs/user/reference/` from the command definitions and the
specifications, `bun run docs:check` checks the reference, examples, links,
navigation and assets (CI runs it), and `bun run docs:capture` records the
terminal recordings again with Docker. [docs/AGENTS.md](docs/AGENTS.md)
describes each. They release as their own Intentional
unit, `seek-docs`, which depends on `seek-cli`. `seek-docs` writes
`docs-version` into `docs/user/docs.yml`, and `seek-cli` writes `version`; do not
edit either by hand. A docs-only change takes a `seek-docs` intent:

```sh
intentional add --release-unit seek-docs:patch --message "..."
```

The `Publish docs` workflow calls the wyrd.foo reusable workflow. It runs when
the `Release` workflow succeeds for a pushed release tag, when a
`seek-docs@X.Y.Z` tag is pushed, and on manual dispatch with a `ref`. A plain
push to `main` does not publish. The `Release` and `Server image` workflows run
only for `X.Y.Z` tags, so a docs tag does not start a release.
