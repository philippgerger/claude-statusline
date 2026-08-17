# claude-statusline

A compact [Claude Code](https://docs.anthropic.com/en/docs/claude-code) statusline with a per‑terminal
**session name**, plus context usage, model, and cost:

```
🏷 deploy | 🧠 445,274 (45%) | 🤖 Opus 4.8 | 💰 $1.23 session / $12.49 today
```

The name is colored (stable hue per name) so you can tell your `bugs` terminal from your `deploy`
terminal at a glance — even across `/clear`. Set it with `/rename <name>` or let Claude pick one with
`/rename-suggest`.

## How it works

- **`statusline.js`** wraps [`ccusage statusline`](https://github.com/ryoppippi/ccusage), then reorders
  and trims its segments to `🏷 name · 🧠 context · 🤖 model · 💰 cost` (session + today only — the
  block‑cost detail and 🔥 burn‑rate segment are dropped). All the usage/cost math comes from ccusage.
- **`session-name.js`** stores per‑terminal names in `~/.claude/session-names.json`. Names are keyed by
  the terminal's own `claude` process PID — the one handle that's both unique per terminal and stable
  across `/clear` (the session id is regenerated on `/clear`; the SSE port is shared across terminals in
  one window). The statusline and the writer run the identical PID walk, so both agree on the key.
- **`/rename`** and **`/rename-suggest`** are the slash commands that write those names.

## Install

Requires **Node.js** and **npx** on your PATH. `npx` fetches `ccusage` automatically on first run.

```sh
git clone https://github.com/philippgerger/claude-statusline.git
cd claude-statusline
./install.sh
```

The installer copies `statusline.js` + `session-name.js` into `~/.claude/`, copies the two slash
commands into `~/.claude/commands/`, and points `~/.claude/settings.json` → `statusLine` at the script
(backing up your existing `settings.json` first). Open a new Claude Code session to see it.

> Custom Claude config dir? Run `CLAUDE_DIR=/path/to/.claude ./install.sh`.

### Manual install

If you'd rather not run the script: copy `statusline.js` and `session-name.js` into `~/.claude/`, copy
`commands/*.md` into `~/.claude/commands/`, and add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/absolute/path/to/.claude/statusline.js\""
  }
}
```

## Usage

- `/rename <name>` — name this terminal's session (empty clears it).
- `/rename-suggest` — let Claude infer a short name from what you're working on.

Names persist across `/clear` and show on the next statusline render.

## Uninstall

Remove `statusline.js`, `session-name.js`, and `session-names.json` from `~/.claude/`; delete
`commands/rename.md` + `commands/rename-suggest.md`; and remove the `statusLine` block from
`settings.json` (or restore a `settings.json.bak-*` backup the installer made).

## Credits

Built on [ccusage](https://github.com/ryoppippi/ccusage) by ryoppippi, which does the token and cost
accounting. This project only reshapes its output and adds session naming.

## License

MIT — see [LICENSE](LICENSE).
