const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, DEFAULTS, colorDepth, pctColor, renderBar, stripAnsi, visibleLength, truncateVisible } = require('../statusline.js');

test('parseArgs defaults', () => assert.deepEqual(parseArgs([]), DEFAULTS));
test('parseArgs values', () => {
  const o = parseArgs(['--bar-width', '16', '--model-key', '', '--align', 'right', '--no-cost', '--ascii', '--theme', 'mono']);
  assert.equal(o.barWidth, 16); assert.equal(o.modelKey, ''); assert.equal(o.align, 'right');
  assert.equal(o.showCost, false); assert.equal(o.ascii, true); assert.equal(o.theme, 'mono');
});
test('colorDepth', () => {
  assert.equal(colorDepth({ COLORTERM: 'truecolor' }), 'truecolor');
  assert.equal(colorDepth({ COLORTERM: '24bit' }), 'truecolor');
  assert.equal(colorDepth({ WT_SESSION: 'x' }), 'truecolor');
  assert.equal(colorDepth({ TERM: 'xterm-256color' }), '256');
  assert.equal(colorDepth({ NO_COLOR: '1', COLORTERM: 'truecolor' }), 'none');
  assert.equal(colorDepth({}), '16');
});
test('pctColor 16 steps', () => {
  assert.equal(pctColor(0, '16'), '\x1b[32m'); assert.equal(pctColor(49.9, '16'), '\x1b[32m');
  assert.equal(pctColor(50, '16'), '\x1b[33m'); assert.equal(pctColor(80, '16'), '\x1b[31m');
});
test('pctColor gradient', () => {
  assert.ok(pctColor(0, 'truecolor').startsWith('\x1b[38;2;'));
  assert.equal(pctColor(80, 'truecolor'), pctColor(100, 'truecolor'));
  assert.notEqual(pctColor(25, 'truecolor'), pctColor(0, 'truecolor'));
  assert.notEqual(pctColor(25, 'truecolor'), pctColor(50, 'truecolor'));
  assert.match(pctColor(25, '256'), /^\x1b\[38;5;\d+m$/);
  assert.equal(pctColor(25, 'none'), '');
});
test('renderBar eighths', () => {
  assert.deepEqual(renderBar(50, 10, false), { full: '█████', partial: '', empty: '░░░░░' });
  assert.deepEqual(renderBar(22.4, 10, false), { full: '██', partial: '▎', empty: '░░░░░░░' });
  assert.deepEqual(renderBar(150, 10, false), { full: '██████████', partial: '', empty: '' });
  assert.deepEqual(renderBar(-5, 10, false), { full: '', partial: '', empty: '░░░░░░░░░░' });
  assert.deepEqual(renderBar(22.4, 10, true), { full: '##', partial: '', empty: '........' });
});
test('ansi helpers', () => {
  assert.equal(visibleLength('\x1b[32mab\x1b[0m'), 2);
  const t = truncateVisible('\x1b[32mabcdef\x1b[0m', 4, false);
  assert.equal(stripAnsi(t), 'abc…'); assert.equal(visibleLength(t), 4);
  assert.equal(stripAnsi(truncateVisible('abcdef', 5, true)), 'ab...');
  assert.equal(truncateVisible('abc', 5, false), 'abc');
});
test('parseArgs ignores unknown tokens including Object.prototype names', () => {
  assert.deepEqual(parseArgs(['constructor', 'toString', '--unknown', 'x', '__proto__']), DEFAULTS);
});
