# claude-statusline

A compact [Claude Code](https://docs.anthropic.com/en/docs/claude-code) statusline. It shows a
per-terminal **session name**, context-window fill, model, cost, the time left in your usage window,
the git branch, and any background work still running. Everything renders instantly from the status JSON
Claude Code pipes in; the one cross-session figure — today's total cost — is fetched from
[ccusage](https://github.com/ryoppippi/ccusage) in the background and cached, so a render never blocks.

```
deploy | 🤖 Opus 5 · medium | 🌿 main | 🧠 75,635 (8%) | 💰 $2.50 session / $9.48 today | ⏳ 2h41m 14% · 9% wk
🧵 2 pnpm test:affected 01:02:05 · Design system drift review 00:01:25
```

- **name** — a per-terminal name you set with `/rename`, colored with a stable hue so you can tell
  your `bugs` terminal from your `deploy` terminal at a glance, even across `/clear`. Falls back to
  Claude Code's own session name. Pin a specific color with `/color <color>` when you'd rather choose
  than take the auto hue.
- **🧠 context** — tokens used and % of the context window, colored on the shared percentage ramp
  below, so you notice before you run low.
- **🤖 model** · **💰 cost** — the active model with its **reasoning-effort** level appended
  (`· high` / `· medium` / `· low`, or `⚡ fast` in fast mode), this session's cost, and today's total
  across all sessions (the `today` figure needs `ccusage`, refreshed in the background; omitted if
  unavailable).
- **⏳ limits** — the **time left** in the current 5-hour window (from `resets_at`) followed by how much
  of it you've spent, then the weekly figure. Both ride the same ramp, so the group starts bright green
  after a reset and darkens as the window fills. Nothing else surfaces this.
- **🌿 branch** — the current git branch of the working directory.
- **🧵 threads** — a row *under* the statusline listing the background work still running: the count,
  then each running **subagent** (cyan) or **background command** (plain) with a `hh:mm:ss` clock since
  it started. Three items, then `+N`. The row is absent when nothing runs. Claude Code doesn't pass this
  on stdin, so it's read from the session transcript (see below).

### Colors

Every percentage — context, 5-hour, weekly — uses one ramp, so the same number always means the same
color: **bright green** at 0, **yellow-green** at 50, **yellow** at 70, **orange** at 75, **red** at 80,
**dark red** at 90, **deepest** at 100, interpolated per percent in between. Truecolor when the terminal
sets `COLORTERM`, otherwise the 256-color cube.

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
- **🧵 threads** come from the transcript that stdin points at (`transcript_path`). A thread starts at its
  `tool_use` record (an `Agent` call, or a `Bash` call with `run_in_background`) and ends when a
  `<task-notification>` for its id lands — or, for a synchronous agent, when its `tool_result` arrives.
  The parsed byte offset is cached in `~/.claude/.statusline-threads.json`, so each render reads only the
  new tail and a multi-megabyte transcript stays cheap. A thread older than 6 hours is dropped, because a
  killed session never sends its notification. The `hh:mm:ss` clock advances per render, and Claude Code
  renders on conversation updates rather than on a timer — so it steps up while Claude works and holds
  still while you sit idle at the prompt.
- **`session-name.js`** stores per-terminal names in `~/.claude/session-names.json`. Names are keyed by
  the terminal's own `claude` process PID — the one handle that's both unique per terminal and stable
  across `/clear` (the session id is regenerated on `/clear`; the SSE port is shared across terminals in
  one window). The statusline and the writer run the identical PID walk, so both agree on the key.
- **`session-color.js`** stores per-terminal name colors in `~/.claude/session-colors.json`, keyed the
  same PID way. When set, the color wins over the name-hash hue; the statusline falls back to the hash
  when there's no override.
- **`/rename`** / **`/rename-suggest`** write the names; **`/color`** writes the color override.

## Install

Requires **Node.js** on your PATH. The optional `today` cost figure also uses `npx`/`ccusage` (bundled
with Node); everything else works without it.

```sh
git clone https://github.com/philippgerger/claude-statusline.git
cd claude-statusline
./install.sh
```

The installer copies `statusline.js` + `session-name.js` + `session-color.js` into `~/.claude/`, copies
the slash commands into `~/.claude/commands/`, and points `~/.claude/settings.json` → `statusLine` at
the script (backing up your existing `settings.json` first). Open a new Claude Code session to see it.

> Custom Claude config dir? Run `CLAUDE_DIR=/path/to/.claude ./install.sh`.

### Manual install

If you'd rather not run the script: copy `statusline.js`, `session-name.js`, and `session-color.js` into
`~/.claude/`, copy `commands/*.md` into `~/.claude/commands/`, and add this to `~/.claude/settings.json`:

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
- `/color <color>` — pin the name's color (`red green yellow blue magenta cyan gray white`); empty
  reverts to the auto hue.

Names and colors persist across `/clear` and show on the next statusline render.

## Uninstall

Remove `statusline.js`, `session-name.js`, `session-color.js`, `session-names.json`,
`session-colors.json`, `.statusline-threads.json`, and any `.statusline-today.json*` from `~/.claude/`; delete `commands/rename.md`
+ `commands/rename-suggest.md` + `commands/color.md`; and remove the `statusLine` block from
`settings.json` (or restore a `settings.json.bak-*` backup the installer made).

## License

MIT — see [LICENSE](LICENSE).
