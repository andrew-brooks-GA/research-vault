import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testEnv } from './helpers.mjs';

const runs = new Map();
const script = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url));
function fixture(t, source, beforeRemove) {
  const cwd = mkdtempSync(join(tmpdir(), 'rv-npm-test-'));
  runs.set(cwd, []);
  t.after(async () => {
    const record = join(cwd, 'process.json');
    const info = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : null;
    try {
      if (info) {
        kill(info.runner, true);
        kill(info.pid);
      }
      for (const child of runs.get(cwd)) kill(child.pid, true);
      await Promise.all(runs.get(cwd).map(result));
      if (info) await waitFor(() => gone(info.pid), 'fixture process cleanup');
    } finally {
      beforeRemove?.();
      if (info) rmSync(info.home, { recursive: true, force: true });
      runs.delete(cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  // A separate cwd prevents an argument-forwarding regression from discovering the real suite.
  const file = join(cwd, 'fixture.mjs');
  writeFileSync(file, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n" + `
import { writeFileSync as recordFile } from 'node:fs';
import { dirname as parentDir } from 'node:path';
recordFile('process.json', JSON.stringify({ pid: process.pid, runner: process.ppid, home: parentDir(process.env.HOME) }));
` + source);
  return { cwd, file };
}

function tempFixture(t, source, beforeRemove) {
  const { cwd, file } = fixture(t, `
import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('fixture leaves a temporary directory', () => {
  const leftover = mkdtempSync(join(tmpdir(), 'rv-leftover-'));
  ${source}
});
`, beforeRemove && (() => beforeRemove(parentTemp)));
  const parentTemp = join(cwd, 'parent-tmp');
  mkdirSync(parentTemp);
  return { cwd, file, parentTemp, overrides: { TMPDIR: parentTemp, TEMP: parentTemp, TMP: parentTemp } };
}

const skipReadOnlyTemp = process.platform === 'win32' || process.geteuid?.() === 0;
function readOnlyTempFixture(t, source = '') {
  return tempFixture(t, `
  recordFile(join(leftover, 'file'), 'leftover');
  chmodSync(leftover, 0o500);
  ${source}
`, (parentTemp) => {
    for (const entry of readdirSync(parentTemp, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory()) chmodSync(join(entry.parentPath, entry.name), 0o700);
    }
  });
}

// macOS reports EPERM for a group holding only ended processes; treat it as gone.
function kill(pid, group = false, signal = 'SIGKILL') {
  try { process.kill(group && process.platform !== 'win32' ? -pid : pid, signal); }
  catch (error) { if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error; }
}
function gone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH' || error.code === 'EPERM') return true; throw error; }
}
async function waitFor(predicate, description, limit = 3000) {
  const until = performance.now() + limit;
  while (!predicate()) {
    assert.ok(performance.now() < until, description);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function start(cwd, args, overrides = {}, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, script, '--test-reporter=tap', ...args], {
    cwd, env: testEnv({ TMPDIR: cwd, TEMP: cwd, TMP: cwd, ...overrides }), detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  child.done = new Promise((resolve) => {
    child.on('error', (error) => resolve({ error, stdout, stderr }));
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  runs.get(cwd).push(child);
  return child;
}
async function result(child) {
  let timer;
  try {
    const value = await Promise.race([child.done, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('wrapper did not exit within 10 seconds')), 10000);
    })]);
    assert.ifError(value.error);
    return value;
  } finally { clearTimeout(timer); }
}
async function run(cwd, args, overrides = {}) {
  const value = await result(start(cwd, args, overrides));
  assert.equal(value.signal, null);
  return value;
}

test('npm test isolates the runner environment and removes its temporary home', { timeout: 30000 }, async (t) => {
  const { cwd, file } = fixture(t, `
import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
test('isolated runner', () => {
  assert.equal(process.env.TERM, 'xterm-256color');
  assert.deepEqual(Object.keys(process.env).filter((key) => /^(RESEARCH_VAULT_|CLAUDE_)/i.test(key)), []);
  const root = dirname(process.env.HOME);
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
    assert.equal(dirname(process.env[key]), root);
    assert.ok(statSync(process.env[key]).isDirectory());
  }
  assert.equal(dirname(process.env.GIT_CONFIG_GLOBAL), root);
  assert.equal(readFileSync(process.env.GIT_CONFIG_GLOBAL, 'utf8'), '');
  assert.equal(process.env.GIT_CONFIG_NOSYSTEM, '1');
  console.log('runner-home=' + JSON.stringify(root));
});
`);
  const home = join(cwd, 'parent-home');
  mkdirSync(home);
  const sentinel = join(home, 'sentinel');
  writeFileSync(sentinel, 'parent home untouched');
  const overrides = { TERM: 'xterm-256color', GIT_CONFIG_GLOBAL: sentinel, GIT_CONFIG_NOSYSTEM: '0' };
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
    'RESEARCH_VAULT_PATH', 'RESEARCH_VAULT_ALLOW_NETWORK', 'RESEARCH_VAULT_EMBED_URL', 'RESEARCH_VAULT_EMBED_KEY',
    'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT']) overrides[key] = home;
  const result = await run(cwd, [file], overrides);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const match = result.stdout.match(/runner-home=(".*")/);
  assert.ok(match, result.stdout);
  const runnerHome = JSON.parse(match[1]);
  assert.notEqual(runnerHome, home);
  assert.equal(existsSync(runnerHome), false, 'temporary runner home was removed');
  assert.equal(readFileSync(sentinel, 'utf8'), 'parent home untouched');
});

test('npm test removes directories left by passing tests', { timeout: 30000 }, async (t) => {
  const { cwd, file, parentTemp, overrides } = tempFixture(t, '');
  const outcome = await run(cwd, [file], overrides);
  assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
  assert.deepEqual(readdirSync(parentTemp), []);
  assert.match(outcome.stdout, /^ok \d+ - fixture leaves a temporary directory$/m);
});

test('npm test keeps a passing status when temporary home cleanup fails', { timeout: 30000, skip: skipReadOnlyTemp }, async (t) => {
  const { cwd, file, parentTemp, overrides } = readOnlyTempFixture(t);
  const outcome = await run(cwd, [file], overrides);
  assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
  assert.match(outcome.stdout, /^ok \d+ - fixture leaves a temporary directory$/m);
  const { home } = JSON.parse(readFileSync(join(cwd, 'process.json'), 'utf8'));
  assert.equal(dirname(home), parentTemp);
  assert.match(outcome.stderr, new RegExp(String.raw`^Could not remove temporary test home ${RegExp.escape(home)}: [^\r\n]+\r?\n$`));
});

test('npm test removes directories left by failing tests', { timeout: 30000 }, async (t) => {
  const { cwd, file, parentTemp, overrides } = tempFixture(t, "assert.fail('deliberate fixture failure');");
  const outcome = await run(cwd, [file], overrides);
  assert.notEqual(outcome.status, 0);
  assert.deepEqual(readdirSync(parentTemp), []);
  assert.match(outcome.stdout, /^not ok \d+ - fixture leaves a temporary directory$/m);
});

test('npm test removes directories left when the child is killed', { timeout: 30000, skip: process.platform === 'win32' }, async (t) => {
  const { cwd, file, parentTemp, overrides } = tempFixture(t, "process.kill(process.ppid, 'SIGKILL');");
  const outcome = await result(start(cwd, [file], overrides));
  assert.equal(outcome.signal, 'SIGKILL', outcome.stdout + outcome.stderr);
  assert.deepEqual(readdirSync(parentTemp), []);
});

test('test helpers load from a working directory outside the repository', { timeout: 30000 }, async (t) => {
  const { cwd } = fixture(t, '');
  const file = fileURLToPath(new URL('./schema.test.mjs', import.meta.url));
  const outcome = await run(cwd, [file]);
  assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
  assert.match(outcome.stdout, /^ok \d+ - verification scalar types remain searchable with existing enum findings$/m);
});

test('npm test removes its temporary home before propagating a child signal', { timeout: 30000, skip: process.platform === 'win32' }, async (t) => {
  const { cwd, file } = fixture(t, `
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
writeFileSync('runner-home.txt', dirname(process.env.HOME));
process.kill(process.ppid, 'SIGKILL');
`);
  const outcome = await result(start(cwd, [file]));
  const runnerHome = readFileSync(join(cwd, 'runner-home.txt'), 'utf8');
  t.after(() => rmSync(runnerHome, { recursive: true, force: true }));
  assert.ifError(outcome.error);
  assert.equal(outcome.signal, 'SIGKILL', outcome.stdout + outcome.stderr);
  assert.equal(existsSync(runnerHome), false, 'temporary runner home was removed');
});

test('npm test propagates SIGTERM when temporary home cleanup fails', { timeout: 30000, skip: skipReadOnlyTemp }, async (t) => {
  const { cwd, file, overrides } = readOnlyTempFixture(t, `
  recordFile('ready.txt', 'ready');
  setInterval(() => {}, 1000);
`);
  const child = start(cwd, [file], overrides);
  await waitFor(() => existsSync(join(cwd, 'ready.txt')), 'fixture must be ready');
  kill(child.pid, false, 'SIGTERM');
  const outcome = await result(child);
  assert.equal(outcome.signal, 'SIGTERM', outcome.stderr);
});

test('npm test cleans up and propagates the signal when its group probe gets EPERM', { timeout: 30000, skip: process.platform === 'win32' }, async (t) => {
  const { cwd, file } = fixture(t, `
recordFile('ready.txt', 'ready');
setInterval(() => {}, 1000);
`);
  const preload = join(cwd, 'eperm.mjs');
  // Preload only the wrapper: its real stop/grace/finish path handles the injected
  // kernel error, while the runner and fixture receive real process signals.
  writeFileSync(preload, `
import { writeFileSync } from 'node:fs';
const kill = process.kill;
let stoppedGroup;
process.kill = function (pid, signal) {
  if (pid === stoppedGroup && signal === 0) {
    writeFileSync('eperm.txt', 'group probe');
    const error = new Error('kill EPERM');
    error.code = 'EPERM';
    throw error;
  }
  if (pid < 0 && signal === 'SIGTERM') stoppedGroup = pid;
  return kill.call(process, pid, signal);
};
`);
  const child = start(cwd, [file], {}, ['--import', pathToFileURL(preload).href]);
  await waitFor(() => existsSync(join(cwd, 'ready.txt')), 'fixture must be ready');
  const info = JSON.parse(readFileSync(join(cwd, 'process.json'), 'utf8'));
  kill(child.pid, false, 'SIGTERM');
  const outcome = await result(child);
  assert.equal(readFileSync(join(cwd, 'eperm.txt'), 'utf8'), 'group probe');
  assert.equal(outcome.stderr, '', 'no uncaught exception on standard error');
  assert.equal(outcome.status, null);
  assert.equal(outcome.signal, 'SIGTERM');
  assert.equal(existsSync(info.home), false, 'temporary runner home was removed');
  await waitFor(() => gone(info.pid) && gone(info.runner), 'signal must end run processes');
});

test('npm test supplies a ten-minute timeout when none is given', { timeout: 30000 }, async (t) => {
  const { cwd, file } = fixture(t, `
test('default timeout', () => {
  assert.ok(process.execArgv.includes('--test-timeout=600000'));
});
`);
  const result = await run(cwd, [file]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('npm test forwards a supplied timeout without adding the default', { timeout: 30000 }, async (t) => {
  const { cwd, file } = fixture(t, `
test('supplied timeout', () => {
  assert.ok(!process.execArgv.includes('--test-timeout=600000'));
  const index = process.execArgv.indexOf('--test-timeout');
  assert.ok(process.execArgv.includes('--test-timeout=2000') ||
    (index !== -1 && process.execArgv[index + 1] === '2000'));
});
`);
  for (const args of [['--test-timeout=2000'], ['--test-timeout', '2000']]) {
    const result = await run(cwd, [...args, file]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('npm test bounds unending test files and ends their processes', { timeout: 30000, skip: process.platform === 'win32' }, async (t) => {
  for (const source of [
    "process.on('SIGTERM', () => {}); test('never finishes', () => new Promise(() => { setInterval(() => {}, 1000); }));",
    "process.on('SIGTERM', () => {}); for (;;) {}",
  ]) {
    const { cwd, file } = fixture(t, source);
    const began = performance.now();
    const outcome = await run(cwd, ['--run-timeout=1500', file]);
    assert.notEqual(outcome.status, 0);
    assert.ok(performance.now() - began < 6000, 'whole-run deadline bounds the run');
    assert.match(outcome.stderr, /Test run did not end within 1500ms: a test or a test file did not end\./);
    const info = JSON.parse(readFileSync(join(cwd, 'process.json'), 'utf8'));
    await waitFor(() => gone(info.pid) && gone(info.runner), 'run processes must be gone');
    assert.equal(existsSync(info.home), false, 'temporary runner home was removed');
  }
});

test('npm test forwards signals to the fixture and removes the home after it ends', { timeout: 30000, skip: process.platform === 'win32' }, async (t) => {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    const { cwd, file } = fixture(t, `
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => { recordFile('signal.txt', signal); process.exit(0); });
}
recordFile('ready.txt', 'ready');
setInterval(() => {}, 1000);
`);
    const child = start(cwd, [file]);
    await waitFor(() => existsSync(join(cwd, 'ready.txt')), 'fixture handlers must be ready');
    const info = JSON.parse(readFileSync(join(cwd, 'process.json'), 'utf8'));
    // Hold Node's runner teardown until the fixture records the forwarded signal:
    // otherwise the runner can send its child SIGTERM while SIGINT is pending.
    kill(info.runner, false, 'SIGSTOP');
    try {
      kill(child.pid, false, signal);
      await waitFor(() => existsSync(join(cwd, 'signal.txt')) && readFileSync(join(cwd, 'signal.txt'), 'utf8') !== '',
        'fixture must record the signal');
      assert.equal(readFileSync(join(cwd, 'signal.txt'), 'utf8'), signal, 'fixture received the signal');
    } finally {
      kill(info.runner, false, 'SIGCONT');
    }
    const outcome = await result(child);
    assert.equal(outcome.signal, signal);
    await waitFor(() => gone(info.pid) && gone(info.runner), 'signal must end run processes');
    assert.equal(existsSync(info.home), false, 'temporary runner home was removed');
  }
});

test('npm test consumes its run timeout without forwarding it', { timeout: 30000 }, async (t) => {
  const { cwd, file } = fixture(t, `
test('script option stays out of Node', () => {
  assert.ok(![...process.argv, ...process.execArgv].some((arg) => arg.startsWith('--run-timeout')));
});
`);
  for (const args of [['--run-timeout=5000'], ['--run-timeout', '5000']]) {
    const outcome = await run(cwd, [...args, file]);
    assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
  }
});

test('npm test forwards file and name arguments and preserves pass and fail status', { timeout: 30000 }, async (t) => {
  const { cwd, file } = fixture(t, `
test('selected pass', () => console.log('selected-pass-ran'));
test('selected fail', () => assert.fail('selected-failure-ran'));
`);
  const pass = await run(cwd, ['--test-name-pattern=selected pass', file]);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /selected-pass-ran/);
  assert.doesNotMatch(pass.stdout, /selected-failure-ran/);
  const fail = await run(cwd, ['--test-name-pattern=selected fail', file]);
  assert.notEqual(fail.status, 0);
  assert.match(fail.stdout, /selected-failure-ran/);
  assert.doesNotMatch(fail.stdout, /selected-pass-ran/);
});

test('default test discovery matches only files under test/', (t) => {
  // Node 24 docs: "Running tests from the command line" and
  // "Test runner execution model". Include TypeScript defaults (strip types enabled).
  // https://nodejs.org/docs/latest-v24.x/api/test.html#test-runner-execution-model
  const patterns = [
    /(?:^|\/)[^/]*\.test\.(?:cjs|mjs|js)$/, // **/*.test.{cjs,mjs,js}
    /(?:^|\/)[^/]*-test\.(?:cjs|mjs|js)$/, // **/*-test.{cjs,mjs,js}
    /(?:^|\/)[^/]*_test\.(?:cjs|mjs|js)$/, // **/*_test.{cjs,mjs,js}
    /(?:^|\/)test-[^/]*\.(?:cjs|mjs|js)$/, // **/test-*.{cjs,mjs,js}
    /(?:^|\/)test\.(?:cjs|mjs|js)$/, // **/test.{cjs,mjs,js}
    /(?:^|\/)test\/.*\.(?:cjs|mjs|js)$/, // **/test/**/*.{cjs,mjs,js}
    /(?:^|\/)[^/]*\.test\.(?:cts|mts|ts)$/, // **/*.test.{cts,mts,ts}
    /(?:^|\/)[^/]*-test\.(?:cts|mts|ts)$/, // **/*-test.{cts,mts,ts}
    /(?:^|\/)[^/]*_test\.(?:cts|mts|ts)$/, // **/*_test.{cts,mts,ts}
    /(?:^|\/)test-[^/]*\.(?:cts|mts|ts)$/, // **/test-*.{cts,mts,ts}
    /(?:^|\/)test\.(?:cts|mts|ts)$/, // **/test.{cts,mts,ts}
    /(?:^|\/)test\/.*\.(?:cts|mts|ts)$/, // **/test/**/*.{cts,mts,ts}
  ];
  const root = fileURLToPath(new URL('../', import.meta.url));
  const matches = [];
  function walk(folder = '') {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      // Skip git metadata, installed dependencies, and git-ignored local specs:
      // none belongs to the repository's runnable source files.
      if (entry.name === '.git' || entry.name === 'node_modules' || path === 'docs/specs') continue;
      if (entry.isDirectory()) walk(path);
      else if (patterns.some((pattern) => pattern.test(path))) matches.push(path);
    }
  }
  walk();
  matches.sort();
  t.diagnostic(`Default discovery matches (${matches.length}):\n${matches.join('\n')}`);
  const outside = matches.filter((path) => !path.startsWith('test/'));
  t.diagnostic(`Matches outside test/: ${outside.length}`);
  assert.deepEqual(outside, [], 'default discovery must not execute files outside test/');
});
