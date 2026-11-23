import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { testEnv, tmpVault } from './helpers.mjs';

const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
const unbound = 'staged gated files: none (no .research-vault.json binding here, so nothing is gated)\n';
const posix = { skip: process.platform === 'win32' ? 'pre-commit requires a POSIX shell' : false };

function repo(t) {
  const root = realpathSync(tmpVault('rv-precommit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, env: testEnv(), encoding: 'utf8', timeout: 20_000 });
  const git = (...args) => {
    const r = run('git', args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  git('init', '-q');
  git('config', 'user.name', 'Gate test');
  git('config', 'user.email', 'gate@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  // Git invokes the real hook in root; its own path resolves the plugin's bin directory.
  const hook = () => git('config', 'core.hooksPath', join(plugin, '.githooks'));
  const cli = (...args) => run(process.execPath, [join(plugin, 'bin/research-vault.mjs'), 'gate', 'staged', ...args]);
  writeFileSync(join(root, 'draft.md'), 'Draft without a verdict.\n');
  git('add', 'draft.md');
  return { root, run, git, hook, cli };
}

function snapshot(root) {
  return readdirSync(root, { recursive: true }).filter(p => p !== '.git' && !p.startsWith('.git/'))
    .sort().map(p => [p, lstatSync(join(root, p)).isSymbolicLink() ? readlinkSync(join(root, p)) : readFileSync(join(root, p))]);
}

test('gate staged with no binding reports nothing gated, with or without --check', (t) => {
  const { cli } = repo(t);
  const results = [['--check'], []].map(args => cli(...args));
  for (const r of results) {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, unbound);
    assert.equal(r.stderr, '');
  }
});

test('gate staged refuses invalid JSON without changing files or the index', (t) => {
  const { root, cli, git } = repo(t);
  writeFileSync(join(root, '.research-vault.json'), '{');
  const before = snapshot(root), index = git('write-tree');
  const r = cli('--check');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, "error: invalid .research-vault.json: Expected property name or '}' in JSON at position 1 (line 1 column 2)\n");
  assert.deepEqual(snapshot(root), before);
  assert.equal(git('write-tree'), index);
});

test('pre-commit permits a commit with no binding', posix, (t) => {
  const { git, hook } = repo(t);
  hook();
  git('commit', '-qm', 'Unbound draft');
  assert.equal(git('log', '-1', '--format=%s').trim(), 'Unbound draft');
  assert.equal(git('show', 'HEAD:draft.md'), 'Draft without a verdict.\n');
});

test('gate staged refuses a binding entry that cannot be followed without writing or committing', (t) => {
  const { root, cli, git } = repo(t);
  git('commit', '-qm', 'Baseline');
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'draft.md'), 'Changed draft without a verdict.\n');
  git('add', 'draft.md');
  const outside = tmpVault('rv-broken-binding-');
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'sentinel'), 'Outside bytes.\n');
  const binding = join(root, '.research-vault.json');
  for (const target of [join(outside, 'missing.json'), binding]) {
    try { symlinkSync(target, binding); } catch (err) {
      if (process.platform !== 'win32') throw err;
      t.skip(`cannot create binding symlink on Windows: ${err.message}`);
      return;
    }
    const before = snapshot(root), outsideBefore = snapshot(outside), index = git('write-tree');
    const r = cli('--check');
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `gate: ${binding}: binding exists but cannot be read\n`);
    assert.deepEqual(snapshot(root), before);
    assert.deepEqual(snapshot(outside), outsideBefore);
    assert.equal(git('write-tree'), index);
    assert.equal(git('rev-parse', 'HEAD'), head);
    rmSync(binding);
  }
});

test('pre-commit refuses invalid binding JSON without moving HEAD', posix, (t) => {
  const { root, run, git, hook } = repo(t);
  git('commit', '-qm', 'Baseline');
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(root, '.research-vault.json'), '{');
  writeFileSync(join(root, 'draft.md'), 'Changed draft without a verdict.\n');
  git('add', 'draft.md');
  hook();
  const before = snapshot(root), index = git('write-tree');
  const r = run('git', ['commit', '-qm', 'Must be refused']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /^error: invalid \.research-vault\.json:/m);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('write-tree'), index);
  assert.deepEqual(snapshot(root), before);
});

test('pre-commit refuses an unreviewed gated file without creating a commit', posix, (t) => {
  const { root, run, git, hook } = repo(t);
  git('commit', '-qm', 'Baseline');
  const head = git('rev-parse', 'HEAD');
  mkdirSync(join(root, 'research'));
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'research', gates: { globs: ['*.md'] } }));
  writeFileSync(join(root, 'draft.md'), 'Changed draft without a verdict.\n');
  git('add', 'draft.md');
  const index = git('write-tree');
  hook();
  const r = run('git', ['commit', '-qm', 'Must be refused']);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout + r.stderr, /^draft\.md: none$/m);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('write-tree'), index);
  assert.equal(readFileSync(join(root, 'draft.md'), 'utf8'), 'Changed draft without a verdict.\n');
  assert.equal(existsSync(join(root, '.research-vault-ledger.jsonl')), false);
});

test('gate staged refuses an unapproved outside vault without changing it', (t) => {
  const { root, cli } = repo(t);
  const outside = tmpVault('rv-refused-vault-');
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'sentinel'), 'Outside bytes.\n');
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: outside }));
  const before = snapshot(outside);
  const r = cli('--check');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `error: The binding at ${join(root, '.research-vault.json')} names a vault outside its repository that is not one of your own. Set RESEARCH_VAULT_PATH to that folder or pass --vault to the command.\n`);
  assert.deepEqual(snapshot(outside), before);
});

test('gate staged refuses an unreadable binding without changing files', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'requires POSIX file permissions and a non-root user' : false }, (t) => {
  const { root, cli } = repo(t);
  const binding = join(root, '.research-vault.json');
  writeFileSync(binding, '{}');
  const before = snapshot(root);
  chmodSync(binding, 0);
  try {
    const r = cli('--check');
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `error: EACCES: permission denied, open '${binding}'\n`);
  } finally {
    chmodSync(binding, 0o600);
  }
  assert.deepEqual(snapshot(root), before);
});
