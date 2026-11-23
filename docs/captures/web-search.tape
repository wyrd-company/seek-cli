# Search the web: two search providers, against the practice server.
Output docs/user/assets/web-search.gif
Source docs/captures/_settings.tape
Hide
Type "export SEEK_SERVER_URL=http://127.0.0.1:8788 SEEK_SERVER_TOKEN=practice-token && clear"
Enter
Show

Type 'seek web parallel "how do honeybees make honey" -n 2'
Enter
Sleep 4s
Type "clear"
Enter
Type 'seek web exa "how do honeybees make honey" -n 2'
Enter
Sleep 4s
