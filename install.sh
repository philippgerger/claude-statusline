#!/usr/bin/env bash
# Installs claude-statusline into ~/.claude:
#   - copies statusline.js + session-name.js to ~/.claude/
#   - copies the /rename + /rename-suggest slash commands to ~/.claude/commands/
#   - points settings.json -> statusLine at the statusline (backing it up first)
#
# Re-running is safe (idempotent). Requires node + npx on PATH (npx fetches
# ccusage on first run). Override the target dir with CLAUDE_DIR=/path ./install.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"

command -v node >/dev/null 2>&1 || { echo "error: node not found on PATH" >&2; exit 1; }

mkdir -p "$CLAUDE_DIR/commands"

echo "Installing scripts to $CLAUDE_DIR ..."
cp "$SRC/statusline.js"    "$CLAUDE_DIR/statusline.js"
cp "$SRC/session-name.js"  "$CLAUDE_DIR/session-name.js"
cp "$SRC/commands/rename.md"         "$CLAUDE_DIR/commands/rename.md"
cp "$SRC/commands/rename-suggest.md" "$CLAUDE_DIR/commands/rename-suggest.md"

echo "Wiring statusLine into $SETTINGS ..."
CLAUDE_DIR="$CLAUDE_DIR" SETTINGS="$SETTINGS" node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const settingsPath = process.env.SETTINGS;
const claudeDir = process.env.CLAUDE_DIR;

let settings = {};
if (fs.existsSync(settingsPath)) {
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch (e) { console.error('Could not parse existing settings.json — aborting so nothing is lost.'); process.exit(1); }
  // Back up before we touch it.
  const bak = settingsPath + '.bak-' + Date.now();
  fs.copyFileSync(settingsPath, bak);
  console.log('Backed up existing settings to ' + path.basename(bak));
}

settings.statusLine = {
  type: 'command',
  command: `node "${path.join(claudeDir, 'statusline.js')}"`,
};

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('statusLine set to node "' + path.join(claudeDir, 'statusline.js') + '"');
NODE

echo
echo "Done. Open a new Claude Code session (or run /statusline) to see it."
echo "Name a session with:  /rename <name>   or   /rename-suggest"
