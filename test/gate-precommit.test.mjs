import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
  assert.equal(r.stderr, `error: The binding at ${join(root, '.research-vault.json')} names a vault outside its repository that is not one of your own. Run research-vault trust in that project to approve the binding. Set RESEARCH_VAULT_PATH to that folder or pass --vault to the command.\n`);
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

const CLI = join(plugin, 'bin/research-vault.mjs');

// The baseline committed, then a binding to an empty vault inside the repository; `record` passes a file's working copy.
function bound(t, binding = { vault: 'research', gates: { globs: ['*.md'] } }) {
  const ctx = repo(t);
  ctx.git('commit', '-qm', 'Baseline');
  mkdirSync(join(ctx.root, 'research'));
  writeFileSync(join(ctx.root, '.research-vault.json'), JSON.stringify(binding));
  const record = (file) => {
    const r = ctx.run(process.execPath, [CLI, 'gate', 'record', file, 'PASS']);
    assert.equal(r.status, 0, r.stderr);
  };
  return { ...ctx, record, draft: join(ctx.root, 'draft.md') };
}

test('gate staged refuses an unreviewed staged edit while the working copy holds the passed bytes, and the hook commits nothing', posix, (t) => {
  const { draft, run, git, hook, cli, record } = bound(t);
  writeFileSync(draft, 'Reviewed draft.\n');
  record('draft.md');
  writeFileSync(draft, 'Unreviewed edit.\n');
  git('add', 'draft.md');
  writeFileSync(draft, 'Reviewed draft.\n');
  const r = cli('--check');
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, 'draft.md: none\n');
  const head = git('rev-parse', 'HEAD');
  hook();
  const c = run('git', ['commit', '-qm', 'Must be refused']);
  assert.equal(c.status, 1, c.stderr);
  assert.equal(git('rev-parse', 'HEAD'), head);
});

test('gate staged passes reviewed staged bytes while the working copy has moved on, and the hook commits those bytes', posix, (t) => {
  const { draft, run, git, hook, cli, record } = bound(t);
  writeFileSync(draft, 'Reviewed draft.\n');
  record('draft.md');
  git('add', 'draft.md');
  writeFileSync(draft, 'Reviewed draft, edited further.\n');
  const r = cli('--check');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'draft.md: PASS\n');
  hook();
  const c = run('git', ['commit', '-qm', 'Reviewed']);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(git('show', 'HEAD:draft.md'), 'Reviewed draft.\n');
});

test('gate staged hashes the staged blob as bytes, not as decoded text', (t) => {
  const { draft, git, cli, record } = bound(t);
  writeFileSync(draft, Buffer.from([...Buffer.from('Reviewed '), 0xff, ...Buffer.from(' draft.\n')]));
  record('draft.md');
  git('add', 'draft.md');
  writeFileSync(draft, 'Edited.\n');
  const r = cli('--check');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'draft.md: PASS\n');
});

test('gate staged applies the per-unit rule to the staged bytes', (t) => {
  const { draft, git, cli, record } = bound(t);
  writeFileSync(draft, '# A\n\nOne.\n\n# B\n\nTwo.\n');
  record('draft.md');
  writeFileSync(draft, '# A\n\nOne, unreviewed.\n\n# B\n\nTwo.\n');
  git('add', 'draft.md');
  const r = cli('--check');
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, 'draft.md: none\n');
  // The index holds both passed sections in another order; the working copy keeps the unreviewed edit.
  writeFileSync(draft, '# B\n\nTwo.\n\n# A\n\nOne.\n');
  git('add', 'draft.md');
  writeFileSync(draft, '# A\n\nOne, unreviewed.\n\n# B\n\nTwo.\n');
  const ok = cli('--check');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, 'draft.md: PASS (by unit)\n');
});

