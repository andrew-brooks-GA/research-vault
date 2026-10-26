// `teach` CLI verbs (record, attempt, lint, next) and the session brief (spec 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixtureVault } from './helpers.mjs';
import { workspaceBrief } from '../hooks/session-start.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const FIX = join(ROOT, 'test', 'fixtures', 'teach');
const VAULT = fixtureVault();
const TODAY = new Date().toISOString().slice(0, 10);
const USAGE = 'usage: research-vault teach record add|supersede ... | attempt add ... | lint [--fix] [workspace] | next [workspace] | serve [workspace]\n';

const copyFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-teach-'));
  cpSync(FIX, dir, { recursive: true });
  return dir;
};
const cli = (args, cwd = ROOT) => spawnSync(process.execPath, [BIN, 'teach', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, RESEARCH_VAULT_PATH: VAULT },
});
const attemptFiles = (ws) => readdirSync(join(ws, 'attempts')).sort();

test('CLI teach lint on the good lesson exits 0 with lint: clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-teach-clean-'));
  for (const f of ['MISSION.md', 'GLOSSARY.md', 'lessons/0001-good.html', 'lessons/0003-review-good.html', 'reference/good.html',
    'learning-records/0001-known.md', 'attempts/a-20260101-120000-0001.md', 'evidence/0001/PLAN.md']) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(FIX, f), join(dir, f));
  }
  const r = cli(['lint', dir]);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, 'lint: clean\n');
  assert.equal(r.status, 0);
});

test('CLI teach lint on the workspace exits 1 and prints the bad codes in the vault format', () => {
  const ws = copyFixture();
  const r = cli(['lint', ws]);
  console.log(r.stdout);
  assert.equal(r.status, 1);
  const lines = r.stdout.trim().split('\n');
  const violations = lines.filter((l) => !l.startsWith('warning '));
  const warnings = lines.filter((l) => l.startsWith('warning '));
  console.log(`violations ${violations.length}, warnings ${warnings.length}`);
  for (const l of violations) assert.match(l, /^[A-Z_]+ {2}lessons\/0002-bad\.html: \S/);
  assert.deepEqual(violations.map((l) => l.split(' ')[0]).sort(), [
    'EVIDENCE_PLAN_MISSING', 'LESSON_BLOCK_MISSING', 'LESSON_CITE_UNRESOLVED', 'LESSON_CLAIM_UNCITED', 'LESSON_LINK_DANGLING',
    'QUIZ_ANSWER_SPREAD', 'QUIZ_CORRECT_RANGE', 'QUIZ_TOO_FEW', 'QUIZ_WHY_MISSING',
  ]);
  assert.ok(violations.includes('LESSON_BLOCK_MISSING  lessons/0002-bad.html: missing block: step'));
  assert.deepEqual(warnings, ['warning WARN_RECORD_FRONTMATTER_MISSING  learning-records/0002-legacy.md: no frontmatter; run teach lint --fix']);
  assert.ok(!r.stdout.includes('lint: clean'));
  // Warnings print after the violations, as the vault lint does.
  assert.equal(lines.at(-1), warnings[0]);
});

test('CLI teach lint --fix migrates the legacy record and is idempotent', () => {
  const ws = copyFixture();
  const legacy = join(ws, 'learning-records', '0002-legacy.md');
  const r1 = cli(['lint', '--fix', ws]);
  assert.equal(r1.stdout.split('\n')[0], 'fixed 1 record(s)');
  assert.ok(!r1.stdout.includes('WARN_RECORD_FRONTMATTER_MISSING'));
  const after = readFileSync(legacy, 'utf8');
  assert.match(after, /^---\n/);
  assert.match(after, /^status: superseded$/m);
  assert.match(after, /^superseded_by: 0001-known$/m);
  assert.match(after, /Status: superseded by LR-0001/);
  const r2 = cli(['lint', '--fix', ws]);
  assert.equal(r2.stdout.split('\n')[0], 'fixed 0 record(s)');
  assert.equal(readFileSync(legacy, 'utf8'), after);
  assert.equal(r2.status, 1); // the bad lesson still fires
});

