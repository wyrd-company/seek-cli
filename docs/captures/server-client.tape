# Call a seek server from your code: the tutorial's second terminal.
Output docs/user/assets/server-client.gif
Source docs/captures/_settings.tape
Type "export SEEK_SERVER_URL=http://127.0.0.1:8788"
Enter
Type "export SEEK_SERVER_TOKEN=practice-token"
Enter
Type 'node server-client.mjs "how do honeybees make honey"'
Enter
Sleep 3s
Type "export SEEK_SERVER_TOKEN=wrong-token"
Enter
Type 'node server-client.mjs "how do honeybees make honey"'
Enter
Sleep 4s
