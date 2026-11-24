# The product recording on the seek page and in How seek is organized: one
# search, one research job and one extraction, against the practice server.
Output docs/user/assets/demo.gif
Source docs/captures/_settings.tape
Hide
Type "export SEEK_SERVER_URL=http://127.0.0.1:8788 SEEK_SERVER_TOKEN_VALUE=practice-token && clear"
Enter
Show

Type 'seek web parallel "how do honeybees make honey" -n 2'
Enter
Sleep 4s
Type "clear"
Enter
Type 'seek research parallel "how do honeybees make honey" --async'
Enter
Sleep 3s
Type "seek research status parallel -- trun_practice_1"
Enter
Sleep 3s
Type "clear"
Enter
Type "seek scrape exa https://example.com/honey"
Enter
Sleep 4s
