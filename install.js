#!/usr/bin/env node
'use strict';

// Installs claude-quota-line as the Claude Code status line.
// Copies statusline.js to <configDir>/quota-line/ and merges one `statusLine`
// key into <configDir>/settings.json. Existing settings are backed up first.

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS, FLAGS, configDir, readJson } = require('./statusline.js');

const HELP = `Usage:
  node install.js [options]
  node install.js --uninstall

Options (same as statusline.js):
  --bar-width N        --refresh-seconds N   --model-key KEY
  --model-label TEXT   --ctx-label TEXT      --five-hour-label TEXT
  --week-label TEXT    --ascii               --align left|right
  --width N            --right-margin N      --theme NAME
  --icons NAME         --no-model            --no-folder
  --no-cost            --dump-input

Other:
  --uninstall          Remove the status line, its files and its cache
  --help               Show this text

Set CLAUDE_CONFIG_DIR to use a folder other than ~/.claude.`;

function checkNode(version) {
  return parseInt(String(version).replace(/^v/, ''), 10) >= 18;
}

// Only the flags actually passed end up in `explicit`. Flag names and value
// kinds come from the FLAGS table of statusline.js.
function parseInstallArgs(argv) {
  const explicit = {};
  let uninstall = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uninstall') { uninstall = true; continue; }
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    const spec = Object.hasOwn(FLAGS, arg) ? FLAGS[arg] : undefined;
    if (!spec) throw new Error(`Unknown option: ${arg}`);
    const [key, kind] = spec;
    if (key === 'refresh') continue; // internal flag, never installed
    if (kind === 'bool') explicit[key] = true;
    else if (kind === 'off') explicit[key] = false;
    else {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      const val = argv[++i];
      if (kind === 'int') {
        const n = parseInt(val, 10);
        if (Number.isNaN(n)) throw new Error(`Invalid number for ${arg}: ${val}`);
        explicit[key] = n;
      } else {
        explicit[key] = val;
      }
    }
  }
  return { explicit, uninstall, help };
}

const LEGACY_FLAGS = {
  barwidth: ['barWidth', 'int'],
  refreshseconds: ['refreshSeconds', 'int'],
  modelkey: ['modelKey', 'str'],
  modellabel: ['modelLabel', 'str'],
  ctxlabel: ['ctxLabel', 'str'],
  fivehourlabel: ['fiveHourLabel', 'str'],
  weeklabel: ['weekLabel', 'str'],
  ascii: ['ascii', 'switch'],
  align: ['align', 'lower'],
  width: ['width', 'int'],
};

// Reads the options out of an old PowerShell status line command.
function parseLegacyCommand(cmd) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(cmd))) !== null) {
    if (m[3] !== undefined) tokens.push({ text: m[3], quoted: false });
    else tokens.push({ text: m[1] !== undefined ? m[1] : m[2], quoted: true });
  }
  const out = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.quoted || !t.text.startsWith('-')) continue;
    const name = t.text.slice(1).toLowerCase();
    const spec = Object.hasOwn(LEGACY_FLAGS, name) ? LEGACY_FLAGS[name] : undefined;
    if (!spec) continue;
    const [key, kind] = spec;
    if (kind === 'switch') { out[key] = true; continue; }
    if (i + 1 >= tokens.length) continue;
    const val = tokens[++i].text;
    if (kind === 'int') {
      const n = parseInt(val, 10);
      if (!Number.isNaN(n)) out[key] = n;
    } else {
      out[key] = kind === 'lower' ? val.toLowerCase() : val;
    }
  }
  return out;
}

