---
title: How research jobs work
product: seek
order: 13
---

Deep research can take longer than a terminal session should wait, so seek
lets the provider hold the work. This page explains what a research job is,
how seek reports its state, and why Brave research is different.

## The provider holds the job

Google, Parallel and Perplexity run research as jobs on their own servers.
`seek research <provider> <question> --async` submits the job and returns
as soon as the provider accepts it. seek keeps nothing locally: no database,
no background process. Later, `seek research status` and `seek research get`
ask the provider about the job directly, from any machine with the same
provider access.

A job is identified by its job locator: the provider and the provider's job
ID. A job ID is opaque and has meaning only with its provider, so seek always
takes the two together, as in `seek research status parallel -- <job-id>`.

Without `--async`, seek submits the same kind of job and checks it at an
interval until it ends, then prints the report. This is blocking research;
it is the same job, watched by one seek process.

## One set of statuses for every provider

Each provider names its states differently: Google says `in_progress`,
Perplexity `IN_PROGRESS`, Parallel `running`. seek maps each to a normalized
status, so a person or a script reads one vocabulary:

| Status | Final | Meaning |
| --- | --- | --- |
| `queued` | No | Accepted and not started |
| `running` | No | In progress |
| `action-required` | No | Waiting for the provider's user to act |
| `completed` | Yes | Finished with a report |
| `incomplete` | Yes | Ended before completing, without a provider failure |
| `failed` | Yes | Ended in a provider failure |
| `cancelled` | Yes | Cancelled |
| `unknown` | No | A provider status seek does not map |

The provider's own status stays beside the normalized one, so nothing the
provider said is lost. `incomplete` comes only from Google: the job stopped
short of a full report, and the provider's partial response is still in the
job's payload.

## Status and result are separate questions

`seek research status` answers "what state is the job in?" and succeeds
whenever the provider answers, even for a failed job, because the lookup
itself worked. `seek research get` answers "give me the report" and fails at
once, with exit status 1, unless the job has completed. Neither waits: each
asks the provider once, so a script decides how often to ask and for how
long.

## Why Brave research has no job

Brave's research streams one response while it works and gives no job ID, so
there is nothing to look up later. `seek research brave` always waits for its
answer, and `status` and `get` refuse `brave`.

## JSON for programs

With `--json`, submission, `status` and `get` print a research job envelope:
the locator, the normalized status, whether it is final, and the provider's
complete response. For a completed job, `get` adds the report text and its
citations. The [research job envelope reference](reference/research-job-envelope.md)
defines each field, and [Track a research job from a script](script-research-jobs.md)
uses them.
