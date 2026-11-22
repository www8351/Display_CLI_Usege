const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEFAULTS, readJson } = require('../statusline.js');
const {
  checkNode, parseInstallArgs, parseLegacyCommand, parseNodeCommand, buildCommand, install, uninstall,
} = require('../install.js');

const repoDir = path.join(__dirname, '..');
const LEGACY = "pwsh -NoProfile -NoLogo -ExecutionPolicy Bypass -File \"C:/Users/www83/.claude/quota-line/statusline.ps1\" -BarWidth 16 -RefreshSeconds 300 -ModelKey opus -ModelLabel 'Opus' -CtxLabel 'Context win' -FiveHourLabel '5H Limit' -WeekLabel 'Weekly' -Align Right -Width 160 -Ascii";

let tmp;
let env;
test.beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qline-inst-'));
  env = { ...process.env, CLAUDE_CONFIG_DIR: tmp };
});
test.afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const write = (rel, text) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const baks = () => fs.readdirSync(tmp).filter((f) => f.startsWith('settings.json.bak-'));

test('checkNode', () => {
  assert.equal(checkNode('17.9.0'), false);
  assert.equal(checkNode('18.0.0'), true);
  assert.equal(checkNode('v20.1.0'), true);
});

test('parseLegacyCommand', () => assert.deepEqual(parseLegacyCommand(LEGACY), {
  barWidth: 16, refreshSeconds: 300, modelKey: 'opus', modelLabel: 'Opus', ctxLabel: 'Context win',
  fiveHourLabel: '5H Limit', weekLabel: 'Weekly', align: 'right', width: 160, ascii: true,
}));

test('parseLegacyCommand handles double quotes and unknown flags', () => {
  assert.deepEqual(parseLegacyCommand('pwsh -File "x.ps1" -ModelLabel "My Model" -Foo bar'), { modelLabel: 'My Model' });
});

test('parseInstallArgs keeps only passed flags', () => {
  assert.deepEqual(parseInstallArgs(['--bar-width', '12', '--ascii', '--no-cost', '--model-label', 'A B']),
    { explicit: { barWidth: 12, ascii: true, showCost: false, modelLabel: 'A B' }, uninstall: false, help: false });
  assert.deepEqual(parseInstallArgs(['--bar-width', '10']).explicit, { barWidth: 10 });
  assert.equal(parseInstallArgs(['--uninstall']).uninstall, true);
  assert.equal(parseInstallArgs(['--help']).help, true);
});

test('parseInstallArgs rejects unknown flags and missing values', () => {
  assert.throws(() => parseInstallArgs(['--bogus']), /--bogus/);
  assert.throws(() => parseInstallArgs(['--bar-width']), /--bar-width/);
  assert.throws(() => parseInstallArgs(['--bar-width', 'x']), /--bar-width/);
});

test('buildCommand quotes paths with spaces', () => assert.equal(
  buildCommand('C:\\Users\\First Last\\.claude\\quota-line\\statusline.js', { ...DEFAULTS, align: 'right', modelLabel: 'My Model' }),
  'node "C:/Users/First Last/.claude/quota-line/statusline.js" --model-label "My Model" --align right'));

test('buildCommand flag kinds and order', () => {
  const cmd = buildCommand('/a/s.js', {
    ...DEFAULTS, barWidth: 12, ascii: true, width: 150, showModel: false, showCost: false,
    theme: 'neon', dumpInput: true, refresh: true,
  });
  assert.equal(cmd, 'node "/a/s.js" --bar-width 12 --ascii --width 150 --dump-input --theme neon --no-model --no-cost');
  assert.equal(buildCommand('/a/s.js', { ...DEFAULTS }), 'node "/a/s.js"');
});

test('buildCommand replaces double quotes in values', () => {
  assert.equal(buildCommand('/a/s.js', { ...DEFAULTS, modelLabel: 'My "X"' }), 'node "/a/s.js" --model-label "My \'X\'"');
});

