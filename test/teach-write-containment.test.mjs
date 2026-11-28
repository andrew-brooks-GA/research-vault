import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs, { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run as runTeach } from '../bin/commands/teach.mjs';
import { assertInsideWorkspaceFolder, VAULT_PATH_OUTSIDE } from '../bin/lib/containment.ts';
import { loadTeachSchema } from '../bin/lib/schema.mjs';
import { cancelRun, endRun, ENDING_FILE, readRun, RUN_FILE, startRun } from '../bin/lib/task.mjs';
import { createServer, fixRecordFrontmatter, fixRecordFrontmatters, previousTaskAttempt, supersedeRecord, writeAttempt, writeRecord } from '../bin/lib/teach.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { testEnv } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const SCHEMA = loadTeachSchema(ROOT);
const NOW = new Date('2026-10-26T20:57:00.690Z');
const LESSON = '0001-one';
const ATTEMPT = 'a-20261026-205700-0001';
const ANSWERS = { lesson: LESSON, answers: [0] };
const folderError = (place) => `${place}: path is outside its workspace folder or cannot be resolved`;
const ATTEMPT_ERROR = folderError('attempts/');
const RECORD_ERROR = folderError('learning-records/');
const STATE_FILE = '.teach-serve.json';
const STATE_ERROR = 'teach serve: .teach-serve.json: cannot use as a regular workspace state file\n';
const runError = (name) => ({
  code: VAULT_PATH_OUTSIDE, message: `${name}: cannot use as a regular workspace state file. Remove it by hand.`,
});

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-teach-write-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ws = join(root, 'workspace'), outside = join(root, 'outside');
  mkdirSync(join(ws, 'lessons'), { recursive: true });
  mkdirSync(outside);
  const marker = join(outside, 'marker.txt');
  writeFileSync(marker, 'outside marker\n');
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n');
  const quiz = JSON.stringify({ items: [{ q: 'One?', options: ['yes', 'no'], correct: 0, why: ['yes', 'no'] }] });
  writeFileSync(join(ws, 'lessons', LESSON + '.html'),
    `<title>One</title><section data-block="quiz"><script type="application/json" data-quiz>${quiz}</script></section>\n`);
  return { root, ws, outside, marker };
}

function link(t, target, name, type = 'file') {
  try {
    symlinkSync(target, name, type);
    t.diagnostic(`${type} symlink`);
  } catch (e) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(e.code)) throw e;
    if (type === 'file') {
      t.skip(`Windows file links are unavailable (${e.code})`);
      return false;
    }
    symlinkSync(target, name, 'junction');
    t.diagnostic(`directory junction (${e.code})`);
  }
  return true;
}

const snapshot = (dir) => readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name))]);
const assertLink = (name) => assert.ok(lstatSync(name).isSymbolicLink(), name);

function refused(result, message) {
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `error: ${message}\n`);
}

function cli(root, ...args) {
  return runCli(root, [], args);
}

function runCli(root, nodeArgs, args) {
  const result = spawnSync(process.execPath, [...nodeArgs, BIN, 'teach', ...args], {
    cwd: root, env: testEnv(), encoding: 'utf8', timeout: 10000,
  });
  if (result.error) throw result.error;
  return result;
}

async function withServe(root, ws, verify, onExit = '') {
  // Exercise the application's signal handler on Windows, where ChildProcess.kill
  // terminates the process without dispatching a JavaScript signal event.
  const preload = join(root, 'serve-signal.mjs');
  writeFileSync(preload, `process.once('message', () => process.emit('SIGTERM'));\n${onExit}`);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, BIN, 'teach', 'serve', ws], {
    cwd: root, env: testEnv(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const closed = once(child, 'close');
  let stdout = '', stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const serving = new Promise((resolve) => child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('\n')) resolve(stdout);
  }));
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const line = await Promise.race([serving, closed.then(([code]) => assert.fail(`serve exited ${code}: ${stderr}`))]);
    const match = /^serving (.+) at http:\/\/127\.0\.0\.1:(\d+)\/\n$/.exec(line);
    assert.ok(match, line);
    assert.equal(match[1], ws);
    await verify({ port: Number(match[2]), pid: child.pid });
    if (process.platform === 'win32') child.send('stop');
    else child.kill('SIGTERM');
    assert.deepEqual(await closed, [0, null], stderr);
    assert.equal(stderr, '');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

