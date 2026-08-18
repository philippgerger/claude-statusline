---
description: Set the colour of this terminal's session name in the statusline
argument-hint: [red|green|yellow|blue|magenta|cyan|gray|white — empty to clear]
allowed-tools: Bash(node:*)
---

Run exactly this command and report its stdout back to the user, nothing else:

```
node ~/.claude/session-color.js set $ARGUMENTS
```

Notes:
- The colour is scoped to THIS terminal's session.
- If `$ARGUMENTS` is empty the override is cleared and the name reverts to its auto (name-hashed) hue.
- Accepted colours: red, green, yellow, blue, magenta (purple/pink), cyan (teal), gray, white.
- The new colour appears on the session name in the statusline on the next render.
Do not do anything beyond running that one command.
