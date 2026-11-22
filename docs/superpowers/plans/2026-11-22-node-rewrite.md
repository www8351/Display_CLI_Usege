# claude-quota-line v2 (Node.js rewrite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows-only PowerShell status line with one dependency-free Node.js script that runs on Windows, macOS and Linux, adds model, folder and branch, and cost segments, and upgrades the visuals.

**Architecture:** `statusline.js` is a single CommonJS file: pure functions exported for tests, `main()` runs only when executed directly. The usage API is never called during a render; a detached child (`statusline.js --refresh`) refreshes the cache. `install.js` merges one `statusLine` key into Claude Code's `settings.json` on every platform.

**Tech Stack:** Node.js 18+, built-in modules only, `node:test` + `node:assert/strict`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-22-node-rewrite-design.md`

## Global Constraints

* Node.js 18 or newer. Built-in modules only. No npm dependencies, ever.
* `statusline.js` stays one runnable file. CommonJS, `'use strict'`, exports via `module.exports`, entry guarded by `if (require.main === module)`.
* Never print more than three lines.
* Warm-cache render target under 100 ms. The render never waits on the network.
* `CLAUDE_CONFIG_DIR`, when set, replaces `~/.claude` for every path: credentials, cache, lock, dump, install folder, `settings.json`.
* Cache file `quota-line-cache.json`, lifetime `--refresh-seconds` default 300, fetch timeout 4 s.
* Endpoint `https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`.
* Gradient stops: green at 0%, yellow at 50%, red at 80% and above.
* Prose in docs and commit messages: no em dashes, no hyphens as separators. Commit messages carry no AI attribution and no Co-Authored-By lines.
* README never mentions LEDGER.md, CLAUDE.md, the docs/superpowers folder, or AI involvement.

## Review Focus

1. **`settings.json` or stdin with a UTF-8 BOM.** The old PowerShell installer wrote `settings.json` with a BOM, and a captured stdin dump also starts with one. `JSON.parse` rejects a BOM. Expected: BOM stripped before every parse. Tests in Task 5 (cache, credentials), Task 7 (stdin), Task 8 (settings).
2. **Garbage or non-object stdin** (`not json`, `null`, empty). Expected: placeholder line, exit code 0, no stack trace. Test in Task 7.
3. **Corrupt cache file** (`{}` from a failed fetch, truncated JSON). Expected: treated as no data, render continues, refresh still scheduled when stale. Test in Task 5.
4. **Stale lock left by a crashed refresh.** Expected: a lock older than 30 s is ignored so refreshes resume. Test in Task 5.
5. **Install path with spaces** (`C:\Users\First Last\.claude`). Expected: the written command quotes the script path and still runs. Test in Task 8.

---

## File Structure

```
statusline.js                  render script (all runtime logic)
install.js                     installer and uninstaller
package.json                   private, engines >=18, "test": "node --test"
test/fixtures/full.json        real captured payload (below)
test/fixtures/fresh.json       context_window with used_percentage null, no rate_limits
test/fixtures/apikey.json      no rate_limits key at all
test/fixtures/usage-limits.json   API shape with limits[] weekly_scoped
test/fixtures/usage-legacy.json   API shape with seven_day_<key>
test/render.test.js            Task 2
test/data.test.js              Task 3
test/git.test.js               Task 4
test/api.test.js               Task 5
test/layout.test.js            Task 6
test/main.test.js              Task 7
test/install.test.js           Task 8
.github/workflows/test.yml     Task 9
legacy/powershell/             statusline.ps1, install.ps1, test.ps1 moved unchanged (Task 9)
quota.json, README.md          rewritten in Task 9
```

---

### Task 1: Terminal width spike (throwaway, needs the user)

Purpose: learn which width source works when Claude Code runs the status line with piped stdout. Nothing from this task is committed except a LEDGER entry.

**Files:**
- Create (outside the repo, in a scratch dir): `width-spike.js`

- [ ] **Step 1: Write `width-spike.js`**

It must write `~/.claude/width-spike.json` with one key per candidate and print one line `spike ok`. Candidates, each in its own try/catch, recording the value or the error message:
`process.stdout.columns`, `process.stderr.columns`, `process.env.COLUMNS`, and a tty stream opened on the controlling terminal: `new (require('tty').WriteStream)(fs.openSync(process.platform === 'win32' ? 'CONOUT$' : '/dev/tty', 'w')).columns`. Also record elapsed ms for the tty candidate.

- [ ] **Step 2: Ask the user before touching their live `settings.json`.** On approval, back it up to `settings.json.bak-spike`, set `statusLine.command` to `node "<abs path>/width-spike.js"`.

- [ ] **Step 3: User sends one message in a Claude Code session, resizes the window, sends another.**

- [ ] **Step 4: Read `~/.claude/width-spike.json`, then restore `settings.json` from the backup and delete the backup and the spike output.**

Expected: at least one candidate returns the real width. Restore must happen even if the spike failed.

- [ ] **Step 5: Record the result in LEDGER.md DECISIONS** (which candidates worked on Windows, elapsed ms of the tty candidate). If the tty candidate costs more than 20 ms, Task 6 drops it. Commit `LEDGER.md` only.

---

### Task 2: Rendering primitives and options

**Files:**
- Create: `statusline.js`, `package.json`
- Test: `test/render.test.js`

**Interfaces:**
- Produces:
  - `DEFAULTS` object: `{ barWidth: 10, refreshSeconds: 300, modelKey: 'fable', modelLabel: 'Fable', ctxLabel: 'Context win', fiveHourLabel: '5H Limit', weekLabel: 'Weekly', ascii: false, align: 'left', width: 0, rightMargin: 2, dumpInput: false, theme: 'default', icons: 'unicode', showModel: true, showFolder: true, showCost: true, refresh: false }`
  - `parseArgs(argv: string[]) -> Options` (DEFAULTS merged with flags). Flags: `--bar-width --refresh-seconds --model-key --model-label --ctx-label --five-hour-label --week-label --ascii --align --width --right-margin --dump-input --theme --icons --no-model --no-folder --no-cost --refresh`. Numeric flags parsed as integers. A value may be the empty string (`--model-key ""` disables the per-model segment). Unknown flags are ignored.
  - `colorDepth(env: object) -> 'truecolor'|'256'|'16'|'none'`
  - `pctColor(pct: number, depth) -> string` (an SGR start sequence, `''` for `none`)
  - `renderBar(pct: number, width: number, ascii: boolean) -> { full: string, partial: string, empty: string }` (uncolored pieces)
  - `stripAnsi(s) -> string`, `visibleLength(s) -> number`, `truncateVisible(s: string, max: number, ascii: boolean) -> string`

- [ ] **Step 1: Create `package.json`**

`{ "name": "claude-quota-line", "version": "2.0.0", "private": true, "license": "MIT", "engines": { "node": ">=18" }, "scripts": { "test": "node --test" } }`

- [ ] **Step 2: Write the failing tests in `test/render.test.js`**

```js
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
```

(Each test file starts with `const test = require('node:test'); const assert = require('node:assert/strict');`.)

- [ ] **Step 3: Run `node --test test/render.test.js`.** Expected: FAIL, cannot find module or exports undefined.

- [ ] **Step 4: Implement the exports in `statusline.js`**

`renderBar`, non-ascii: clamp pct to 0..100; `eighths = Math.round(pct / 100 * width * 8)`; `full = floor(eighths / 8)` cells of `█`; remainder r selects `['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][r]`; empty fills the rest with `░`. Ascii: `full = Math.round(pct / 100 * width)` of `#`, no partial, rest `.`.
`pctColor`: 16 uses the three steps shown. Truecolor interpolates linearly between the RGB of green (0) and yellow (50), then yellow and red (80), clamped above 80; RGB values are the builder's call. 256 maps the same RGB to `16 + 36r + 6g + b` with each channel `Math.round(c / 255 * 5)`.
`colorDepth` order: `NO_COLOR` set → none; `COLORTERM` truecolor/24bit or `WT_SESSION` set → truecolor; `TERM` contains `256` → 256; else 16.
ANSI regex: `/\x1b\[[0-9;]*m/g`. Ellipsis `…`, or `...` when ascii. `truncateVisible` keeps escapes intact and appends `\x1b[0m` after the ellipsis when the input had escapes.

- [ ] **Step 5: Run `node --test test/render.test.js`.** Expected: PASS.

- [ ] **Step 6: Commit** `git add package.json statusline.js test/render.test.js && git commit -m "feat: add Node rendering primitives and option parsing"`

---

### Task 3: Payload and usage data extraction

**Files:**
- Modify: `statusline.js`
- Create: `test/fixtures/full.json`, `fresh.json`, `apikey.json`, `usage-limits.json`, `usage-legacy.json`
- Test: `test/data.test.js`

**Interfaces:**
- Consumes: `parseArgs`, `DEFAULTS` (Task 2).
- Produces:
  - `toTime(v) -> Date|null` (epoch seconds, epoch ms when > 1e12, numeric string, ISO string)
  - `resetLabel(v, weekly: boolean, now: Date) -> string` (uncolored, no arrow; `''` when no time)
  - `getPct(obj) -> number|null` (keys in order `used_percentage`, `utilization`, `percent`; `utilization <= 1` scaled ×100)
  - `findModelBucket(usage, key: string) -> { pct: number, resetsAt: any }|null` (case-insensitive match)
  - `shortModelName(name: string) -> string`, `formatCost(usd: number) -> string`
  - `collect(payload, usage, opts, deps = { gitBranch }) -> Data`
  - `Data = { ctx: number|null, fiveHour: Limit|null, week: Limit|null, model: Limit|null, modelName: string|null, cost: number|null, folder: string|null, branch: string|null }`, `Limit = { pct: number, resetsAt: any }`

- [ ] **Step 1: Create fixtures**

`full.json` is this captured payload verbatim (no BOM):
```json
{"session_id":"60812273-216a-466e-82e7-2eb5bfde2301","cwd":"C:\\Users\\www83\\Downloads\\AI\\AccountGuardian","model":{"id":"claude-opus-5[1m]","display_name":"Opus 5 (1M context)"},"workspace":{"current_dir":"C:\\Users\\www83\\Downloads\\AI\\AccountGuardian","project_dir":"C:\\Users\\www83\\Downloads\\AI\\AccountGuardian","added_dirs":[],"repo":{"host":"github.com","owner":"www8351","name":"Account_Guardian_V2"}},"version":"2.1.245","cost":{"total_cost_usd":3.7472655000000006,"total_duration_ms":397333},"context_window":{"context_window_size":1000000,"used_percentage":14,"remaining_percentage":86},"rate_limits":{"five_hour":{"used_percentage":41,"resets_at":1787695200},"seven_day":{"used_percentage":18,"resets_at":1787824800}}}
```
`fresh.json`: `{"model":{"display_name":"Fable 5"},"cwd":"/tmp/x","context_window":{"used_percentage":null,"context_window_size":200000}}`
`apikey.json`: same as `full.json` without `rate_limits`.
`usage-limits.json`: `{"five_hour":{"utilization":41,"resets_at":"2026-11-22T20:00:00Z"},"seven_day":{"utilization":18,"resets_at":"2026-11-26T10:59:00Z"},"limits":[{"kind":"session","percent":41},{"kind":"weekly_scoped","percent":45,"resets_at":"2026-11-26T10:59:00Z","scope":{"model":{"display_name":"Fable","id":"claude-fable-5"}}}]}`
`usage-legacy.json`: `{"five_hour":{"utilization":0.41,"resets_at":"2026-11-22T20:00:00Z"},"seven_day":{"utilization":0.18,"resets_at":"2026-11-26T10:59:00Z"},"seven_day_opus":{"utilization":0.3,"resets_at":"2026-11-26T10:59:00Z"}}`

- [ ] **Step 2: Write failing tests in `test/data.test.js`**

```js
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
```

- [ ] **Step 3: Run `node --test test/data.test.js`.** Expected: FAIL.

- [ ] **Step 4: Implement** the Task 3 exports. Folder is the basename of `workspace.current_dir`, else `cwd`; use `path.win32.basename` when the value contains a backslash, else `path.posix.basename`, so Windows payloads parse on any OS. `collect` calls `deps.gitBranch(dir)` only when `showFolder` is true and a dir exists. `findModelBucket` checks `limits[]` entries with `kind === 'weekly_scoped'` against `"${display_name} ${id}"`, then top-level keys matching `^seven_day_` that contain the key. `resetLabel` weekly format: English short weekday plus `HH:mm` 24 h in local time; non-weekly `${h}h${mm}m`.

- [ ] **Step 5: Run `node --test test/data.test.js`.** Expected: PASS.

- [ ] **Step 6: Commit** `git add statusline.js test/data.test.js test/fixtures && git commit -m "feat: extract limits, model, folder and cost from payload"`

---

### Task 4: Git branch without spawning git

**Files:**
- Modify: `statusline.js`
- Test: `test/git.test.js`

**Interfaces:**
- Produces: `gitBranch(startDir: string) -> string|null`. Task 3 ships `collect` with default `deps = { gitBranch: () => null }`; this task switches that default to `gitBranch`.

- [ ] **Step 1: Write failing tests** (each builds a tree under `fs.mkdtempSync(path.join(os.tmpdir(), 'qlgit-'))`)

```js
test('branch from nested dir', () => {           // repo/.git/HEAD = 'ref: refs/heads/feature/x\n'
  assert.equal(gitBranch(path.join(repo, 'a', 'b')), 'feature/x');
});
test('detached HEAD gives short hash', () => {   // HEAD = 40 hex chars
  assert.equal(gitBranch(repo), 'a1b2c3d');
});
test('.git file with relative gitdir (worktree)', () => {
  // wt/.git = 'gitdir: ../real/.git/worktrees/wt\n', that dir holds HEAD 'ref: refs/heads/wt-branch'
  assert.equal(gitBranch(wt), 'wt-branch');
});
test('.git file with absolute gitdir', () => { /* same with absolute path */ });
test('no repo returns null', () => assert.equal(gitBranch(emptyTmp), null));
test('missing dir returns null', () => assert.equal(gitBranch(path.join(emptyTmp, 'nope')), null));
```

- [ ] **Step 2: Run `node --test test/git.test.js`.** Expected: FAIL.

- [ ] **Step 3: Implement `gitBranch`.** Walk up with `path.dirname` until it stops changing. All fs calls wrapped; any error returns null.

- [ ] **Step 4: Run `node --test test/git.test.js`.** Expected: PASS.

- [ ] **Step 5: Commit** `git add statusline.js test/git.test.js && git commit -m "feat: read git branch from .git without spawning git"`

---

### Task 5: Config dir, cache, credentials, background refresh

**Files:**
- Modify: `statusline.js`
- Test: `test/api.test.js`

**Interfaces:**
- Produces:
  - `configDir(env = process.env) -> string`
  - `readJson(file: string) -> any|null` (strips a leading `\uFEFF`, returns null on any error)
  - `readCache(dir: string, refreshSeconds: number, now = Date.now()) -> { data: object|null, stale: boolean }` (data is null when the file is missing, unparsable, or an empty object)
  - `getToken(dir: string, platform = process.platform) -> string|null`
  - `lockIsFresh(dir: string, now = Date.now()) -> boolean` (lock file `quota-line-refresh.lock`, fresh if mtime under 30 s old)
  - `spawnRefresh(opts) -> void` (detached `process.execPath [__filename, '--refresh', ...]`, `stdio: 'ignore'`, `unref()`; no-op when `lockIsFresh`)
  - `runRefresh(dir: string, deps = { getToken, fetchUsage }) -> Promise<void>`
  - `fetchUsage(token: string) -> Promise<object>` (lazy `require('node:https')`, 4 s timeout, rejects on non-2xx)

- [ ] **Step 1: Write failing tests** (temp `dir` per test)

```js
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
```
(`write` and `age` are small helpers in the test file; `age` uses `fs.utimesSync` to push mtime back N seconds.)

- [ ] **Step 2: Run `node --test test/api.test.js`.** Expected: FAIL.

- [ ] **Step 3: Implement.** `getToken` on `darwin` first tries `execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 3000 })` and parses its JSON, then falls back to `<dir>/.credentials.json`. `runRefresh` creates the lock with flag `'w'`, deletes it in `finally`. A missing token counts as a failure. Write the cache as `JSON.stringify(data)`.

- [ ] **Step 4: Run `node --test test/api.test.js`.** Expected: PASS.

- [ ] **Step 5: Commit** `git add statusline.js test/api.test.js && git commit -m "feat: cached usage API with detached background refresh"`

---

### Task 6: Layout, themes, icons, width

**Files:**
- Modify: `statusline.js`
- Test: `test/layout.test.js`

**Interfaces:**
- Consumes: `renderBar`, `pctColor`, `visibleLength`, `truncateVisible`, `stripAnsi` (Task 2); `resetLabel`, `shortModelName`, `formatCost`, `Data` (Task 3).
- Produces:
  - `ICONS = { unicode: {...}, nerd: {...}, none: {...} }`, each with keys `ctx, fiveHour, week, model, modelName, folder, branch, cost`. Unicode `branch` is `⎇`, `cost` is `$`. Nerd glyphs are in the Private Use Area. `none` maps every key to `''`. Other glyphs are the builder's call.
  - `detectWidth(opts, env = process.env) -> number|null`
  - `buildLines(data: Data, opts, width: number|null, ctx = { depth, now }) -> string[]` (0 to 3 lines, styled and aligned)

Rules the tests pin:
* Bar cell: `[icon ]label(padded to the widest of the four labels) bar pct(4 wide, right aligned) reset(11 wide: '↻ ' + resetLabel, or '~ ' when ascii)`. Separator `' │ '` dim, `' | '` when ascii.
* Info segments: modelName, `folder ⎇ branch` (ascii: `folder (branch)`; no branch: folder alone), cost.
* Two-line mode: line 1 = ctx cell, five-hour cell, modelName, cost. Line 2 = week cell, model cell, folder segment. Empty lines are omitted.
* Three-line mode: line 1 = modelName, folder segment, cost. Lines 2 and 3 = the bar cells.
* Available width = `width - opts.rightMargin`. `width === null`: two-line mode, left aligned, no shortening.
* Shortening, cumulative, stop at the first state where every line fits: (a) two-line mode; (b) three-line mode; (c) truncate folder to the space left on its line, minimum 8 visible chars incl. ellipsis; (d) `shortModelName`; (e) drop reset columns on both bar lines; (f) `minimal` layout; (g) `truncateVisible` every line.
* Themes: `minimal` uses the icon instead of the label (falls back to `Ctx`, `5h`, `Wk`, and `modelLabel` when icons are `none`) and bar width `Math.min(opts.barWidth, 5)`. `mono` forces depth `none`. `--ascii` forces icons `none` and ASCII glyphs everywhere.
* `align === 'right'` left-pads each line to the available width.

- [ ] **Step 1: Write failing tests**

```js
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
  assert.match(plain(buildLines(D, { ...DEFAULTS, icons: 'nerd' }, 220, C)).join(''), /[\ue000-\uf8ff]/);
  assert.ok(!buildLines(D, { ...DEFAULTS, theme: 'mono' }, 220, { depth: 'truecolor', now }).join('').includes('\x1b[38;'));
});
test('detectWidth prefers --width, then COLUMNS', () => {
  assert.equal(detectWidth({ ...DEFAULTS, width: 150 }, {}), 150);
  assert.equal(detectWidth(DEFAULTS, { COLUMNS: '133' }), 133); // only meaningful when stdout/stderr are not TTYs, as under node --test
});
```

- [ ] **Step 2: Run `node --test test/layout.test.js`.** Expected: FAIL.

- [ ] **Step 3: Implement `ICONS`, `detectWidth`, `buildLines`.** `detectWidth` order: `opts.width > 0`; `process.stdout.columns`; `process.stderr.columns`; `env.COLUMNS`; the tty stream candidate from Task 1 unless the LEDGER entry says it was dropped (close the fd after reading). Each candidate in try/catch; first positive integer wins; else null.

- [ ] **Step 4: Run `node --test test/layout.test.js`.** Expected: PASS.

- [ ] **Step 5: Commit** `git add statusline.js test/layout.test.js && git commit -m "feat: adaptive two or three line layout with themes and icons"`

---

### Task 7: Entry point, end-to-end and timing

**Files:**
- Modify: `statusline.js`
- Test: `test/main.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `main(argv: string[], input: string) -> Promise<string[]>` (lines to print; the entry wrapper writes them joined by `\n` and exits 0). When run directly: `--refresh` runs `runRefresh(configDir())` and exits; otherwise read all stdin (skip when `process.stdin.isTTY`), call `main`, print.

`main` steps: strip BOM, parse JSON (non-object counts as null); with `--dump-input` write the raw input to `<configDir>/quota-line-last-input.json`; need API when `modelKey` is non-empty or a limit is missing from stdin; then `readCache`, and `spawnRefresh` when stale; `collect`; `buildLines(data, opts, detectWidth(opts), { depth: colorDepth(process.env), now: new Date() })`; when empty, return the single dim placeholder `quota: waiting for first response`. Any thrown error inside `main` also returns the placeholder.

- [ ] **Step 1: Write failing tests** (spawn `process.execPath` on `statusline.js` with `env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, NO_COLOR: '1' }`)

```js
const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input, env, encoding: 'utf8' });
test('renders full payload', () => {
  const r = run(['--model-key', '', '--width', '220'], full);
  assert.equal(r.status, 0); assert.equal(r.stdout.trim().split('\n').length, 2); assert.ok(r.stdout.includes('14%'));
});
test('garbage stdin prints placeholder', () => {
  for (const bad of ['not json', 'null', '']) {
    const r = run([], bad);
    assert.equal(r.status, 0); assert.ok(r.stdout.includes('quota: waiting for first response')); assert.equal(r.stderr, '');
  }
});
test('BOM on stdin is accepted', () => assert.ok(run(['--model-key', ''], '\uFEFF' + full).stdout.includes('14%')));
test('--dump-input writes payload', () => {
  run(['--dump-input', '--model-key', ''], full);
  assert.equal(fs.readFileSync(path.join(tmp, 'quota-line-last-input.json'), 'utf8'), full);
});
test('stale cache does not block render', () => {
  const t0 = Date.now(); const r = run([], full);
  assert.equal(r.status, 0); assert.ok(Date.now() - t0 < 2000);
});
test('warm render is fast', t => {
  const opts = parseArgs(['--model-key', '']); const p = JSON.parse(full);
  const t0 = process.hrtime.bigint();
  buildLines(collect(p, null, opts), opts, 200, { depth: 'truecolor', now: new Date() });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  t.diagnostic(`in-process render ${ms.toFixed(2)} ms`);
  assert.ok(ms < 50);
  const s0 = Date.now(); run(['--model-key', ''], full); t.diagnostic(`full process ${Date.now() - s0} ms`);
});
```

- [ ] **Step 2: Run `node --test test/main.test.js`.** Expected: FAIL.

- [ ] **Step 3: Implement `main` and the entry wrapper.**

- [ ] **Step 4: Run `node --test`.** Expected: all suites PASS.

- [ ] **Step 5: Manual check in a real session.** Ask the user before editing their live `settings.json`; back it up; point `statusLine.command` at `node "<repo>/statusline.js" --align right`; confirm both bar lines and the info segments render and resize correctly; restore. Record the outcome in LEDGER.md.

- [ ] **Step 6: Commit** `git add statusline.js test/main.test.js LEDGER.md && git commit -m "feat: statusline entry point with placeholder and dump input"`

---

### Task 8: Installer

**Files:**
- Create: `install.js`
- Test: `test/install.test.js`

**Interfaces:**
- Consumes: `DEFAULTS`, `configDir`, `readJson` from `statusline.js` (require it from the repo copy).
- Produces:
  - `checkNode(version: string) -> boolean` (major >= 18)
  - `parseInstallArgs(argv) -> { explicit: Partial<Options>, uninstall: boolean }` (same flags as `parseArgs`, only flags actually passed)
  - `parseLegacyCommand(cmd: string) -> Partial<Options>` (PowerShell `-Name value`, `-Name 'value'`, `-Name "value"`, bare switches; maps `-BarWidth -RefreshSeconds -ModelKey -ModelLabel -CtxLabel -FiveHourLabel -WeekLabel -Ascii -Align -Width`; `-Align` value lowercased)
  - `buildCommand(scriptPath: string, opts: Options) -> string` (`node "<path with forward slashes>"` then, in the flag order of `parseArgs`, every option that differs from `DEFAULTS`; string values in double quotes, numbers bare, booleans as bare switches)
  - `install(explicit, env = process.env, repoDir = __dirname) -> { settingsPath, command, previous: string|null, carried: object }`
  - `uninstall(env = process.env) -> void`
  - Final options: `{ ...DEFAULTS, align: 'right', ...carried, ...explicit }`

- [ ] **Step 1: Write failing tests** (temp `CLAUDE_CONFIG_DIR` per test)

```js
const LEGACY = "pwsh -NoProfile -NoLogo -ExecutionPolicy Bypass -File \"C:/Users/www83/.claude/quota-line/statusline.ps1\" -BarWidth 16 -RefreshSeconds 300 -ModelKey opus -ModelLabel 'Opus' -CtxLabel 'Context win' -FiveHourLabel '5H Limit' -WeekLabel 'Weekly' -Align Right -Width 160 -Ascii";
test('checkNode', () => { assert.equal(checkNode('17.9.0'), false); assert.equal(checkNode('18.0.0'), true); });
test('parseLegacyCommand', () => assert.deepEqual(parseLegacyCommand(LEGACY), {
  barWidth: 16, refreshSeconds: 300, modelKey: 'opus', modelLabel: 'Opus', ctxLabel: 'Context win',
  fiveHourLabel: '5H Limit', weekLabel: 'Weekly', align: 'right', width: 160, ascii: true }));
