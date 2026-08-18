#!/usr/bin/env node
// A Claude Code statusline, built from the status JSON that Claude Code pipes in
// on stdin, so it renders instantly. The one cross-session figure that isn't in
// stdin — today's total cost — is fetched from ccusage in the background and
// cached, so it never blocks a render.
//
// Layout (segments, in order):
//   name · 🧠 context · 🤖 model · 💰 cost · ⏳ rate limits · 🌿 branch
//
//   name  per-terminal session name set via /rename (falls back to Claude Code's
//         own session name); coloured with a stable per-name hue, no icon.
//   🧠  context-window fill: tokens + %, green under 70%, yellow 70–90%, red 90%+.
//   🤖  model display name.
//   💰  this session's cost + today's total across all sessions.
//   ⏳  how much of your 5-hour and weekly usage windows you've burned.
//   🌿  current git branch of the working directory.
//
// On a narrow terminal it reflows to two rows — identity on top, the numbers
// that grow below — instead of ellipsing. Toggle with
// CLAUDE_STATUSLINE_ROWS=auto|1|2 (default: auto).
//
// Install: point settings.json → statusLine.command at this file (see README /
// install.sh). This script and session-name.js must live in the same directory
// so they share session-names.json — the default is ~/.claude/.

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ─── Background refresh mode ─────────────────────────────────────────────────
// Invoked as `node statusline.js --refresh-today`: fetch today's cross-session
// cost from ccusage (which reads the local Claude logs) and cache it. This runs
// detached from the render path so it never blocks the status line.
const TODAY_CACHE = path.join(__dirname, '.statusline-today.json');
if (process.argv.includes('--refresh-today')) {
  try {
    const out = execFileSync('npx', ['-y', 'ccusage', 'daily', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
    const days = (JSON.parse(out).daily) || [];
    const last = days[days.length - 1];
    if (last && typeof last.totalCost === 'number') {
      fs.writeFileSync(TODAY_CACHE, JSON.stringify({ cost: last.totalCost, ts: Date.now() }));
    }
  } catch { /* ccusage unavailable — today cost just stays hidden */ }
  try { fs.unlinkSync(TODAY_CACHE + '.lock'); } catch { /* ignore */ }
  process.exit(0);
}

// Claude Code passes the status JSON on stdin.
let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
let data = {};
try { data = JSON.parse(input) || {}; } catch { /* not JSON */ }

// ─── ANSI helpers ───────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const paint = (code, s) => `\x1b[${code}m${s}${RESET}`;
// Colour a percentage: green ok, yellow warning, red danger.
function pctColour(pct) {
  if (pct >= 90) return 91; // red
  if (pct >= 70) return 93; // yellow
  return 92;                // green
}

// ─── Session name ─────────────────────────────────────────────────────────────
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

function customName() {
  const keys = [];
  const cpid = claudePid();
  if (cpid) keys.push(`pid:${cpid}`);
  const sid = process.env.CLAUDE_CODE_SESSION_ID || data.session_id || '';
  if (sid) keys.push(sid);
  if (!keys.length) return '';
  try {
    const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'session-names.json'), 'utf8'));
    for (const k of keys) if (db[k] && db[k].name) return db[k].name;
  } catch { /* no db */ }
  return '';
}

// Each name gets a stable colour derived from its own text, so a given terminal
// keeps the same hue across renders and different names stay visually distinct.
const PALETTE = [91, 92, 93, 94, 95, 96];
function colourFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Prefer the user's /rename; otherwise fall back to Claude Code's own session
// name (truncated — those can be a whole sentence).
let rawName = customName();
if (!rawName && data.session_name) {
  rawName = data.session_name.length > 24 ? data.session_name.slice(0, 23) + '…' : data.session_name;
}
const label = rawName ? paint(`1;${colourFor(rawName)}`, rawName) : '';

// ─── Context window ───────────────────────────────────────────────────────────
let context = '';
const cw = data.context_window || {};
if (typeof cw.used_percentage === 'number') {
  const cu = cw.current_usage || {};
  const tokens = (cu.input_tokens || 0) + (cu.output_tokens || 0) +
    (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0);
  const shown = tokens || cw.total_input_tokens || 0;
  const pct = Math.round(cw.used_percentage);
  context = paint(pctColour(pct), `🧠 ${shown.toLocaleString('en-US')} (${pct}%)`);
}