// A bound folder outside any repository (the ceiling keeps git from finding one above it), and a repository whose index is not an index.
test('gate staged exits 2 with one line naming the failed git command when git cannot be inspected, and never prints none', (t) => {
  const plain = realpathSync(tmpVault('rv-norepo-'));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  mkdirSync(join(plain, 'research'));
  writeFileSync(join(plain, '.research-vault.json'), JSON.stringify({ vault: 'research', gates: { globs: ['*.md'] } }));
  writeFileSync(join(plain, 'draft.md'), 'Draft.\n');
  const { root, git } = bound(t);
  writeFileSync(join(root, '.git', 'index'), 'not an index');
  const head = git('rev-parse', 'HEAD');
  for (const [cwd, line] of [[plain, /^error: git rev-parse --show-toplevel failed in .+: fatal: not a git repository/], [root, /^error: git diff --cached --name-only --diff-filter=ACMRT --ignore-submodules=all -z failed in .+: fatal: /]]) {
    const index = existsSync(join(cwd, '.git')) && readFileSync(join(cwd, '.git', 'index'));
    const r = spawnSync(process.execPath, [CLI, 'gate', 'staged', '--check'], { cwd, env: testEnv({ GIT_CEILING_DIRECTORIES: dirname(cwd) }), encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, line);
    assert.equal(r.stderr.split('\n').length, 2, r.stderr);
    assert.deepEqual(existsSync(join(cwd, '.git')) && readFileSync(join(cwd, '.git', 'index')), index, cwd);
  }
  assert.equal(git('rev-parse', 'HEAD'), head);
});

test('gate staged outside any repository with no binding reports nothing gated', (t) => {
  const plain = realpathSync(tmpVault('rv-norepo-'));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [CLI, 'gate', 'staged', '--check'], { cwd: plain, env: testEnv({ GIT_CEILING_DIRECTORIES: dirname(plain) }), encoding: 'utf8', timeout: 20_000 });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, unbound, '']);
});

// A smudge filter that fails: the staged blob cannot be read as a checkout would write it.
test('gate staged exits 2 when a staged blob cannot be read', (t) => {
  const { root, draft, git, cli } = bound(t);
  git('config', 'filter.broken.clean', 'cat');
  git('config', 'filter.broken.smudge', 'false');
  git('config', 'filter.broken.required', 'true');
  writeFileSync(join(root, '.gitattributes'), 'draft.md filter=broken\n');
  writeFileSync(draft, 'Changed draft.\n');
  git('add', 'draft.md');
  rmSync(draft);
  const index = git('ls-files', '-s'), head = git('rev-parse', 'HEAD');
  const r = cli('--check');
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^error: git cat-file --filters :0:draft\.md failed in .+: fatal: draft\.md: smudge filter broken failed\n$/);
  assert.deepEqual([git('ls-files', '-s'), git('rev-parse', 'HEAD')], [index, head]);
});

test('gate staged passes over an untracked page whose image is staged: nothing of the page is committed', (t) => {
  const { root, git, cli } = bound(t, { vault: 'research' });
  for (const dir of ['lessons', 'assets']) mkdirSync(join(root, 'ws', dir), { recursive: true });
  writeFileSync(join(root, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(root, 'ws', 'lessons', '0001-x.html'), '<section data-block="fact"><p>one</p><figure><img src="../assets/shot.png" alt="a"><figcaption>c</figcaption></figure></section>\n');
  writeFileSync(join(root, 'ws', 'assets', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
  git('add', 'ws/assets/shot.png');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'staged gated files: none\n', '']);
});

test('gate staged refuses a page while an image it reads from outside the repository exists', (t) => {
  // The page sits at the top of a repository nested in another folder, with no MISSION.md: its image resolves above the repository.
  const outer = realpathSync(tmpVault('rv-outer-'));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  const root = join(outer, 'repo');
  mkdirSync(join(root, 'research'), { recursive: true });
  mkdirSync(join(outer, 'assets'));
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, env: testEnv(), encoding: 'utf8', timeout: 20_000 });
  assert.equal(run('git', ['init', '-q']).status, 0);
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'research', gates: { globs: ['p.html'] } }));
  writeFileSync(join(root, 'p.html'), '<section data-block="fact"><p>one</p><figure><img src="../assets/s.png" alt="a"><figcaption>c</figcaption></figure></section>\n');
  writeFileSync(join(outer, 'assets', 's.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
  assert.equal(run(process.execPath, [CLI, 'gate', 'record', 'p.html', 'PASS']).status, 0);
  assert.equal(run('git', ['add', 'p.html']).status, 0);
  const r = run(process.execPath, [CLI, 'gate', 'staged', '--check']);
  assert.deepEqual([r.status, r.stdout], [1, 'p.html: none (../assets/s.png: staged and working copies differ)\n'], r.stderr);
});

// The commit is refused, HEAD and the index stay where they were.
function refusedCommit({ run, git, hook }) {
  const head = git('rev-parse', 'HEAD'), index = git('write-tree');
  hook();
  const c = run('git', ['commit', '-qm', 'Must be refused']);
  assert.equal(c.status, 1, c.stderr);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('write-tree'), index);
}

