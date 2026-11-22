#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const DEFAULTS = {
  barWidth: 10,
  refreshSeconds: 300,
  modelKey: 'fable',
  modelLabel: 'Fable',
  ctxLabel: 'Context win',
  fiveHourLabel: '5H Limit',
  weekLabel: 'Weekly',
  ascii: false,
  align: 'left',
  width: 0,
  rightMargin: 2,
  dumpInput: false,
  theme: 'default',
  icons: 'unicode',
  showModel: true,
  showFolder: true,
  showCost: true,
  refresh: false,
};

// flag -> [option key, kind]. 'int' and 'str' take a value, 'bool' sets true,
// 'off' sets false.
const FLAGS = {
  '--bar-width': ['barWidth', 'int'],
  '--refresh-seconds': ['refreshSeconds', 'int'],
  '--model-key': ['modelKey', 'str'],
  '--model-label': ['modelLabel', 'str'],
  '--ctx-label': ['ctxLabel', 'str'],
  '--five-hour-label': ['fiveHourLabel', 'str'],
  '--week-label': ['weekLabel', 'str'],
  '--ascii': ['ascii', 'bool'],
  '--align': ['align', 'str'],
  '--width': ['width', 'int'],
  '--right-margin': ['rightMargin', 'int'],
  '--dump-input': ['dumpInput', 'bool'],
  '--theme': ['theme', 'str'],
  '--icons': ['icons', 'str'],
  '--no-model': ['showModel', 'off'],
  '--no-folder': ['showFolder', 'off'],
  '--no-cost': ['showCost', 'off'],
  '--refresh': ['refresh', 'bool'],
};

// Values of these options are matched case-insensitively.
const LOWER_KEYS = new Set(['align', 'theme', 'icons']);