// ─── Model ────────────────────────────────────────────────────────────────────
let model = '';
if (data.model && data.model.display_name) {
  // Trim trailing "(1M context)" and similar parentheticals for a compact label.
  const name = data.model.display_name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  model = `🤖 ${name}`;
}

// ─── Cost (this session + today across all sessions) ──────────────────────────
// Session cost is in stdin; today's cross-session total comes from ccusage via a
// cached background refresh, so a render never blocks on it.
function todayCost() {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(TODAY_CACHE, 'utf8')); } catch { /* none yet */ }
  const fresh = cached && (Date.now() - (cached.ts || 0) < 60000);
  if (!fresh) {
    // Kick off a background refresh unless one is already in flight (lock < 20s old).
    const lock = TODAY_CACHE + '.lock';
    let inFlight = false;
    try { inFlight = Date.now() - fs.statSync(lock).mtimeMs < 20000; } catch { /* no lock */ }
    if (!inFlight) {
      try {
        fs.writeFileSync(lock, String(process.pid));
        spawn(process.execPath, [__filename, '--refresh-today'], { detached: true, stdio: 'ignore' }).unref();
      } catch { /* can't spawn — skip, session cost still shows */ }
    }
  }
  return cached && typeof cached.cost === 'number' ? cached.cost : null;
}

let cost = '';
if (data.cost && typeof data.cost.total_cost_usd === 'number') {
  const parts = [`$${data.cost.total_cost_usd.toFixed(2)} session`];
  const today = todayCost();
  if (today !== null) parts.push(`$${today.toFixed(2)} today`);
  cost = `💰 ${parts.join(' / ')}`;
}

// ─── Rate limits (usage windows) ──────────────────────────────────────────────
let limits = '';
const rl = data.rate_limits || {};
const win = (w) => (w && typeof w.used_percentage === 'number') ? Math.round(w.used_percentage) : null;
const h5 = win(rl.five_hour);
const wk = win(rl.seven_day);
if (h5 !== null || wk !== null) {
  const parts = [];
  if (h5 !== null) parts.push(paint(pctColour(h5), `${h5}% 5h`));
  if (wk !== null) parts.push(paint(pctColour(wk), `${wk}% wk`));
  limits = `⏳ ${parts.join(' · ')}`;
}

// ─── Git branch ───────────────────────────────────────────────────────────────
let branch = '';
const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();
try {
  const b = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 500 }).trim();
  if (b) branch = `🌿 ${b}`;
} catch { /* not a git repo */ }

// ─── Layout ───────────────────────────────────────────────────────────────────
// Wide terminal: one row. When it wouldn't fit, wrap to two rows — identity
// (name · model · branch) on top, the numbers (context · cost · limits) below.
const SEP = ' | ';

// Visible width, ignoring ANSI colour codes. We iterate by code point and count
// each emoji as 2 columns (terminals render them double-width); the result is a
// close estimate — enough for a wrap threshold.
function width(str) {
  const bare = str.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of bare) w += ch.codePointAt(0) > 0x2000 ? 2 : 1;
  return w;
}

const identity = [label, model, branch].filter(Boolean);
const numbers = [context, cost, limits].filter(Boolean);
const oneLine = [...identity, ...numbers].join(SEP);

const mode = process.env.CLAUDE_STATUSLINE_ROWS || 'auto';
const cols = parseInt(process.env.COLUMNS || '0', 10);
// Wrap a couple of columns early: emoji width is approximate and Claude Code may
// share the row with notifications, so leaning toward two rows avoids ellipsis.
const tooWide = cols > 0 && width(oneLine) > cols - 3;

let output;
if (mode === '2' || (mode === 'auto' && tooWide)) {
  output = [identity.join(SEP), numbers.join(SEP)].filter(Boolean).join('\n');
} else {
  output = oneLine;
}
process.stdout.write(output);