function fetchPath(port, path, body) {
  return new Promise((resolve, reject) => {
    const headers = body === undefined ? undefined : {
      Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    };
    const req = request({ host: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (chunk) => { text += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

for (const dangling of [false, true]) {
  test(`serve refuses a ${dangling ? 'dangling' : 'file'} link at the state name`, (t) => {
    const { root, ws, outside, marker } = fixture(t);
    const target = dangling ? join(outside, 'missing.txt') : marker;
    if (!link(t, target, join(ws, STATE_FILE))) return;
    const before = snapshot(outside);
    const result = cli(root, 'serve', ws);
    assert.deepEqual(snapshot(outside), before);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, STATE_ERROR);
    assertLink(join(ws, STATE_FILE));
  });
}

test('serve refuses a directory at the state name', (t) => {
  const { root, ws } = fixture(t);
  mkdirSync(join(ws, STATE_FILE));
  const result = cli(root, 'serve', ws);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, STATE_ERROR);
});

test('serve replaces stale regular state and removes it on normal exit', async (t) => {
  const { root, ws } = fixture(t);
  const file = join(ws, STATE_FILE);
  writeFileSync(file, '{"port":1,"pid":1}\n');
  await withServe(root, ws, (state) => assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), state));
  assert.equal(existsSync(file), false);
});

test('serve exit removes a substituted state name and preserves its target', async (t) => {
  const { root, ws, outside } = fixture(t);
  const file = join(ws, STATE_FILE);
  const before = snapshot(outside);
  await withServe(root, ws, () => {
    rmSync(file);
    link(t, outside, file, 'dir');
  });
  assert.equal(lstatSync(file, { throwIfNoEntry: false }), undefined);
  assert.deepEqual(snapshot(outside), before);
});

test('POST /attempt refuses an outside attempts folder and keeps serving', async (t) => {
  const { ws, outside } = fixture(t);
  link(t, outside, join(ws, 'attempts'), 'dir');
  const before = snapshot(outside);
  const server = createServer(ws, { schema: SCHEMA, now: () => NOW });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const response = await fetchPath(port, '/attempt', JSON.stringify(ANSWERS));
    assert.deepEqual(snapshot(outside), before);
    assert.equal(response.status, 500);
    assert.equal(response.text, ATTEMPT_ERROR + '\n');
    assert.equal(response.text.includes(outside), false);
    assert.equal((await fetchPath(port, '/lessons/' + LESSON + '.html')).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('teach attempt add refuses an outside attempts folder', (t) => {
  const { root, ws, outside } = fixture(t);
  link(t, outside, join(ws, 'attempts'), 'dir');
  const before = snapshot(outside);
  const result = cli(root, 'attempt', 'add', ws, '--lesson', LESSON, '--answers', '0');
  assert.deepEqual(snapshot(outside), before);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `error: ${ATTEMPT_ERROR}\n`);
});

test('teach attempt import refuses an outside attempts folder before skipping and records in a real folder', (t) => {
  const { root, ws, outside } = fixture(t);
  const dir = join(ws, 'attempts');
  const results = join(root, 'results.json');
  writeFileSync(results, JSON.stringify({
    format: 'research-vault-attempts', version: 1, workspace: 'workspace',
    attempts: [{ ...ANSWERS, at: NOW.toISOString(), total: 1, wrong: [] }],
  }));
  writeFileSync(join(outside, ATTEMPT + '.md'), 'outside attempt marker\n');
  link(t, outside, dir, 'dir');
  const before = snapshot(outside);
  const result = cli(root, 'attempt', 'import', results, ws);
  assert.deepEqual(snapshot(outside), before);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `error: ${ATTEMPT_ERROR}\n`);

  rmSync(dir, { recursive: true });
  mkdirSync(dir);
  const accepted = cli(root, 'attempt', 'import', results, ws);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout, `recorded ${ATTEMPT}: 1/1\n`);
  assert.deepEqual(readdirSync(dir), [ATTEMPT + '.md']);
  assert.deepEqual(snapshot(outside), before);
});

test('writeAttempt refuses an attempts folder redirected within the workspace', (t) => {
  const { ws } = fixture(t);
  const other = join(ws, 'other'), dir = join(ws, 'attempts');
  mkdirSync(other);
  writeFileSync(join(other, 'marker.txt'), 'inside marker\n');
  link(t, other, dir, 'dir');
  const before = snapshot(other);
  assert.throws(() => assertInsideWorkspaceFolder(ws, dir), { code: VAULT_PATH_OUTSIDE });
  assert.throws(() => writeAttempt(ws, { ...ANSWERS, now: NOW }, SCHEMA), { message: ATTEMPT_ERROR });
  assert.deepEqual(snapshot(other), before);
});

test('workspace refusal escapes control and format characters in the file name', (t) => {
  const { ws } = fixture(t);
  const dir = join(ws, 'learning-records');
  mkdirSync(dir);
  const name = 'record\0\n\u007f\u0085\u00ad\u202e\u2028\u2029\ud800\u{e0001}é.md';
  const place = String.raw`learning-records/record\u0000\u000a\u007f\u0085\u00ad\u202e\u2028\u2029\ud800\udb40\udc01é.md`;
  assert.throws(() => assertInsideWorkspaceFolder(ws, dir, join(dir, name)), {
    code: VAULT_PATH_OUTSIDE, message: folderError(place),
  });
});

test('writeAttempt refuses an attempt filename linked outside its folder', (t) => {
  const { ws, outside, marker } = fixture(t);
  const dir = join(ws, 'attempts');
  mkdirSync(dir);
  if (!link(t, marker, join(dir, ATTEMPT + '.md'))) return;
  const before = snapshot(outside);
  assert.throws(() => writeAttempt(ws, { ...ANSWERS, now: NOW }, SCHEMA), { message: folderError(`attempts/${ATTEMPT}.md`) });
  assert.deepEqual(snapshot(outside), before);
  assert.deepEqual(readdirSync(dir), [ATTEMPT + '.md']);
  assertLink(join(dir, ATTEMPT + '.md'));
});

const record = (title) => ({ title, kind: 'understanding', now: NOW });

test('writeRecord refuses an outside learning-records folder', (t) => {
  const { ws, outside } = fixture(t);
  link(t, outside, join(ws, 'learning-records'), 'dir');
  const before = snapshot(outside);
  assert.throws(() => writeRecord(ws, record('New'), SCHEMA), { message: RECORD_ERROR });
  assert.deepEqual(snapshot(outside), before);
});

test('supersedeRecord refuses an outside learning-records folder', (t) => {
  const { root, ws, outside } = fixture(t);
  const source = join(root, 'records-workspace');
  mkdirSync(source);
  const old = writeRecord(source, record('Old'), SCHEMA);
  const replacement = writeRecord(source, record('Replacement'), SCHEMA);
  for (const { id, path } of [old, replacement]) writeFileSync(join(outside, id + '.md'), readFileSync(path));
  link(t, outside, join(ws, 'learning-records'), 'dir');
  const before = snapshot(outside);
  assert.throws(() => supersedeRecord(ws, old.id, replacement.id, 'Revised', SCHEMA), { message: RECORD_ERROR });
  assert.deepEqual(snapshot(outside), before);
});

test('fixRecordFrontmatter refuses an outside learning-records folder', (t) => {
  const { ws, outside } = fixture(t);
  const file = '0001-legacy.md';
  writeFileSync(join(outside, file), '# Legacy record\n');
  link(t, outside, join(ws, 'learning-records'), 'dir');
  const before = snapshot(outside);
  assert.throws(() => fixRecordFrontmatter(ws, file, NOW), { message: RECORD_ERROR });
  assert.deepEqual(snapshot(outside), before);
});

test('startRun refuses a run state linked outside the workspace', async (t) => {
  const { ws, outside, marker } = fixture(t);
  if (!link(t, marker, join(ws, RUN_FILE))) return;
  taskFixture(ws);
  const before = snapshot(outside);
  await assert.rejects(startRun(ws, ['1'], RUN_OPTIONS, runIO()), runError(RUN_FILE));
  assertLink(join(ws, RUN_FILE));
  assert.deepEqual(snapshot(outside), before);
});

test('cancelRun refuses an outside attempts folder and keeps ending state', (t) => {
  const { ws, outside } = fixture(t);
  const ending = join(ws, ENDING_FILE);
  const id = 'c-20261026-205700';
  writeFileSync(ending, JSON.stringify({ id }));
  writeFileSync(join(outside, ATTEMPT + '.md'), `---\ncertification: ${id}\n---\n`);
  link(t, outside, join(ws, 'attempts'), 'dir');
  const before = snapshot(outside);
  const state = readFileSync(ending);
  assert.throws(() => cancelRun(ws, { out: assert.fail, err: assert.fail }), { message: ATTEMPT_ERROR });
  assert.deepEqual(snapshot(outside), before);
  assert.deepEqual(readFileSync(ending), state);
});

test('attempt and serve state writes accept a linked workspace root', async (t) => {
  const { root, ws } = fixture(t);
  const alias = join(root, 'workspace-link');
  link(t, ws, alias, 'dir');
  const attempt = writeAttempt(alias, { ...ANSWERS, now: NOW }, SCHEMA);
  assert.equal(attempt.id, ATTEMPT);
  assert.deepEqual(readdirSync(join(ws, 'attempts')), [ATTEMPT + '.md']);
  const file = join(ws, STATE_FILE);
  await withServe(root, alias, (state) => assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), state));
  assert.equal(existsSync(file), false);
});

