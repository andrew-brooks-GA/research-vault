// Issue 79: a checked task's requirements file, its checker's output and `teach check` (commit 2: D3, D4 without
// recording). Every checker a test here starts runs in a temp copy of test/fixtures/teach-task, and every test leaves
// no process of the group it started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRequirements, parseChecker } from '../bin/lib/task.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const FIX = join(ROOT, 'test', 'fixtures', 'teach-task');
const USAGE_RE = /^usage: research-vault teach /;

const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-task-'));
  cpSync(FIX, dir, { recursive: true });
  return dir;
};
const script = (ws, name) => assert.equal(spawnSync(join(ws, 'evidence', '0001', name), [], { cwd: ws }).status, 0, name);
const check = (ws, ...args) => spawnSync(process.execPath, [BIN, 'teach', 'check', ...args, ws], { encoding: 'utf8', timeout: 30000 });
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
  assert.deepEqual(parse(0, ['checking teach-0001', 'ok a-exists', 'okay b-exists', 'FAIL b-exists', 'ok b-exists', 'ok b-text']),
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

test('teach check: after setup.sh it fails the first requirement, with the hint and read lines, and reaches no other', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  const r = check(ws, '1');
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, FAILED.join('\n') + '\n');
  assert.equal(r.status, 1);
});

test('teach check: after solution.sh every requirement is ok, exit 0', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  script(ws, 'solution.sh');
  const r = check(ws, '0001');
  assert.equal(r.stderr, '');
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

test('teach check writes no attempt in this commit', () => {
  const ws = copy();
  script(ws, 'setup.sh');
  check(ws, '1');
  check(ws, '--dry-run', '1');
  script(ws, 'solution.sh');
  check(ws, '1');
  assert.equal(existsSync(join(ws, 'attempts')), false);
});

test('teach check: an invalid requirements.json or a checker problem exits 2 with one line and no report', () => {
  const ws = copy();
  writeReqs(ws, '{');
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: 0001: requirements.json is not JSON\n']);
  const w = copy();
  writeChecker(w, 'echo "ok a-exists"\necho "first" >&2\necho "the last line" >&2\nexit 1\n');
  const p = check(w, '1');
  assert.deepEqual([p.status, p.stdout, p.stderr], [2, '', 'teach check: 0001: check.sh exited 1 with no FAIL line; stderr: the last line\n']);
});

test('the runner: a checker that hangs is stopped at the timeout, exit 2, and no process of its group is left', () => {
  const ws = copy();
  writeChecker(ws, 'echo $$ > checker.pid\nsleep 30 & sleep 30\n', 1);
  const t0 = Date.now();
  const r = check(ws, '1');
  const pgid = Number(readFileSync(join(ws, 'checker.pid'), 'utf8'));
  try {
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
    assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: 0001: ran past 1 seconds\n']);
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
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, SOLVED.join('\n') + '\n', '']);
    assert.throws(() => process.kill(sleeper, 0), { code: 'ESRCH' });
    assert.ok(groupGone(pgid), `group ${pgid} is still there`);
  } finally { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`the runner: ${sig} to teach check while the checker sleeps stops its group, exit 2`, async () => {
    const ws = copy();
    writeChecker(ws, 'echo $$ > checker.pid\nsleep 30 & sleep 30\n');
    const child = spawn(process.execPath, [BIN, 'teach', 'check', '1', ws], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      assert.equal(stderr, `teach check: 0001: stopped by ${sig}\n`);
      assert.ok(groupGone(pgid), `group ${pgid} is still there`);
    } finally { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
  });
}

test('the runner: a checker that prints 2 MiB is stopped, exit 2', () => {
  const ws = copy();
  writeChecker(ws, "head -c 2097152 /dev/zero | tr '\\0' x\n");
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: 0001: output past 1 MiB\n']);
});

test('the runner: the 1 MiB cap counts standard error too', () => {
  const ws = copy();
  writeChecker(ws, "head -c 2097152 /dev/zero | tr '\\0' x >&2\n");
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: 0001: output past 1 MiB\n']);
});

test('the runner: a checker without the executable bit cannot start, exit 2', () => {
  const ws = copy();
  chmodSync(join(ws, 'evidence', '0001', 'check.sh'), 0o644);
  const r = check(ws, '1');
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'teach check: 0001: check.sh could not start (EACCES)\n']);
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
