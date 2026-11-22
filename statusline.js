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
        opts[key] = val;
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
  let data = readJson(file);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    return { data: null, stale: true };
  }
  let stale = true;
  try {
    stale = now - fs.statSync(file).mtimeMs >= refreshSeconds * 1000;
  } catch {
    data = null;
  }
  return { data, stale };
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
    }).unref();
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
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DEFAULTS,
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
};

if (require.main === module) {
  // main() arrives in a later task.
}