function parseArgs(argv) {
  const opts = Object.assign({}, DEFAULTS);
  for (let i = 0; i < argv.length; i++) {
    const spec = Object.hasOwn(FLAGS, argv[i]) ? FLAGS[argv[i]] : undefined;
    if (!spec) continue;
    const [key, kind] = spec;
    if (kind === 'bool') opts[key] = true;
    else if (kind === 'off') opts[key] = false;
    else {
      if (i + 1 >= argv.length) continue;
      const val = argv[++i];
      if (kind === 'int') {
        const n = parseInt(val, 10);
        if (!Number.isNaN(n)) opts[key] = n;
      } else {
        opts[key] = LOWER_KEYS.has(key) ? val.toLowerCase() : val;
      }
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

function colorDepth(env) {
  if (env.NO_COLOR !== undefined) return 'none';
  const ct = String(env.COLORTERM || '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit' || env.WT_SESSION) return 'truecolor';
  if (String(env.TERM || '').includes('256')) return '256';
  return '16';
}

const GREEN = [64, 200, 90];
const YELLOW = [235, 200, 40];
const RED = [230, 60, 60];

function lerp(a, b, t) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}

function gradientRgb(pct) {
  if (pct >= 80) return RED.slice();
  if (pct >= 50) return lerp(YELLOW, RED, (pct - 50) / 30);
  if (pct <= 0) return GREEN.slice();
  return lerp(GREEN, YELLOW, pct / 50);
}

function pctColor(pct, depth) {
  if (depth === 'none') return '';
  if (depth === '16') {
    if (pct >= 80) return '\x1b[31m';
    if (pct >= 50) return '\x1b[33m';
    return '\x1b[32m';
  }
  const [r, g, b] = gradientRgb(pct);
  if (depth === '256') {
    const q = (c) => Math.round(c / 255 * 5);
    return `\x1b[38;5;${16 + 36 * q(r) + 6 * q(g) + q(b)}m`;
  }
  return `\x1b[38;2;${r};${g};${b}m`;
}

// ---------------------------------------------------------------------------
// Bar and ANSI helpers
// ---------------------------------------------------------------------------

const PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

function renderBar(pct, width, ascii) {
  const p = Math.min(100, Math.max(0, pct));
  if (ascii) {
    const full = Math.round(p / 100 * width);
    return { full: '#'.repeat(full), partial: '', empty: '.'.repeat(width - full) };
  }
  const eighths = Math.round(p / 100 * width * 8);
  const full = Math.floor(eighths / 8);
  const partial = PARTIALS[eighths % 8];
  const empty = width - full - (partial ? 1 : 0);
  return { full: '█'.repeat(full), partial, empty: '░'.repeat(empty) };
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s) {
  return s.replace(ANSI_RE, '');
}

function visibleLength(s) {
  return stripAnsi(s).length;
}

function truncateVisible(s, max, ascii) {
  if (visibleLength(s) <= max) return s;
  const ell = ascii ? '...' : '…';
  const keep = Math.max(0, max - ell.length);
  const hadEscapes = s.includes('\x1b[');
  let out = '';
  let count = 0;
  let i = 0;
  while (i < s.length && count < keep) {
    ANSI_RE.lastIndex = i;
    const m = ANSI_RE.exec(s);
    if (m && m.index === i) {
      out += m[0];
      i += m[0].length;
    } else {
      out += s[i];
      count++;
      i++;
    }
  }
  return out + ell + (hadEscapes ? '\x1b[0m' : '');
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toTime(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  let d;
  if (typeof v === 'number' || (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v))) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    d = new Date(n > 1e12 ? n : n * 1000);
  } else if (typeof v === 'string') {
    d = new Date(v);
  } else {
    return null;
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function resetLabel(v, weekly, now) {
  const t = toTime(v);
  if (!t) return '';
  const diff = t.getTime() - now.getTime();
  if (diff <= 0) return 'now';
  if (weekly) return `${WEEKDAYS[t.getDay()]} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  const mins = Math.floor(diff / 60000);
  return `${Math.floor(mins / 60)}h${pad2(mins % 60)}m`;
}

function getPct(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of ['used_percentage', 'utilization', 'percent']) {
    const v = obj[key];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return key === 'utilization' && v <= 1 ? Math.round(v * 10000) / 100 : v;
  }
  return null;
}

function findModelBucket(usage, key) {
  if (!usage || typeof usage !== 'object' || !key) return null;
  const k = String(key).toLowerCase();
  if (Array.isArray(usage.limits)) {
    for (const e of usage.limits) {
      if (!e || e.kind !== 'weekly_scoped') continue;
      const m = (e.scope && e.scope.model) || {};
      const hay = `${m.display_name || ''} ${m.id || ''}`.toLowerCase();
      const pct = getPct(e);
      if (hay.includes(k) && pct !== null) return { pct, resetsAt: e.resets_at };
    }
  }
  for (const name of Object.keys(usage)) {
    if (!/^seven_day_/.test(name) || !name.toLowerCase().includes(k)) continue;
    const pct = getPct(usage[name]);
    if (pct !== null) return { pct, resetsAt: usage[name].resets_at };
  }
  return null;
}

function shortModelName(name) {
  return String(name).replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function formatCost(usd) {
  return '$' + usd.toFixed(2);
}

function limitFrom(payloadObj, usageObj) {
  for (const o of [payloadObj, usageObj]) {
    const pct = getPct(o);
    if (pct !== null) return { pct, resetsAt: o.resets_at };
  }
  return null;
}

function folderName(dir) {
  const base = dir.includes('\\') ? path.win32.basename(dir) : path.posix.basename(dir);
  return base || dir;
}

function branchFromHead(headFile) {
  const head = fs.readFileSync(headFile, 'utf8').trim();
  const m = /^ref: *(.+)$/.exec(head);
  if (m) {
    const ref = m[1].trim();
    return ref.startsWith('refs/') ? ref.slice('refs/'.length).replace(/^heads\//, '') : ref;
  }
  return /^[0-9a-f]{40,64}$/i.test(head) ? head.slice(0, 7) : null;
}

function gitBranch(startDir) {
  try {
    if (typeof startDir !== 'string' || startDir === '') return null;
    let dir = path.resolve(startDir);
    for (;;) {
      const dotGit = path.join(dir, '.git');
      let st = null;
      try {
        st = fs.statSync(dotGit);
      } catch {
        st = null;
      }
      if (st && st.isDirectory()) return branchFromHead(path.join(dotGit, 'HEAD'));
      if (st && st.isFile()) {
        const m = /^gitdir: *(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
        if (!m) return null;
        return branchFromHead(path.join(path.resolve(dir, m[1].trim()), 'HEAD'));
      }
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

function collect(payload, usage, opts, deps = { gitBranch }) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const u = usage && typeof usage === 'object' ? usage : {};
  const rl = p.rate_limits && typeof p.rate_limits === 'object' ? p.rate_limits : {};

  const ctx = p.context_window && typeof p.context_window === 'object'
    ? (getPct(p.context_window) ?? 0)
    : null;

  let modelName = null;
  if (opts.showModel && p.model && typeof p.model === 'object') {
    modelName = p.model.display_name || p.model.id || null;
  }

  const rawCost = p.cost && p.cost.total_cost_usd;
  const cost = opts.showCost && typeof rawCost === 'number' && Number.isFinite(rawCost) ? rawCost : null;

  let folder = null;
  let branch = null;
  if (opts.showFolder) {
    const ws = p.workspace && typeof p.workspace === 'object' ? p.workspace : {};
    const dir = [ws.current_dir, p.cwd].find((x) => typeof x === 'string' && x !== '');
    if (dir) {
      folder = folderName(dir);
      try {
        branch = deps.gitBranch(dir) || null;
      } catch {
        branch = null;
      }
    }
  }

  return {
    ctx,
    fiveHour: limitFrom(rl.five_hour, u.five_hour),
    week: limitFrom(rl.seven_day, u.seven_day),
    model: findModelBucket(u, opts.modelKey),
    modelName,
    cost,
    folder,
    branch,
  };
}

// ---------------------------------------------------------------------------
// Config dir, cache, credentials, background refresh
// ---------------------------------------------------------------------------

const os = require('node:os');

const CACHE_FILE = 'quota-line-cache.json';
const LOCK_FILE = 'quota-line-refresh.lock';
const CREDENTIALS_FILE = '.credentials.json';
const LOCK_MAX_AGE_MS = 30000;
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const FETCH_TIMEOUT_MS = 4000;

function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function parseJsonText(text) {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function readJson(file) {
  try {
    return parseJsonText(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readCache(dir, refreshSeconds, now = Date.now()) {
  const file = path.join(dir, CACHE_FILE);
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return { data: null, stale: true };
  }
  let data = readJson(file);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    data = null;
  }
  return { data, stale: now - mtimeMs >= refreshSeconds * 1000 };
}

function tokenFrom(creds) {
  const t = creds && creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
  return typeof t === 'string' && t !== '' ? t : null;
}

function getToken(dir, platform = process.platform) {
  if (platform === 'darwin') {
    try {
      const { execFileSync } = require('node:child_process');
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).toString();
      const t = tokenFrom(parseJsonText(out.trim()));
      if (t) return t;
    } catch {
      // fall back to the credentials file
    }
  }
  return tokenFrom(readJson(path.join(dir, CREDENTIALS_FILE)));
}

function lockIsFresh(dir, now = Date.now()) {
  try {
    return now - fs.statSync(path.join(dir, LOCK_FILE)).mtimeMs < LOCK_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function spawnRefresh(opts) { // eslint-disable-line no-unused-vars
  try {
    if (lockIsFresh(configDir())) return;
    const { spawn } = require('node:child_process');
    spawn(process.execPath, [__filename, '--refresh'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: os.tmpdir(),
    }).on('error', () => {}).unref();
  } catch {
    // never break a render
  }
}

function fetchUsage(token) {
  return new Promise((resolve, reject) => {
    const https = require('node:https');
    const req = https.request(
      USAGE_URL,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode > 299) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(parseJsonText(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function runRefresh(dir, deps = { getToken, fetchUsage }) {
  const lock = path.join(dir, LOCK_FILE);
  const cache = path.join(dir, CACHE_FILE);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lock, '', { flag: 'w' });
    try {
      const token = deps.getToken(dir);
      if (!token) throw new Error('no token');
      const data = await deps.fetchUsage(token);
      fs.writeFileSync(cache, JSON.stringify(data));
    } catch {
      // keep the old cache but mark it fresh so we back off; seed {} if none
      try {
        const now = new Date();
        fs.utimesSync(cache, now, now);
      } catch {
        fs.writeFileSync(cache, '{}');
      }
    }
  } catch {
    // dir not writable: nothing more to do
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------------------
// Layout: width, icons, themes, line building
// ---------------------------------------------------------------------------

// Every glyph is a single terminal column so visibleLength stays accurate.
const ICONS = {
  unicode: {
    ctx: '◔', fiveHour: '◷', week: '▦', model: '◆',
    modelName: '✦', folder: '⌂', branch: '⎇', cost: '$',
  },
  nerd: {
    ctx: '', fiveHour: '', week: '', model: '',
    modelName: '', folder: '', branch: '', cost: '',
  },
  none: {
    ctx: '', fiveHour: '', week: '', model: '',
    modelName: '', folder: '', branch: '', cost: '',
  },
};

const RESET_WIDTH = 11;
const FOLDER_MIN = 8;

function positiveInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Columns of the controlling terminal. The fd is always closed: by the
// stream when one was created, otherwise directly.
function ttyColumns() {
  let fd = null;
  let ws = null;
  try {
    // Device paths opened with 'r+' (open existing only). A bare 'CONOUT$'
    // with 'w' would create a regular file in the cwd when no console exists.
    fd = fs.openSync(process.platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty', 'r+');
    ws = new (require('node:tty').WriteStream)(fd);
    return ws.columns;
  } finally {
    if (ws) {
      try {
        ws.destroy();
      } catch {
        // ignore
      }
    } else if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function detectWidth(opts, env = process.env, readTty = ttyColumns) {
  const candidates = [
    () => opts.width,
    () => process.stdout.columns,
    () => process.stderr.columns,
    () => env.COLUMNS,
    readTty,
  ];
  for (const get of candidates) {
    try {
      const n = positiveInt(get());
      if (n !== null) return n;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Cut to max visible chars without an ellipsis, keeping escapes intact.
function cutVisible(s, max) {
  let out = '';
  let count = 0;
  let i = 0;
  while (i < s.length && count < max) {
    ANSI_RE.lastIndex = i;
    const m = ANSI_RE.exec(s);
    if (m && m.index === i) {
      out += m[0];
      i += m[0].length;
    } else {
      out += s[i];
      count++;
      i++;
    }
  }
  return out + (out.includes('\x1b[') ? '\x1b[0m' : '');
}

function fitLine(s, max, ascii) {
  if (visibleLength(s) <= max) return s;
  const ell = ascii ? '...' : '…';
  return max >= ell.length ? truncateVisible(s, max, ascii) : cutVisible(s, max);
}

// Fixed parts of a render that do not change between shortening steps.
function layoutEnv(opts, ctx) {
  const ascii = !!opts.ascii;
  const depth = opts.theme === 'mono' ? 'none' : (ctx.depth || 'none');
  const plain = depth === 'none';
  const icons = ascii ? ICONS.none : (Object.hasOwn(ICONS, opts.icons) ? ICONS[opts.icons] : ICONS.unicode);
  const dim = plain ? '' : '\x1b[90m';
  const reset = plain ? '' : '\x1b[0m';
  return {
    opts,
    ascii,
    depth,
    icons,
    now: ctx.now || new Date(),
    bold: plain ? '' : '\x1b[1m',
    dim,
    reset,
    sep: ` ${dim}${ascii ? '|' : '│'}${reset} `,
  };
}

function cellLabels(env, minimal) {
  const { opts, icons } = env;
  if (!minimal) {
    return { ctx: opts.ctxLabel, fiveHour: opts.fiveHourLabel, week: opts.weekLabel, model: opts.modelLabel };
  }
  return {
    ctx: icons.ctx || 'Ctx',
    fiveHour: icons.fiveHour || '5h',
    week: icons.week || 'Wk',
    model: icons.model || opts.modelLabel,
  };
}

function barCell(env, st, key, pct, resetsAt, weekly) {
  const { opts, icons, bold, dim, reset } = env;
  const labels = cellLabels(env, st.minimal);
  const labelWidth = Math.max(...Object.values(labels).map((l) => String(l).length));
  const icon = st.minimal || !icons[key] ? '' : icons[key] + ' ';
  const labelText = String(labels[key]);
  const label = `${icon}${bold}${labelText}${reset}${' '.repeat(labelWidth - labelText.length)}`;

  const want = st.minimal ? Math.min(opts.barWidth, 5) : opts.barWidth;
  const width = Math.max(1, Math.floor(want) || 1);
  const bar = renderBar(pct, width, env.ascii);
  const color = pctColor(pct, env.depth);
  const filled = bar.full + bar.partial;
  const barText = (filled ? `${color}${filled}${reset}` : '') + (bar.empty ? `${dim}${bar.empty}${reset}` : '');
  const pctText = `${color}${`${Math.round(pct)}%`.padStart(4)}${reset}`;

  let cell = `${label} ${barText} ${pctText}`;
  if (!st.dropReset) {
    const when = resetLabel(resetsAt, weekly, env.now);
    const text = when ? `${env.ascii ? '~' : '↻'} ${when}` : '';
    cell += ' ' + (text ? `${dim}${text}${reset}` : '') + ' '.repeat(Math.max(0, RESET_WIDTH - text.length));
  }
  return cell;
}

function folderSegment(env, name, branch) {
  const { icons } = env;
  const icon = icons.folder ? icons.folder + ' ' : '';
  if (!branch) return icon + name;
  return icons.branch ? `${icon}${name} ${icons.branch} ${branch}` : `${icon}${name} (${branch})`;
}

// One render of the layout state. Returns unpadded, untruncated lines as
// { text, bars }, where bars marks a line that holds bar cells.
function renderState(data, env, st, avail) {
  const { icons } = env;
  const cells = {
    ctx: typeof data.ctx === 'number' ? barCell(env, st, 'ctx', data.ctx, null, false) : null,
    fiveHour: data.fiveHour ? barCell(env, st, 'fiveHour', data.fiveHour.pct, data.fiveHour.resetsAt, false) : null,
    week: data.week ? barCell(env, st, 'week', data.week.pct, data.week.resetsAt, true) : null,
    model: data.model ? barCell(env, st, 'model', data.model.pct, data.model.resetsAt, true) : null,
  };
  let modelName = null;
  if (data.modelName) {
    const name = st.shortModel ? shortModelName(data.modelName) : String(data.modelName);
    modelName = (icons.modelName ? icons.modelName + ' ' : '') + name;
  }
  let cost = null;
  if (typeof data.cost === 'number' && Number.isFinite(data.cost)) {
    cost = icons.cost ? icons.cost + formatCost(data.cost).slice(1) : formatCost(data.cost);
  }
  const FOLDER = data.folder ? {} : null; // placeholder, filled per line below

  const rows = st.mode === 'two'
    ? [[cells.ctx, cells.fiveHour, modelName, cost], [cells.week, cells.model, FOLDER]]
    : [[modelName, FOLDER, cost], [cells.ctx, cells.fiveHour], [cells.week, cells.model]];

  const barCells = new Set(Object.values(cells).filter((c) => c !== null));
  const lines = [];
  for (const row of rows) {
    const parts = row.filter((p) => p !== null);
    const bars = parts.some((p) => barCells.has(p));
    if (parts.length === 0) continue;
    const fi = parts.indexOf(FOLDER);
    if (fi !== -1) {
      let name = String(data.folder);
      if (st.truncFolder && avail !== null) {
        const others = parts.filter((p) => p !== FOLDER);
        const used = others.reduce((n, p) => n + visibleLength(p), 0)
          + (parts.length - 1) * visibleLength(env.sep)
          + visibleLength(folderSegment(env, '', data.branch));
        const room = Math.max(FOLDER_MIN, avail - used);
        if (name.length > room) name = truncateVisible(name, room, env.ascii);
      }
      parts[fi] = folderSegment(env, name, data.branch);
    }
    lines.push({ text: parts.join(env.sep).replace(/ +$/, ''), bars });
  }
  return lines;
}

// Right alignment. Bar lines are padded as one block, from the longest of
// them, so their columns stay aligned. Other lines are padded on their own.
function alignRight(lines, avail) {
  const barWidest = Math.max(0, ...lines.filter((l) => l.bars).map((l) => visibleLength(l.text)));
  return lines.map((l) => {
    const pad = avail - (l.bars ? barWidest : visibleLength(l.text));
    return { ...l, text: ' '.repeat(Math.max(0, pad)) + l.text };
  });
}

// Shortening steps, cumulative. Each one changes the layout state; the
// first state where every line fits wins.
const SHORTEN_STEPS = [
  (st) => { st.mode = 'three'; },
  (st) => { st.truncFolder = true; },
  (st) => { st.shortModel = true; },
  (st) => { st.dropReset = true; },
  (st) => { st.minimal = true; },
];

function buildLines(data, opts, width, ctx = { depth: colorDepth(process.env), now: new Date() }) {
  const d = data || {};
  const env = layoutEnv(opts, ctx || {});
  const st = {
    mode: 'two',
    truncFolder: false,
    shortModel: false,
    dropReset: false,
    minimal: opts.theme === 'minimal',
  };

  if (width === null || width === undefined) return renderState(d, env, st, null).map((l) => l.text);

  const avail = width - (opts.rightMargin || 0);
  if (avail < 1) return [];

  const fits = (ls) => ls.every((l) => visibleLength(l.text) <= avail);
  let lines = renderState(d, env, st, avail);
  for (const step of SHORTEN_STEPS) {
    if (fits(lines)) break;
    step(st);
    lines = renderState(d, env, st, avail);
  }
  if (!fits(lines)) lines = lines.map((l) => ({ ...l, text: fitLine(l.text, avail, env.ascii) }));

  lines = lines.filter((l) => visibleLength(l.text) > 0).slice(0, 3);
  if (opts.align === 'right') lines = alignRight(lines, avail);
  return lines.map((l) => l.text);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DEFAULTS,
  FLAGS,
  parseArgs,
  colorDepth,
  pctColor,
  renderBar,
  stripAnsi,
  visibleLength,
  truncateVisible,
  toTime,
  resetLabel,
  getPct,
  findModelBucket,
  shortModelName,
  formatCost,
  gitBranch,
  collect,
  configDir,
  readJson,
  readCache,
  getToken,
  lockIsFresh,
  spawnRefresh,
  runRefresh,
  fetchUsage,
  ICONS,
  detectWidth,
  buildLines,
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const PLACEHOLDER_TEXT = 'quota: waiting for first response';
const LAST_INPUT_FILE = 'quota-line-last-input.json';

function placeholder() {
  return colorDepth(process.env) === 'none' ? PLACEHOLDER_TEXT : `\x1b[90m${PLACEHOLDER_TEXT}\x1b[0m`;
}

function dumpInput(input) {
  try {
    const dir = configDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LAST_INPUT_FILE), input);
  } catch {
    // diagnostics only
  }
}

function needsApi(payload, opts) {
  if (opts.modelKey) return true;
  const rl = payload && payload.rate_limits;
  return !(rl && rl.five_hour && rl.seven_day);
}

async function main(argv, input) {
  try {
    const opts = parseArgs(argv);
    const raw = typeof input === 'string' ? input : '';
    if (opts.dumpInput) dumpInput(raw);

    let payload = null;
    try {
      payload = parseJsonText(raw);
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = null;
    if (!payload) return [placeholder()];

    let usage = null;
    if (needsApi(payload, opts)) {
      const cache = readCache(configDir(), opts.refreshSeconds, Date.now());
      usage = cache.data;
      if (cache.stale) spawnRefresh(opts);
    }

    const data = collect(payload, usage, opts);
    const lines = buildLines(data, opts, detectWidth(opts), {
      depth: colorDepth(process.env),
      now: new Date(),
    });
    return lines.length > 0 ? lines : [placeholder()];
  } catch {
    return [placeholder()];
  }
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', () => resolve(chunks.join('')));
  });
}

async function entry() {
  const argv = process.argv.slice(2);
  process.exitCode = 0;
  if (argv.includes('--refresh')) {
    try {
      await runRefresh(configDir());
    } catch {
      // detached, nothing to report
    }
    return;
  }
  const input = await readStdin();
  const lines = await main(argv, input);
  process.stdout.write(lines.join('\n') + '\n');
}

module.exports.main = main;

if (require.main === module) {
  entry().catch(() => {
    process.exitCode = 0;
  });
}