test('gate staged judges a staged gates.globs file deleted from the working tree, and the hook commits nothing', posix, (t) => {
  const ctx = bound(t);
  writeFileSync(ctx.draft, 'Reviewed draft.\n');
  ctx.record('draft.md');
  writeFileSync(ctx.draft, 'Unreviewed edit.\n');
  ctx.git('add', 'draft.md');
  rmSync(ctx.draft);
  const r = ctx.cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'draft.md: none\n'], r.stderr);
  refusedCommit(ctx);
});

test('gate staged judges a staged workspace lesson deleted from the working tree, and the hook commits nothing', posix, (t) => {
  const ctx = bound(t, { vault: 'research' });
  const page = 'ws/lessons/0001-x.html';
  mkdirSync(join(ctx.root, 'ws', 'lessons'), { recursive: true });
  writeFileSync(join(ctx.root, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(ctx.root, page), '<section data-block="fact"><p>one</p></section>\n');
  ctx.record(page);
  writeFileSync(join(ctx.root, page), '<section data-block="fact"><p>one, unreviewed</p></section>\n');
  ctx.git('add', 'ws');
  rmSync(join(ctx.root, page));
  const r = ctx.cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, `${page}: none\n`], r.stderr);
  refusedCommit(ctx);
});

test('gate staged gates a code.globs file by the attached link in its staged content, not its working copy', (t) => {
  const { root, git, cli } = bound(t, { vault: 'research', code: { globs: ['src/*.js'] } });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), '// 2026-01-01-fx-doc\nexport function f() {}\n');
  git('add', 'src/a.js');
  writeFileSync(join(root, 'src', 'a.js'), 'export function f() {}\n');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'src/a.js: none\n'], r.stderr);
});

const PNG = (n) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n]);
const FIGURE = '<section data-block="fact"><p>one</p><figure><img src="../assets/shot.png" alt="a"><figcaption>c</figcaption></figure></section>\n';

// A passed lesson with its image committed, then a new image staged.
function lessonWithImage(t) {
  const ctx = bound(t, { vault: 'research' });
  const page = 'ws/lessons/0001-x.html';
  for (const dir of ['lessons', 'assets']) mkdirSync(join(ctx.root, 'ws', dir), { recursive: true });
  writeFileSync(join(ctx.root, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(ctx.root, page), FIGURE);
  writeFileSync(join(ctx.root, 'ws', 'assets', 'shot.png'), PNG(1));
  ctx.record(page);
  ctx.git('add', 'ws');
  ctx.git('commit', '-qm', 'Reviewed lesson');
  writeFileSync(join(ctx.root, 'ws', 'assets', 'shot.png'), PNG(2));
  ctx.git('add', 'ws/assets/shot.png');
  return { ...ctx, page };
}

test('gate staged selects a page by the staged image its index version references when its working copy no longer does', (t) => {
  const { root, cli, page } = lessonWithImage(t);
  writeFileSync(join(root, page), '<section data-block="fact"><p>one</p></section>\n');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, `${page}: none\n`], r.stderr);
});

test('gate staged selects a page deleted from the working tree but not from the index by the staged image it references', (t) => {
  const { root, cli, page } = lessonWithImage(t);
  rmSync(join(root, page));
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, `${page}: none\n`], r.stderr);
});

test('gate staged does not gate a staged file under a folder the disk expansion skips', (t) => {
  const { root, git, cli } = bound(t, { vault: 'research', gates: { globs: ['**/*.md'] } });
  for (const f of ['node_modules/x.md', 'docs/_index/y.md', 'docs/z.md']) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), 'Unreviewed.\n');
    git('add', '-f', f);
  }
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'docs/z.md: none\n'], r.stderr);
});

test('gate staged matches a gates glob written with a leading ./ or as an absolute path as the disk expansion does', (t) => {
  const { root, git, cli } = bound(t, { vault: 'research' });
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'research', gates: { globs: ['./docs/*.md', join(root, 'notes', '*.md')] } }));
  for (const f of ['docs/a.md', 'notes/b.md']) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), 'Unreviewed.\n');
    git('add', f);
    rmSync(join(root, f));
  }
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'docs/a.md: none\nnotes/b.md: none\n'], r.stderr);
});

test('gate staged does not gate a staged submodule whose path matches a gates glob', (t) => {
  const { root, git, cli } = bound(t, { vault: 'research', gates: { globs: ['docs/*'] } });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'a.md'), 'Unreviewed.\n');
  git('add', 'docs/a.md');
  git('update-index', '--add', '--cacheinfo', `160000,${git('rev-parse', 'HEAD').trim()},docs/sub`);
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'docs/a.md: none\n'], r.stderr);
});

