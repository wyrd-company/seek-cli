# Set up provider keys: writing the configuration template and checking which keys seek finds.
Output docs/user/assets/config.gif
Source docs/captures/_settings.tape
Type "seek config init"
Enter
Sleep 1500ms
Type "export SEEK_PROVIDERS_EXA_API_KEY_VALUE=exa-synthetic-key-1234"
Enter
Type "seek config show"
Enter
Sleep 5s