function preload(root, source) {
  const path = join(root, 'observe.mjs');
  writeFileSync(path, source);
  return ['--import', pathToFileURL(path).href];
}

test('serve refuses the state name before opening a listener', (t) => {
  const { root, ws } = fixture(t);
  const file = join(ws, STATE_FILE);
  mkdirSync(file);
  const marker = join(root, 'listening');
  const args = preload(root, `
    import { Server } from 'node:net';
    import { writeFileSync } from 'node:fs';
    const listen = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      writeFileSync(${JSON.stringify(marker)}, 'listen called');
      return listen.apply(this, args);
    };
  `);
  const result = runCli(root, args, ['serve', ws]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, STATE_ERROR);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(marker), false);
  assert.ok(lstatSync(file).isDirectory());
});

test('serve exit preserves state in a replacement workspace', async (t) => {
  const { root, ws, outside } = fixture(t);
  const replacement = join(outside, STATE_FILE);
  writeFileSync(replacement, 'replacement state\n');
  const original = join(root, 'original');
  await withServe(root, ws, () => {
    renameSync(ws, original);
    link(t, outside, ws, 'dir');
  });
  assertLink(ws);
  assert.equal(readFileSync(replacement, 'utf8'), 'replacement state\n');
  assert.ok(lstatSync(join(original, STATE_FILE)).isFile());
});

test('serve exit continues to later handlers if state cleanup fails', async (t) => {
  const { root, ws } = fixture(t);
  const file = join(ws, STATE_FILE);
  const marker = join(root, 'later-exit');
  const onExit = `
    import { writeFileSync } from 'node:fs';
    process.once('SIGTERM', () => {
      process.once('exit', () => writeFileSync(${JSON.stringify(marker)}, 'later exit ran'));
    });
  `;
  await withServe(root, ws, () => {
    rmSync(file);
    mkdirSync(file);
  }, onExit);
  assert.ok(lstatSync(file).isDirectory());
  assert.equal(readFileSync(marker, 'utf8'), 'later exit ran');
});

test('POST /attempt refuses a workspace redirected after listening', async (t) => {
  const { root, ws, outside } = fixture(t);
  const alias = join(root, 'workspace-link');
  link(t, ws, alias, 'dir');
  mkdirSync(join(outside, 'lessons'));
  const lesson = join('lessons', LESSON + '.html');
  writeFileSync(join(outside, lesson), readFileSync(join(ws, lesson)));
  await withServe(root, alias, async ({ port }) => {
    assert.equal((await fetchPath(port, '/lessons/' + LESSON + '.html')).status, 200);
    rmSync(alias, { recursive: true });
    link(t, outside, alias, 'dir');
    const response = await fetchPath(port, '/attempt', JSON.stringify(ANSWERS));
    assert.deepEqual(response, { status: 500, text: '.: workspace location changed or cannot be resolved\n' });
    assert.equal(existsSync(join(outside, 'attempts')), false);
    assert.equal(existsSync(join(ws, 'attempts')), false);
  });
  assertLink(alias);
});

