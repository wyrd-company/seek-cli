# Track a research job from a script, against the practice server. The
# hidden sleep function shortens the script's 30-second wait to one second.
Output docs/user/assets/script-research-jobs.gif
Source docs/captures/_settings.tape
Hide
Type "export SEEK_SERVER_URL=http://127.0.0.1:8788 SEEK_SERVER_TOKEN=practice-token && sleep() { command sleep 1; } && clear"
Enter
Show
Type `job=$(seek research parallel "how do honeybees make honey" --async --json)`
Enter
Type `provider=$(jq -r '.locator.provider' <<<"$job")`
Enter
Type `job_id=$(jq -r '.locator.jobId' <<<"$job")`
Enter
Type `until seek research status --json "$provider" -- "$job_id" | jq -e '.terminal' >/dev/null; do sleep 30; done`
Enter
Sleep 3s
Type `if result=$(seek research get --json "$provider" -- "$job_id"); then jq -r '.result.text, .result.citations[]' <<<"$result"; else jq -r '"job ended as \(.status): \(.failure.message // "no report")"' <<<"$result" >&2; fi`
Enter
Sleep 5s
