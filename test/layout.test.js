const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, ICONS, detectWidth, buildLines, stripAnsi, visibleLength } = require('../statusline.js');

const now = new Date(2026, 10, 22, 8, 0);
const D = { ctx: 22.4, fiveHour: { pct: 11, resetsAt: new Date(now.getTime() + 288 * 60000) },
  week: { pct: 28, resetsAt: new Date(2026, 10, 26, 12, 59) }, model: { pct: 45, resetsAt: new Date(2026, 10, 26, 12, 59) },
  modelName: 'Opus 5 (1M context)', cost: 3.75, folder: 'Display_CLI_Usege', branch: 'main' };
const C = { depth: 'none', now };
const plain = l => l.map(stripAnsi);

test('wide terminal uses two lines', () => {
  const l = plain(buildLines(D, DEFAULTS, 220, C));
  assert.equal(l.length, 2);
  assert.ok(l[0].includes('Opus 5 (1M context)') && l[0].includes('$3.75'));
  assert.ok(l[1].includes('Display_CLI_Usege ⎇ main'));
});
test('medium terminal uses three lines with info first', () => {
  const l = plain(buildLines(D, DEFAULTS, 110, C));
  assert.equal(l.length, 3); assert.ok(l[0].includes('$3.75'));
  assert.equal(l[1].indexOf('│'), l[2].indexOf('│'));
});
test('never more than three lines, never wider than available', () => {
  for (const w of [220, 160, 120, 100, 80, 60, 40, 20]) {
    const l = buildLines(D, DEFAULTS, w, C);
    assert.ok(l.length <= 3, `width ${w}`);
    for (const line of l) assert.ok(visibleLength(line) <= w - 2, `width ${w}: ${stripAnsi(line)}`);
  }
});
test('reset columns dropped on both bar lines together', () => {
  for (const w of [120, 100, 80, 60]) {
    const bars = plain(buildLines(D, DEFAULTS, w, C)).filter(s => s.includes('%'));
    assert.equal(new Set(bars.map(s => s.includes('↻'))).size, 1, `width ${w}`);
  }
});
test('unknown width: two lines, left aligned', () => {
  const l = plain(buildLines(D, DEFAULTS, null, C));
  assert.equal(l.length, 2); assert.ok(!l[0].startsWith(' '));
});
test('right align pads to available width', () => {
  for (const s of buildLines(D, { ...DEFAULTS, align: 'right' }, 220, C)) assert.equal(visibleLength(s), 218);
});
test('partial data', () => {
  const only = { ctx: 5, fiveHour: null, week: null, model: null, modelName: null, cost: null, folder: null, branch: null };
  assert.equal(buildLines(only, DEFAULTS, null, C).length, 1);
  assert.deepEqual(buildLines({ ...only, ctx: null }, DEFAULTS, null, C), []);
});
test('ascii output is pure ASCII', () => {
  for (const s of plain(buildLines(D, { ...DEFAULTS, ascii: true }, 220, C))) assert.match(s, /^[\x20-\x7e]*$/);
});
test('themes and icons', () => {
  assert.ok(!plain(buildLines(D, { ...DEFAULTS, theme: 'minimal' }, 220, C)).join('\n').includes('Context win'));
  assert.match(plain(buildLines(D, { ...DEFAULTS, icons: 'nerd' }, 220, C)).join(''), /[-]/);
  assert.ok(!buildLines(D, { ...DEFAULTS, theme: 'mono' }, 220, { depth: 'truecolor', now }).join('').includes('\x1b[38;'));
});
test('detectWidth prefers --width, then COLUMNS', () => {
  assert.equal(detectWidth({ ...DEFAULTS, width: 150 }, {}), 150);
  assert.equal(detectWidth(DEFAULTS, { COLUMNS: '133' }), 133); // only meaningful when stdout/stderr are not TTYs, as under node --test
});

// Additional coverage beyond the brief.