test('CLI teach record add then supersede round-trips', () => {
  const ws = copyFixture();
  const body = join(ws, 'body.txt');
  writeFileSync(body, 'The learner thought fx was linear in general.\n');
  const add = cli(['record', 'add', '--title', 'fx is linear', '--kind', 'misconception', '--lesson', '0001-good', '--body-file', body, ws]);
  assert.equal(add.stderr, '');
  assert.equal(add.stdout, '0003-fx-linear\n');
  assert.equal(add.status, 0);
  const rec = readFileSync(join(ws, 'learning-records', '0003-fx-linear.md'), 'utf8');
  assert.match(rec, /^kind: misconception$/m);
  assert.match(rec, /^lesson: 0001-good$/m);
  assert.match(rec, /The learner thought fx was linear in general\./);

  const sup = cli(['record', 'supersede', '0001-known', '--by', '0003-fx-linear', '--reason', 'learner revised', ws]);
  assert.equal(sup.stdout, 'superseded 0001-known by 0003-fx-linear\n');
  assert.equal(sup.status, 0);
  const old = readFileSync(join(ws, 'learning-records', '0001-known.md'), 'utf8');
  assert.match(old, /^status: superseded$/m);
  assert.match(old, /^superseded_by: 0003-fx-linear$/m);
  assert.match(old, /Superseded by 0003-fx-linear: learner revised/);

  // Missing --kind is usage; an invalid kind is a lib error; neither writes.
  const before = readdirSync(join(ws, 'learning-records')).length;
  const noKind = cli(['record', 'add', '--title', 'x', ws]);
  assert.equal(noKind.status, 2);
  assert.equal(noKind.stderr, USAGE);
  const badKind = cli(['record', 'add', '--title', 'x', '--kind', 'guess', ws]);
  assert.equal(badKind.status, 2);
  assert.match(badKind.stderr, /^error: unknown kind: guess/);
  const afterCount = readdirSync(join(ws, 'learning-records')).length;
  console.log(`records before ${before}, after ${afterCount}`);
  assert.equal(afterCount, before);
});

test('CLI teach attempt add records a graded attempt', () => {
  const ws = copyFixture();
  const before = attemptFiles(ws);
  const r = cli(['attempt', 'add', '--lesson', '0003-review-good', '--answers', '0,0,1', ws]);
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
  const m = /^recorded (a-\d{8}-\d{6}-0003): 2\/3\n$/.exec(r.stdout);
  assert.ok(m, r.stdout);
  const after = attemptFiles(ws);
  console.log(`attempts before ${before.length}, after ${after.length}`);
  assert.deepEqual(after, [...before, `${m[1]}.md`].sort());
  assert.match(readFileSync(join(ws, 'attempts', `${m[1]}.md`), 'utf8'), /^records: \[0001-known\]$/m);

  // A non-integer answer and an out-of-range answer each write nothing.
  for (const answers of ['0,x,1', '0,0,9']) {
    const bad = cli(['attempt', 'add', '--lesson', '0003-review-good', '--answers', answers, ws]);
    assert.equal(bad.status, 2, answers);
    assert.match(bad.stderr, /^error: /);
  }
  assert.equal(attemptFiles(ws).length, after.length);
});

test('CLI teach next prints criteria, the records table and the review lines', () => {
  const ws = copyFixture();
  const head = '1. Predict what fx prints for a given input\n2. Run fx on a new input and check the prediction\n\n' +
    '| id | kind | date | lesson | last attempt |\n|---|---|---|---|---|\n';
  const r1 = cli(['next', ws]);
  assert.equal(r1.status, 0);
  assert.equal(r1.stdout, head + '| 0001-known | understanding | 2026-01-01 | 0001-good | none |\n\nreview-due: 0001-known\nreview-failed: none\n');
  // A wrong answer on the review item today: no longer due, now failed. Run from the cwd.
  assert.equal(cli(['attempt', 'add', '--lesson', '0003-review-good', '--answers', '0,0,1', ws]).status, 0);
  const r2 = cli(['next'], ws);
  assert.equal(r2.status, 0);
  assert.equal(r2.stdout, head + `| 0001-known | understanding | 2026-01-01 | 0001-good | 2/3 on ${TODAY} |\n\nreview-due: none\nreview-failed: 0001-known\n`);
});

test('CLI teach next without a Success section exits 2', () => {
  const ws = copyFixture();
  writeFileSync(join(ws, 'MISSION.md'), '# Mission\n\n## Why\nNo criteria yet.\n');
  const r = cli(['next', ws]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'teach next: MISSION.md has no "Success looks like" section\n');
});

test('CLI teach usage exits 2; cwd without MISSION.md exits 2', () => {
  const empty = mkdtempSync(join(tmpdir(), 'rv-teach-empty-'));
  for (const args of [[], ['bogus'], ['record'], ['attempt', 'add', '--lesson', '0001-good'], ['next'], ['lint']]) {
    const r = cli(args, empty);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr, USAGE, args.join(' '));
  }
  // Positive control: the same verb from a cwd holding MISSION.md runs.
  assert.equal(cli(['lint'], copyFixture()).status, 1);
});

test('session brief names review-due, stale docs and the last attempt', () => {
  const ws = copyFixture();
  const now = new Date();
  assert.equal(workspaceBrief(ws, VAULT, now, 'learn/fx'),
    'research-teach learn/fx: 1 record(s) review-due; 1 reference doc(s) with a stale citation; last attempt 2/3 on 0001-good');
  assert.equal(cli(['attempt', 'add', '--lesson', '0003-review-good', '--answers', '0,2,1', ws]).status, 0);
  assert.equal(workspaceBrief(ws, VAULT, now, 'learn/fx'),
    'research-teach learn/fx: 0 record(s) review-due; 1 reference doc(s) with a stale citation; last attempt 3/3 on 0003-review-good');
});
