const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, collect, buildLines } = require('../statusline.js');

const script = path.join(__dirname, '..', 'statusline.js');
const full = fs.readFileSync(path.join(__dirname, 'fixtures', 'full.json'), 'utf8');

let tmp;
let env;
test.beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qline-main-'));
  env = { ...process.env, CLAUDE_CONFIG_DIR: tmp, NO_COLOR: '1' };
});
test.afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // a detached refresh child may still hold the folder
  }
});

const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input, env, encoding: 'utf8' });

test('renders full payload', () => {
  const r = run(['--model-key', '', '--width', '220'], full);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split('\n').length, 2);
  assert.ok(r.stdout.includes('14%'));
});

test('garbage stdin prints placeholder', () => {
  for (const bad of ['not json', 'null', '']) {
    const r = run([], bad);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('quota: waiting for first response'));
    assert.equal(r.stderr, '');
  }
});

test('BOM on stdin is accepted', () => {
  assert.ok(run(['--model-key', ''], '\uFEFF' + full).stdout.includes('14%'));
});

test('--dump-input writes payload', () => {
  run(['--dump-input', '--model-key', ''], full);
  assert.equal(fs.readFileSync(path.join(tmp, 'quota-line-last-input.json'), 'utf8'), full);
});

test('stale cache does not block render', () => {
  const t0 = Date.now();
  const r = run([], full);
  assert.equal(r.status, 0);
  assert.ok(Date.now() - t0 < 2000);
});

test('warm render is fast', (t) => {
  const opts = parseArgs(['--model-key', '']);
  const p = JSON.parse(full);
  const t0 = process.hrtime.bigint();
  buildLines(collect(p, null, opts), opts, 200, { depth: 'truecolor', now: new Date() });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  t.diagnostic(`in-process render ${ms.toFixed(2)} ms`);
  assert.ok(ms < 50);
  const s0 = Date.now();
  run(['--model-key', ''], full);
  t.diagnostic(`full process ${Date.now() - s0} ms`);
});
