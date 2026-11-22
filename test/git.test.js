const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitBranch } = require('../statusline.js');

const roots = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qlgit-'));
  roots.push(d);
  return d;
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
test.after(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
});

test('branch from nested dir', () => {
  const repo = tmp();
  write(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
  fs.mkdirSync(path.join(repo, 'a', 'b'), { recursive: true });
  assert.equal(gitBranch(path.join(repo, 'a', 'b')), 'feature/x');
});

test('CRLF and surrounding whitespace are trimmed', () => {
  const repo = tmp();
  write(path.join(repo, '.git', 'HEAD'), '  ref: refs/heads/main \r\n');
  assert.equal(gitBranch(repo), 'main');
});

test('detached HEAD gives short hash', () => {
  const repo = tmp();
  write(path.join(repo, '.git', 'HEAD'), 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n');
  assert.equal(gitBranch(repo), 'a1b2c3d');
});

test('.git file with relative gitdir (worktree)', () => {
  const root = tmp();
  const real = path.join(root, 'real');
  write(path.join(real, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/wt-branch\n');
  const wt = path.join(root, 'wt');
  write(path.join(wt, '.git'), 'gitdir: ../real/.git/worktrees/wt\n');
  fs.mkdirSync(path.join(wt, 'sub'), { recursive: true });
  assert.equal(gitBranch(wt), 'wt-branch');
  assert.equal(gitBranch(path.join(wt, 'sub')), 'wt-branch');
});

test('.git file with absolute gitdir', () => {
  const root = tmp();
  const gd = path.join(root, 'real', '.git', 'worktrees', 'wt');
  write(path.join(gd, 'HEAD'), 'ref: refs/heads/abs-branch\r\n');
  const wt = path.join(root, 'wt');
  write(path.join(wt, '.git'), `gitdir: ${gd}\r\n`);
  assert.equal(gitBranch(wt), 'abs-branch');
});

test('no repo returns null', () => {
  assert.equal(gitBranch(tmp()), null);
});

test('missing dir returns null', () => {
  assert.equal(gitBranch(path.join(tmp(), 'nope')), null);
});

test('non-string and empty input returns null', () => {
  assert.equal(gitBranch(''), null);
  assert.equal(gitBranch(undefined), null);
});
