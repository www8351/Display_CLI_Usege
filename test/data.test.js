const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, toTime, resetLabel, getPct, findModelBucket, shortModelName, formatCost, collect } = require('../statusline.js');

const fx = n => require(`./fixtures/${n}.json`);
const noGit = { gitBranch: () => null };
test('toTime', () => {
  assert.equal(toTime(1787695200).getTime(), 1787695200000);
  assert.equal(toTime(1787695200000).getTime(), 1787695200000);
  assert.equal(toTime('1787695200').getTime(), 1787695200000);
  assert.equal(toTime('2026-11-22T10:00:00Z').toISOString(), '2026-11-22T10:00:00.000Z');
  assert.equal(toTime(null), null); assert.equal(toTime('garbage'), null);
});
test('resetLabel', () => {
  const now = new Date(2026, 10, 22, 8, 0, 0);
  assert.equal(resetLabel(new Date(now.getTime() + (4 * 60 + 48) * 60000 + 30000), false, now), '4h48m');
  assert.equal(resetLabel(new Date(now.getTime() - 1000), false, now), 'now');
  assert.equal(resetLabel(new Date(2026, 10, 26, 12, 59), true, now), 'Thu 12:59');
  assert.equal(resetLabel(null, true, now), '');
});
test('getPct', () => {
  assert.equal(getPct({ used_percentage: 41 }), 41); assert.equal(getPct({ utilization: 0.45 }), 45);
  assert.equal(getPct({ utilization: 45 }), 45); assert.equal(getPct({ percent: 12 }), 12);
  assert.equal(getPct(null), null); assert.equal(getPct({}), null);
  assert.equal(getPct({ used_percentage: 'abc' }), null);
});
test('findModelBucket', () => {
  assert.deepEqual(findModelBucket(fx('usage-limits'), 'fable'), { pct: 45, resetsAt: '2026-11-26T10:59:00Z' });
  assert.equal(findModelBucket(fx('usage-legacy'), 'opus').pct, 30);
  assert.equal(findModelBucket(fx('usage-limits'), 'opus'), null);
  assert.equal(findModelBucket(null, 'fable'), null);
});
test('model name and cost', () => {
  assert.equal(shortModelName('Opus 5 (1M context)'), 'Opus 5'); assert.equal(shortModelName('Fable 5'), 'Fable 5');
  assert.equal(formatCost(3.7472655000000006), '$3.75'); assert.equal(formatCost(0), '$0.00');
});
test('collect full payload, no usage', () => {
  const d = collect(fx('full'), null, DEFAULTS, { gitBranch: () => 'main' });
  assert.equal(d.ctx, 14); assert.equal(d.fiveHour.pct, 41); assert.equal(d.week.pct, 18);
  assert.equal(d.model, null); assert.equal(d.modelName, 'Opus 5 (1M context)');
  assert.equal(d.cost, 3.7472655000000006); assert.equal(d.folder, 'AccountGuardian'); assert.equal(d.branch, 'main');
});
test('collect fresh session shows 0% context', () => assert.equal(collect(fx('fresh'), null, DEFAULTS, noGit).ctx, 0));
test('collect falls back to API for limits', () => {
  const d = collect(fx('apikey'), fx('usage-limits'), DEFAULTS, noGit);
  assert.equal(d.fiveHour.pct, 41); assert.equal(d.week.pct, 18); assert.equal(d.model.pct, 45);
});
test('collect honors --no-* flags', () => {
  const d = collect(fx('full'), null, { ...DEFAULTS, showModel: false, showFolder: false, showCost: false }, { gitBranch: () => 'main' });
  assert.equal(d.modelName, null); assert.equal(d.folder, null); assert.equal(d.branch, null); assert.equal(d.cost, null);
});
test('collect tolerates null payload', () => assert.equal(collect(null, null, DEFAULTS, noGit).ctx, null));
