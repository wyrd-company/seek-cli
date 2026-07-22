# ---
# relationships:
#   demonstrates: overview
#   references: research
# ---

Output docs/assets/demo.gif

Require bash
Require jq

Set Shell "bash"
Set FontSize 21
Set Width 1400
Set Height 900
Set Theme "Catppuccin Mocha"
Set Padding 24
Set Margin 12
Set MarginFill "#11111b"
Set BorderRadius 8
Set WindowBar "Colorful"
Set TypingSpeed 28ms

Hide
Type "export PATH=$PWD/dist:$PATH" Enter
Type "unset NODE_EXTRA_CA_CERTS" Enter
Type 'export PS1="demo> "' Enter
Type "clear" Enter
Show

Sleep 500ms
Type "seek --version" Enter
Sleep 2s
Type "seek --help" Enter
Sleep 5s

Ctrl+L
Sleep 500ms
Type 'seek web parallel "SQLite and PostgreSQL JSONB storage differences" --objective "Find official documentation and performance guarantees" -n 3 -c 220' Enter
Wait+Line@2m /demo>$/
Sleep 4s

Ctrl+L
Sleep 500ms
Type "seek scrape firecrawl https://www.sqlite.org/json1.html --json-prompt 'Extract SQLite JSONB purpose, compatibility claims, and complexity guarantees.' --json | jq '.data.json'" Enter
Wait+Line@2m /demo>$/
Sleep 5s

Ctrl+L
Sleep 500ms
Type "seek research --help" Enter
Sleep 5s

Ctrl+L
Sleep 500ms
Type 'JOB=$(seek research google "Compare SQLite and PostgreSQL JSONB for embedded applications. Prioritize official documentation and limit the report to 600 words." --async --json)' Enter
Wait+Line@2m /demo>$/
Sleep 2s
Type 'echo "$JOB" | jq "{locator, status, terminal}"' Enter
Wait+Line /demo>$/
Sleep 5s

Hide
Type 'JOB_ID=$(echo "$JOB" | jq -r ".locator.jobId")' Enter
Type "clear" Enter
Show

Type 'seek research status google -- "$JOB_ID"' Enter
Wait+Line@2m /demo>$/
Sleep 4s

Hide
Type 'until seek research status --json google -- "$JOB_ID" | jq -e ".terminal" >/dev/null; do sleep 10; done' Enter
Wait+Line@25m /demo>$/
Type "clear" Enter
Wait+Line /demo>$/
Show

Type 'seek research status google -- "$JOB_ID"' Enter
Wait+Line@2m /demo>$/
Sleep 4s
Type 'seek research get --json google -- "$JOB_ID" | jq "{status, excerpt: .result.text[:500], citationCount: (.result.citations | length)}"' Enter
Wait+Line@2m /demo>$/
Sleep 7s
