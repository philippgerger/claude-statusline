---
description: Suggest and set a session name based on what you've been working on
argument-hint: (no args — infers from the session)
allowed-tools: Bash(node:*), Bash(git:*)
---

Pick a short name for THIS terminal's Claude session and set it.

1. Infer a concise name (1–3 words, lowercase-with-hyphens, e.g. `auth-bug`,
   `deploy`, `statusline`) from our conversation so far — the main task or theme.
2. If the conversation is too new to tell, base it on the repo + branch:
   run `git rev-parse --abbrev-ref HEAD` and use the folder name and/or branch.
3. Set it: `node ~/.claude/session-name.js set <name>`
4. Reply in ONE line: the name you chose, and that they can override with
   `/rename <name>`. Don't overthink it or explain your reasoning.