test('install over legacy settings with BOM', () => {
  write('settings.json', '\uFEFF' + JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: LEGACY, padding: 0 } }));
  write('quota-line/statusline.ps1', 'x');
  const r = install({ barWidth: 12 }, env, repoDir);
  const s = readJson(path.join(tmp, 'settings.json'));
  assert.equal(s.theme, 'dark');
  assert.equal(s.statusLine.padding, 0);
  assert.ok(s.statusLine.command.includes('--model-key opus') && s.statusLine.command.includes('--bar-width 12'));
  assert.ok(fs.existsSync(path.join(tmp, 'quota-line', 'statusline.js')));
  assert.ok(!fs.existsSync(path.join(tmp, 'quota-line', 'statusline.ps1')));
  assert.equal(baks().length, 1);
  assert.equal(r.previous, LEGACY);
});

test('backup is a byte copy and settings keep key order', () => {
  const original = JSON.stringify({ a: 1, statusLine: { type: 'command', command: 'x' }, z: 2 });
  write('settings.json', original);
  install({}, env, repoDir);
  assert.equal(fs.readFileSync(path.join(tmp, baks()[0]), 'utf8'), original);
  assert.deepEqual(Object.keys(readJson(path.join(tmp, 'settings.json'))), ['a', 'statusLine', 'z']);
  assert.ok(fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8').endsWith('}\n'));
});