// Under each rule the index blob as a checkout writes it differs from the bytes gate record hashed from disk.
test('gate staged passes a file recorded from disk and staged unchanged under a line-ending or ident rule, and the hook commits it', posix, (t) => {
  const cases = [
    ['core.autocrlf=true with an LF file', (ctx) => ctx.git('config', 'core.autocrlf', 'true'), 'Reviewed draft.\n'],
    ['* text=auto with a CRLF file', (ctx) => writeFileSync(join(ctx.root, '.gitattributes'), '* text=auto\n'), 'Reviewed draft.\r\n'],
    ['ident', (ctx) => writeFileSync(join(ctx.root, '.gitattributes'), 'draft.md ident\n'), '$Id$ Reviewed draft.\n'],
  ];
  for (const [name, rule, bytes] of cases) {
    const ctx = bound(t);
    rule(ctx);
    writeFileSync(ctx.draft, bytes);
    ctx.record('draft.md');
    ctx.git('add', 'draft.md');
    const r = ctx.cli('--check');
    assert.deepEqual([r.status, r.stdout], [0, 'draft.md: PASS\n'], `${name}: ${r.stderr}`);
    ctx.hook();
    const c = ctx.run('git', ['commit', '-qm', 'Reviewed']);
    assert.equal(c.status, 0, `${name}: ${c.stdout}${c.stderr}`);
  }
});

test('gate staged selects a page by a staged image deleted from the working tree', (t) => {
  const { root, cli, page } = lessonWithImage(t);
  rmSync(join(root, 'ws', 'assets', 'shot.png'));
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, `${page}: none (ws/assets/shot.png: staged and working copies differ)\n`], r.stderr);
});

test('gate staged judges a gated symbolic link replaced by a regular file and staged', { skip: process.platform === 'win32' ? 'needs a symbolic link' : false }, (t) => {
  const { root, git, cli } = bound(t);
  symlinkSync('draft.md', join(root, 'link.md'));
  git('add', 'link.md');
  git('commit', '-qm', 'Link');
  rmSync(join(root, 'link.md'));
  writeFileSync(join(root, 'link.md'), 'Unreviewed.\n');
  git('add', 'link.md');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'link.md: none\n'], r.stderr);
});

// The disk expansion gates regular files only, so a link to a folder is not gated.
test('gate staged passes over a staged symbolic link to a folder whose name a gates glob matches, and the hook commits it', posix, (t) => {
  const ctx = bound(t);
  mkdirSync(join(ctx.root, 'target'));
  symlinkSync('target', join(ctx.root, 'notes.md'));
  ctx.git('add', 'notes.md');
  const r = ctx.cli('--check');
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'staged gated files: none\n', '']);
  const head = ctx.git('rev-parse', 'HEAD');
  ctx.hook();
  const c = ctx.run('git', ['commit', '-qm', 'Link']);
  assert.equal(c.status, 0, `${c.stdout}${c.stderr}`);
  assert.notEqual(ctx.git('rev-parse', 'HEAD'), head);
});

test('gate staged gates a staged file by a gates glob that leaves the root and comes back, as the disk expansion does', (t) => {
  const { root, git, cli } = bound(t, { vault: 'research' });
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'research', gates: { globs: [`../${basename(root)}/docs/*.md`] } }));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'a.md'), 'Unreviewed.\n');
  git('add', 'docs/a.md');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'docs/a.md: none\n'], r.stderr);
});

test('gate staged does not judge a changed HTML file no gate covers, though it references a staged image', (t) => {
  const { root, git, cli } = bound(t, { vault: 'research' });
  // No MISSION.md: the page's image resolves under its grandparent, x/.
  for (const dir of ['lessons', 'assets']) mkdirSync(join(root, 'x', dir), { recursive: true });
  writeFileSync(join(root, 'x', 'lessons', 'p.html'), FIGURE);
  writeFileSync(join(root, 'x', 'assets', 'shot.png'), PNG(1));
  git('add', 'x');
  git('commit', '-qm', 'Ungated page');
  writeFileSync(join(root, 'x', 'lessons', 'p.html'), `${FIGURE}<p>changed</p>\n`);
  writeFileSync(join(root, 'x', 'assets', 'shot.png'), PNG(2));
  git('add', 'x/assets/shot.png');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'staged gated files: none\n', '']);
});

