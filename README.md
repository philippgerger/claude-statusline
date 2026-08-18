# claude-statusline

A compact, zero-dependency [Claude Code](https://docs.anthropic.com/en/docs/claude-code) statusline. It
shows a per-terminal **session name**, context-window fill, model, session cost, your usage-window
limits, and the git branch — built entirely from the status JSON Claude Code pipes in, so it renders
instantly with no external process or network call.

```
deploy | 🤖 Opus 4.8 | 🌿 main | 🧠 75,635 (8%) | 💰 $2.50 session | ⏳ 14% 5h · 9% wk
```

- **name** — a per-terminal name you set with `/rename`, colored with a stable hue so you can tell
  your `bugs` terminal from your `deploy` terminal at a glance, even across `/clear`. Falls back to
  Claude Code's own session name.
- **🧠 context** — tokens used and % of the context window, colored **green** under 70%, **yellow**
  70–90%, **red** past 90%, so you notice before you run low.
- **🤖 model** · **💰 cost** — the active model and this session's cost.
- **⏳ limits** — how much of your **5-hour** and **weekly** usage windows you've burned (same color
  thresholds). Nothing else surfaces this.
- **🌿 branch** — the current git branch of the working directory.

On a **narrow terminal** it reflows to two rows instead of ellipsing — identity on top, the numbers that
grow below:

```
deploy | 🤖 Opus 4.8 | 🌿 main
🧠 75,635 (8%) | 💰 $2.50 session | ⏳ 14% 5h · 9% wk
```

It wraps only when the one-line version wouldn't fit the terminal width (`COLUMNS`, exposed by Claude
Code ≥ 2.1.153). Force it with the `CLAUDE_STATUSLINE_ROWS` env var: `auto` (default), `1` (always one
row), or `2` (always two).

## How it works

- **`statusline.js`** reads the [status JSON](https://code.claude.com/docs/en/statusline) on stdin
  (context window, cost, model, rate limits, workspace) and renders the segments above. No dependencies.
- **`session-name.js`** stores per-terminal names in `~/.claude/session-names.json`. Names are keyed by
  the terminal's own `claude` process PID — the one handle that's both unique per terminal and stable
  across `/clear` (the session id is regenerated on `/clear`; the SSE port is shared across terminals in
  one window). The statusline and the writer run the identical PID walk, so both agree on the key.
- **`/rename`** and **`/rename-suggest`** are the slash commands that write those names.

## Install

Requires **Node.js** on your PATH.

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

## License

MIT — see [LICENSE](LICENSE).
