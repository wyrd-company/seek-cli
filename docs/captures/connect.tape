# Use a seek server from the CLI. The practice server stands in for the seek server.
Output docs/user/assets/connect.gif
Source docs/captures/_settings.tape
Type "export SEEK_SERVER_URL=http://127.0.0.1:8788"
Enter
Type "export SEEK_SERVER_TOKEN_VALUE=practice-token"
Enter
Type "seek config show"
Enter
Sleep 4s
Type "clear"
Enter
Type 'seek web parallel "how do honeybees make honey" -n 1'
Enter
Sleep 4s
