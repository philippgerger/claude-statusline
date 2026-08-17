#!/usr/bin/env node
// A Claude Code statusline: 🏷 session name · 🧠 context · 🤖 model · 💰 cost.
//
// It's a thin wrapper around `ccusage statusline` that reorders/trims its
// segments to the layout above and prepends a per-terminal session name (set
// via the /rename slash command). ccusage has no built-in way to reorder or
// hide segments, so we run it, split its single output line on " | ", identify
// each segment by its leading emoji, and reassemble in our preferred order.
// The block-cost detail and the 🔥 burn-rate segment are dropped. Context math
// comes straight from ccusage, unchanged.
//
// Install: point settings.json → statusLine.command at this file (see README /
// install.sh). This script and session-name.js must live in the same directory
// so they share session-names.json — the default is ~/.claude/.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Claude Code passes the status JSON on stdin — forward it to ccusage verbatim.
let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }

// Resolve this terminal's custom name (set via /rename). We key by the terminal's
// own `claude` process PID — the only handle that is both unique per terminal and
// stable across /clear. (The session id is regenerated on /clear; the SSE port is
// shared by every terminal in one VS Code window, so it collides.) We find the PID
// by walking up the parent chain until we hit a process named `claude`; the writer
// (session-name.js) runs the identical walk, so both sides agree on the key. Fall
// back to the session id so entries named under the old scheme still resolve.
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

function candidateKeys(jsonInput) {
  const keys = [];
  const cpid = claudePid();
  if (cpid) keys.push(`pid:${cpid}`);
  let sid = process.env.CLAUDE_CODE_SESSION_ID || '';
  if (!sid) { try { sid = (JSON.parse(jsonInput) || {}).session_id || ''; } catch { /* not JSON */ } }
  if (sid) keys.push(sid);
  return keys;
}

function sessionName(keys) {
  if (!keys.length) return '';
  try {
    const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'session-names.json'), 'utf8'));
    for (const k of keys) if (db[k] && db[k].name) return db[k].name;
    return '';
  } catch { return ''; }
}

let out = '';
try {
  out = execFileSync('npx', ['-y', 'ccusage', 'statusline', ...process.argv.slice(2)], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
} catch (e) {
  // If ccusage errored, salvage whatever it managed to print.
  out = (e && e.stdout ? e.stdout.toString() : '') || '';
}

// The name label renders even if ccusage produced nothing, so a rename still
// shows when ccusage is slow/offline. Each name gets a stable colour derived
// from its own text, so a given terminal keeps the same hue across renders and
// different names stay visually distinct. Bright fg codes: red/green/yellow/
// blue/magenta/cyan.
const PALETTE = [91, 92, 93, 94, 95, 96];
function colourFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const name = sessionName(candidateKeys(input));
const label = name ? `\x1b[1;${colourFor(name)}m🏷 ${name}\x1b[0m` : '';

// ccusage prints one status line; take the last non-empty line to be safe.
const line = out.split('\n').map((s) => s.trim()).filter(Boolean).pop() || '';

let context, model, cost;
if (line) {
  const segs = line.split(' | ');
  const find = (emoji) => segs.find((s) => s.startsWith(emoji));

  context = find('🧠'); // 445,274 (45%)
  model = find('🤖');   // Opus 4.8
  cost = find('💰');    // $1.23 session / $12.49 today / $12.49 block (…)

  // Trim the cost segment to just the session + today figures.
  if (cost) {
    const parts = cost.split(' / ');
    const kept = parts.filter((p) => /\bsession\b|\btoday\b/.test(p));
    cost = (kept.length ? kept : [parts[0]]).join(' / ');
  }
}

// 🔥 burn-rate segment is intentionally omitted by not including it here.
// Layout: on a wide terminal everything fits on one row; when it wouldn't, we
// wrap to two rows — identity (name · model) on top, the numbers that grow
// (context · cost) below — so a narrow terminal reflows instead of ellipsing.
// Toggle with CLAUDE_STATUSLINE_ROWS=auto|1|2 (default: auto).
const SEP = ' | ';

// Visible width, ignoring ANSI colour codes. We iterate by code point so an
// emoji counts once, and add 1 per emoji since terminals render them ~2 cols
// wide — a rough estimate is fine, we only need a wrap threshold.
function width(str) {
  const bare = str.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of bare) w += ch.codePointAt(0) > 0x2000 ? 2 : 1;
  return w;
}

const oneLine = [label, context, model, cost].filter(Boolean).join(SEP);
const mode = process.env.CLAUDE_STATUSLINE_ROWS || 'auto';
const cols = parseInt(process.env.COLUMNS || '0', 10);
const tooWide = cols > 0 && width(oneLine) > cols - 1;

let output;
if (mode === '2' || (mode === 'auto' && tooWide)) {
  const row1 = [label, model].filter(Boolean).join(SEP);
  const row2 = [context, cost].filter(Boolean).join(SEP);
  output = [row1, row2].filter(Boolean).join('\n');
} else {
  output = oneLine;
}
process.stdout.write(output);
