import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitInvocation, GIT_TIMEOUT_MS, runGit } from '../bin/lib/git.mjs';
import { cleanInGit } from '../hooks/stop-gate.mjs';
import { testEnv, tmpVault } from './helpers.mjs';

const wrapperPath = fileURLToPath(new URL('../bin/lib/git.mjs', import.meta.url));
const gitVersion = execFileSync('git', ['--version'], { env: testEnv(), encoding: 'utf8', timeout: GIT_TIMEOUT_MS })
  .match(/^git version (\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);

function gitOlderThan(major, minor, patch = 0) {
  const [installedMajor, installedMinor, installedPatch] = gitVersion;
  if (installedMajor !== major) return installedMajor < major;
  if (installedMinor !== minor) return installedMinor < minor;
  return installedPatch < patch;
}

function setEnv(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
}

beforeEach((t) => {
  const { GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM } = testEnv();
  setEnv(t, { GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM });
});

function tempDirectory(t) {
  const dir = tmpVault('rv git-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixtureGit(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { env: testEnv(), encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
}

function commitDraft(cwd, ...options) {
  fixtureGit(cwd, ...options, 'add', '--', 'draft.md');
  fixtureGit(cwd, ...options, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
}

test('text files check out with LF even with core.autocrlf enabled', (t) => {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--template=');
  fixtureGit(cwd, 'config', 'core.autocrlf', 'true');
  copyFileSync(new URL('../.gitattributes', import.meta.url), join(cwd, '.gitattributes'));
  const names = ['page.html', 'style.css', 'run.sh', 'browser.js', 'session.cast', 'future.ts', 'LICENSE'];
  const expected = Buffer.from('first line\nsecond line\n');
  for (const name of names) writeFileSync(join(cwd, name), expected);
  fixtureGit(cwd, 'add', '.');
  fixtureGit(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
  for (const name of names) rmSync(join(cwd, name));
  fixtureGit(cwd, 'checkout', '--', '.');
  for (const name of names) assert.deepEqual(readFileSync(join(cwd, name)), expected, name);
});

test('encoding gate reports a CR byte in any tracked text file without changing files', (t) => {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--template=');
  fixtureGit(cwd, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(cwd, 'scripts'));
  mkdirSync(join(cwd, 'bin/lib'), { recursive: true });
  copyFileSync(new URL('../scripts/check-encoding.mjs', import.meta.url), join(cwd, 'scripts/check-encoding.mjs'));
  copyFileSync(new URL('../bin/lib/git.mjs', import.meta.url), join(cwd, 'bin/lib/git.mjs'));
  const file = join(cwd, 'page.html');
  const markdown = join(cwd, 'lonecr.md');
  const clean = Buffer.from('<p>clean</p>\n');
  writeFileSync(file, clean);
  writeFileSync(markdown, 'a clean line\n');
  writeFileSync(join(cwd, '.gitattributes'), '* text=auto eol=lf\n');
  fixtureGit(cwd, 'add', '.');
  const run = () => spawnSync(process.execPath, ['scripts/check-encoding.mjs'], {
    cwd, env: testEnv(), encoding: 'utf8', timeout: GIT_TIMEOUT_MS,
  });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, 'encoding ok\n');
  const dirty = Buffer.from('<p>dirty</p>\r\n');
  writeFileSync(file, dirty);
  writeFileSync(markdown, 'a line\rwith a lone CR\n');
  const names = fixtureGit(cwd, 'ls-files', '--cached', '--others', '--exclude-standard');
  const before = names.trimEnd().split('\n').map((name) => readFileSync(join(cwd, name)));
  const bad = run();
  assert.equal(bad.status, 1, bad.stderr);
  assert.equal(bad.stderr, 'CRLF: lonecr.md\nCRLF: page.html\nencoding gate: 2 issue(s)\n');
  assert.equal(fixtureGit(cwd, 'ls-files', '--cached', '--others', '--exclude-standard'), names);
  assert.deepEqual(names.trimEnd().split('\n').map((name) => readFileSync(join(cwd, name))), before);
});

test('encoding gate skips tracked binary files containing CR bytes', (t) => {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--template=');
  fixtureGit(cwd, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(cwd, 'scripts'));
  mkdirSync(join(cwd, 'bin/lib'), { recursive: true });
  copyFileSync(new URL('../scripts/check-encoding.mjs', import.meta.url), join(cwd, 'scripts/check-encoding.mjs'));
  copyFileSync(new URL('../bin/lib/git.mjs', import.meta.url), join(cwd, 'bin/lib/git.mjs'));
  writeFileSync(join(cwd, '.gitattributes'), '* text=auto eol=lf\nexplicit.md -text\n');
  writeFileSync(join(cwd, 'explicit.md'), 'a line\rwith a lone CR\n');
  writeFileSync(join(cwd, 'nul.md'), Buffer.from([0x61, 0x00, 0x0d, 0x0a]));
  fixtureGit(cwd, 'add', '.');
  const result = spawnSync(process.execPath, ['scripts/check-encoding.mjs'], {
    cwd, env: testEnv(), encoding: 'utf8', timeout: GIT_TIMEOUT_MS,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'encoding ok\n');
  assert.equal(result.stderr, '');
});

test('Git refuses implicit bare repositories', {
  skip: gitOlderThan(2, 38) && 'Requires Git 2.38 for safe.bareRepository.',
}, (t) => {
  const outer = tempDirectory(t);
  const inner = join(outer, 'bare');
  mkdirSync(inner);
  fixtureGit(inner, 'init', '-q', '--bare', '--template=');
  const file = join(inner, 'draft.md');
  writeFileSync(file, 'draft\n');

  assert.equal(fixtureGit(inner, '-c', 'safe.bareRepository=all', 'rev-parse', '--is-bare-repository'), 'true\n');
  assert.equal(cleanInGit(outer, file), false);
  assert.throws(() => runGit(['rev-parse', '--is-bare-repository'], { cwd: inner }), { status: 128 });
  assert.throws(() => runGit(['status', '--porcelain'], { cwd: inner }), { status: 128 });

  const withWorkTree = join(outer, 'with-work-tree');
  mkdirSync(withWorkTree);
  fixtureGit(withWorkTree, 'init', '-q', '--bare', '--template=');
  const allowBare = ['-c', 'safe.bareRepository=all'];
  fixtureGit(withWorkTree, ...allowBare, 'config', 'core.bare', 'false');
  fixtureGit(withWorkTree, ...allowBare, 'config', 'core.worktree', '.');
  fixtureGit(withWorkTree, ...allowBare, 'config', 'core.repositoryformatversion', '0');
  const workTreeFile = join(withWorkTree, 'draft.md');
  writeFileSync(workTreeFile, 'draft\n');

  assert.equal(fixtureGit(withWorkTree, ...allowBare, 'rev-parse', '--is-inside-work-tree'), 'true\n');
  commitDraft(withWorkTree, ...allowBare);
  assert.equal(fixtureGit(withWorkTree, ...allowBare, 'status', '--porcelain', '--ignored', '--', workTreeFile), '');
  assert.equal(cleanInGit(outer, workTreeFile), false);
  assert.throws(() => runGit(['status', '--porcelain'], { cwd: withWorkTree }), { status: 128 });
});

test('Git returns stdout, throws on a failed command, and overrides local fsmonitor settings', (t) => {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--template=');
  assert.equal(runGit(['rev-parse', '--is-inside-work-tree'], { cwd }), 'true\n');
  assert.throws(() => runGit(['rev-parse', '--verify', 'HEAD'], { cwd }), { status: 128 });

  const file = join(cwd, 'draft.md');
  writeFileSync(file, 'draft\n');
  commitDraft(cwd);
  assert.equal(cleanInGit(cwd, file), true);

  fixtureGit(cwd, 'config', 'core.fsmonitor', 'true');
  assert.equal(runGit(['config', '--bool', 'core.fsmonitor'], { cwd }), 'false\n');
});

test('Git invocation puts fixed overrides first and passes the environment and process options', (t) => {
  const cwd = 'a directory with spaces';
  const command = ['status', '--porcelain'];
  const overrides = [
    '--no-optional-locks',
    '-c', 'core.fsmonitor=false', '-c', 'safe.bareRepository=explicit',
    '-c', `core.hooksPath=${wrapperPath}`,
    '-c', 'hook.post-index-change.enabled=false',
  ];
  setEnv(t, { GIT_NO_LAZY_FETCH: '0' });
  const { args, options } = gitInvocation(command, { cwd });
  assert.deepEqual(args, [...overrides, '-C', cwd, ...command]);
  assert.deepEqual(gitInvocation(command).args, [...overrides, ...command]);
  assert.deepEqual(options.env, { ...process.env, GIT_NO_LAZY_FETCH: '1' });
  assert.equal(GIT_TIMEOUT_MS, 3000);
  assert.equal(options.cwd, undefined);
  assert.equal(options.timeout, GIT_TIMEOUT_MS);
  assert.equal(options.killSignal, 'SIGKILL');
  assert.equal(options.encoding, 'utf8');
  assert.equal(options.shell, false);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);

  const processCwd = 'a separate launch directory';
  const untimed = gitInvocation(command, { cwd, processCwd, timeout: 0, stderr: 'inherit' });
  assert.deepEqual(untimed.args, [...overrides, '-C', cwd, ...command]);
  assert.equal(untimed.options.cwd, processCwd);
  assert.equal(untimed.options.timeout, 0);
  assert.deepEqual(untimed.options.stdio, ['ignore', 'pipe', 'inherit']);
});

test('Git overrides the repository hooks directory', (t) => {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--template=');
  fixtureGit(cwd, 'config', 'core.hooksPath', 'repo-hooks');
  assert.equal(runGit(['config', '--get', 'core.hooksPath'], { cwd }), `${wrapperPath}\n`);
  assert.ok(statSync(wrapperPath).isFile());
});

test('Git disables the post-index-change hook event', {
  skip: gitOlderThan(2, 55) && 'Requires Git 2.55 for event-level hook disabling and its list output.',
}, (t) => {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--template=');
  fixtureGit(cwd, 'config', 'hook.fixture.command', 'fixture-hook');
  fixtureGit(cwd, 'config', 'hook.fixture.event', 'post-index-change');
  const command = ['hook', 'list', 'post-index-change'];
  assert.equal(fixtureGit(cwd, ...command), 'fixture\n');
  assert.equal(runGit(command, { cwd }), 'event-disabled\tfixture\n');
});

function checkStatusLeavesIndexUnchanged(t, splitIndex) {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--template=');
  const file = join(cwd, 'draft.md');
  const gitDir = join(cwd, '.git');
  const index = join(gitDir, 'index');
  const originalTime = new Date('2000-01-01');
  const rewrittenTime = new Date('2001-01-01');
  writeFileSync(file, 'draft\n');
  utimesSync(file, originalTime, originalTime);
  commitDraft(cwd);
  if (splitIndex) fixtureGit(cwd, 'update-index', '--split-index');

  // Git refreshes shared index file mtimes on read.
  const snapshot = () => ['index', ...readdirSync(gitDir).filter((name) => name.startsWith('sharedindex.')).sort()]
    .map((name) => ({ name, bytes: readFileSync(join(gitDir, name)) }));
  const indexMtime = () => statSync(index, { bigint: true }).mtimeNs;

  writeFileSync(file, 'draft\n');
  utimesSync(file, rewrittenTime, rewrittenTime);
  const before = snapshot();
  if (splitIndex) assert.ok(before.length > 1, 'Git created a shared index file');
  const beforeMtime = indexMtime();
  assert.equal(runGit(['status', '--porcelain'], { cwd }), '');
  assert.deepEqual(snapshot(), before, 'index file names and bytes stayed unchanged');
  assert.equal(indexMtime(), beforeMtime, 'index mtime stayed unchanged');

  if (!splitIndex) {
    assert.equal(fixtureGit(cwd, 'status', '--porcelain'), '');
    assert.notDeepEqual(readFileSync(index), before[0].bytes, 'plain Git status rewrote the stale index');
  }
}

test('Git status leaves a stale index unchanged', (t) => checkStatusLeavesIndexUnchanged(t, false));
test('Git status leaves a stale split index unchanged', (t) => checkStatusLeavesIndexUnchanged(t, true));

test('Git reports a missing object without starting a lazy fetch', {
  skip: gitOlderThan(2, 45, 1) && 'Requires Git 2.45.1 for GIT_NO_LAZY_FETCH.',
}, (t) => {
  const cwd = tempDirectory(t);
  fixtureGit(cwd, 'init', '-q', '--object-format=sha1', '--template=');
  fixtureGit(cwd, 'config', 'remote.origin.promisor', 'true');
  const trace = join(cwd, 'git-trace.jsonl');
  setEnv(t, { GIT_TRACE2_EVENT: trace, GIT_ALLOW_PROTOCOL: 'none', GIT_NO_LAZY_FETCH: '0' });
  assert.throws(() => runGit(['cat-file', '-e', '1'.repeat(40)], { cwd }), { status: 1 });
  assert.doesNotMatch(readFileSync(trace, 'utf8'), /"event":"child_start"/, 'no child Git process was started');
});

// Guard direct Git launches outside the wrapper; a run cannot visit every launch branch.
// This sees literals, simple conditionals, constants and shell commands, not aliases or computed names.
test('source scan: only the shared wrapper starts Git', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  // This scan sees direct literals, simple conditionals, constants and simple shell commands.
  // It cannot follow aliases, computed command names or shell indirection.
  const jsGit = /\b(?:exec(?:File)?(?:Sync)?|spawn(?:Sync)?|fork)\s*\(\s*(?:[^,;]*\?(?=[^,;]*:)[^,;]*)?(['"`])git(?:\.exe)?(?:\1|[ \t])/;
  const gitConstant = /\bconst\s+[\w$]+\s*=\s*(['"`])git(?:\.exe)?\1/;
  const shellGit = /(?:^|[;&|])[ \t]*(?:exec[ \t]+)?git(?:\.exe)?[ \t]/m;
  const dirs = [join(root, 'bin'), join(root, 'hooks'), join(root, 'scripts')];
  const gitHooks = join(root, '.githooks');
  if (existsSync(gitHooks)) dirs.push(gitHooks);
  for (const dir of dirs) {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const file = relative(root, path).replaceAll('\\', '/');
      if (file === 'bin/lib/git.mjs') continue;
      const source = readFileSync(path, 'utf8');
      assert.ok(!jsGit.test(source) && !gitConstant.test(source) && !shellGit.test(source), `${file} must use the shared Git wrapper`);
    }
  }
});