test('writeAttempt refuses an attempt link to another workspace folder', (t) => {
  const { ws } = fixture(t);
  const dir = join(ws, 'attempts');
  const file = join(dir, ATTEMPT + '.md');
  const mission = join(ws, 'MISSION.md');
  mkdirSync(dir);
  if (!link(t, mission, file)) return;
  assert.throws(() => writeAttempt(ws, { ...ANSWERS, now: NOW }, SCHEMA), { message: folderError(`attempts/${ATTEMPT}.md`) });
  assertLink(file);
  assert.deepEqual(readdirSync(dir), [ATTEMPT + '.md']);
  assert.equal(readFileSync(mission, 'utf8'), '# Mission\n');
});

test('previousTaskAttempt refuses a redirected attempts folder', (t) => {
  const { ws } = fixture(t);
  const dir = join(ws, 'attempts');
  link(t, join(ws, 'lessons'), dir, 'dir');
  assert.throws(() => previousTaskAttempt(ws, LESSON), { code: VAULT_PATH_OUTSIDE, message: ATTEMPT_ERROR });
  assertLink(dir);
});

test('teach check refuses a redirected attempts folder before validating the checker for a recorded attempt', async (t) => {
  const { ws } = fixture(t);
  const dir = join(ws, 'attempts');
  link(t, join(ws, 'lessons'), dir, 'dir');
  mkdirSync(join(ws, 'evidence', '0001'), { recursive: true });
  t.mock.method(process.stderr, 'write', () => true);
  const args = { _: ['teach', 'check', '1', ws] };
  await assert.rejects(runTeach(args), { code: VAULT_PATH_OUTSIDE, message: ATTEMPT_ERROR });
  assert.equal(await runTeach({ ...args, 'dry-run': true }), 2);
  assertLink(dir);
});

test('writeAttempt and teach attempt import refuse a regular file at attempts', (t) => {
  const { root, ws } = fixture(t);
  const file = join(ws, 'attempts');
  writeFileSync(file, 'attempts marker\n');
  const results = join(root, 'results.json');
  writeFileSync(results, JSON.stringify({
    format: 'research-vault-attempts', version: 1, workspace: 'workspace',
    attempts: [{ ...ANSWERS, at: NOW.toISOString(), total: 1, wrong: [] }],
  }));
  assert.throws(() => writeAttempt(ws, { ...ANSWERS, now: NOW }, SCHEMA), { message: ATTEMPT_ERROR });
  refused(cli(root, 'attempt', 'import', results, ws), ATTEMPT_ERROR);
  assert.equal(readFileSync(file, 'utf8'), 'attempts marker\n');
});

for (const target of ['lessons', 'workspace root']) {
  test(`record writes and teach lint --fix refuse learning-records linked to ${target}`, (t) => {
    const { root, ws } = fixture(t);
    const dest = target === 'lessons' ? join(ws, 'lessons') : ws;
    const dir = join(ws, 'learning-records');
    const legacy = join(dest, '0001-legacy.md');
    writeFileSync(legacy, '# Legacy record\n');
    link(t, dest, dir, 'dir');
    assert.throws(() => writeRecord(ws, record('New'), SCHEMA), { message: RECORD_ERROR });
    assert.throws(() => supersedeRecord(ws, '0001-legacy', '0002-new', '', SCHEMA), { message: RECORD_ERROR });
    assert.throws(() => fixRecordFrontmatter(ws, '0001-legacy.md', NOW), { message: RECORD_ERROR });
    const args = preload(root, `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const readdir = fs.readdirSync;
      fs.readdirSync = (path, ...options) => {
        if (path === ${JSON.stringify(dir)}) throw new Error('learning-records listing reached');
        return readdir(path, ...options);
      };
      syncBuiltinESMExports();
    `);
    refused(runCli(root, args, ['lint', '--fix', ws, '--vault', root]), RECORD_ERROR);
    assertLink(dir);
    assert.equal(readFileSync(legacy, 'utf8'), '# Legacy record\n');
    assert.equal(readFileSync(join(ws, 'MISSION.md'), 'utf8'), '# Mission\n');
  });
}

test('teach record add and supersede refuse an outside learning-records folder', (t) => {
  const { root, ws, outside } = fixture(t);
  const dir = join(ws, 'learning-records');
  link(t, outside, dir, 'dir');
  const before = snapshot(outside);
  refused(cli(root, 'record', 'add', ws, '--title', 'New', '--kind', 'understanding'), RECORD_ERROR);
  refused(cli(root, 'record', 'supersede', '0001-old', ws, '--by', '0002-new'), RECORD_ERROR);
  assert.deepEqual(snapshot(outside), before);
  assertLink(dir);
});

test('record writes and teach lint --fix refuse a regular file at learning-records', (t) => {
  const { root, ws } = fixture(t);
  const dir = join(ws, 'learning-records');
  writeFileSync(dir, 'learning records marker\n');
  assert.throws(() => writeRecord(ws, record('New'), SCHEMA), { message: RECORD_ERROR });
  assert.throws(() => supersedeRecord(ws, '0001-old', '0002-new', '', SCHEMA), { message: RECORD_ERROR });
  assert.throws(() => fixRecordFrontmatter(ws, '0001-legacy.md', NOW), { message: RECORD_ERROR });
  refused(cli(root, 'lint', '--fix', ws, '--vault', root), RECORD_ERROR);
  assert.equal(readFileSync(dir, 'utf8'), 'learning records marker\n');
});

test('writeRecord refuses a linked destination immediately before creating the record', (t) => {
  const { ws, marker } = fixture(t);
  const dir = join(ws, 'learning-records');
  const file = join(dir, '0001-new.md');
  const staged = join(dir, 'destination.link');
  mkdirSync(dir);
  if (!link(t, marker, staged)) return;
  // Install the destination after the next record number has been selected.
  const body = { trimEnd() { renameSync(staged, file); return 'New'; } };
  assert.throws(() => writeRecord(ws, { ...record('New'), body }, SCHEMA),
    { message: folderError('learning-records/0001-new.md') });
  assertLink(file);
  assert.equal(readFileSync(marker, 'utf8'), 'outside marker\n');
});

