# claude-statusline

A compact [Claude Code](https://docs.anthropic.com/en/docs/claude-code) statusline. It shows a
per-terminal **session name**, context-window fill, model, cost, your usage-window limits, and the git
branch. Everything renders instantly from the status JSON Claude Code pipes in; the one cross-session
figure — today's total cost — is fetched from [ccusage](https://github.com/ryoppippi/ccusage) in the
background and cached, so a render never blocks.

```
deploy | 🤖 Opus 4.8 | 🌿 main | 🧠 75,635 (8%) | 💰 $2.50 session / $9.48 today | ⏳ 14% 5h · 9% wk
```

- **name** — a per-terminal name you set with `/rename`, colored with a stable hue so you can tell
  your `bugs` terminal from your `deploy` terminal at a glance, even across `/clear`. Falls back to
  Claude Code's own session name.
- **🧠 context** — tokens used and % of the context window, colored **green** under 70%, **yellow**
  70–90%, **red** past 90%, so you notice before you run low.
- **🤖 model** · **💰 cost** — the active model, this session's cost, and today's total across all
  sessions (the `today` figure needs `ccusage`, refreshed in the background; omitted if unavailable).
- **⏳ limits** — how much of your **5-hour** and **weekly** usage windows you've burned (same color
  thresholds). Nothing else surfaces this.
- **🌿 branch** — the current git branch of the working directory.

On a **narrow terminal** it reflows to two rows instead of ellipsing — identity on top, the numbers that
grow below:

```
deploy | 🤖 Opus 4.8 | 🌿 main
🧠 75,635 (8%) | 💰 $2.50 session / $9.48 today | ⏳ 14% 5h · 9% wk
```

It wraps only when the one-line version wouldn't fit the terminal width (`COLUMNS`, exposed by Claude
Code ≥ 2.1.153). Force it with the `CLAUDE_STATUSLINE_ROWS` env var: `auto` (default), `1` (always one
row), or `2` (always two).

## How it works

- **`statusline.js`** reads the [status JSON](https://code.claude.com/docs/en/statusline) on stdin
  (context window, cost, model, rate limits, workspace) and renders the segments above. The only thing
  it doesn't get from stdin — today's cross-session cost — is refreshed out of band by a detached
  `node statusline.js --refresh-today` that caches `ccusage daily` output; renders just read the cache.
- **`session-name.js`** stores per-terminal names in `~/.claude/session-names.json`. Names are keyed by
  the terminal's own `claude` process PID — the one handle that's both unique per terminal and stable
  across `/clear` (the session id is regenerated on `/clear`; the SSE port is shared across terminals in
  one window). The statusline and the writer run the identical PID walk, so both agree on the key.
- **`/rename`** and **`/rename-suggest`** are the slash commands that write those names.

## Install

Requires **Node.js** on your PATH. The optional `today` cost figure also uses `npx`/`ccusage` (bundled
with Node); everything else works without it.

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

Remove `statusline.js`, `session-name.js`, `session-names.json`, and any `.statusline-today.json*` from
`~/.claude/`; delete
`commands/rename.md` + `commands/rename-suggest.md`; and remove the `statusLine` block from
`settings.json` (or restore a `settings.json.bak-*` backup the installer made).

## License

MIT — see [LICENSE](LICENSE).