// Emits `node "<script>"` plus every option that differs from DEFAULTS, in the
// order of the FLAGS table. `--refresh` is never emitted. Strings are bare when
// they are plain words and double quoted otherwise, numbers are bare.
function buildCommand(scriptPath, opts) {
  const parts = ['node', `"${scriptPath.replace(/\\/g, '/')}"`];
  for (const [flag, [key, kind]] of Object.entries(FLAGS)) {
    if (key === 'refresh') continue;
    const val = opts[key];
    if (val === undefined || val === DEFAULTS[key]) continue;
    if (kind === 'bool') {
      if (val === true) parts.push(flag);
    } else if (kind === 'off') {
      if (val === false) parts.push(flag);
    } else if (kind === 'int') {
      if (Number.isFinite(val)) parts.push(flag, String(val));
    } else {
      // Plain words stay bare, anything else (spaces, empty, symbols) is put in
      // double quotes. Labels never need a double quote, and one would break
      // the quoting of the command line, so it is swapped for a single quote.
      const text = String(val).replace(/"/g, "'");
      parts.push(flag, /^[\w.:+\/-]+$/.test(text) ? text : `"${text}"`);
    }
  }
  return parts.join(' ');
}

// Returns the parsed settings object, or {} when the file does not exist.
// Throws before anything is written when the file is not a valid JSON object.
function loadSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  const cfg = readJson(settingsPath);
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`settings.json is not valid JSON: ${settingsPath}`);
  }
  return cfg;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function backupSettings(settingsPath, now = new Date()) {
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
    + `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  let target = `${settingsPath}.bak-${stamp}`;
  for (let n = 1; fs.existsSync(target); n++) target = `${settingsPath}.bak-${stamp}-${n}`;
  fs.copyFileSync(settingsPath, target);
  return target;
}

function writeSettings(settingsPath, cfg) {
  fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + '\n');
}

function install(explicit, env = process.env, repoDir = __dirname) {
  const dir = configDir(env);
  const settingsPath = path.join(dir, 'settings.json');
  const cfg = loadSettings(settingsPath);

  const old = cfg.statusLine && typeof cfg.statusLine === 'object' ? cfg.statusLine : null;
  const previous = old && typeof old.command === 'string' ? old.command : null;
  const carried = previous && previous.includes('statusline.ps1') ? parseLegacyCommand(previous) : {};

  const targetDir = path.join(dir, 'quota-line');
  const scriptPath = path.join(targetDir, 'statusline.js');
  fs.mkdirSync(targetDir, { recursive: true });
  const source = path.join(repoDir, 'statusline.js');
  if (path.resolve(source) !== path.resolve(scriptPath)) fs.copyFileSync(source, scriptPath);
  fs.rmSync(path.join(targetDir, 'statusline.ps1'), { force: true });

  const opts = { ...DEFAULTS, align: 'right', ...carried, ...explicit };
  const command = buildCommand(scriptPath, opts);

  const statusLine = { type: 'command', command, padding: 0 };
  if (old) {
    for (const [k, v] of Object.entries(old)) {
      if (k !== 'type' && k !== 'command') statusLine[k] = v;
    }
  }
  cfg.statusLine = statusLine; // replaces in place, or appends when new

  if (fs.existsSync(settingsPath)) backupSettings(settingsPath);
  fs.mkdirSync(dir, { recursive: true });
  writeSettings(settingsPath, cfg);
  return { settingsPath, command, previous, carried };
}

function uninstall(env = process.env) {
  const dir = configDir(env);
  const settingsPath = path.join(dir, 'settings.json');
  const cfg = loadSettings(settingsPath);

  if (Object.hasOwn(cfg, 'statusLine')) {
    const sl = cfg.statusLine;
    const cmd = sl && typeof sl === 'object' && typeof sl.command === 'string' ? sl.command : '';
    if (cmd.includes('quota-line')) {
      backupSettings(settingsPath);
      delete cfg.statusLine;
      writeSettings(settingsPath, cfg);
    } else {
      console.log(`Left the existing statusLine in place, it does not reference quota-line: ${cmd || '(no command)'}`);
    }
  }

  fs.rmSync(path.join(dir, 'quota-line'), { recursive: true, force: true });
  for (const f of ['quota-line-cache.json', 'quota-line-refresh.lock', 'quota-line-last-input.json']) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

function cli(argv, env = process.env) {
  if (!checkNode(process.versions.node)) {
    throw new Error(`Node.js 18 or newer is required, found ${process.versions.node}`);
  }
  const { explicit, uninstall: remove, help } = parseInstallArgs(argv);
  if (help) {
    console.log(HELP);
    return;
  }
  console.log(`Config dir: ${configDir(env)}`);
  if (remove) {
    uninstall(env);
    console.log('Removed. Restart Claude Code.');
    return;
  }
  const r = install(explicit, env, __dirname);
  if (r.previous) console.log(`Replaced previous command: ${r.previous}`);
  console.log(`Command: ${r.command}`);
  console.log('Restart Claude Code to see the status line.');
}

module.exports = {
  checkNode, parseInstallArgs, parseLegacyCommand, buildCommand, install, uninstall,
};

if (require.main === module) {
  try {
    cli(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