test('writeRecord refuses a regular file before creating the learning-records directory', (t) => {
  const { ws } = fixture(t);
  const dir = join(ws, 'learning-records');
  const now = { toISOString() { writeFileSync(dir, 'learning records marker\n'); return NOW.toISOString(); } };
  assert.throws(() => writeRecord(ws, { ...record('New'), now }, SCHEMA), { message: RECORD_ERROR });
  assert.equal(readFileSync(dir, 'utf8'), 'learning records marker\n');
});

for (const [role, where] of [['record', 'outside'], ['--by record', 'outside'], ['record', 'inside'], ['--by record', 'inside']]) {
  test(`supersedeRecord refuses a linked ${role} ${where} learning-records`, (t) => {
    const { ws } = fixture(t);
    const old = writeRecord(ws, record('Old'), SCHEMA);
    const replacement = writeRecord(ws, record('Replacement'), SCHEMA);
    const { id, path } = role === 'record' ? old : replacement;
    const target = where === 'inside' ? join(ws, 'learning-records', id + '-target.md') : join(ws, id + '.md');
    const content = readFileSync(path);
    renameSync(path, target);
    if (!link(t, target, path)) return;
    assert.throws(() => supersedeRecord(ws, old.id, replacement.id, 'Revised', SCHEMA),
      { message: folderError(`learning-records/${id}.md`) });
    assertLink(path);
    assert.deepEqual(readFileSync(target), content);
  });
}

test('fixRecordFrontmatter and lint --fix refuse a linked record and leave earlier records alone', (t) => {
  const { root, ws } = fixture(t);
  const dir = join(ws, 'learning-records');
  const first = join(dir, '0001-legacy.md'), linked = join(dir, '0002-refused.md');
  const mission = join(ws, 'MISSION.md');
  mkdirSync(dir);
  writeFileSync(first, '# Legacy record\n');
  if (!link(t, mission, linked)) return;
  const message = folderError('learning-records/0002-refused.md');
  assert.throws(() => fixRecordFrontmatter(ws, '0002-refused.md', NOW), { message });
  refused(cli(root, 'lint', '--fix', ws, '--vault', root), message);
  assertLink(linked);
  assert.equal(readFileSync(first, 'utf8'), '# Legacy record\n');
  assert.equal(readFileSync(mission, 'utf8'), '# Mission\n');
});

for (const action of ['fixRecordFrontmatter', 'teach lint --fix']) {
  test(`${action} refuses a linked record inside learning-records`, (t) => {
    const { root, ws } = fixture(t);
    const dir = join(ws, 'learning-records');
    const first = join(dir, '0001-legacy.md'), linked = join(dir, '0002-refused.md'), target = join(dir, '0003-target.md');
    mkdirSync(dir);
    writeFileSync(first, '# Legacy record\n');
    writeFileSync(target, '# Target record\n');
    if (!link(t, target, linked)) return;
    const message = folderError('learning-records/0002-refused.md');
    if (action === 'fixRecordFrontmatter') {
      assert.throws(() => fixRecordFrontmatter(ws, '0002-refused.md', NOW), { code: VAULT_PATH_OUTSIDE, message });
    } else {
      refused(cli(root, 'lint', '--fix', ws, '--vault', root), message);
    }
    assertLink(linked);
    assert.equal(readFileSync(first, 'utf8'), '# Legacy record\n');
    assert.equal(readFileSync(target, 'utf8'), '# Target record\n');
  });
}

for (const action of ['supersedeRecord', 'fixRecordFrontmatter']) {
  for (const targetKind of ['another record', 'same record relative', 'same record absolute']) {
    test(`${action} preserves a linked old temporary name within learning-records (${targetKind})`, (t) => {
      const { ws } = fixture(t);
      const old = writeRecord(ws, record('Old'), SCHEMA);
      const replacement = writeRecord(ws, record('Replacement'), SCHEMA);
      if (action === 'fixRecordFrontmatter') writeFileSync(old.path, '# Legacy record\n');
      const temp = old.path + '.tmp';
      const target = targetKind === 'another record' ? replacement.path
        : targetKind === 'same record relative' ? old.id + '.md' : old.path;
      if (!link(t, target, temp)) return;
      const before = readFileSync(replacement.path);
      const mutate = action === 'supersedeRecord' ? () => supersedeRecord(ws, old.id, replacement.id, 'Revised', SCHEMA)
        : () => fixRecordFrontmatter(ws, old.id + '.md', NOW);
      mutate();
      assert.ok(lstatSync(old.path).isFile(), 'record remains a regular file');
      const updated = readEntry(old.path);
      if (action === 'supersedeRecord') {
        assert.equal(updated.data.status, 'superseded');
        assert.equal(updated.data.superseded_by, replacement.id);
        assert.ok(updated.body.includes(`Superseded by ${replacement.id}: Revised`));
      } else {
        assert.equal(updated.data.type, 'learning-record');
        assert.equal(updated.data.title, 'Legacy record');
        assert.equal(updated.body.trim(), '# Legacy record');
      }
      assertLink(temp);
      assert.equal(readlinkSync(temp), target);
      assert.deepEqual(readFileSync(replacement.path), before);
    });
  }
}

const RUN_ID = 'c-20261026-205700';
const RUN = { id: RUN_ID, started: NOW.toISOString(), tasks: ['0001'], minutes: null, pass: null, hints: true };
const RUN_OPTIONS = { minutes: null, pass: null, hints: true };
const REQUIREMENTS = [{ id: 'one', text: 'One', records: [], read: '0001-one.html' }];
const passed = () => ({ requirements: REQUIREMENTS, parsed: { passed: ['one'], failed: [], unreached: [] } });
const runIO = (options = {}) => ({ now: () => NOW, out: assert.fail, err: assert.fail, setup: assert.fail, ...options });

