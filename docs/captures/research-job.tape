# Run a research job: submit, check the status twice, get the report.
Output docs/user/assets/research-job.gif
Source docs/captures/_settings.tape
Hide
Type "export SEEK_SERVER_URL=http://127.0.0.1:8788 SEEK_SERVER_TOKEN_VALUE=practice-token && clear"
Enter
Show

Type 'seek research parallel "how do honeybees make honey" --async'
Enter
Sleep 3s
Type "clear"
Enter
Type "seek research status parallel -- trun_practice_1"
Enter
Sleep 2s
Type "seek research status parallel -- trun_practice_1"
Enter
Sleep 2s
Type "clear"
Enter
Type "seek research get parallel -- trun_practice_1"
Enter
Sleep 4s
