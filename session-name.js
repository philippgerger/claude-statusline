#!/usr/bin/env node
// Per-terminal session names, read by the statusline to label each terminal
// so you can tell your "bugs" session from your "deploy" session at a glance.
// Used by the /rename and /rename-suggest slash commands (write) and by
// statusline.js (read). Both must live in the same directory so they share
// session-names.json — the default is ~/.claude/.
//
//   node session-name.js set <name...>   set name for the current session
//   node session-name.js clear           remove the current session's name
//   node session-name.js get [id]        print name for id (default: current)

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const STORE = path.join(__dirname, 'session-names.json');

// Key each name by the terminal's own `claude` process PID. It's the only handle
// that is BOTH unique per terminal AND stable across /clear:
//   - CLAUDE_CODE_SESSION_ID is regenerated on /clear (strands the name).
//   - CLAUDE_CODE_SSE_PORT is shared by every terminal in one VS Code window
//     (one SSE server per window), so it collides across terminals.
// The claude process persists across /clear and is distinct per terminal. We find
// it by walking up the parent chain until we hit a process named `claude`. The
// statusline runs the identical walk, so both sides resolve the same key.
function claudePid() {
  let pid = String(process.pid);
  for (let i = 0; i < 20; i++) {
    let line;
    try {
      line = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', pid], { encoding: 'utf8' }).trim();
    } catch { break; }
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) break;
    const ppid = m[1];
    const base = m[2].trim().split('/').pop();
    if (base === 'claude' || base === 'claude.exe') return pid;
    if (!ppid || ppid === '0' || ppid === pid) break;
    pid = ppid;
  }
  return '';
}

const cpid = claudePid();
const id = cpid ? `pid:${cpid}` : (process.env.CLAUDE_CODE_SESSION_ID || '');

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; }
}
function save(db) {
  fs.writeFileSync(STORE, JSON.stringify(db, null, 2) + '\n');
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'set') {
  if (!id) { console.error('No claude session could be resolved — cannot set a name.'); process.exit(1); }
  const name = rest.join(' ').trim();
  const db = load();
  if (!name) { delete db[id]; save(db); console.log('Session name cleared.'); process.exit(0); }
  db[id] = { name, ts: Date.now() };
  save(db);
  console.log(`Session name set to: ${name}`);
} else if (cmd === 'clear') {
  const db = load();
  delete db[id];
  save(db);
  console.log('Session name cleared.');
} else if (cmd === 'get') {
  const gid = rest[0] || id;
  const db = load();
  process.stdout.write((gid && db[gid] && db[gid].name) || '');
} else {
  console.error('usage: session-name.js set <name...> | clear | get [id]');
  process.exit(1);
}
