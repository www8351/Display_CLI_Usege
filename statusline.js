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
    const spec = FLAGS[argv[i]];
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
};

if (require.main === module) {
  // main() arrives in a later task.
}
