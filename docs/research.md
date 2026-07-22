---
docs: true
title: research
order: 6
---

Autonomous deep research — multi-step investigation that browses, verifies, and
compiles a cited report. These calls are slower than `web` (seconds to tens of
minutes) and stream progress to stderr unless quieted.

```bash
seek research <provider> "<query...>" [options]
```

Providers: `brave`, `parallel`, `google`, `perplexity`.

## Resumable jobs

Google, Parallel, and Perplexity can submit research without keeping the local
`seek` process alive. The remote provider owns the durable job. Retain the
provider and opaque job id printed by submission.

```bash
# Submit and return after provider acceptance
seek research google \
  "compare common methods for preserving paper records" --async

# Perform one status lookup without polling
seek research status google job-opaque-123

# Perform one result lookup without polling
seek research get google job-opaque-123
```

Async human-readable output includes the provider, job id, normalized and
provider-native statuses, and copyable status and result commands. The same
lifecycle works with `parallel` and `perplexity`.

`status` exits successfully whenever the provider lookup succeeds, even if the
remote job failed. `get` exits non-zero immediately when a job is queued,
running, action-required, incomplete, failed, cancelled, or unknown. It never
waits for the job to change state.

### JSON lifecycle contract

Pass `--json` to submission, `status`, or `get` for automation:

```bash
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

| Field | Contract |
| --- | --- |
| `locator` | Stable provider-qualified locator. The opaque `jobId` is meaningful only with its `provider`. |
| `status` | `queued`, `running`, `action-required`, `completed`, `incomplete`, `failed`, `cancelled`, or `unknown`. Google `incomplete` is terminal and distinct from provider failure. |
| `providerStatus` | Provider-native status string. |
| `terminal` | Whether the normalized state is `completed`, `incomplete`, `failed`, or `cancelled`. |
| `providerPayload` | Complete raw provider status response. |
| `failure` | Optional provider failure message and details. |

Completed `get --json` also contains normalized `result.text` and
`result.citations`. Parallel adds `providerResult` with the unmodified response
from its separate result endpoint.

## research brave

Brave Answers Deep Research — a quick, surface-level pass. Uses
`BRAVE_ANSWERS_API_KEY`.

```bash
seek research brave \
  "compare common methods for preserving paper records" --citations
```

| Option              | Description                          |
| ------------------- | ------------------------------------ |
| `--country <cc>`    | Two-letter country code (default `us`)|
| `--language <code>` | Response language (default `en`)      |
| `--citations`       | Request provider citation tags        |
| `--entities`        | Request provider entity tags          |
| `--json`            | Emit raw JSON response               |

Output: report text with a citations list appended.

Brave research is synchronous. Its streaming endpoint does not expose a
resumable job id, so `--async`, `status`, and `get` do not apply to Brave.

## research parallel

Parallel Deep Research — thorough, from ~30s up to ~25 minutes depending on
processor depth. Supports strict JSON output via a schema file, giving
auditable sources for B2B and data-ops work.

```bash
seek research parallel "compare three soil amendments for container gardens" \
  --schema ./schema.json --processor pro
seek research parallel "compare traditional bookbinding methods" --async
```

| Option               | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `--schema <path>`    | Path to a JSON file describing the desired output schema        |
| `--processor <name>` | Depth: `core-fast` \| `core` \| `core2x-fast` \| `core2x` \| `pro-fast` \| `pro` \| `ultra-fast` \| `ultra` (default `core`) |
| `--async`            | Submit and return after provider acceptance                    |
| `--json`             | Raw blocking result, or lifecycle envelope with `--async`      |

Processor guidance: `-fast` variants trade data freshness for speed.
`core` = cross-referenced moderate complexity; `core2x` = high-complexity
cross-referenced; `pro` = exploratory web research; `ultra` = advanced
multi-source deep research.

Output: report content (JSON-stringified if a schema was used) with unique
citation URLs appended.

## research google

Gemini Deep Research Agent — comprehensive, 5–20 minutes. It autonomously
plans, executes, and synthesizes multi-step research into a detailed, cited
report. Uses `GEMINI_API_KEY`.

```bash
seek research google "compare common methods for preserving paper records"
seek research google "compare insulation materials for a small workshop" \
  --interactive --planner perplexity
seek research google "compare insulation materials for a small workshop" \
  --interactive --planner manual --async
```

| Option                | Description                                                  |
| --------------------- | ----------------------------------------------------------- |
| `--agent <name>`      | Override the Deep Research agent id                          |
| `--system <text>`     | Instruction incorporated into the Deep Research input         |
| `--interactive`       | Review and approve a research plan before starting           |
| `--planner <provider>`| Planner for `--interactive`: `perplexity` \| `brave` \| `manual` (default `perplexity`) |
| `--quiet`             | Suppress polling progress on stderr                          |
| `--async`             | Submit and return after provider acceptance                  |
| `--json`              | Raw blocking interaction, or lifecycle envelope with `--async` |

`--interactive` requires a TTY; it proposes a plan you can approve, revise, or
quit before submission. With `--async`, `seek` returns the accepted interaction
locator after plan approval instead of polling.

`--system` keeps the instruction distinct from the research question while
incorporating both into the Deep Research input. In interactive mode, the
planner receives the research question without this instruction. After plan
approval, the final Deep Research input contains the instruction and approved
plan once each.

Output: report text with a citations list appended.

## research perplexity

Perplexity Sonar Deep Research — an informed pass, ~1–3 minutes, run as an
async job. Uses `PERPLEXITY_API_KEY`.

```bash
seek research perplexity "compare traditional bookbinding methods"
seek research perplexity "compare archival storage materials" --async
```

| Option             | Description                                       |
| ------------------ | ------------------------------------------------- |
| `--model <name>`   | Override model (default `sonar-deep-research`)     |
| `--effort <level>` | Reasoning effort: `low` \| `medium` \| `high` (default `medium`) |
| `--quiet`          | Suppress polling progress on stderr                |
| `--async`          | Submit and return after provider acceptance        |
| `--json`           | Raw blocking job, or lifecycle envelope with `--async` |

Output: report text with a citations list appended.
