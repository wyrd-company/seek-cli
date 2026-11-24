---
title: Run a research job
product: seek
order: 5
---

Submit a deep research question, let the provider work on it while seek is
not running, then check its status and collect the report. Google, Parallel
and Perplexity hold research as resumable jobs. You need the provider's key
(see [Set up provider keys](config.md)) or a seek server.

To practice these steps without a key, start the practice server and set
`SEEK_SERVER_URL` and `SEEK_SERVER_TOKEN_VALUE` as
[Run your first search](first-search.md) shows, and use `parallel`. The
outputs below are the practice server's.

![Terminal recording: seek research parallel --async accepts a job, seek research status reports it running and then completed, and seek research get prints the report and its citations.](assets/research-job.gif)

## 1. Submit the question

Add `--async` to submit the job and return at once:

```sh
seek research parallel "how do honeybees make honey" --async
```

```text
Research job accepted.
Provider: parallel
Job ID: trun_practice_1
Status: queued (provider: queued)
Check status: seek research status parallel -- trun_practice_1
Get result: seek research get parallel -- trun_practice_1
```

Keep the provider and the job ID. Together they identify the job; the ID
alone does not. `google` and `perplexity` work the same way, each with its
own job IDs. Each provider also has its own options, such as
`--processor` for Parallel and `--effort` for Perplexity; see the
[research commands](reference/commands/seek-research.md).

## 2. Check the status

Run the status command that submission printed. It asks the provider once and
does not wait:

```sh
seek research status parallel -- trun_practice_1
```

```text
Research job status.
Provider: parallel
Job ID: trun_practice_1
Status: running (provider: running)
```

Run it again later. A Parallel job takes from under a minute to about 25
minutes, depending on its processor:

```sh
seek research status parallel -- trun_practice_1
```

```text
Research job status.
Provider: parallel
Job ID: trun_practice_1
Status: completed (provider: completed)
```

`completed`, `incomplete`, `failed` and `cancelled` are final. The status
command exits with status 0 whenever the provider answers, even for a failed
job.

## 3. Get the report

```sh
seek research get parallel -- trun_practice_1
```

```text
A made-up report on "how do honeybees make honey". The practice server wrote it from two invented sources.
Citations:
  [1] https://example.com/practice/source-1
  [2] https://example.com/practice/source-2
```

`seek research get` prints the report and its citations when the job has
completed. For a job that has not completed, it prints the job's status on
stderr and exits with status 1 at once; it never waits.

## Wait in the terminal instead

To keep seek running until the report is ready, leave out `--async`:

```sh
seek research parallel "how do honeybees make honey"
```

Brave research always works this way: `seek research brave` takes no
`--async`, and its job has no ID to check later.

## Check the result

The report printed in step 3, and `seek research get` exited with status 0.
To read the status and result from a script, see
[Track a research job from a script](script-research-jobs.md).
[How research jobs work](research-jobs.md) explains the statuses.
