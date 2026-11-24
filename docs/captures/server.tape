# Run a seek server with a synthetic token and key. The recording starts the
# server in the background with & so that one terminal shows both. No
# request reaches a provider.
Output docs/user/assets/server.gif
Source docs/captures/_settings.tape
Type "export SEEK_SERVER_TOKENS_VALUE=synthetic-client-token"
Enter
Type "export SEEK_PROVIDERS_EXA_API_KEY_VALUE=exa-synthetic-key-1234"
Enter
Type "seek serve --host 0.0.0.0 --port 8787 &"
Enter
Sleep 2s
Type "curl -s http://127.0.0.1:8787/healthz; echo"
Enter
Sleep 3s
Hide
Type "kill %1"
Enter
Sleep 500ms
