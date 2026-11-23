# Track a research job from a script, against the practice server. The
# hidden sleep function shortens the script's 30-second wait to one second.
Output docs/user/assets/script-research-jobs.gif
Source docs/captures/_settings.tape
Set TypingSpeed 12ms
Hide
Type "export SEEK_SERVER_URL=http://127.0.0.1:8788 SEEK_SERVER_TOKEN=practice-token && sleep() { command sleep 1; } && clear"
Enter
Show
Type `job=$(seek research parallel "how do honeybees make honey" --async --json) || exit 1`
Enter
Type `provider=$(jq -r '.locator.provider' <<<"$job")`
Enter
Type `job_id=$(jq -r '.locator.jobId' <<<"$job")`
Enter
Type `for attempt in {1..20}; do`
Enter
Type `  status=$(seek research status --json "$provider" -- "$job_id") || exit 1`
Enter
Type `  if jq -e '.terminal' <<<"$status" >/dev/null; then break; fi`
Enter
Type `  if [ "$attempt" -eq 20 ]; then echo "Job has no final status after 20 checks." >&2; exit 1; fi`
Enter
Type `  sleep 30`
Enter
Type `done`
Enter
Sleep 3s
Type `if result=$(seek research get --json "$provider" -- "$job_id"); then`
Enter
Type `  jq -r '.result.text, .result.citations[]' <<<"$result"`
Enter
Type `else`
Enter
Type `  if [ -n "$result" ]; then`
Enter
Type `    jq -r '"job ended as \(.status): \(.failure.message // "no report")"' <<<"$result" >&2`
Enter
Type `  fi`
Enter
Type `  exit 1`
Enter
Type `fi`
Enter
Sleep 5s
