---
title: Track a research job from a script
product: seek
order: 21
---

Submit a research job from a shell script, wait until it reaches a final
status, and print its report or its failure. The script reads seek's research
job envelope with [jq](https://jqlang.org/). It assumes seek has a key for the
provider or a seek server, as for any research; with the practice server from
[Run your first search](first-search.md), it prints the output below.

![Terminal recording: the script submits a Parallel job, waits until its status is final, and prints the report text and its two citations.](assets/script-research-jobs.gif)

## 1. Submit the job and keep its locator

`--async --json` prints the envelope of the accepted job, as in
[research-job-submitted.json](examples/research-job-submitted.json). Keep
`locator.provider` and `locator.jobId`:

```sh
job=$(seek research parallel "how do honeybees make honey" --async --json)
provider=$(jq -r '.locator.provider' <<<"$job")
job_id=$(jq -r '.locator.jobId' <<<"$job")
```

Store the two values if the script may stop before the job ends; a later run
can continue from step 2 with them.

## 2. Wait for a final status

`status --json` asks the provider once. `terminal` is `true` once the status
is `completed`, `incomplete`, `failed` or `cancelled`:

```sh
until seek research status --json "$provider" -- "$job_id" | jq -e '.terminal' >/dev/null; do
  sleep 30
done
```

Put `--json` before `--`: everything after `--` is read as the job ID. Choose
an interval that suits the provider; Google jobs take minutes.

## 3. Print the report or the failure

`get --json` exits with status 0 and adds `result` for a completed job, as in
[research-job-result.json](examples/research-job-result.json). For any other
status it exits with status 1 and prints the envelope without `result`:

```sh
if result=$(seek research get --json "$provider" -- "$job_id"); then
  jq -r '.result.text, .result.citations[]' <<<"$result"
else
  jq -r '"job ended as \(.status): \(.failure.message // "no report")"' <<<"$result" >&2
  exit 1
fi
```

With the practice server, the script prints:

```text
A made-up report on "how do honeybees make honey". The practice server wrote it from two invented sources.
https://example.com/practice/source-1
https://example.com/practice/source-2
```

## Check the result

The script printed the report and exited with status 0. The
[research job envelope reference](reference/research-job-envelope.md) lists
every field and status, and the provider's own response is in
`providerPayload`.