function taskFixture(ws) {
  const task = join(ws, 'evidence', '0001');
  mkdirSync(task, { recursive: true });
  writeFileSync(join(task, 'requirements.json'), JSON.stringify({ version: 1, requirements: REQUIREMENTS }));
  for (const file of ['setup.sh', 'check.sh', 'solution.sh']) writeFileSync(join(task, file), '', { mode: 0o700 });
}

function afterFsCall(t, method, file, change) {
  const original = fs[method];
  let pending = true;
  fs[method] = (path, ...args) => {
    const result = original(path, ...args);
    if (path === file && pending) {
      pending = false;
      change();
    }
    return result;
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs[method] = original;
    syncBuiltinESMExports();
  });
}

test('startRun refuses a dangling run state link and leaves it in place', async (t) => {
  const { ws, outside } = fixture(t);
  const file = join(ws, RUN_FILE);
  if (!link(t, join(outside, 'missing.json'), file)) return;
  taskFixture(ws);
  const before = snapshot(outside);
  await assert.rejects(startRun(ws, ['1'], RUN_OPTIONS, runIO()), runError(RUN_FILE));
  assertLink(file);
  assert.deepEqual(snapshot(outside), before);
});

test('startRun and readRun refuse a linked ending state without reporting its contents', async (t) => {
  const { ws, marker } = fixture(t);
  const ending = join(ws, ENDING_FILE);
  writeFileSync(marker, JSON.stringify(RUN));
  if (!link(t, marker, ending)) return;
  taskFixture(ws);
  const before = readFileSync(marker);
  await assert.rejects(startRun(ws, ['1'], RUN_OPTIONS, runIO()), runError(ENDING_FILE));
  assert.throws(() => readRun(ws), runError(ENDING_FILE));
  assertLink(ending);
  assert.equal(existsSync(join(ws, RUN_FILE)), false);
  assert.deepEqual(readFileSync(marker), before);
});

for (const name of [RUN_FILE, ENDING_FILE]) {
  test(`cancelRun refuses a link at ${name} before reading the state`, (t) => {
    const { root, ws, marker } = fixture(t);
    const file = join(ws, name);
    writeFileSync(marker, JSON.stringify(RUN));
    if (!link(t, marker, file)) return;
    const before = readFileSync(marker);
    let read = false;
    afterFsCall(t, 'readFileSync', file, () => { read = true; });
    assert.throws(() => cancelRun(ws, runIO()), runError(name));
    assert.equal(read, false);
    refused(cli(root, 'check', '--cancel', ws), runError(name).message);
    assertLink(file);
    assert.deepEqual(readFileSync(marker), before);
  });

  test(`cancelRun refuses a link at ${name} immediately before removal`, (t) => {
    const { ws, marker } = fixture(t);
    const file = join(ws, name), staged = join(ws, 'state.link');
    writeFileSync(file, JSON.stringify(RUN));
    if (!link(t, marker, staged)) return;
    afterFsCall(t, 'readFileSync', file, () => {
      rmSync(file);
      renameSync(staged, file);
    });
    assert.throws(() => cancelRun(ws, runIO()), runError(name));
    assertLink(file);
    assert.equal(readFileSync(marker, 'utf8'), 'outside marker\n');
  });
}

test('cancelRun refuses a linked attempt before reading it for a certification match', (t) => {
  const { ws, marker } = fixture(t);
  const dir = join(ws, 'attempts');
  const ending = join(ws, ENDING_FILE);
  const attempt = join(dir, ATTEMPT + '.md');
  mkdirSync(dir);
  writeFileSync(ending, JSON.stringify(RUN));
  if (!link(t, marker, attempt)) return;
  assert.throws(() => cancelRun(ws, runIO()), { message: folderError(`attempts/${ATTEMPT}.md`) });
  assertLink(attempt);
  assert.deepEqual(JSON.parse(readFileSync(ending, 'utf8')), RUN);
  assert.equal(readFileSync(marker, 'utf8'), 'outside marker\n');
});

for (const phase of ['before creation', 'after a failed setup', 'before reading after setup', 'before writing started']) {
  test(`startRun refuses a link at the run state ${phase}`, async (t) => {
    const { ws, outside } = fixture(t);
    const file = join(ws, RUN_FILE), staged = join(ws, 'state.link');
    const target = join(outside, 'other.json');
    if (phase !== 'before creation') writeFileSync(target, JSON.stringify({ ...RUN, id: 'c-20000101-000000' }));
    if (!link(t, target, staged)) return;
    taskFixture(ws);
    const before = snapshot(outside);
    const substitute = () => {
      rmSync(file, { force: true });
      renameSync(staged, file);
    };
    const io = runIO({ out: () => {} });
    if (phase === 'before creation') {
      const write = fs.writeFileSync;
      let wrote = false;
      fs.writeFileSync = (path, ...args) => {
        if (path === file) wrote = true;
        return write(path, ...args);
      };
      syncBuiltinESMExports();
      t.after(() => { fs.writeFileSync = write; syncBuiltinESMExports(); });
      t.after(() => assert.equal(wrote, false));
      io.now = () => { substitute(); return NOW; };
    }
    else if (phase === 'before writing started') {
      let calls = 0;
      io.now = () => { if (++calls === 2) substitute(); return NOW; };
      io.setup = () => ({ code: 0 });
    } else {
      io.setup = () => { substitute(); return { code: phase === 'after a failed setup' ? 1 : 0 }; };
    }
    await assert.rejects(startRun(ws, ['1'], RUN_OPTIONS, io), runError(RUN_FILE));
    assertLink(file);
    assert.deepEqual(snapshot(outside), before);
  });
}

