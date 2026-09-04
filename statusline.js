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
//   🧠  context-window fill: tokens + %, on the shared percentage ramp.
//   🤖  model display name.
//   💰  this session's cost + today's total across all sessions.
//   ⏳  time to the 5-hour reset + how much of it is spent, then the weekly
//       figure; every percentage uses the shared green→dark-red ramp.
//   🌿  current git branch of the working directory.
//
//   ⏳ also gives the time left in the current 5-hour window, from resets_at.
//
// A second block, 🧵, renders on its own row under the status line, and only
// when work runs in the background: the count, then each running subagent
// (cyan) or background command (plain) with the time since it started. It comes
// from the session transcript, because stdin does not carry it.
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
// Colour a percentage on one shared ramp, so the same number always means the
// same colour wherever it appears: bright green at 0, yellow through the 60s
// and 70s, red at 80, dark red from 90 to 100. We interpolate between the stops
// and quantise into the xterm-256 colour cube, because 256 colours render
// everywhere while truecolor does not (Apple Terminal has none).
const PCT_STOPS = [
  [0, [0, 255, 0]],     // bright green
  [50, [150, 255, 0]],  // yellow-green
  [70, [255, 255, 0]],  // yellow
  [75, [255, 140, 0]],  // orange
  [80, [255, 0, 0]],    // red
  [90, [150, 0, 0]],    // dark red
  [100, [90, 0, 0]],    // deep dark red
];
const CUBE = [0, 95, 135, 175, 215, 255];
function pctColour(pct) {
  const p = Math.max(0, Math.min(100, pct));
  let lo = PCT_STOPS[0];
  let hi = PCT_STOPS[PCT_STOPS.length - 1];
  for (let i = 0; i < PCT_STOPS.length - 1; i++) {
    if (p >= PCT_STOPS[i][0] && p <= PCT_STOPS[i + 1][0]) {
      lo = PCT_STOPS[i];
      hi = PCT_STOPS[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const t = span ? (p - lo[0]) / span : 0;
  // Nearest cube level per channel, then the xterm index for that cell.
  const level = (v) => {
    let best = 0;
    for (let i = 1; i < CUBE.length; i++) {
      if (Math.abs(CUBE[i] - v) < Math.abs(CUBE[best] - v)) best = i;
    }
    return best;
  };
  const rgb = [0, 1, 2].map((i) => Math.round(lo[1][i] + (hi[1][i] - lo[1][i]) * t));
  // Truecolor where the terminal claims it, because the 256-colour cube is too
  // coarse at the dark end (90% and 95% would share one cell).
  const ct = process.env.COLORTERM || '';
  if (ct === 'truecolor' || ct === '24bit') return `38;2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  return `38;5;${16 + 36 * level(rgb[0]) + 6 * level(rgb[1]) + level(rgb[2])}`;
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

// An explicit per-terminal colour override, set via /color and stored in
// session-colors.json (sister to session-names.json, same PID-based key). When
// present it wins over the name-hash hue; otherwise we fall back to colourFor().
const COLOR_CODES = {
  red: 91, green: 92, yellow: 93, blue: 94, magenta: 95, cyan: 96,
  gray: 90, white: 97,
};
function colourOverride() {
  const keys = [];
  const cpid = claudePid();
  if (cpid) keys.push(`pid:${cpid}`);
  const sid = process.env.CLAUDE_CODE_SESSION_ID || data.session_id || '';
  if (sid) keys.push(sid);
  if (!keys.length) return null;
  try {
    const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'session-colors.json'), 'utf8'));
    for (const k of keys) if (db[k] && db[k].color) return COLOR_CODES[db[k].color] || null;
  } catch { /* no db */ }
  return null;
}

// Prefer the user's /rename; otherwise fall back to Claude Code's own session
// name (truncated — those can be a whole sentence).
let rawName = customName();
if (!rawName && data.session_name) {
  rawName = data.session_name.length > 24 ? data.session_name.slice(0, 23) + '…' : data.session_name;
}
const nameColour = colourOverride() || colourFor(rawName);
const label = rawName ? paint(`1;${nameColour}`, rawName) : '';

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
  // Append the reasoning-effort level (high/medium/low/…) so you can see at a
  // glance how hard this session is thinking. Fast mode shows a ⚡ instead.
  const effort = data.effort && data.effort.level ? String(data.effort.level) : '';
  const tag = data.fast_mode ? '⚡ fast' : (effort ? `· ${effort}` : '');
  model = `🤖 ${name}${tag ? ` ${tag}` : ''}`;
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
// Time left in the current 5-hour usage window. resets_at is epoch seconds.
function timeLeft(resetsAt) {
  if (typeof resetsAt !== 'number') return '';
  const mins = Math.ceil((resetsAt * 1000 - Date.now()) / 60000);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}
if (h5 !== null || wk !== null) {
  // The 5-hour window reads as "2h53m 31%": time to its reset, then how much of
  // it is spent. The weekly window keeps its own label, because two bare
  // percentages side by side say nothing about which is which.
  const parts = [];
  const left = timeLeft(rl.five_hour && rl.five_hour.resets_at);
  const window5 = [left, h5 !== null ? `${h5}%` : ''].filter(Boolean).join(' ');
  // Time and percentage read as one figure, so they carry one colour: the ramp
  // position of the window that is being spent.
  if (window5) parts.push(h5 !== null ? paint(pctColour(h5), window5) : window5);
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

// ─── Threads (running subagents and background commands) ─────────────────────
// Claude Code does not pass these on stdin, so we read them out of the session
// transcript that stdin points at. A thread starts at its `tool_use` record (an
// Agent call, or a Bash call with run_in_background) and ends when a
// <task-notification> for its id lands, or — for a synchronous Agent — when its
// tool_result arrives. We remember the byte offset we already parsed and read
// only the new tail on each render, so a large transcript stays cheap.
const THREADS_CACHE = path.join(__dirname, '.statusline-threads.json');

function scanTranscript(text, state) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    // A completion notification retires a thread, whoever launched it.
    if (line.includes('task-notification')) {
      for (const m of line.matchAll(/<task-id>([^<]+)<\/task-id>/g)) state.done[m[1]] = 1;
    }
    if (!line.includes('tool_use') && !line.includes('toolUseResult')) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }

    // Launch: an Agent call, or a Bash call sent to the background.
    const content = rec.message && rec.message.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_use') continue;
        const input = b.input || {};
        const isAgent = b.name === 'Agent';
        const isBg = b.name === 'Bash' && input.run_in_background;
        if (!isAgent && !isBg) continue;
        state.open[b.id] = {
          kind: isAgent ? 'agent' : 'cmd',
          desc: String(input.description || (isAgent ? input.subagent_type : input.command) || '')
            .replace(/\s+/g, ' ').trim(),
          at: Date.parse(rec.timestamp) || Date.now(),
          id: null,
        };
      }
    }

    // Result: an async launch hands us the task id to watch; a synchronous
    // Agent result means that thread is already finished.
    const res = rec.toolUseResult;
    if (res && typeof res === 'object' && Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_result') continue;
        const open = state.open[b.tool_use_id];
        if (!open) continue;
        const taskId = res.agentId || res.backgroundTaskId;
        if (taskId) open.id = taskId; else delete state.open[b.tool_use_id];
      }
    }
  }
  // Drop anything already retired, plus threads older than 6 hours (a session
  // that was killed never sends their notification).
  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const [useId, t] of Object.entries(state.open)) {
    if ((t.id && state.done[t.id]) || t.at < cutoff) delete state.open[useId];
  }
}

function runningThreads() {
  const file = data.transcript_path;
  if (!file) return [];
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  let state = null;
  try { state = JSON.parse(fs.readFileSync(THREADS_CACHE, 'utf8')); } catch { /* first run */ }
  // Start over when the transcript changed or was rewritten shorter than we read.
  if (!state || state.file !== file || state.offset > stat.size) {
    state = { file, offset: 0, open: {}, done: {} };
  }
  if (stat.size > state.offset) {
    let text = '';
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.allocUnsafe(stat.size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      fs.closeSync(fd);
      text = buf.toString('utf8');
    } catch { return []; }
    // Only parse up to the last complete line; the rest is read again next time.
    const cut = text.lastIndexOf('\n');
    if (cut !== -1) {
      state.offset += Buffer.byteLength(text.slice(0, cut + 1), 'utf8');
      scanTranscript(text.slice(0, cut + 1), state);
      try { fs.writeFileSync(THREADS_CACHE, JSON.stringify(state)); } catch { /* cache is optional */ }
    }
  }
  return Object.values(state.open).sort((a, b) => a.at - b.at);
}

// One row per render, not one row per thread: the status line is a fixed budget.
function threadsRow() {
  let open = [];
  try { open = runningThreads(); } catch { return ''; }
  if (!open.length) return '';
  // hh:mm:ss, so the number advances on every render instead of sitting on the
  // same rounded minute for an hour.
  const age = (at) => {
    const total = Math.max(0, Math.floor((Date.now() - at) / 1000));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  };
  const SHOWN = 3;
  const cells = open.slice(0, SHOWN).map((t) => {
    const desc = t.desc.length > 26 ? t.desc.slice(0, 25) + '…' : t.desc;
    // Cyan marks a subagent; a background command keeps the plain foreground.
    const shown = t.kind === 'agent' ? paint(96, desc) : desc;
    return `${shown} ${paint(90, age(t.at))}`;
  });
  const rest = open.length - cells.length;
  if (rest > 0) cells.push(paint(90, `+${rest}`));
  return `🧵 ${paint(1, String(open.length))} ${cells.join(paint(90, ' · '))}`;
}

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

// Running threads get their own row under the status line, and only when there
// is something to show.
const threads = threadsRow();
if (threads) output = [output, threads].filter(Boolean).join('\n');

process.stdout.write(output);
