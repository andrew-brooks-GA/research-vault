// Issue 79: a checked task's requirements file, its checker's output and `teach check` (commit 2: D3, D4 without
// recording). Every checker a test here starts runs in a temp copy of test/fixtures/teach-task, and every test leaves
// no process of the group it started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRequirements, parseChecker, checkTask } from '../bin/lib/task.mjs';
import { teachIndex, progress, progressHtml, workspaceKey, attemptOrder } from '../bin/lib/teach.mjs';
import { parseFrontmatter } from '../bin/lib/frontmatter.mjs';
import { lintWorkspace } from '../bin/lib/lesson.mjs';
import { loadSchema, loadTeachSchema } from '../bin/lib/schema.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { fixtureVault, testEnv } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const FIX = join(ROOT, 'test', 'fixtures', 'teach-task');
const USAGE_RE = /^usage: research-vault teach /;

const copy = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rv-task-')));
  cpSync(FIX, dir, { recursive: true });
  return dir;
};
const script = (ws, name) => assert.equal(spawnSync(join(ws, 'evidence', '0001', name), [], { env: testEnv(), cwd: ws }).status, 0, name);
const runCheck = (ws, args, stdio) => spawnSync(process.execPath, [BIN, 'teach', 'check', ...args, ws], { env: testEnv(), encoding: 'utf8', timeout: 30000, stdio });
const check = (ws, ...args) => runCheck(ws, args);
const editFile = (path, from, to) => writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
const writeReqs = (ws, doc) => writeFileSync(join(ws, 'evidence', '0001', 'requirements.json'), typeof doc === 'string' ? doc : JSON.stringify(doc));
const writeChecker = (ws, body, timeout) => {
  writeFileSync(join(ws, 'evidence', '0001', 'check.sh'), `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
  if (timeout) editFile(join(ws, 'evidence', '0001', 'requirements.json'), '"timeout": 60', `"timeout": ${timeout}`);
};
// The checker writes its own pid, which leads its process group, to checker.pid.
const groupGone = (pgid) => { try { process.kill(-pgid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };

const REQS = JSON.parse(readFileSync(join(FIX, 'evidence', '0001', 'requirements.json'), 'utf8')).requirements;
const parse = (code, lines) => parseChecker(REQS, { code, stdout: lines.map((l) => `${l}\n`).join('') });

test('parseChecker: every id ok with exit 0 passes them all; a line of neither form is ignored', () => {
  assert.deepEqual(parse(0, ['ok a-exists', 'ok b-exists', 'ok b-text']), { passed: ['a-exists', 'b-exists', 'b-text'], failed: [], unreached: [] });
  assert.deepEqual(parse(0, ['checking teach-0001', 'ok a-exists', 'okay b-exists', 'OK, all checked', 'FAIL nope', 'OK nope', 'ok b-exists', 'ok b-text']),
    { passed: ['a-exists', 'b-exists', 'b-text'], failed: [], unreached: [] });
});

test('parseChecker: a checker that prints CRLF is read as LF', () => {
  const crlf = (code, lines) => parseChecker(REQS, { code, stdout: lines.map((l) => `${l}\r\n`).join('') });
  assert.deepEqual(crlf(0, ['ok a-exists', 'ok b-exists', 'ok b-text']), { passed: ['a-exists', 'b-exists', 'b-text'], failed: [], unreached: [] });
  assert.deepEqual(crlf(1, ['ok a-exists', 'FAIL b-exists: make b.txt']), { passed: ['a-exists'], failed: [{ id: 'b-exists', hint: 'make b.txt' }], unreached: ['b-text'] });
});

test('parseChecker: one FAIL then silence with exit 1 leaves the rest unreached', () => {
  assert.deepEqual(parse(1, ['FAIL a-exists: make a.txt']), { passed: [], failed: [{ id: 'a-exists', hint: 'make a.txt' }], unreached: ['b-exists', 'b-text'] });
  assert.deepEqual(parse(1, ['ok a-exists', 'FAIL b-exists: make b.txt']), { passed: ['a-exists'], failed: [{ id: 'b-exists', hint: 'make b.txt' }], unreached: ['b-text'] });
});

test('parseChecker: each problem of D3 is a problem, never a result', () => {
  const cases = [
    [7, ['ok a-exists'], 'check.sh exited 7'],
    ['SIGTERM', [], 'check.sh exited SIGTERM'],
    [0, ['ok a-exists', 'ok b-exists'], 'check.sh exited 0 without ok for every requirement'],
    [0, ['ok a-exists', 'ok b-exists', 'FAIL b-text: put hello in b.txt'], 'check.sh exited 0 without ok for every requirement'],
    [1, ['ok a-exists'], 'check.sh exited 1 with no FAIL line'],
    [0, ['ok a-exists', 'ok b-exists', 'ok b-text', 'ok nope'], 'check.sh printed "nope", which requirements.json does not hold'],
    [1, ['FAIL nope: x'], 'check.sh printed "nope", which requirements.json does not hold'],
    [0, ['ok a-exists', 'ok a-exists', 'ok b-exists', 'ok b-text'], 'check.sh printed a-exists twice'],
    [1, ['ok a-exists', 'FAIL a-exists: x'], 'check.sh printed a-exists twice'],
    [1, ['FAIL a-exists: bad \u001b[31m hint'], "check.sh printed a hint for a-exists with a control, line-separator or bidi character"],
    [1, ['FAIL a-exists: bad \u202e hint'], "check.sh printed a hint for a-exists with a control, line-separator or bidi character"],
    // A line that starts with ok or FAIL and an id, in neither form, is named, not skipped.
    [0, ['OK a-exists', 'ok b-exists', 'ok b-text'], 'check.sh printed "OK a-exists", which is not of the form ok <id> or FAIL <id>: <hint>'],
    [0, ['ok: a-exists', 'ok b-exists', 'ok b-text'], 'check.sh printed "ok: a-exists", which is not of the form ok <id> or FAIL <id>: <hint>'],
    [0, ['ok a-exists ', 'ok b-exists', 'ok b-text'], 'check.sh printed "ok a-exists", which is not of the form ok <id> or FAIL <id>: <hint>'],
    [1, ['ok a-exists', 'FAIL b-exists'], 'check.sh printed "FAIL b-exists", which is not of the form ok <id> or FAIL <id>: <hint>'],
    [1, ['FAIL: a-exists missing'], 'check.sh printed "FAIL: a-exists missing", which is not of the form ok <id> or FAIL <id>: <hint>'],
    [1, ['oK a-exists'], 'check.sh printed "oK a-exists", which is not of the form ok <id> or FAIL <id>: <hint>'],
    [0, ['ok:a-exists', 'ok b-exists', 'ok b-text'], 'check.sh printed "ok:a-exists", which is not of the form ok <id> or FAIL <id>: <hint>'],
  ];
  for (const [code, lines, problem] of cases) assert.deepEqual(parse(code, lines), { problem }, lines.join(' | '));
});

test('readRequirements: the fixture file, with the timeout 60 when absent', () => {
  const ws = copy();
  assert.deepEqual(readRequirements(ws, '0001'), { timeout: 60, requirements: REQS, problems: [] });
  editFile(join(ws, 'evidence', '0001', 'requirements.json'), '"timeout": 60,', '');
  assert.equal(readRequirements(ws, '0001').timeout, 60);
  editFile(join(ws, 'evidence', '0001', 'requirements.json'), '"version": 1,', '"version": 1, "timeout": 600,');
  assert.deepEqual(readRequirements(ws, '0001'), { timeout: 600, requirements: REQS, problems: [] });
});

test('readRequirements: one problem for each broken rule', () => {
  const doc = JSON.parse(readFileSync(join(FIX, 'evidence', '0001', 'requirements.json'), 'utf8'));
  const req = (i, patch) => ({ ...doc, requirements: doc.requirements.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const cases = [
    [{ ...doc, extra: 1 }, 'requirements.json has the key "extra", which is not allowed'],
    [req(1, { note: 'x' }), 'requirement 2 has the key "note", which is not allowed'],
    [req(0, { id: 'A-exists' }), 'requirement 1: id "A-exists" does not match ^[a-z][a-z0-9-]{0,39}$'],
    [req(2, { id: 'a-exists' }), 'requirement 3: id a-exists is repeated'],
    [{ ...doc, requirements: [] }, 'requirements must be a list of one or more'],
    [{ ...doc, timeout: 0 }, 'timeout must be a whole number of seconds from 1 to 600'],
    [{ ...doc, timeout: 601 }, 'timeout must be a whole number of seconds from 1 to 600'],
    [req(0, { text: 'The file\u0007 exists.' }), 'requirement 1: text must be 1 to 300 characters with no control, line-separator or bidi character'],
    [req(0, { records: ['0001-files', '0009-nope'] }), 'requirement 1: record 0009-nope is not in learning-records/'],
    [{ ...doc, version: 2 }, 'version must be 1'],
    ['{', 'requirements.json is not JSON'],
  ];
  for (const [d, problem] of cases) {
    const ws = copy();
    writeReqs(ws, d);
    const r = readRequirements(ws, '0001');
    assert.deepEqual([r.timeout, r.problems], [60, [problem]], problem);
  }
  // With problems, the list keeps only the requirements whose id, text and read are valid (the lint checks each).
  const keep = copy();
  writeReqs(keep, req(0, { id: 'A-exists' }));
  assert.deepEqual(readRequirements(keep, '0001').requirements.map((r) => r.id), ['b-exists', 'b-text']);
  writeReqs(keep, req(0, { records: ['0009-nope'] }));
  assert.deepEqual(readRequirements(keep, '0001').requirements.map((r) => r.id), ['a-exists', 'b-exists', 'b-text']);
  const ws = copy();
  rmSync(join(ws, 'evidence', '0001', 'requirements.json'));
  assert.deepEqual(readRequirements(ws, '0001').problems, ['evidence/0001/requirements.json is missing']);
});

const FAILED = [
  'FAIL a-exists: The file teach-0001/a.txt exists.',
  '  hint: make the file a.txt inside teach-0001',
  '  read: 0001-files.html',
  'not reached b-exists: The file teach-0001/b.txt exists.',
  'not reached b-text: The file teach-0001/b.txt holds the word hello.',
];
const SOLVED = ['ok a-exists: The file teach-0001/a.txt exists.', 'ok b-exists: The file teach-0001/b.txt exists.', 'ok b-text: The file teach-0001/b.txt holds the word hello.'];
const CHECK_LINE = (nnnn = '0001') => `check: evidence/${nnnn}/check.sh\n`;
const SHELL_TEST = { skip: process.platform === 'win32' && 'requires executable shell scripts' };

function markCheckerStart(ws, nnnn) {
  const shebang = '#!/usr/bin/env bash\n';
  editFile(join(ws, 'evidence', nnnn, 'check.sh'), shebang, `${shebang}printf 'started ${nnnn}\\n' >> checker-order.log\n`);
}

// Put both CLI streams and the checker's start marker in the same append log to observe their order.
function checkOrder(ws, ...args) {
  const path = join(ws, 'checker-order.log');
  const log = openSync(path, 'a');
  try {
    const r = runCheck(ws, args, ['ignore', log, log]);
    assert.ifError(r.error);
    return [r.status, readFileSync(path, 'utf8')];
  } finally { closeSync(log); }
}

test('checkTask announces the checker before calling its runner', async () => {
  const ws = copy();
  const lines = [];
  const r = await checkTask(ws, '0001', {
    err: (line) => lines.push(`${line}\n`),
    runner: () => {
      assert.deepEqual(lines, [CHECK_LINE()]);
      return { code: 0, stdout: 'ok a-exists\nok b-exists\nok b-text\n' };
    },
  });
  assert.deepEqual(r.parsed.passed, ['a-exists', 'b-exists', 'b-text']);
  assert.deepEqual(lines, [CHECK_LINE()]);
});

test('checkTask returns the same result and calls its runner when the announcement writer throws', async () => {
  const ws = copy();
  let calls = 0;
  const runner = () => {
    calls++;
    return { code: 0, stdout: 'ok a-exists\nok b-exists\nok b-text\n' };
  };
  const expected = await checkTask(ws, '0001', { err: () => {}, runner });
  const err = () => { throw new Error('cannot write to standard error'); };
  assert.deepEqual(await checkTask(ws, '0001', { err, runner }), expected);
  assert.equal(calls, 2);
});

test('teach check announces nothing when the evidence or attempts folder is refused', () => {
  const ws = copy();
  writeFileSync(join(ws, 'attempts'), 'a regular file\n');
  const missing = check(ws, '9');
  assert.deepEqual([missing.status, missing.stdout, missing.stderr], [2, '', 'teach check: 0009: no evidence/0009/ folder\n']);
  const attempts = check(ws, '1');
  assert.deepEqual([attempts.status, attempts.stdout, attempts.stderr], [2, '', 'error: attempts/: path is outside its workspace folder or cannot be resolved\n']);
});

test('teach check: after setup.sh it fails the first requirement, with the hint and read lines, and reaches no other', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  const r = check(ws, '1');
  assert.equal(r.stderr, CHECK_LINE());
  assert.equal(r.stdout, FAILED.join('\n') + '\n');
  assert.equal(r.status, 1);
});

test('teach check: after solution.sh every requirement is ok, exit 0', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  script(ws, 'solution.sh');
  const r = check(ws, '0001');
  assert.equal(r.stderr, CHECK_LINE());
  assert.equal(r.stdout, SOLVED.join('\n') + '\n');
  assert.equal(r.status, 0);
});

test('teach check: with Hints: on request the hint waits for --hints, and the last line says how to ask', () => {
  const ws = copy();
  editFile(join(ws, 'MISSION.md'), '- Hints: always', '- Hints: on request');
  script(ws, 'setup.sh');
  const r = check(ws, '1');
  assert.equal(r.stdout, [FAILED[0], ...FAILED.slice(2), 'hints: ./check --hints 1'].join('\n') + '\n');
  assert.equal(r.status, 1);
  const h = check(ws, '--hints', '1');
  assert.equal(h.stderr, CHECK_LINE());
  assert.equal(h.stdout, FAILED.join('\n') + '\n');
  assert.equal(h.status, 1);
  // Every requirement ok: no hints: line.
  script(ws, 'solution.sh');
  assert.equal(check(ws, '1').stdout, SOLVED.join('\n') + '\n');
});

test('teach check prints no count and no fraction', () => {
  const ws = copy();
  editFile(join(ws, 'MISSION.md'), '- Hints: always', '- Hints: on request');
  script(ws, 'setup.sh');
  const outs = [check(ws, '1').stdout, check(ws, '--hints', '1').stdout];
  script(ws, 'solution.sh');
  outs.push(check(ws, '1').stdout);
  for (const o of outs) for (const line of o.split('\n')) assert.doesNotMatch(line, /\d+ of \d+|\d+\/\d+/, line);
});

test('teach check: with the lesson file removed, --dry-run still runs and a plain run exits 2', () => {
  const ws = copy();
  rmSync(join(ws, 'lessons', '0001-files.html'));
  script(ws, 'setup.sh');
  const d = check(ws, '--dry-run', '1');
  assert.equal(d.stderr, CHECK_LINE());
  assert.equal(d.stdout, FAILED.join('\n') + '\n');
  assert.equal(d.status, 1);
  const r = check(ws, '1');
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'teach check: 0001: no lessons/0001-*.html\n');
  assert.equal(r.status, 2);
});

test('teach check: two lessons/0001-*.html files exit 2 without --dry-run', () => {
  const ws = copy();
  cpSync(join(ws, 'lessons', '0001-files.html'), join(ws, 'lessons', '0001-other.html'));
  script(ws, 'setup.sh');
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: 0001: more than one lessons/0001-*.html\n']);
  assert.equal(check(ws, '--dry-run', '1').status, 1);
});

test('teach check exits 2 without a report for invalid requirements or a checker problem, announcing only the checker that runs', () => {
  const ws = copy();
  writeReqs(ws, '{');
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: 0001: requirements.json is not JSON\n']);
  const w = copy();
  writeChecker(w, 'echo "ok a-exists"\necho "first" >&2\necho "the last line" >&2\nexit 1\n');
  const p = check(w, '1');
  assert.deepEqual([p.status, p.stdout, p.stderr], [2, '', CHECK_LINE() + 'teach check: 0001: check.sh exited 1 with no FAIL line; stderr: the last line\n']);
});

test('the runner: a checker that hangs is stopped at the timeout, exit 2, and no process of its group is left', () => {
  const ws = copy();
  writeChecker(ws, 'echo $$ > checker.pid\nsleep 30 & sleep 30\n', 1);
  const t0 = Date.now();
  const r = check(ws, '1');
  const pgid = Number(readFileSync(join(ws, 'checker.pid'), 'utf8'));
  try {
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
    assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', CHECK_LINE() + 'teach check: 0001: ran past 1 seconds\n']);
    assert.ok(groupGone(pgid), `group ${pgid} is still there`);
  } finally { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
});

test('the runner: a checker that prints every ok and exits while a background sleep holds its output returns at once and leaves no sleep', () => {
  const ws = copy();
  writeChecker(ws, 'echo $$ > checker.pid\nsleep 20 &\necho $! > sleep.pid\necho "ok a-exists"\necho "ok b-exists"\necho "ok b-text"\n');
  const t0 = Date.now();
  const r = check(ws, '1');
  const pgid = Number(readFileSync(join(ws, 'checker.pid'), 'utf8'));
  const sleeper = Number(readFileSync(join(ws, 'sleep.pid'), 'utf8'));
  try {
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, SOLVED.join('\n') + '\n', CHECK_LINE()]);
    assert.throws(() => process.kill(sleeper, 0), { code: 'ESRCH' });
    assert.ok(groupGone(pgid), `group ${pgid} is still there`);
  } finally { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`the runner: ${sig} to teach check while the checker sleeps stops its group, exit 2`, async () => {
    const ws = copy();
    writeChecker(ws, 'echo $$ > checker.pid\nsleep 30 & sleep 30\n');
    const child = spawn(process.execPath, [BIN, 'teach', 'check', '1', ws], { env: testEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b; });
    const exited = once(child, 'exit');
    const pidFile = join(ws, 'checker.pid');
    for (const end = Date.now() + 10000; !(existsSync(pidFile) && readFileSync(pidFile, 'utf8').endsWith('\n')) && Date.now() < end;) await new Promise((ok) => setTimeout(ok, 20));
    const pgid = Number(readFileSync(pidFile, 'utf8'));
    try {
      child.kill(sig);
      const [code] = await exited;
      assert.equal(code, 2);
      assert.equal(stderr, CHECK_LINE() + `teach check: 0001: stopped by ${sig}\n`);
      assert.ok(groupGone(pgid), `group ${pgid} is still there`);
    } finally { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
  });
}

test('the runner: a checker that prints 2 MiB is stopped, exit 2', () => {
  const ws = copy();
  writeChecker(ws, "head -c 2097152 /dev/zero | tr '\\0' x\n");
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', CHECK_LINE() + 'teach check: 0001: output past 1 MiB\n']);
});

test('the runner: the 1 MiB cap counts standard error too', () => {
  const ws = copy();
  writeChecker(ws, "head -c 2097152 /dev/zero | tr '\\0' x >&2\n");
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', CHECK_LINE() + 'teach check: 0001: output past 1 MiB\n']);
});

test('the runner: a checker without the executable bit cannot start, exit 2', () => {
  const ws = copy();
  chmodSync(join(ws, 'evidence', '0001', 'check.sh'), 0o644);
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', CHECK_LINE() + 'teach check: 0001: check.sh could not start (EACCES)\n']);
});

test('teach check arguments: no evidence folder, no number, and a flag before the number', () => {
  const ws = copy();
  const none = check(ws, '9');
  assert.deepEqual([none.status, none.stdout, none.stderr], [2, '', 'teach check: 0009: no evidence/0009/ folder\n']);
  const bare = check(ws);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, USAGE_RE);
  assert.ok(bare.stderr.includes('check [--dry-run] [--hints] <N> [workspace]'));
  const two = check(ws, '1', '2');
  assert.equal(two.status, 2);
  assert.match(two.stderr, USAGE_RE);
  script(ws, 'setup.sh');
  for (const flag of ['--hints', '--dry-run']) {
    const r = check(ws, flag, '1');
    assert.equal(r.status, 1, flag);
    assert.ok(r.stdout.startsWith(FAILED[0]), flag);
  }
});

// Issue 79 commit 4 (D5, D6, D7): a check records an attempt when its lists change, an answer is recorded, and every
// view shows a task attempt as its summary, never as a score.
const TODAY = new Date().toISOString().slice(0, 10);
const teach = (ws, ...args) => spawnSync(process.execPath, [BIN, 'teach', ...args, ws], { env: testEnv(), encoding: 'utf8', timeout: 30000 });
// In the order teachIndex reads them: a-...-0001.md before a-...-0001-2.md.
const attemptFiles = (ws) => (existsSync(join(ws, 'attempts')) ? readdirSync(join(ws, 'attempts')).sort((x, y) => attemptOrder(x.slice(0, -3), y.slice(0, -3))) : []);
const attemptAt = (ws, i) => parseFrontmatter(readFileSync(join(ws, 'attempts', attemptFiles(ws).at(i)), 'utf8')).data;

test('teach check with a closed stderr pipe still exits with the same status, report and attempt', SHELL_TEST, async () => {
  const workingWs = copy();
  const working = check(workingWs, '1');
  assert.ifError(working.error);
  assert.deepEqual([working.status, working.stdout, working.stderr], [1, FAILED.join('\n') + '\n', CHECK_LINE()]);

  const ws = copy();
  const preload = join(ws, 'wait-for-stdin.mjs');
  // Wait for the parent to close the stderr reader before allowing the CLI to start.
  writeFileSync(preload, "import { finished } from 'node:stream/promises';\nawait finished(process.stdin.resume());\n");
  const child = spawn(process.execPath, ['--import', preload, BIN, 'teach', 'check', '1', ws], {
    env: testEnv(), stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000,
  });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (s) => { stdout += s; });
  child.stderr.once('close', () => child.stdin.destroy());
  child.stderr.destroy();
  const [status, signal] = await once(child, 'close');
  assert.deepEqual([status, signal, stdout], [working.status, working.signal, working.stdout]);
  assert.equal(attemptFiles(workingWs).length, 1);
  assert.equal(attemptFiles(ws).length, 1);
  const expected = attemptAt(workingWs, 0);
  // The two checks can straddle midnight.
  assert.deepEqual({ ...attemptAt(ws, 0), date: expected.date }, expected);
});

const record = (ws, id = '0001-files') => teachIndex(ws, { now: new Date() }).records.find((r) => r.id === id);
const nextLine = (ws, prefix) => teach(ws, 'next').stdout.split('\n').find((l) => l.startsWith(prefix));
const write = (ws, rel, text) => { mkdirSync(dirname(join(ws, rel)), { recursive: true }); writeFileSync(join(ws, rel), text); };
// a.txt made, b.txt not: a-exists ok, b-exists failed, b-text not reached.
const half = (ws) => { script(ws, 'setup.sh'); writeFileSync(join(ws, 'teach-0001', 'a.txt'), 'one\n'); };
const solved = (ws) => { script(ws, 'setup.sh'); script(ws, 'solution.sh'); };
// The fixture lesson with a one-item quiz whose item tests a second record, 0002-quiz.
const withQuiz = (ws) => {
  write(ws, 'learning-records/0002-quiz.md', '---\ntitle: quiz\ntype: learning-record\ndate: 2026-01-01\nstatus: active\nkind: understanding\n---\n# quiz\n');
  editFile(join(ws, 'lessons', '0001-files.html'), '<section data-block="sources"',
    '<section data-block="quiz"><script type="application/json" data-quiz>{ "items": [ { "q": "Which command makes a folder?", "options": ["mkdir", "rm", "ls"], "correct": 0, "why": ["Right.", "That removes.", "That lists."], "record": "0002-quiz" } ] }</script></section>\n\n<section data-block="sources"');
  return ws;
};

test('recording: a failing check writes one attempt with its lists; the same run again and --dry-run write none', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  assert.equal(check(ws, '1').status, 1);
  assert.equal(attemptFiles(ws).length, 1);
  const a = attemptAt(ws, 0);
  assert.equal(a.lesson, '0001-files');
  assert.deepEqual([a.passed, a.failed, a.unreached, a.total, a.wrong], [[], ['a-exists'], ['b-exists', 'b-text'], 3, [0, 1, 2]]);
  assert.deepEqual([a.tested, a.records], [[], []]);
  assert.equal(check(ws, '1').status, 1);
  assert.equal(check(ws, '--dry-run', '1').status, 1);
  assert.equal(attemptFiles(ws).length, 1);
  // A dry run of a changed result writes nothing either.
  script(ws, 'solution.sh');
  assert.equal(check(ws, '--dry-run', '1').status, 0);
  assert.equal(attemptFiles(ws).length, 1);
});

test('recording: fail, pass, then the same fail write three attempts', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  check(ws, '1');
  script(ws, 'solution.sh');
  check(ws, '1');
  script(ws, 'setup.sh');
  check(ws, '1');
  assert.equal(attemptFiles(ws).length, 3);
  assert.deepEqual(attemptAt(ws, 1).passed, ['a-exists', 'b-exists', 'b-text']);
  assert.deepEqual(attemptAt(ws, 1).tested, ['0001-files']);
  assert.deepEqual(attemptAt(ws, 2).failed, ['a-exists']);
});

test('recording: a quiz attempt between two equal failing checks does not make the second one written', () => {
  const ws = withQuiz(copy());
  script(ws, 'setup.sh');
  check(ws, '1');
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answers', '0').status, 0);
  check(ws, '1');
  assert.equal(attemptFiles(ws).length, 2);
});

test('two requirements, one record: the record counts only when the run reached both', () => {
  const ws = copy();
  half(ws);
  check(ws, '1');
  let a = attemptAt(ws, -1);
  assert.deepEqual([a.passed, a.failed, a.unreached, a.tested, a.records], [['a-exists'], ['b-exists'], ['b-text'], ['0001-files'], ['0001-files']]);
  assert.equal(record(ws).reviewFailed, true);
  // a-exists failed and the run stopped before b-exists: not tested, and the record stays failed.
  script(ws, 'setup.sh');
  check(ws, '1');
  a = attemptAt(ws, -1);
  assert.deepEqual([a.failed, a.tested, a.records], [['a-exists'], [], []]);
  assert.equal(record(ws).reviewFailed, true);
  // From a pass, the same stopped run leaves it not failed.
  solved(ws);
  check(ws, '1');
  assert.equal(record(ws).reviewFailed, false);
  script(ws, 'setup.sh');
  check(ws, '1');
  assert.equal(attemptFiles(ws).length, 4);
  assert.equal(record(ws).reviewFailed, false);
  assert.equal(record(ws).lastAttempt.id, attemptFiles(ws).at(-2).slice(0, -3));
});

test('a failed requirement makes its record review-failed; a later run with every id ok clears it', () => {
  const ws = copy();
  half(ws);
  check(ws, '1');
  assert.equal(record(ws).reviewFailed, true);
  assert.equal(nextLine(ws, 'review-failed:'), 'review-failed: 0001-files');
  solved(ws);
  check(ws, '1');
  assert.equal(record(ws).reviewFailed, false);
  assert.equal(nextLine(ws, 'review-failed:'), 'review-failed: none');
});

test('a lesson with a quiz and a task: a task attempt does not change the last attempt of a record only the quiz tests', () => {
  const ws = withQuiz(copy());
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answers', '1').status, 0);
  const before = record(ws, '0002-quiz').lastAttempt;
  assert.equal(before.kind, 'quiz');
  assert.equal(record(ws, '0002-quiz').reviewFailed, true);
  half(ws);
  check(ws, '1');
  solved(ws);
  check(ws, '1');
  assert.equal(attemptFiles(ws).length, 3);
  assert.deepEqual(record(ws, '0002-quiz').lastAttempt, before);
  assert.equal(record(ws, '0002-quiz').reviewFailed, true);
  assert.equal(record(ws).lastAttempt.kind, 'task');
});

test('the answer: --answered stores answered, and sets the record answered and review-failed', () => {
  const ws = copy();
  const r = teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'a-exists');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^recorded a-\d{8}-\d{6}-0001: answered a-exists\n$/);
  const a = attemptAt(ws, -1);
  assert.deepEqual([a.answered, a.tested, a.records, a.total, a.wrong], [['a-exists'], ['0001-files'], ['0001-files'], 1, [0]]);
  assert.equal(a.passed, undefined);
  const rec = record(ws);
  assert.deepEqual([rec.answered, rec.reviewFailed, rec.lastAttempt.kind], [true, true, 'answered']);
  assert.equal(nextLine(ws, 'answered:'), 'answered: 0001-files');
  assert.equal(nextLine(ws, '| 0001-files'), `| 0001-files | understanding | 2026-01-01 | 0001-files | answered on ${TODAY} |`);
  // all is every id, in file order; b-text names no record.
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'all').status, 0);
  assert.deepEqual([attemptAt(ws, -1).answered, attemptAt(ws, -1).tested, attemptAt(ws, -1).wrong], [['a-exists', 'b-exists', 'b-text'], ['0001-files'], [0, 1, 2]]);
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'b-text').status, 0);
  assert.deepEqual([attemptAt(ws, -1).tested, attemptAt(ws, -1).records], [[], []]);
});

test('the answer: a passing check after it is written and clears answered and review-failed', () => {
  const ws = copy();
  solved(ws);
  check(ws, '1');
  assert.equal(nextLine(ws, 'answered:'), 'answered: none');
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'b-exists').status, 0);
  assert.equal(record(ws).answered, true);
  assert.equal(check(ws, '1').status, 0);
  assert.equal(attemptFiles(ws).length, 3);
  assert.deepEqual([record(ws).answered, record(ws).reviewFailed], [false, false]);
  assert.equal(nextLine(ws, 'answered:'), 'answered: none');
});

test('the answer: an unknown id, --answered with --result, and --answered with --answers exit 2 and write nothing', () => {
  const ws = copy();
  const nope = teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'nope');
  assert.equal(nope.status, 2);
  assert.match(nope.stderr, /nope/);
  for (const other of [['--result', 'pass'], ['--answers', '0']]) {
    const r = teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'a-exists', ...other);
    assert.equal(r.status, 2, other.join(' '));
    assert.match(r.stderr, /^usage: research-vault teach /);
  }
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0002-none', '--answered', 'a-exists').status, 2);
  assert.deepEqual(attemptFiles(ws), []);
});

const FRACTION = /\d+\/\d+/;
test('the views: teach next, teach progress, the progress page and the timeline show the summaries, never a fraction', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  check(ws, '1');
  const failLine = `| 0001-files | understanding | 2026-01-01 | 0001-files | failed on ${TODAY} |`;
  // The run stopped before b-exists, so the record has no attempt yet.
  assert.equal(nextLine(ws, '| 0001-files'), '| 0001-files | understanding | 2026-01-01 | 0001-files | none |');
  half(ws);
  check(ws, '1');
  assert.equal(nextLine(ws, '| 0001-files'), failLine);
  solved(ws);
  check(ws, '1');
  assert.equal(nextLine(ws, '| 0001-files'), `| 0001-files | understanding | 2026-01-01 | 0001-files | ok on ${TODAY} |`);
  assert.doesNotMatch(teach(ws, 'next').stdout, FRACTION);
  const text = teach(ws, 'progress');
  assert.equal(text.status, 0);
  const rows = text.stdout.split('\n').filter((l) => l.startsWith('| 0001-files'));
  assert.deepEqual(rows, ['| 0001-files | 0 | none | none | none |', `| 0001-files | 3 |  | ok a-exists, b-exists, b-text on ${TODAY} |  |`]);
  assert.doesNotMatch(text.stdout, FRACTION);
  const p = progress(ws, { now: new Date() });
  assert.deepEqual(p.lessons.filter((l) => l.id === '0001-files').map((l) => [l.id, l.kind ?? null, l.attempts.length]), [['0001-files', null, 0], ['0001-files', 'task', 3]]);
  const html = progressHtml(p);
  assert.ok(html.includes(`<td><b>ok a-exists, b-exists, b-text</b> <small>${TODAY}</small></td>`), html);
  for (const s of ['failed a-exists; not reached b-exists, b-text', 'ok a-exists; failed b-exists; not reached b-text']) assert.ok(html.includes(`<b>${s}</b>`), s);
  assert.ok(!html.includes('missed item'));
  assert.doesNotMatch(html, FRACTION);
});

test('the views: the quiz row of a lesson with a quiz and a task is unchanged by task attempts', () => {
  const ws = withQuiz(copy());
  teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answers', '1');
  const quizRow = (s) => s.split('\n').filter((l) => l.startsWith('| 0001-files'))[0];
  const before = teach(ws, 'progress').stdout;
  const beforeHtml = progressHtml(progress(ws, { now: new Date() }));
  half(ws);
  check(ws, '1');
  const after = teach(ws, 'progress').stdout;
  assert.equal(quizRow(after), quizRow(before));
  assert.match(quizRow(before), FRACTION);
  const rowHtml = (h) => /<tr><td><a href="\/lessons\/0001-files\.html">[^]*?<\/tr>/.exec(h)[0];
  assert.equal(rowHtml(progressHtml(progress(ws, { now: new Date() }))), rowHtml(beforeHtml));
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'b-exists').stdout.includes('answered b-exists'), true);
  assert.match(teach(ws, 'progress').stdout, new RegExp(`\\| 0001-files \\| 2 \\|  \\| answered b-exists on ${TODAY} \\|  \\|`));
});

test('the views: a stored id the requirements file no longer holds is printed as it is', () => {
  const ws = copy();
  write(ws, 'attempts/a-20260101-120000-0001.md',
    '---\ntype: attempt\ndate: 2026-01-01\nlesson: 0001-files\ntotal: 3\nwrong: [0]\nrecords: [0001-files]\npassed: [a-exists]\nfailed: [gone]\nunreached: []\ntested: [0001-files]\n---\n');
  assert.equal(nextLine(ws, '| 0001-files'), '| 0001-files | understanding | 2026-01-01 | 0001-files | failed on 2026-01-01 |');
  assert.match(teach(ws, 'progress').stdout, /\| 0001-files \| 1 \|  \| ok a-exists; failed gone on 2026-01-01 \|  \|/);
  assert.ok(progressHtml(progress(ws, { now: new Date() })).includes('<b>ok a-exists; failed gone</b>'));
});

test('teach lint is clean on a workspace that holds a check attempt and an answered attempt', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  check(ws, '1');
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'all').status, 0);
  assert.equal(attemptFiles(ws).length, 2);
  rmSync(join(ws, 'teach-0001'), { recursive: true });
  const vault = fixtureVault();
  assert.deepEqual(lintWorkspace(ws, { workspaceDir: ws, vaultPath: vault, entries: buildManifest(vault).entries, schema: loadSchema(ROOT), teachSchema: loadTeachSchema(ROOT), now: '2026-10-26' }), []);
});

// D5's import note (R17): the import skips a quiz attempt whose base id a task attempt of the same second and lesson
// holds. Pinned as it is; the ponytail comment in importAttempts names the fix.
test('the import skips a quiz attempt whose base id a task attempt holds', () => {
  const ws = withQuiz(copy());
  script(ws, 'setup.sh');
  check(ws, '1');
  const id = attemptFiles(ws)[0].slice(0, -3);
  const m = /^a-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-0001$/.exec(id);
  const at = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
  const file = join(ws, 'results.json');
  writeFileSync(file, JSON.stringify({ format: 'research-vault-attempts', version: 1, workspace: workspaceKey(ws),
    attempts: [{ lesson: '0001-files', answers: [0], at, total: 1, wrong: [] }] }));
  const r = teach(ws, 'attempt', 'import', file);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `skipped ${id}: already recorded\n`);
  assert.equal(attemptFiles(ws).length, 1);
});

// Fix round 1 of the commit 4 review.
test('recording: a failed attempt write exits 2 with nothing on stdout', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  mkdirSync(join(ws, 'attempts'), { mode: 0o555 });
  try {
    const r = check(ws, '1');
    assert.deepEqual([r.status, r.stdout], [2, '']);
    assert.match(r.stderr, /EACCES/);
  } finally { chmodSync(join(ws, 'attempts'), 0o755); }
});

test('the views: a hand-written task attempt with an empty summary does not break the progress page', () => {
  const ws = copy();
  write(ws, 'attempts/a-20260101-120000-0001.md', '---\ntype: attempt\ndate: 2026-01-01\nlesson: 0001-files\ntotal: 0\nwrong: []\nrecords: []\ntested: []\n---\n');
  const html = progressHtml(progress(ws, { now: new Date() }));
  assert.ok(html.includes('<b></b>'), html);
  assert.ok(!html.includes('missed item'));
});

test('recording: the compare is per lesson; a second task with the same lists as the first is written', () => {
  const ws = copy();
  cpSync(join(ws, 'evidence', '0001'), join(ws, 'evidence', '0002'), { recursive: true });
  cpSync(join(ws, 'lessons', '0001-files.html'), join(ws, 'lessons', '0002-more.html'));
  script(ws, 'setup.sh');
  check(ws, '1');
  check(ws, '2');
  assert.deepEqual(attemptFiles(ws).map((f) => attemptAt(ws, attemptFiles(ws).indexOf(f)).lesson), ['0001-files', '0002-more']);
  assert.deepEqual(attemptAt(ws, 1).failed, attemptAt(ws, 0).failed);
});

test('recording: all three lists are compared; the same failed with another passed and unreached is written', () => {
  const ws = copy();
  writeChecker(ws, 'echo "FAIL a-exists: make a.txt"\necho "ok b-exists"\necho "ok b-text"\nexit 1\n');
  check(ws, '1');
  writeChecker(ws, 'echo "FAIL a-exists: make a.txt"\nexit 1\n');
  check(ws, '1');
  assert.equal(attemptFiles(ws).length, 2);
  assert.deepEqual([attemptAt(ws, 0).failed, attemptAt(ws, 0).passed, attemptAt(ws, 1).failed, attemptAt(ws, 1).unreached],
    [['a-exists'], ['b-exists', 'b-text'], ['a-exists'], ['b-exists', 'b-text']]);
});

test('the views: the progress page task row has empty first and best cells and the summary and date as the latest', () => {
  const ws = copy();
  solved(ws);
  check(ws, '1');
  const html = progressHtml(progress(ws, { now: new Date() }));
  assert.ok(html.includes(`<td>1</td><td></td><td><b>ok a-exists, b-exists, b-text</b> <small>${TODAY}</small></td><td></td></tr>`), html);
});

test('the answer: --answered stores the ids in the file order', () => {
  const ws = copy();
  assert.equal(teach(ws, 'attempt', 'add', '--lesson', '0001-files', '--answered', 'b-text,a-exists').status, 0);
  assert.deepEqual(attemptAt(ws, -1).answered, ['a-exists', 'b-text']);
});

// D3, changed by the owner: the id `all` is reserved, since `--answered all` means every id.
const reserveAll = (ws) => editFile(join(ws, 'evidence', '0001', 'requirements.json'), '"id": "a-exists"', '"id": "all"');
const RESERVED = 'requirement 1: id "all" is reserved for --answered all';
test('readRequirements: the id all is a problem; teach check refuses with exit 2', () => {
  const ws = copy();
  reserveAll(ws);
  assert.deepEqual(readRequirements(ws, '0001').problems, [RESERVED]);
  script(ws, 'setup.sh');
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', `teach check: 0001: ${RESERVED}\n`]);
  assert.deepEqual(attemptFiles(ws), []);
});

test('teach lint reports the id all as TASK_REQUIREMENTS_INVALID', () => {
  const ws = copy();
  reserveAll(ws);
  const vault = fixtureVault();
  const findings = lintWorkspace(ws, { workspaceDir: ws, vaultPath: vault, entries: buildManifest(vault).entries, schema: loadSchema(ROOT), teachSchema: loadTeachSchema(ROOT), now: '2026-10-26' });
  assert.deepEqual(findings.map((f) => `${f.code} ${f.file}: ${f.message}`), [`TASK_REQUIREMENTS_INVALID evidence/0001/requirements.json: ${RESERVED}`]);
});

// Issue 79 commit 5 (D8): a certification run of one task or several, with one start, one end and one grade. The
// fixture's second task, 0002-more, has two requirements, c-exists and c-text, which name no record.
const { startRun, endRun, readRun, runLine, openLine, checkAttempt } = await import('../bin/lib/task.mjs');
const { certificationRuns, writeAttempt } = await import('../bin/lib/teach.mjs');
const RUN = '.teach-certify.json';
const ENDING = '.teach-certify.ending.json';
const runScript = (ws, n, name) => assert.equal(spawnSync(join(ws, 'evidence', n, name), [], { env: testEnv(), cwd: ws }).status, 0, `${n} ${name}`);
const state = (ws) => JSON.parse(readFileSync(join(ws, RUN), 'utf8'));
// An in-process start or end with the clock passed in; what they print is collected, not written.
const io = (now) => { const out = [], err = []; return { now, out: (s) => out.push(s), err: (s) => err.push(s), lines: { out, err } }; };
const T0 = new Date('2026-01-01T10:00:00.000Z');
const at = (min, sec = 0) => new Date(T0.getTime() + min * 60000 + sec * 1000);
const RUN_LINE = (id, rest = '') => `certification run ${id}: 0 minutes${rest}; end: ./check --certify; drop: ./check --cancel`;
const FAILED2 = ['FAIL c-exists: The file teach-0002/c.txt exists.', '  hint: make the file c.txt inside teach-0002', '  read: 0002-more.html', 'not reached c-text: The file teach-0002/c.txt holds the word world.'];

test('teach check announces the checker before it starts and before the report', SHELL_TEST, () => {
  for (const [flags, open] of [[[], false], [['--dry-run'], false], [['--hints'], false], [[], true]]) {
    const ws = copy();
    markCheckerStart(ws, '0001');
    const report = [...FAILED];
    if (open) {
      assert.equal(check(ws, '--start', '1').status, 0);
      report.push(RUN_LINE(state(ws).id));
    }
    const expected = CHECK_LINE() + ['started 0001', ...report].join('\n') + '\n';
    assert.deepEqual(checkOrder(ws, ...flags, '1'), [1, expected], open ? 'open run' : flags[0] ?? 'plain check');
  }
});

test('teach check --certify announces each checker before it starts in run order', SHELL_TEST, () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '2', '1').status, 0);
  markCheckerStart(ws, '0002');
  markCheckerStart(ws, '0001');
  const report = ['0002-more: 0 of 2', '0001-files: 0 of 3', 'grade: 0 of 5 requirements', 'time: 0 minutes', '0002-more:', ...FAILED2, '0001-files:', ...FAILED];
  const expected = CHECK_LINE('0002') + 'started 0002\n' + CHECK_LINE() + ['started 0001', ...report].join('\n') + '\n';
  assert.deepEqual(checkOrder(ws, '--certify'), [0, expected]);
});

test('certification start: --start 1 2 runs both setups, writes the state, and takes started from the clock after the second setup', async () => {
  const ws = copy();
  // The clock reads T0 until task 2's setup has made teach-0002/, and T1 after.
  const T1 = at(3);
  const o = io(() => (existsSync(join(ws, 'teach-0002')) ? T1 : T0));
  assert.equal(await startRun(ws, ['1', '2'], { minutes: null, pass: null, hints: true }, o), 0, o.lines.err.join('\n'));
  assert.deepEqual(state(ws), { id: 'c-20260101-100000', started: T1.toISOString(), tasks: ['0001', '0002'], minutes: null, pass: null, hints: true });
  assert.ok(existsSync(join(ws, 'teach-0001')) && existsSync(join(ws, 'teach-0002')));
  assert.deepEqual(o.lines.out, [
    'setup: evidence/0001/setup.sh',
    'setup: evidence/0002/setup.sh',
    'certification run c-20260101-100000: started',
    'tasks: 0001-files, 0002-more',
    'requirements: 5',
    'hints: not held back',
    'check a task: ./check <N>',
    'end and grade: ./check --certify',
    'drop, recording nothing: ./check --cancel',
  ]);
});

test('certification start: the CLI prints the run, the limit and the pass line when set, and hints held back', () => {
  const ws = copy();
  const r = check(ws, '--start', '1', '2', '--minutes', '60', '--pass', '70', '--no-hints');
  assert.equal(r.status, 0, r.stderr);
  const s = state(ws);
  assert.deepEqual([s.tasks, s.minutes, s.pass, s.hints], [['0001', '0002'], 60, 70, false]);
  assert.match(s.id, /^c-\d{8}-\d{6}$/);
  assert.equal(r.stdout, ['setup: evidence/0001/setup.sh', 'setup: evidence/0002/setup.sh', `certification run ${s.id}: started`, 'tasks: 0001-files, 0002-more', 'requirements: 5',
    'time limit: 60 minutes', 'pass line: 70%', 'hints: held back', 'check a task: ./check <N>', 'end and grade: ./check --certify', 'drop, recording nothing: ./check --cancel'].join('\n') + '\n');
});

test('certification start: a second --start exits 2 and leaves the state as it was', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1').status, 0);
  const before = readFileSync(join(ws, RUN), 'utf8');
  const r = check(ws, '--start', '2');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `teach check: certification run ${state(ws).id} is open; end: ./check --certify; drop: ./check --cancel\n`);
  assert.equal(readFileSync(join(ws, RUN), 'utf8'), before);
  assert.ok(!existsSync(join(ws, 'teach-0002')), 'the second start ran no setup');
});

test('certification start: a number twice, a bad --minutes or --pass, a task with no requirements.json and a number with no lesson exit 2 and leave no state', () => {
  const cases = [
    [[], ['1', '1'], 'teach check: 0001 is given twice\n'],
    [[], ['1', '--minutes', '0'], 'teach check: --minutes must be a whole number from 1 to 1440\n'],
    [[], ['1', '--minutes', '1441'], 'teach check: --minutes must be a whole number from 1 to 1440\n'],
    [[], ['1', '--pass', '101'], 'teach check: --pass must be a whole number from 1 to 100\n'],
    [[], ['1', '--pass', 'x'], 'teach check: --pass must be a whole number from 1 to 100\n'],
    [[(ws) => rmSync(join(ws, 'evidence', '0002', 'requirements.json'))], ['1', '2'], 'teach check: 0002: evidence/0002/requirements.json is missing\n'],
    [[(ws) => rmSync(join(ws, 'lessons', '0002-more.html'))], ['1', '2'], 'teach check: 0002: no lessons/0002-*.html\n'],
    [[(ws) => rmSync(join(ws, 'evidence', '0002', 'solution.sh'))], ['2'], 'teach check: 0002: evidence/0002/solution.sh is missing\n'],
    [[(ws) => chmodSync(join(ws, 'evidence', '0002', 'setup.sh'), 0o644)], ['2'], 'teach check: 0002: evidence/0002/setup.sh is not executable\n'],
    [[], ['9'], 'teach check: 0009: no evidence/0009/ folder\n'],
  ];
  for (const [mutate, args, stderr] of cases) {
    const ws = copy();
    for (const m of mutate) m(ws);
    const r = check(ws, '--start', ...args);
    assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', stderr], args.join(' '));
    assert.ok(!existsSync(join(ws, RUN)), args.join(' '));
    assert.ok(!existsSync(join(ws, 'teach-0001')), `${args.join(' ')}: no setup ran`);
  }
});

test('certification start: task 2\'s setup.sh exits 3: exit 2, no state, and the line names task 0001 as reset', () => {
  const ws = copy();
  writeFileSync(join(ws, 'evidence', '0002', 'setup.sh'), '#!/usr/bin/env bash\nexit 3\n', { mode: 0o755 });
  const r = check(ws, '--start', '1', '2');
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'teach check: 0002: setup.sh exited 3; no run started; scopes already reset: 0001\n');
  assert.ok(!existsSync(join(ws, RUN)));
  const first = copy();
  writeFileSync(join(first, 'evidence', '0001', 'setup.sh'), '#!/usr/bin/env bash\nexit 3\n', { mode: 0o755 });
  assert.equal(check(first, '--start', '1', '2').stderr, 'teach check: 0001: setup.sh exited 3; no run started; scopes already reset: none\n');
});

test('certification start: SIGINT during a setup stops its group, removes the state and exits 2', async () => {
  const ws = copy();
  // Silence the shell's notice when its foreground sleep is stopped with the group.
  writeFileSync(join(ws, 'evidence', '0001', 'setup.sh'), '#!/usr/bin/env bash\necho $$ > setup.pid\nexec 2>/dev/null\nsleep 30 & sleep 30\n', { mode: 0o755 });
  const child = spawn(process.execPath, [BIN, 'teach', 'check', '--start', '1', ws], { env: testEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (b) => { stderr += b; });
  const exited = once(child, 'exit');
  const pidFile = join(ws, 'setup.pid');
  for (const end = Date.now() + 10000; !(existsSync(pidFile) && readFileSync(pidFile, 'utf8').endsWith('\n')) && Date.now() < end;) await new Promise((ok) => setTimeout(ok, 20));
  const pgid = Number(readFileSync(pidFile, 'utf8'));
  try {
    child.kill('SIGINT');
    const [code] = await exited;
    assert.equal(code, 2);
    assert.equal(stderr, 'teach check: 0001: stopped by SIGINT; no run started; scopes already reset: none\n');
    assert.ok(groupGone(pgid), `group ${pgid} is still there`);
    assert.ok(!existsSync(join(ws, RUN)));
  } finally { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
});

test('certification forms: --start with --certify, --certify 1, --cancel 1 and --minutes 5 1 without --start print the usage and exit 2', () => {
  const ws = copy();
  for (const args of [['--start', '1', '--certify'], ['--certify', '1'], ['--cancel', '1'], ['--minutes', '5', '1'], ['--pass', '50', '1'], ['--no-hints', '1'],
    ['--certify', '--hints'], ['--cancel', '--certify'], ['--start', '1', '--hints'], ['--start']]) {
    const r = check(ws, ...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, USAGE_RE, args.join(' '));
    assert.ok(r.stderr.includes('check --start <N>... [--minutes <M>] [--pass <P>] [--no-hints] [workspace] | check --certify [workspace] | check --cancel [workspace]'), args.join(' '));
  }
  assert.ok(!existsSync(join(ws, RUN)));
});

test('an open run: ./check 1 prints the requirements and the certification run line, exits 1 and writes no attempt; other lessons check as usual', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1', '--minutes', '60').status, 0);
  const id = state(ws).id;
  const r = check(ws, '1');
  assert.equal(r.stderr, CHECK_LINE());
  assert.equal(r.stdout, [...FAILED, RUN_LINE(id, ' of 60')].join('\n') + '\n');
  assert.equal(r.status, 1);
  assert.deepEqual(attemptFiles(ws), []);
  runScript(ws, '0002', 'setup.sh');
  const other = check(ws, '2');
  assert.equal(other.stderr, CHECK_LINE('0002'));
  assert.equal(other.stdout, FAILED2.join('\n') + '\n');
  assert.equal(attemptFiles(ws).length, 1);
});

test('an open run with hints held back: ./check 1 prints no hint line, and ./check --hints 1 exits 2', () => {
  const ws = copy();
  editFile(join(ws, 'MISSION.md'), '- Hints: always', '- Hints: on request');
  assert.equal(check(ws, '--start', '1', '--no-hints').status, 0);
  const id = state(ws).id;
  const r = check(ws, '1');
  assert.equal(r.stdout, [FAILED[0], ...FAILED.slice(2), RUN_LINE(id, '')].join('\n') + '\n');
  const h = check(ws, '--hints', '1');
  assert.deepEqual([h.status, h.stdout, h.stderr], [2, '', `teach check: 0001: hints are held back in certification run ${id}\n`]);
  assert.deepEqual(attemptFiles(ws), []);
});

test('an open run with hints not held back: Hints: on request still gives the hints: line before the run line', () => {
  const ws = copy();
  editFile(join(ws, 'MISSION.md'), '- Hints: always', '- Hints: on request');
  assert.equal(check(ws, '--start', '1').status, 0);
  const r = check(ws, '1');
  assert.equal(r.stdout, [FAILED[0], ...FAILED.slice(2), 'hints: ./check --hints 1', RUN_LINE(state(ws).id)].join('\n') + '\n');
  assert.equal(check(ws, '--hints', '1').stdout, [...FAILED, RUN_LINE(state(ws).id)].join('\n') + '\n');
});

test('an open run: teach next prints certification: open with the tasks and the minutes', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1', '2', '--minutes', '60', '--no-hints').status, 0);
  assert.equal(nextLine(ws, 'certification:'), `certification: open ${state(ws).id}, tasks 0001, 0002, 0 minutes of 60, hints held back`);
  const plain = copy();
  assert.equal(check(plain, '--start', '2').status, 0);
  assert.equal(nextLine(plain, 'certification:'), `certification: open ${state(plain).id}, tasks 0002, 0 minutes`);
  assert.equal(nextLine(copy(), 'certification:'), undefined);
});

test('certification end: --certify with no run exits 2', () => {
  const r = check(copy(), '--certify');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: no certification run is open; start one with ./check --start <N>\n']);
});

test('certification end: task 1 solved and task 2 untouched: two attempts with the run id, the grade over both, and neither state file', () => {
  const ws = copy();
  solved(ws);
  assert.equal(check(ws, '1').status, 0);
  assert.equal(attemptFiles(ws).length, 1);
  assert.equal(check(ws, '--start', '1', '2').status, 0);
  const id = state(ws).id;
  runScript(ws, '0001', 'solution.sh');
  const r = check(ws, '--certify');
  assert.equal(r.stderr, CHECK_LINE() + CHECK_LINE('0002'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, ['0001-files: 3 of 3', '0002-more: 0 of 2', 'grade: 3 of 5 requirements', 'time: 0 minutes', '0001-files:', ...SOLVED, '0002-more:', ...FAILED2].join('\n') + '\n');
  // Task 1's lists equal its last attempt's, and it is written all the same.
  assert.equal(attemptFiles(ws).length, 3);
  const [a1, a2] = [attemptAt(ws, -2), attemptAt(ws, -1)].sort((x, y) => x.lesson.localeCompare(y.lesson));
  assert.deepEqual([a1.lesson, a1.certification, a1.passed], ['0001-files', id, ['a-exists', 'b-exists', 'b-text']]);
  assert.deepEqual([a2.lesson, a2.certification, a2.failed, a2.unreached], ['0002-more', id, ['c-exists'], ['c-text']]);
  assert.ok(!existsSync(join(ws, RUN)) && !existsSync(join(ws, ENDING)));
  // A plain ./check 1 after the run, with the same lists, writes no attempt.
  assert.equal(check(ws, '1').status, 0);
  assert.equal(attemptFiles(ws).length, 3);
});

test('certification end: the pass line is met at 3 of 5 for 60% and not met for 61%', () => {
  for (const [pass, word] of [['60', 'met'], ['61', 'not met']]) {
    const ws = copy();
    assert.equal(check(ws, '--start', '1', '2', '--pass', pass).status, 0);
    runScript(ws, '0001', 'solution.sh');
    const r = check(ws, '--certify');
    assert.deepEqual(r.stdout.split('\n').slice(2, 5), ['grade: 3 of 5 requirements', `pass line ${pass}%: ${word}`, 'time: 0 minutes']);
  }
});

test('certification end: the time against the limit, with the clock passed in, changes no grade', async () => {
  const schema = loadTeachSchema(ROOT);
  for (const [min, line] of [[42, 'time: 42 minutes (limit 60)'], [60, 'time: 60 minutes (limit 60)'], [65, 'time: 65 minutes, 5 over the limit of 60']]) {
    const ws = copy();
    assert.equal(await startRun(ws, ['1', '2'], { minutes: '60', pass: null, hints: true }, io(() => T0)), 0);
    runScript(ws, '0001', 'solution.sh');
    const o = io(() => at(min, 30));
    assert.equal(await endRun(ws, schema, o), 0, o.lines.err.join('\n'));
    assert.deepEqual(o.lines.out.slice(0, 4), ['0001-files: 3 of 3', '0002-more: 0 of 2', 'grade: 3 of 5 requirements', line]);
  }
});

test('certification end: a problem in task 2 writes no attempt for either task, keeps the run open, and --cancel then removes it', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1', '2').status, 0);
  const id = state(ws).id;
  runScript(ws, '0001', 'solution.sh');
  writeFileSync(join(ws, 'evidence', '0002', 'check.sh'), '#!/usr/bin/env bash\nexit 7\n', { mode: 0o755 });
  const r = check(ws, '--certify');
  const problem = `teach check: 0002: check.sh exited 7; certification run ${id} is still open; end: ./check --certify; drop: ./check --cancel\n`;
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', CHECK_LINE() + CHECK_LINE('0002') + problem]);
  assert.deepEqual(attemptFiles(ws), []);
  assert.equal(state(ws).id, id);
  const c = check(ws, '--cancel');
  assert.deepEqual([c.status, c.stdout, c.stderr], [0, `dropped certification run ${id}; nothing was recorded\n`, '']);
  assert.ok(!existsSync(join(ws, RUN)));
  assert.deepEqual(attemptFiles(ws), []);
});

test('certification cancel: a run of two tasks cancelled records nothing; --cancel with no run exits 2', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1', '2').status, 0);
  runScript(ws, '0001', 'solution.sh');
  check(ws, '1');
  assert.equal(check(ws, '--cancel').status, 0);
  assert.deepEqual(attemptFiles(ws), []);
  const none = check(ws, '--cancel');
  assert.deepEqual([none.status, none.stdout, none.stderr], [2, '', 'teach check: no certification run is open\n']);
});

test('a crash: a state file that is not JSON makes --certify exit 2 and name --cancel, which removes it', () => {
  const ws = copy();
  writeFileSync(join(ws, RUN), '{');
  const r = check(ws, '--certify');
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'teach check: .teach-certify.json is not a certification run; drop it with ./check --cancel\n');
  assert.equal(nextLine(ws, 'certification:'), 'certification: .teach-certify.json is not a certification run; drop it with ./check --cancel');
  const c = check(ws, '--cancel');
  assert.deepEqual([c.status, c.stdout], [0, 'dropped .teach-certify.json; nothing was recorded\n']);
  assert.ok(!existsSync(join(ws, RUN)));
});

test('a crash: with .teach-certify.ending.json in place, --start and --certify exit 2 and name --cancel, which removes it and the attempts it wrote', async () => {
  const ws = copy();
  assert.equal(check(ws, '1').status, 1); // an attempt of no run, which stays
  assert.equal(check(ws, '--start', '1').status, 0);
  const id = state(ws).id;
  renameSync(join(ws, RUN), join(ws, ENDING));
  // The end was stopped after it wrote the attempt of task 1.
  const { requirements } = readRequirements(ws, '0001');
  const failed = parseChecker(requirements, { code: 1, stdout: 'FAIL a-exists: x\n' });
  writeAttempt(ws, { lesson: '0001-files', task: checkAttempt(requirements, failed, 'c-20250101-000000'), now: at(4) }, loadTeachSchema(ROOT)); // another run's, which stays
  writeAttempt(ws, { lesson: '0001-files', task: checkAttempt(requirements, failed, id), now: at(5) }, loadTeachSchema(ROOT));
  assert.equal(attemptFiles(ws).length, 3);
  const ending = `teach check: an end of certification run ${id} did not finish; ./check --cancel removes it and the attempts it wrote\n`;
  for (const args of [['--start', '2'], ['--certify']]) {
    const r = check(ws, ...args);
    assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', ending], args.join(' '));
  }
  assert.ok(!existsSync(join(ws, 'teach-0002')));
  const c = check(ws, '--cancel');
  assert.deepEqual([c.status, c.stdout], [0, `removed the end of certification run ${id} that did not finish and the 1 attempt it wrote; nothing of the run is recorded\n`]);
  assert.ok(!existsSync(join(ws, ENDING)) && !existsSync(join(ws, RUN)));
  const left = attemptFiles(ws).map((f) => parseFrontmatter(readFileSync(join(ws, 'attempts', f), 'utf8')).data);
  assert.deepEqual(left.map((a) => a.certification).sort(), ['c-20250101-000000', undefined]);
});

test('a crash with no run id in .teach-certify.ending.json: --cancel removes it and says attempts may be recorded', () => {
  const ws = copy();
  writeFileSync(join(ws, ENDING), '{}\n');
  const c = check(ws, '--cancel');
  assert.deepEqual([c.status, c.stdout], [0, 'removed the end of a certification run that did not finish; attempts of the run may be recorded\n']);
});

test('certification start: a --cancel during a setup is not undone; the start exits 2 and writes no state', async () => {
  const ws = copy();
  // Task 2's setup stands in for a --cancel in a second terminal while it runs.
  writeFileSync(join(ws, 'evidence', '0002', 'setup.sh'), '#!/usr/bin/env bash\nrm -f .teach-certify.json\n');
  chmodSync(join(ws, 'evidence', '0002', 'setup.sh'), 0o755);
  const o = io(() => T0);
  assert.equal(await startRun(ws, ['1', '2'], { minutes: null, pass: null, hints: true }, o), 2);
  assert.deepEqual(o.lines.err, ['teach check: certification run c-20260101-100000 was dropped during its setup; no run started; scopes already reset: 0001, 0002']);
  assert.ok(!existsSync(join(ws, RUN)));
});

test('certificationRuns counts the last attempt of each lesson in a run, oldest run first', () => {
  const a = (id, lesson, run, passed, failed = [], unreached = [], date = '2026-01-01') => ({ id, date, lesson, tested: [], passed, failed, unreached, certification: run });
  assert.deepEqual(certificationRuns([a('a-1', '0001-files', 'c-1', ['x'], ['y']), a('a-2', '0001-files', 'c-1', ['x', 'y'], [], [], '2026-01-02')]),
    [{ id: 'c-1', date: '2026-01-02', ok: 2, total: 2, tasks: [{ lesson: '0001-files', ok: 2, total: 2 }] }]);
  assert.deepEqual(certificationRuns([a('a-1', '0001-files', 'c-1', ['x']), a('a-2', '0002-more', 'c-1', [], ['p'], ['q']), a('a-3', '0001-files', 'c-2', [], ['x']),
    { id: 'a-4', date: '2026-01-01', lesson: '0001-files', tested: [], passed: ['x'], failed: [], unreached: [] }]).map((r) => [r.id, r.ok, r.total, r.tasks.length]),
  [['c-1', 1, 3, 2], ['c-2', 0, 1, 1]]);
  assert.deepEqual(certificationRuns([]), []);
});

test('the views after a run: teach next prints the grade line, the progress timeline shows certification 3 of 3, and teach lint is clean', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1', '2').status, 0);
  const id = state(ws).id;
  runScript(ws, '0001', 'solution.sh');
  assert.equal(check(ws, '--certify').status, 0);
  assert.equal(nextLine(ws, 'certification:'), `certification: ${id} 3 of 5 (0001 3 of 3, 0002 0 of 2)`);
  const next = teach(ws, 'next').stdout.split('\n');
  assert.equal(next.indexOf(`certification: ${id} 3 of 5 (0001 3 of 3, 0002 0 of 2)`), next.findIndex((l) => l.startsWith('answered:')) + 1);
  const html = progressHtml(progress(ws, { now: new Date() }));
  assert.ok(html.includes('<b>certification 3 of 3</b>'), html);
  assert.ok(html.includes('<b>certification 0 of 2</b>'), html);
  for (const d of ['teach-0001', 'teach-0002']) rmSync(join(ws, d), { recursive: true });
  const vault = fixtureVault();
  assert.deepEqual(lintWorkspace(ws, { workspaceDir: ws, vaultPath: vault, entries: buildManifest(vault).entries, schema: loadSchema(ROOT), teachSchema: loadTeachSchema(ROOT), now: '2026-10-26' }), []);
});

test('readRun: none, a run, and a file that is not a run', () => {
  const ws = copy();
  assert.deepEqual(readRun(ws), {});
  writeFileSync(join(ws, RUN), JSON.stringify({ id: 'c-20260101-100000', started: null, tasks: ['0001'], minutes: null, pass: null, hints: true }));
  assert.deepEqual(readRun(ws).state.tasks, ['0001']);
  for (const bad of [{ id: 'x', started: null, tasks: ['0001'], minutes: null, pass: null, hints: true }, { id: 'c-20260101-100000', started: null, tasks: [], minutes: null, pass: null, hints: true },
    { id: 'c-20260101-100000', started: null, tasks: ['0001'], minutes: 0, pass: null, hints: true }, { id: 'c-20260101-100000', started: null, tasks: ['0001'], minutes: null, pass: null, hints: true, extra: 1 }, []]) {
    writeFileSync(join(ws, RUN), JSON.stringify(bad));
    assert.equal(readRun(ws).problem, '.teach-certify.json is not a certification run; drop it with ./check --cancel', JSON.stringify(bad));
  }
});

// Fix round 1 of the commit 5 review.
const writeState = (ws, patch) => writeFileSync(join(ws, RUN), JSON.stringify({ ...state(ws), ...patch }) + '\n');

test('certification start: a setup that leaves a background process exits 0 and the process stays after --start', async () => {
  const ws = copy();
  writeFileSync(join(ws, 'evidence', '0001', 'setup.sh'), '#!/usr/bin/env bash\nrm -rf teach-0001\nmkdir teach-0001\nsleep 30 >/dev/null 2>&1 &\necho $! > bg.pid\n', { mode: 0o755 });
  const o = io(() => T0);
  assert.equal(await startRun(ws, ['1'], { minutes: null, pass: null, hints: true }, o), 0, o.lines.err.join('\n'));
  const pid = Number(readFileSync(join(ws, 'bg.pid'), 'utf8'));
  try {
    await new Promise((ok) => setTimeout(ok, 300));
    assert.doesNotThrow(() => process.kill(pid, 0), 'the background sleep was stopped');
  } finally { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
});

test('an open run with --no-hints and the mission\'s Hints: always prints no hint line and no hints: line', () => {
  const ws = copy();
  assert.match(readFileSync(join(ws, 'MISSION.md'), 'utf8'), /- Hints: always/);
  assert.equal(check(ws, '--start', '1', '--no-hints').status, 0);
  const r = check(ws, '1');
  assert.equal(r.stdout, [FAILED[0], ...FAILED.slice(2), RUN_LINE(state(ws).id)].join('\n') + '\n');
});

test('the open-run lines print the minutes since started, from the clock passed in and from the CLI\'s clock', () => {
  const s = { id: 'c-20260101-100000', started: T0.toISOString(), tasks: ['0001'], minutes: 60, pass: null, hints: true };
  assert.equal(runLine(s, at(42, 10)), 'certification run c-20260101-100000: 42 minutes of 60; end: ./check --certify; drop: ./check --cancel');
  assert.equal(openLine(s, at(42, 10)), 'certification: open c-20260101-100000, tasks 0001, 42 minutes of 60');
  const ws = copy();
  assert.equal(check(ws, '--start', '1', '--minutes', '60').status, 0);
  writeState(ws, { started: new Date(Date.now() - (42 * 60 + 20) * 1000).toISOString() });
  assert.equal(check(ws, '1').stdout.trimEnd().split('\n').at(-1), RUN_LINE(state(ws).id, ' of 60').replace('0 minutes', '42 minutes'));
  assert.equal(nextLine(ws, 'certification:'), `certification: open ${state(ws).id}, tasks 0001, 42 minutes of 60`);
});

test('with two finished runs, teach next shows the latest', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1').status, 0);
  writeState(ws, { id: 'c-20260101-000000' });
  assert.equal(check(ws, '--certify').status, 0);
  assert.equal(check(ws, '--start', '1', '2').status, 0);
  const id = state(ws).id;
  runScript(ws, '0001', 'solution.sh');
  assert.equal(check(ws, '--certify').status, 0);
  assert.equal(nextLine(ws, 'certification:'), `certification: ${id} 3 of 5 (0001 3 of 3, 0002 0 of 2)`);
});

test('the end report gives hints by the mission\'s bullet: with Hints: on request it prints no hint: line', () => {
  const ws = copy();
  editFile(join(ws, 'MISSION.md'), '- Hints: always', '- Hints: on request');
  assert.equal(check(ws, '--start', '1', '2').status, 0);
  const r = check(ws, '--certify');
  assert.equal(r.status, 0);
  const out = r.stdout.split('\n');
  assert.ok(!out.some((l) => l.startsWith('  hint:')), r.stdout);
  assert.deepEqual(out.slice(-4, -1), ['  read: 0002-more.html', 'not reached c-text: The file teach-0002/c.txt holds the word world.', 'hints: ./check --hints 2']);
});

test('certification end: of two ends at the same moment, the one that finds no state to rename exits 2 and records nothing', async () => {
  const ws = copy();
  const schema = loadTeachSchema(ROOT);
  assert.equal(await startRun(ws, ['1', '2'], { minutes: null, pass: null, hints: true }, io(() => T0)), 0);
  const [a, b] = [io(() => at(5)), io(() => at(5))];
  const codes = await Promise.all([endRun(ws, schema, a), endRun(ws, schema, b)]);
  assert.deepEqual([...codes].sort(), [0, 2]);
  const loser = codes[0] === 2 ? a : b;
  assert.deepEqual(loser.lines.err, [
    'check: evidence/0001/check.sh',
    'check: evidence/0002/check.sh',
    'teach check: no certification run is open; start one with ./check --start <N>',
  ]);
  assert.deepEqual(loser.lines.out, []);
  assert.equal(attemptFiles(ws).length, 2);
  assert.ok(!existsSync(join(ws, RUN)) && !existsSync(join(ws, ENDING)));
});

test('certification end: a state with started null is refused, names --cancel and records nothing', () => {
  const ws = copy();
  assert.equal(check(ws, '--start', '1').status, 0);
  writeState(ws, { started: null });
  const r = check(ws, '--certify');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', `teach check: certification run ${state(ws).id} has not started: its start did not finish; ./check --cancel removes it\n`]);
  assert.deepEqual(attemptFiles(ws), []);
  assert.ok(existsSync(join(ws, RUN)));
});