test('endRun refuses a linked attempts folder before renaming the run state', async (t) => {
  const { ws, outside } = fixture(t);
  const file = join(ws, RUN_FILE);
  const dir = join(ws, 'attempts');
  writeFileSync(file, JSON.stringify(RUN));
  link(t, outside, dir, 'dir');
  const before = snapshot(outside);
  await assert.rejects(endRun(ws, SCHEMA, runIO({ checker: passed })), { message: ATTEMPT_ERROR });
  assertLink(dir);
  assert.deepEqual(snapshot(outside), before);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), RUN);
  assert.equal(lstatSync(join(ws, ENDING_FILE), { throwIfNoEntry: false }), undefined);
});

for (const name of [RUN_FILE, ENDING_FILE]) {
  test(`endRun refuses a link at ${name} immediately before renaming`, async (t) => {
    const { ws, marker } = fixture(t);
    const file = join(ws, RUN_FILE), ending = join(ws, ENDING_FILE), staged = join(ws, 'state.link');
    const original = join(ws, 'original.json');
    writeFileSync(file, JSON.stringify(RUN));
    if (!link(t, marker, staged)) return;
    const checker = () => {
      if (name === RUN_FILE) renameSync(file, original);
      renameSync(staged, join(ws, name));
      return passed();
    };
    await assert.rejects(endRun(ws, SCHEMA, runIO({ checker })), runError(name));
    assertLink(join(ws, name));
    assert.deepEqual(JSON.parse(readFileSync(name === RUN_FILE ? original : file, 'utf8')), RUN);
    assert.equal(existsSync(ending), name === ENDING_FILE);
    assert.equal(existsSync(join(ws, 'attempts')), false);
    assert.equal(readFileSync(marker, 'utf8'), 'outside marker\n');
  });
}

test('endRun refuses a substituted ending link before removing the ending state', async (t) => {
  const { ws, marker } = fixture(t);
  const ending = join(ws, ENDING_FILE), staged = join(ws, 'state.link');
  writeFileSync(join(ws, RUN_FILE), JSON.stringify(RUN));
  if (!link(t, marker, staged)) return;
  afterFsCall(t, 'writeFileSync', join(ws, 'attempts', ATTEMPT + '.md'), () => {
    rmSync(ending);
    renameSync(staged, ending);
  });
  await assert.rejects(endRun(ws, SCHEMA, runIO({ checker: passed })), runError(ENDING_FILE));
  assertLink(ending);
  assert.equal(readFileSync(marker, 'utf8'), 'outside marker\n');
});

test('fixRecordFrontmatter refuses a linked record before reading its type', (t) => {
  const { ws } = fixture(t);
  const { path } = writeRecord(ws, record('Old'), SCHEMA);
  const target = join(ws, 'typed.md');
  renameSync(path, target);
  if (!link(t, target, path)) return;
  const before = readFileSync(target);
  assert.throws(() => fixRecordFrontmatter(ws, '0001-old.md', NOW), { message: folderError('learning-records/0001-old.md') });
  assertLink(path);
  assert.deepEqual(readFileSync(target), before);
});

test('lint --fix preserves an outside link at the old temporary name while fixing records', (t) => {
  const { root, ws, marker } = fixture(t);
  const dir = join(ws, 'learning-records');
  mkdirSync(dir);
  const first = join(dir, '0001-first.md'), second = join(dir, '0002-second.md');
  writeFileSync(first, '# First\n');
  writeFileSync(second, '# Second\n');
  const temp = second + '.tmp';
  if (!link(t, marker, temp)) return;
  const before = readFileSync(marker);
  const result = cli(root, 'lint', '--fix', ws, '--vault', root);
  assert.equal(result.status, 1, result.stdout + result.stderr); // The minimal workspace still has lint findings.
  assert.ok(result.stdout.split('\n').includes('fixed 2 record(s)'), result.stdout);
  assert.equal(result.stderr, '');
  assertLink(temp);
  assert.equal(readlinkSync(temp), marker);
  assert.deepEqual(readFileSync(marker), before);
  for (const [path, title] of [[first, 'First'], [second, 'Second']]) {
    assert.ok(lstatSync(path).isFile());
    const updated = readEntry(path);
    assert.equal(updated.data.type, 'learning-record');
    assert.equal(updated.data.title, title);
    assert.equal(updated.body.trim(), `# ${title}`);
  }
});

test('fixRecordFrontmatters preserves an outside old temporary link introduced before a planned fix', (t) => {
  const { ws, marker } = fixture(t);
  const dir = join(ws, 'learning-records');
  mkdirSync(dir);
  const first = join(dir, '0001-first.md'), second = join(dir, '0002-second.md');
  writeFileSync(first, '# First\n');
  writeFileSync(second, '# Second\n');
  const staged = join(dir, 'temp.link'), temp = first + '.tmp';
  if (!link(t, marker, staged)) return;
  const before = readFileSync(marker);
  afterFsCall(t, 'readFileSync', second, () => renameSync(staged, temp));
  fixRecordFrontmatters(ws, ['0001-first.md', '0002-second.md']);
  assertLink(temp);
  assert.equal(readlinkSync(temp), marker);
  assert.deepEqual(readFileSync(marker), before);
  for (const [path, title] of [[first, 'First'], [second, 'Second']]) {
    assert.ok(lstatSync(path).isFile());
    const updated = readEntry(path);
    assert.equal(updated.data.type, 'learning-record');
    assert.equal(updated.data.title, title);
    assert.equal(updated.body.trim(), `# ${title}`);
  }
});