test('tiny width with ascii never exceeds available width', () => {
  const l = buildLines(D, { ...DEFAULTS, ascii: true }, 4, C);
  assert.ok(l.length <= 3);
  for (const s of l) assert.ok(visibleLength(s) <= 2, JSON.stringify(stripAnsi(s)));
});
test('available width of zero or less yields no lines', () => {
  assert.deepEqual(buildLines(D, DEFAULTS, 2, C), []);
  assert.deepEqual(buildLines(D, DEFAULTS, 1, C), []);
});
test('detectWidth tty candidate is only a last resort', () => {
  let calls = 0;
  const tty = () => { calls++; return 97; };
  assert.equal(detectWidth({ ...DEFAULTS, width: 150 }, {}, tty), 150);
  assert.equal(detectWidth(DEFAULTS, { COLUMNS: '133' }, tty), 133);
  assert.equal(calls, 0);
  assert.equal(detectWidth(DEFAULTS, {}, tty), 97);
  assert.equal(calls, 1);
});
test('detectWidth never throws and returns null when nothing works', () => {
  assert.equal(detectWidth(DEFAULTS, { COLUMNS: 'abc' }, () => { throw new Error('no tty'); }), null);
  assert.equal(detectWidth(DEFAULTS, { COLUMNS: '0' }, () => undefined), null);
  const real = detectWidth(DEFAULTS, {});
  assert.ok(real === null || (Number.isInteger(real) && real > 0));
});
test('depth none emits no escape sequences at all', () => {
  for (const w of [220, 110, 60, 20, null]) {
    assert.ok(!buildLines(D, DEFAULTS, w, C).join('').includes('\x1b'), `width ${w}`);
  }
});
test('color depth styles labels bold, separators dim, bars colored', () => {
  const s = buildLines(D, DEFAULTS, 220, { depth: 'truecolor', now }).join('\n');
  assert.ok(s.includes('\x1b[1m') && s.includes('\x1b[90m') && s.includes('\x1b[38;2;'));
});
test('labels are padded so bar columns align', () => {
  const l = plain(buildLines(D, DEFAULTS, 110, C));
  assert.equal(l[1].indexOf('%'), l[2].indexOf('%'));
  assert.ok(l[1].includes('↻ 4h48m') && l[2].includes('↻ Thu 12:59'));
});
test('folder is truncated with an ellipsis but kept at 8 visible chars or more', () => {
  const l = plain(buildLines(D, DEFAULTS, 40, C));
  const info = l.find(s => s.includes('$3.75'));
  const m = /(\S*…)/.exec(info);
  assert.ok(m, info);
  assert.ok(m[1].length >= 8, info);
});
test('shortened model name drops the parenthesis', () => {
  const l = plain(buildLines(D, DEFAULTS, 60, C));
  assert.ok(l[0].includes('Opus 5') && !l[0].includes('(1M'));
});
test('no branch shows folder alone, ascii shows branch in parentheses', () => {
  assert.ok(plain(buildLines({ ...D, branch: null }, DEFAULTS, 220, C))[1].endsWith('Display_CLI_Usege'));
  assert.ok(plain(buildLines(D, { ...DEFAULTS, ascii: true }, 220, C))[1].includes('Display_CLI_Usege (main)'));
});
test('minimal theme falls back to short labels without icons', () => {
  const s = plain(buildLines(D, { ...DEFAULTS, theme: 'minimal', icons: 'none' }, 220, C)).join('\n');
  for (const label of ['Ctx', '5h', 'Wk', 'Fable']) assert.ok(s.includes(label), label);
});
test('ICONS sets', () => {
  assert.equal(ICONS.unicode.branch, '⎇'); assert.equal(ICONS.unicode.cost, '$');
  for (const set of Object.values(ICONS)) {
    assert.deepEqual(Object.keys(set).sort(), ['branch', 'cost', 'ctx', 'fiveHour', 'folder', 'model', 'modelName', 'week']);
  }
  for (const v of Object.values(ICONS.none)) assert.equal(v, '');
  for (const v of Object.values(ICONS.nerd)) assert.match(v, /^[-]$/);
});