test('buildCommand quotes paths with spaces', () => assert.equal(
  buildCommand('C:\\Users\\First Last\\.claude\\quota-line\\statusline.js', { ...DEFAULTS, align: 'right', modelLabel: 'My Model' }),
  'node "C:/Users/First Last/.claude/quota-line/statusline.js" --model-label "My Model" --align right'));
test('install over legacy settings with BOM', () => {
  write('settings.json', '\uFEFF' + JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: LEGACY, padding: 0 } }));
  write('quota-line/statusline.ps1', 'x');
  const r = install({ barWidth: 12 }, env, repoDir);
  const s = readJson(path.join(tmp, 'settings.json'));
  assert.equal(s.theme, 'dark'); assert.equal(s.statusLine.padding, 0);
  assert.ok(s.statusLine.command.includes('--model-key opus') && s.statusLine.command.includes('--bar-width 12'));
  assert.ok(fs.existsSync(path.join(tmp, 'quota-line', 'statusline.js')));
  assert.ok(!fs.existsSync(path.join(tmp, 'quota-line', 'statusline.ps1')));
  assert.equal(fs.readdirSync(tmp).filter(f => f.startsWith('settings.json.bak-')).length, 1);
  assert.equal(r.previous, LEGACY);
});
test('invalid settings.json is left untouched', () => {
  write('settings.json', '{ broken');
  assert.throws(() => install({}, env, repoDir), /settings\.json/);
  assert.equal(fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8'), '{ broken');
});
test('install without settings.json creates it', () => {
  install({}, env, repoDir);
  assert.deepEqual(Object.keys(readJson(path.join(tmp, 'settings.json'))), ['statusLine']);
});
test('non-legacy statusLine is replaced and reported', () => {
  write('settings.json', JSON.stringify({ statusLine: { type: 'command', command: 'other-tool' } }));
  assert.equal(install({}, env, repoDir).previous, 'other-tool');
});
test('uninstall', () => {
  write('settings.json', JSON.stringify({ theme: 'dark' })); install({}, env, repoDir);
  write('quota-line-cache.json', '{}'); uninstall(env);
  assert.deepEqual(readJson(path.join(tmp, 'settings.json')), { theme: 'dark' });
  assert.ok(!fs.existsSync(path.join(tmp, 'quota-line')) && !fs.existsSync(path.join(tmp, 'quota-line-cache.json')));
});
```

- [ ] **Step 2: Run `node --test test/install.test.js`.** Expected: FAIL.

- [ ] **Step 3: Implement `install.js`.** Parse `settings.json` before writing anything; on failure throw `Error('settings.json is not valid JSON: <path>')`. Backup name `settings.json.bak-YYYYMMDD-HHmmss`, a byte copy. Write `JSON.stringify(cfg, null, 2) + '\n'`. Carry legacy flags only when the old command contains `statusline.ps1`. CLI entry prints the resolved config dir, the previous command when replaced, and the final command; exits 1 with a clear message when `checkNode(process.versions.node)` is false.

- [ ] **Step 4: Run `node --test`.** Expected: all suites PASS.

- [ ] **Step 5: Commit** `git add install.js test/install.test.js && git commit -m "feat: cross-platform installer with legacy flag carry-over"`

---

### Task 9: Legacy move, docs, CI

**Files:**
- Move: `statusline.ps1`, `install.ps1`, `test.ps1` to `legacy/powershell/` (`git mv`, contents unchanged)
- Modify: `quota.json`, `README.md`
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: `git mv` the three PowerShell files into `legacy/powershell/`.** Verify `pwsh legacy/powershell/test.ps1 -NoApi` still renders (its paths are relative to `$PSScriptRoot`).

- [ ] **Step 2: Replace `quota.json`** with the `statusLine` block `install.js` writes by default, using the placeholder path `C:/Users/<you>/.claude/quota-line/statusline.js`.

- [ ] **Step 3: Create `.github/workflows/test.yml`**: on `push` and `pull_request`; matrix `os: [ubuntu-latest, windows-latest, macos-latest]`, `node: [18, 'lts/*']`, `fail-fast: false`; steps `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: ${{ matrix.node }}`, `node --test`.

- [ ] **Step 4: Rewrite `README.md`**, English section then full Hebrew section. Covers: what it shows (sample from the spec's Layout section), requirements (Node 18+, Claude Code 2.1.6+, Pro or Max), install with `git clone` and `node install.js`, every flag, themes and icon modes, adaptive 2 or 3 lines, session cost is an estimate on subscriptions, macOS Keychain prompt on first refresh, `CLAUDE_CONFIG_DIR`, `--dump-input`, `npm test`, and that the PowerShell version stays in `legacy/powershell/` without further updates. No mention of LEDGER.md, CLAUDE.md, docs/superpowers, or AI.

- [ ] **Step 5: Run `node --test`.** Expected: PASS. Run `node install.js --help` style smoke: `node -e "require('./install.js')"` exits 0 without side effects.

- [ ] **Step 6: Commit** `git add -A legacy quota.json README.md .github && git commit -m "docs: Node README, CI on three platforms, move PowerShell to legacy"`

- [ ] **Step 7: Push only when the user says so.** After the first push, confirm the Actions run is green on all six matrix cells.