test('supersedeRecord refuses a record destination redirected before its rewrite', (t) => {
  const { ws } = fixture(t);
  const old = writeRecord(ws, record('Old'), SCHEMA);
  const replacement = writeRecord(ws, record('Replacement'), SCHEMA);
  const target = join(ws, 'old.md'), staged = join(ws, 'record.link');
  if (!link(t, target, staged)) return;
  const before = readFileSync(old.path);
  const reason = {
    toString() {
      renameSync(old.path, target);
      renameSync(staged, old.path);
      return 'Revised';
    },
  };
  assert.throws(() => supersedeRecord(ws, old.id, replacement.id, reason, SCHEMA),
    { message: folderError('learning-records/0001-old.md') });
  assertLink(old.path);
  assert.deepEqual(readFileSync(target), before);
});

test('endRun refuses a linked attempt destination before renaming the run state', async (t) => {
  const { ws, marker } = fixture(t);
  const file = join(ws, RUN_FILE);
  const dir = join(ws, 'attempts'), attempt = join(dir, ATTEMPT + '.md');
  writeFileSync(file, JSON.stringify(RUN));
  mkdirSync(dir);
  if (!link(t, marker, attempt)) return;
  await assert.rejects(endRun(ws, SCHEMA, runIO({ checker: passed })), { message: folderError(`attempts/${ATTEMPT}.md`) });
  assertLink(attempt);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), RUN);
  assert.equal(lstatSync(join(ws, ENDING_FILE), { throwIfNoEntry: false }), undefined);
  assert.equal(readFileSync(marker, 'utf8'), 'outside marker\n');
});

test('writeAttempt refuses a linked destination immediately before creating the attempt', (t) => {
  const { ws, outside } = fixture(t);
  const dir = join(ws, 'attempts');
  const attempt = join(dir, ATTEMPT + '.md'), staged = join(dir, 'attempt.link');
  mkdirSync(dir);
  if (!link(t, join(outside, 'missing.md'), staged)) return;
  const before = snapshot(outside);
  afterFsCall(t, 'existsSync', attempt, () => renameSync(staged, attempt));
  assert.throws(() => writeAttempt(ws, { ...ANSWERS, now: NOW }, SCHEMA),
    { message: folderError(`attempts/${ATTEMPT}.md`) });
  assertLink(attempt);
  assert.deepEqual(snapshot(outside), before);
});

test('fixRecordFrontmatter refuses a record name held outside its workspace folder', (t) => {
  const { ws, outside } = fixture(t);
  const dir = join(ws, 'learning-records');
  mkdirSync(dir);
  const record = join(dir, '0001-legacy.md'), alias = join(dir, 'nested');
  const outerName = join(outside, '0001-legacy.md');
  writeFileSync(record, '# Legacy\n');
  if (!link(t, record, outerName)) return;
  link(t, outside, alias, 'dir');
  assert.throws(() => fixRecordFrontmatter(ws, join('nested', '0001-legacy.md'), NOW),
    { message: folderError('learning-records/nested/0001-legacy.md') });
  assertLink(outerName);
  assertLink(alias);
  assert.equal(readFileSync(record, 'utf8'), '# Legacy\n');
});

test('readRun refuses a certification state link even within the workspace', (t) => {
  const { ws } = fixture(t);
  const file = join(ws, RUN_FILE), target = join(ws, 'state.json');
  writeFileSync(target, JSON.stringify(RUN));
  if (!link(t, target, file)) return;
  assert.throws(() => readRun(ws), runError(RUN_FILE));
  assertLink(file);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), RUN);
});

test('cancelRun refuses a redirected attempts folder before listing an empty set of attempts', (t) => {
  const { ws, outside } = fixture(t);
  const ending = join(ws, ENDING_FILE), dir = join(ws, 'attempts');
  writeFileSync(ending, JSON.stringify(RUN));
  link(t, outside, dir, 'dir');
  assert.throws(() => cancelRun(ws, runIO()), { message: ATTEMPT_ERROR });
  assertLink(dir);
  assert.deepEqual(JSON.parse(readFileSync(ending, 'utf8')), RUN);
});

test('cancelRun refuses a linked attempt immediately before removal', (t) => {
  const { ws, marker } = fixture(t);
  const dir = join(ws, 'attempts'), ending = join(ws, ENDING_FILE);
  const attempt = join(dir, 'a.md'), staged = join(ws, 'attempt.link');
  mkdirSync(dir);
  writeFileSync(ending, JSON.stringify(RUN));
  writeFileSync(attempt, `---\ncertification: ${RUN_ID}\n---\n`);
  if (!link(t, marker, staged)) return;
  afterFsCall(t, 'readFileSync', attempt, () => {
    rmSync(attempt);
    renameSync(staged, attempt);
  });
  assert.throws(() => cancelRun(ws, runIO()), { message: folderError('attempts/a.md') });
  assertLink(attempt);
  assert.deepEqual(JSON.parse(readFileSync(ending, 'utf8')), RUN);
  assert.equal(readFileSync(marker, 'utf8'), 'outside marker\n');
});

test('workspace folder assertion refuses a directory nested at a different workspace location', (t) => {
  const { ws } = fixture(t);
  const dir = join(ws, 'lessons', 'attempts');
  mkdirSync(dir);
  assert.throws(() => assertInsideWorkspaceFolder(ws, dir), { message: ATTEMPT_ERROR });
  assert.deepEqual(readdirSync(dir), []);
});

test('POST /attempt refuses a server whose original workspace location was unavailable', async (t) => {
  const { root } = fixture(t);
  const ws = join(root, 'missing');
  const server = createServer(ws, { schema: SCHEMA });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetchPath(server.address().port, '/attempt', JSON.stringify(ANSWERS));
    assert.deepEqual(response, { status: 500, text: '.: workspace location changed or cannot be resolved\n' });
    assert.equal(existsSync(ws), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
