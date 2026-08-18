---
description: Name this terminal's Claude session (shows in the statusline)
argument-hint: [name — leave empty to clear]
allowed-tools: Bash(node:*)
---

Run exactly this command and report its stdout back to the user, nothing else:

```
node ~/.claude/session-name.js set $ARGUMENTS
```

Notes:
- The name is scoped to THIS terminal's session.
- If `$ARGUMENTS` is empty the name is cleared.
- The new name appears in the statusline (colored, at the start) on the next render.
Do not do anything beyond running that one command.
