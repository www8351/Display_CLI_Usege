const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configDir, readJson, readCache, getToken, lockIsFresh, runRefresh, spawnRefresh } = require('../statusline.js');

const roots = [];
let dir;
test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlapi-'));
  roots.push(dir);
});
test.after(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
});
function write(name, text) {
  fs.writeFileSync(path.join(dir, name), text);
}
function age(name, seconds) {
  const t = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(path.join(dir, name), t, t);
}

test('configDir', () => {
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: '/x/y' }), '/x/y');
  assert.equal(configDir({}), path.join(os.homedir(), '.claude'));
});
test('readCache missing', () => assert.deepEqual(readCache(dir, 300), { data: null, stale: true }));
test('readCache fresh, stale, BOM, corrupt, empty object', () => {
  write('quota-line-cache.json', '\uFEFF{"five_hour":{"utilization":5}}');
  assert.deepEqual(readCache(dir, 300), { data: { five_hour: { utilization: 5 } }, stale: false });
  age('quota-line-cache.json', 400);
  assert.equal(readCache(dir, 300).stale, true); assert.ok(readCache(dir, 300).data);
  write('quota-line-cache.json', '{"five_'); assert.equal(readCache(dir, 300).data, null);
  write('quota-line-cache.json', '{}'); assert.equal(readCache(dir, 300).data, null);
});
test('readCache backoff: unusable content derives stale from mtime', async () => {
  await runRefresh(dir, { getToken: () => null, fetchUsage: async () => ({}) });
  assert.deepEqual(readCache(dir, 300), { data: null, stale: false });
  write('quota-line-cache.json', '{"five_');
  assert.deepEqual(readCache(dir, 300), { data: null, stale: false });
  age('quota-line-cache.json', 400);
  assert.deepEqual(readCache(dir, 300), { data: null, stale: true });
});
test('readJson returns null on missing file', () => assert.equal(readJson(path.join(dir, 'nope.json')), null));
test('getToken from file with BOM', () => {
  write('.credentials.json', '\uFEFF{"claudeAiOauth":{"accessToken":"tok"}}');
  assert.equal(getToken(dir, 'linux'), 'tok');
});
test('getToken missing', () => assert.equal(getToken(dir, 'win32'), null));
test('lockIsFresh', () => {
  assert.equal(lockIsFresh(dir), false);
  write('quota-line-refresh.lock', ''); assert.equal(lockIsFresh(dir), true);
  age('quota-line-refresh.lock', 31); assert.equal(lockIsFresh(dir), false);
});
test('runRefresh success writes cache and removes lock', async () => {
  await runRefresh(dir, { getToken: () => 't', fetchUsage: async () => ({ five_hour: { utilization: 7 } }) });
  assert.equal(readJson(path.join(dir, 'quota-line-cache.json')).five_hour.utilization, 7);
  assert.equal(fs.existsSync(path.join(dir, 'quota-line-refresh.lock')), false);
});
test('runRefresh failure keeps old cache and touches it', async () => {
  write('quota-line-cache.json', '{"a":1}'); age('quota-line-cache.json', 400);
  await runRefresh(dir, { getToken: () => 't', fetchUsage: async () => { throw new Error('x'); } });
  assert.deepEqual(readJson(path.join(dir, 'quota-line-cache.json')), { a: 1 });
  assert.equal(readCache(dir, 300).stale, false);
});
test('runRefresh failure without cache writes {}', async () => {
  await runRefresh(dir, { getToken: () => null, fetchUsage: async () => ({}) });
  assert.equal(fs.readFileSync(path.join(dir, 'quota-line-cache.json'), 'utf8'), '{}');
});
test('runRefresh creates a missing dir and passes dir to getToken', async () => {
  const sub = path.join(dir, 'a', 'b');
  let seen;
  await runRefresh(sub, { getToken: (d) => { seen = d; return 't'; }, fetchUsage: async () => ({ x: 1 }) });
  assert.equal(seen, sub);
  assert.deepEqual(readJson(path.join(sub, 'quota-line-cache.json')), { x: 1 });
});
test('spawnRefresh is a no-op when the lock is fresh', () => {
  const old = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    write('quota-line-refresh.lock', '');
    assert.doesNotThrow(() => spawnRefresh({}));
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old;
  }
});
