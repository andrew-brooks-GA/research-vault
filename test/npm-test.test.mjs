import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './helpers.mjs';

const runs = new Map();
const script = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url));
function fixture(t, source) {
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
      if (info) rmSync(info.home, { recursive: true, force: true });
      runs.delete(cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  // The helper loads the bundled schema at import time. An otherwise empty cwd also
  // prevents an argument-forwarding regression from discovering the real suite.
  mkdirSync(join(cwd, 'schema'));
  for (const name of ['taxonomy.json', 'frontmatter.schema.json']) {
    cpSync(new URL(`../schema/${name}`, import.meta.url), join(cwd, 'schema', name));
  }
  const file = join(cwd, 'fixture.mjs');
  writeFileSync(file, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n" + `
import { writeFileSync as recordFile } from 'node:fs';
import { dirname as parentDir } from 'node:path';
recordFile('process.json', JSON.stringify({ pid: process.pid, runner: process.ppid, home: parentDir(process.env.HOME) }));
` + source);
  return { cwd, file };
}

function kill(pid, group = false) {
  try { process.kill(group && process.platform !== 'win32' ? -pid : pid, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function gone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
async function waitFor(predicate, description, limit = 3000) {
  const until = performance.now() + limit;
  while (!predicate()) {
    assert.ok(performance.now() < until, description);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
function start(cwd, args, overrides = {}) {
  const child = spawn(process.execPath, [script, '--test-reporter=tap', ...args], {
    cwd, env: testEnv({ TMPDIR: cwd, ...overrides }), detached: process.platform !== 'win32',
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
    child.kill(signal);
    const outcome = await result(child);
    assert.equal(outcome.signal, signal);
    assert.equal(readFileSync(join(cwd, 'signal.txt'), 'utf8'), signal, 'fixture received the signal');
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
  // Node 22 and 24 docs: "Running tests from the command line" and
  // "Test runner execution model". Include TypeScript defaults (strip types enabled).
  // https://nodejs.org/download/release/v22.21.1/docs/api/test.html#test-runner-execution-model
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
