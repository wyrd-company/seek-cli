# Give an agent the seek skill.
Output docs/user/assets/agent-skill.gif
Source docs/captures/_settings.tape
Type "seek skill | head -12"
Enter
Sleep 3s
Type "mkdir -p ~/.claude/skills/seek"
Enter
Type "seek skill > ~/.claude/skills/seek/SKILL.md"
Enter
Type 'seek skill | cmp - ~/.claude/skills/seek/SKILL.md && echo "up to date"'
Enter
Sleep 3s