test('invalid settings.json is left untouched', () => {
  write('settings.json', '{ broken');
  assert.throws(() => install({}, env, repoDir), /settings\.json/);
  assert.equal(fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8'), '{ broken');
  assert.equal(baks().length, 0);
  assert.ok(!fs.existsSync(path.join(tmp, 'quota-line')));
});

test('settings.json holding a non-object is invalid', () => {
  write('settings.json', '[1,2]');
  assert.throws(() => install({}, env, repoDir), /settings\.json/);
  assert.equal(fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8'), '[1,2]');
});

test('install without settings.json creates it', () => {
  const r = install({}, env, repoDir);
  assert.deepEqual(Object.keys(readJson(path.join(tmp, 'settings.json'))), ['statusLine']);
  assert.equal(r.previous, null);
  assert.equal(readJson(path.join(tmp, 'settings.json')).statusLine.padding, 0);
  assert.ok(r.command.includes('--align right'));
});

test('non-legacy statusLine is replaced and reported', () => {
  write('settings.json', JSON.stringify({ statusLine: { type: 'command', command: 'other-tool' } }));
  const r = install({}, env, repoDir);
  assert.equal(r.previous, 'other-tool');
  assert.deepEqual(r.carried, {});
});

test('explicit flags override carried values', () => {
  write('settings.json', JSON.stringify({ statusLine: { type: 'command', command: LEGACY } }));
  const r = install({ modelKey: 'sonnet' }, env, repoDir);
  assert.ok(r.command.includes('--model-key sonnet'));
});

test('uninstall', () => {
  write('settings.json', JSON.stringify({ theme: 'dark' }));
  install({}, env, repoDir);
  write('quota-line-cache.json', '{}');
  write('quota-line-refresh.lock', '1');
  write('quota-line-last-input.json', '{}');
  uninstall(env);
  assert.deepEqual(readJson(path.join(tmp, 'settings.json')), { theme: 'dark' });
  for (const f of ['quota-line', 'quota-line-cache.json', 'quota-line-refresh.lock', 'quota-line-last-input.json']) {
    assert.ok(!fs.existsSync(path.join(tmp, f)), f);
  }
});

test('uninstall leaves a foreign statusLine', () => {
  write('settings.json', JSON.stringify({ statusLine: { type: 'command', command: 'other-tool' } }));
  uninstall(env);
  assert.equal(readJson(path.join(tmp, 'settings.json')).statusLine.command, 'other-tool');
});

test('uninstall with invalid settings.json throws and changes nothing', () => {
  write('settings.json', '{ broken');
  write('quota-line/statusline.js', 'x');
  assert.throws(() => uninstall(env), /settings\.json/);
  assert.ok(fs.existsSync(path.join(tmp, 'quota-line')));
});

test('CLI installs, reports, and exits 1 on invalid settings', () => {
  const cli = path.join(repoDir, 'install.js');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  let r = run(['--model-label', 'My Model']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(tmp) && r.stdout.includes('--model-label "My Model"'));
  r = run(['--help']);
  assert.equal(r.status, 0);
  assert.ok(/Usage/.test(r.stdout));
  write('settings.json', '{ broken');
  r = run([]);
  assert.equal(r.status, 1);
  assert.ok(/settings\.json/.test(r.stderr) && !/\n\s+at /.test(r.stderr));
});

const LEGACY_LEFT = LEGACY.replace(' -Align Right', '');
const sl = () => readJson(path.join(tmp, 'settings.json')).statusLine.command;
const withCommand = (command) => write('settings.json', JSON.stringify({ statusLine: { type: 'command', command } }));

test('legacy command without -Align migrates to left (no --align flag)', () => {
  withCommand(LEGACY_LEFT);
  const r = install({}, env, repoDir);
  assert.ok(!r.command.includes('--align'));
  assert.ok(r.command.includes('--model-key opus'));
});

test('explicit --align right wins over a legacy left install', () => {
  withCommand(LEGACY_LEFT);
  assert.ok(install({ align: 'right' }, env, repoDir).command.includes('--align right'));
});

test('parseNodeCommand reads quoted values and skips node and the script path', () => {
  assert.deepEqual(
    parseNodeCommand('node "C:/Users/First Last/.claude/quota-line/statusline.js" --model-label "My Model" --bar-width 16 --align right'),
    { align: 'right', modelLabel: 'My Model', barWidth: 16 });
});

test('reinstall keeps the options of the previous Node command', () => {
  withCommand('node "C:/x/.claude/quota-line/statusline.js" --model-key opus --bar-width 16 --align right');
  const r = install({}, env, repoDir);
  assert.ok(r.command.includes('--model-key opus') && r.command.includes('--bar-width 16'));
  assert.ok(r.command.includes('--align right'));
  assert.equal(sl(), r.command);
});

test('reinstall accepts backslash paths in the previous command', () => {
  withCommand('node "C:\\x\\.claude\\quota-line\\statusline.js" --model-key opus');
  assert.ok(install({}, env, repoDir).command.includes('--model-key opus'));
});

test('explicit flags win over the previous Node command', () => {
  withCommand('node "C:/x/.claude/quota-line/statusline.js" --model-key opus --bar-width 16 --align right');
  const r = install({ barWidth: 20 }, env, repoDir);
  assert.ok(r.command.includes('--bar-width 20') && !r.command.includes('--bar-width 16'));
  assert.ok(r.command.includes('--model-key opus'));
});

test('previous Node command without --align keeps left', () => {
  withCommand('node "C:/x/.claude/quota-line/statusline.js" --model-key opus');
  const r = install({}, env, repoDir);
  assert.ok(!r.command.includes('--align'));
  assert.ok(r.command.includes('--model-key opus'));
});

test('parseInstallArgs lowercases and validates align, theme and icons', () => {
  assert.deepEqual(parseInstallArgs(['--align', 'Right', '--theme', 'MONO', '--icons', 'Nerd']).explicit,
    { align: 'right', theme: 'mono', icons: 'nerd' });
  assert.throws(() => parseInstallArgs(['--align', 'center']), /--align.*left\|right/);
  assert.throws(() => parseInstallArgs(['--theme', 'neon']), /--theme.*default\|minimal\|mono/);
  assert.throws(() => parseInstallArgs(['--icons', 'emoji']), /--icons.*unicode\|nerd\|none/);
});

test('CLI exits 1 with a one line error for an unknown option value', () => {
  const r = spawnSync(process.execPath, [path.join(repoDir, 'install.js'), '--theme', 'neon'], { env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(/^Error: Invalid value for --theme: neon/m.test(r.stderr));
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.ok(!fs.existsSync(path.join(tmp, 'settings.json')));
});

test('empty or whitespace-only settings.json is treated as {} and backed up', () => {
  for (const text of ['', ' \n\t ', '\uFEFF']) {
    for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
    write('settings.json', text);
    install({}, env, repoDir);
    assert.deepEqual(Object.keys(readJson(path.join(tmp, 'settings.json'))), ['statusLine']);
    assert.equal(baks().length, 1);
    assert.equal(fs.readFileSync(path.join(tmp, baks()[0]), 'utf8'), text);
  }
});
