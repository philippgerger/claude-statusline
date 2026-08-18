#!/usr/bin/env node
// Per-terminal session name COLOURS, read by the statusline to override the
// default name-hash hue. Sister script to session-name.js — same keying, same
// store shape, different file (session-colors.json). Used by the /color slash
// command (write) and statusline.js (read). Both must live in the same directory.
//
//   node session-color.js set <color>   set colour for the current session
//   node session-color.js clear         revert to the hashed colour
//   node session-color.js get [id]      print colour name for id (default: current)
//
// Accepted colours (map to ANSI SGR codes in statusline.js):
//   red green yellow blue magenta cyan  (plus aliases: gray/grey/white)

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const STORE = path.join(__dirname, 'session-colors.json');

// Colours we accept and the canonical name we persist. statusline.js owns the
// name→ANSI mapping so both sides stay in sync from one source of truth.
const COLORS = {
  red: 'red', green: 'green', yellow: 'yellow', blue: 'blue',
  magenta: 'magenta', purple: 'magenta', pink: 'magenta',
  cyan: 'cyan', teal: 'cyan',
  gray: 'gray', grey: 'gray', white: 'white',
  orange: 'yellow',
};

// Key by the terminal's own `claude` process PID — identical walk to
// session-name.js so both scripts and the statusline resolve the same key.
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
  if (!id) { console.error('No claude session could be resolved — cannot set a colour.'); process.exit(1); }
  const raw = rest.join(' ').trim().toLowerCase();
  const db = load();
  if (!raw) { delete db[id]; save(db); console.log('Session colour cleared — back to the auto hue.'); process.exit(0); }
  const canon = COLORS[raw];
  if (!canon) {
    console.error(`Unknown colour "${raw}". Try one of: ${[...new Set(Object.values(COLORS))].join(', ')}.`);
    process.exit(1);
  }
  db[id] = { color: canon, ts: Date.now() };
  save(db);
  console.log(`Session colour set to: ${canon}`);
} else if (cmd === 'clear') {
  const db = load();
  delete db[id];
  save(db);
  console.log('Session colour cleared — back to the auto hue.');
} else if (cmd === 'get') {
  const gid = rest[0] || id;
  const db = load();
  process.stdout.write((gid && db[gid] && db[gid].color) || '');
} else {
  console.error('usage: session-color.js set <color> | clear | get [id]');
  process.exit(1);
}