test('gate staged counts the cited ids this vault does not hold in the staged content, not the working copy', (t) => {
  const { draft, git, cli } = bound(t);
  writeFileSync(draft, '# A\n\n<!-- evidence: 2026-09-09-not-here -->\n\nA claim.\n');
  git('add', 'draft.md');
  writeFileSync(draft, '# A\n\nA claim.\n');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, 'draft.md: none (1 cited id not in this vault)\n'], r.stderr);
});

test('gate staged takes the images of a staged page from its staged content, not its working copy', (t) => {
  const { root, git, cli, record } = bound(t, { vault: 'research' });
  const page = 'ws/lessons/0001-x.html';
  for (const dir of ['lessons', 'assets']) mkdirSync(join(root, 'ws', dir), { recursive: true });
  writeFileSync(join(root, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(root, page), FIGURE);
  writeFileSync(join(root, 'ws', 'assets', 'shot.png'), PNG(1));
  record(page);
  git('add', page);
  writeFileSync(join(root, page), '<section data-block="fact"><p>one</p></section>\n');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, `${page}: none (ws/assets/shot.png: staged and working copies differ)\n`], r.stderr);
});

const LESSON = 'ws/lessons/0001-x.html';
const DEPS = {
  'ws/assets/shot.png': [PNG(1), PNG(2)],
  'ws/assets/a.js': ['one();\n', 'two();\n'],
  'ws/evidence/0001/requirements.json': ['{"a":1}\n', '{"a":2}\n'],
};
const differ = (dep) => `${LESSON}: none (${dep}: staged and working copies differ)\n`;

// A passed lesson that reads an image, a script and a requirements file, all staged.
function lessonWithDeps(t) {
  const ctx = bound(t, { vault: 'research' });
  for (const dir of ['lessons', 'assets', 'evidence/0001']) mkdirSync(join(ctx.root, 'ws', dir), { recursive: true });
  writeFileSync(join(ctx.root, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(ctx.root, LESSON), '<section data-block="mission"><p>m</p></section>\n<section data-block="fact"><p>one</p><figure><img src="../assets/shot.png" alt="a"><figcaption>c</figcaption></figure></section>\n<section data-block="step"><p>s</p></section>\n<script src="../assets/a.js"></script>\n');
  for (const [dep, [reviewed]] of Object.entries(DEPS)) writeFileSync(join(ctx.root, dep), reviewed);
  ctx.record(LESSON);
  ctx.git('add', 'ws');
  return ctx;
}

for (const [dep, kind] of [['ws/assets/shot.png', 'image'], ['ws/assets/a.js', 'script'], ['ws/evidence/0001/requirements.json', 'requirements file']]) {
  test(`gate staged refuses a lesson while an unreviewed copy of its ${kind} is staged and the working tree holds the reviewed one`, (t) => {
    const { root, git, cli } = lessonWithDeps(t);
    const [reviewed, edited] = DEPS[dep];
    writeFileSync(join(root, dep), edited);
    git('add', dep);
    writeFileSync(join(root, dep), reviewed);
    const r = cli('--check');
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, differ(dep), dep);
  });
}

test('gate staged refuses a lesson while the working copy of its reviewed staged image has moved on, and passes it once the change is staged and passed', (t) => {
  const { root, git, cli, record } = lessonWithDeps(t);
  const png = 'ws/assets/shot.png';
  writeFileSync(join(root, png), DEPS[png][1]);
  const moved = cli('--check');
  assert.deepEqual([moved.status, moved.stdout], [1, differ(png)]);
  git('add', png);
  record(LESSON);
  const ok = cli('--check');
  assert.deepEqual([ok.status, ok.stdout], [0, `${LESSON}: PASS\n`], ok.stderr);
});

test('gate staged refuses a lesson while its image is untracked: the index has none and the working tree has the passed one', (t) => {
  const { git, cli } = lessonWithDeps(t);
  git('rm', '-q', '--cached', 'ws/assets/shot.png');
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, differ('ws/assets/shot.png')]);
});

test('gate staged selects a lesson by a staged requirements file deleted from the working tree', (t) => {
  const { root, git, cli } = lessonWithDeps(t);
  const req = 'ws/evidence/0001/requirements.json';
  git('commit', '-qm', 'Reviewed lesson');
  writeFileSync(join(root, req), DEPS[req][1]);
  git('add', req);
  rmSync(join(root, req));
  const r = cli('--check');
  assert.deepEqual([r.status, r.stdout], [1, differ(req)], r.stderr);
});
