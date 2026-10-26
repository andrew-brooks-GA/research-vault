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
const USAGE = 'usage: research-vault teach record add|supersede ... | attempt add ... | lint [--fix] [workspace] | next [workspace] | progress [workspace] | serve [workspace]\n';

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
  const recordLine = 'MISSING_REQUIRED  learning-records/0003-legacy-frontmatter.md: missing required field: type';
  assert.ok(violations.includes(recordLine));
  const lessonLines = violations.filter((l) => l !== recordLine);
  for (const l of lessonLines) assert.match(l, /^[A-Z_]+ {2}lessons\/0002-bad\.html: \S/);
  assert.deepEqual(lessonLines.map((l) => l.split(' ')[0]).sort(), [
    'EVIDENCE_PLAN_MISSING', 'LESSON_BLOCK_MISSING', 'LESSON_CITE_UNRESOLVED', 'LESSON_CLAIM_UNCITED', 'LESSON_LINK_DANGLING', 'LESSON_TOOL_NOT_INTRODUCED',
    'QUIZ_ANSWER_SPREAD', 'QUIZ_CORRECT_RANGE', 'QUIZ_TOO_FEW', 'QUIZ_WHY_MISSING',
  ]);
  assert.ok(violations.includes('LESSON_BLOCK_MISSING  lessons/0002-bad.html: missing block: step'));
  assert.deepEqual(warnings, ['warning WARN_RECORD_FRONTMATTER_MISSING  learning-records/0002-legacy.md: no frontmatter; run teach lint --fix']);
  assert.ok(!r.stdout.includes('lint: clean'));
  // Warnings print after the violations, as the vault lint does.
  assert.equal(lines.at(-1), warnings[0]);
});

test('CLI teach lint: a command tool must be in Known tools or taught by this or an earlier lesson (data-teaches)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-teach-tools-'));
  for (const f of ['MISSION.md', 'GLOSSARY.md', 'lessons/0001-good.html', 'reference/good.html', 'evidence/0001/PLAN.md']) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(FIX, f), join(dir, f));
  }
  const good = readFileSync(join(FIX, 'lessons', '0001-good.html'), 'utf8');
  const second = good.replace('data-lesson="0001-good"', 'data-lesson="0002-fxctl"')
    .replace('<section data-block="step">', '<section data-block="step">\n<pre><code>FX_ENV=lab fxctl run 3 | node -e "process.stdin.pipe(process.stdout)"</code></pre>');
  writeFileSync(join(dir, 'lessons', '0002-fxctl.html'), second);
  mkdirSync(join(dir, 'evidence', '0002'));
  cpSync(join(FIX, 'evidence', '0001', 'PLAN.md'), join(dir, 'evidence', '0002', 'PLAN.md'));

  // node is in Known tools; fxctl is not taught anywhere: one finding, naming the block and the tool.
  let r = cli(['lint', dir]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, 'LESSON_TOOL_NOT_INTRODUCED  lessons/0002-fxctl.html: step runs fxctl, which is neither in MISSION.md "Known tools" nor taught by this or an earlier lesson (data-teaches)\n');

  // An earlier lesson teaches it: clean.
  writeFileSync(join(dir, 'lessons', '0001-good.html'), good.replace('<body data-lesson="0001-good">', '<body data-lesson="0001-good" data-teaches="fxctl">'));
  r = cli(['lint', dir]);
  assert.equal(r.stdout, 'lint: clean\n');
  assert.equal(r.status, 0);

  // Only a LATER lesson teaches it: still a finding (order matters).
  writeFileSync(join(dir, 'lessons', '0001-good.html'), good);
  writeFileSync(join(dir, 'lessons', '0002-fxctl.html'), second.replace('data-lesson="0002-fxctl"', 'data-lesson="0002-fxctl" data-teaches="FXCTL"'));
  r = cli(['lint', dir]);
  assert.equal(r.stdout, 'lint: clean\n', 'a lesson may use the tool it teaches, case-insensitively');
  writeFileSync(join(dir, 'lessons', '0002-fxctl.html'), second);
  writeFileSync(join(dir, 'lessons', '0003-later.html'), good.replace('<body data-lesson="0001-good">', '<body data-lesson="0003-later" data-teaches="fxctl">'));
  mkdirSync(join(dir, 'evidence', '0003'));
  cpSync(join(FIX, 'evidence', '0001', 'PLAN.md'), join(dir, 'evidence', '0003', 'PLAN.md'));
  r = cli(['lint', dir]);
  assert.match(r.stdout, /^LESSON_TOOL_NOT_INTRODUCED  lessons\/0002-fxctl\.html: step runs fxctl/);
  assert.equal(r.status, 1);

  // No Known tools section: the rule cannot run; a warning, not a violation.
  writeFileSync(join(dir, 'MISSION.md'), readFileSync(join(FIX, 'MISSION.md'), 'utf8').replace(/## Known tools\n- node\n\n/, ''));
  r = cli(['lint', dir]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^warning WARN_MISSION_KNOWN_TOOLS_MISSING  lessons\/0001-good\.html: MISSION\.md has no "Known tools" section/m);
});

test('CLI teach lint resolves the vault from the workspace, not the cwd; a missing vault exits 2', () => {
  // A repo bound to the fixture vault holds a clean workspace; the cwd is another repo bound
  // to a vault that does not exist, and RESEARCH_VAULT_PATH points nowhere too.
  const bind = (root, vault) => writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault }) + '\n');
  const repo = mkdtempSync(join(tmpdir(), 'rv-teach-repo-'));
  bind(repo, VAULT);
  const ws = join(repo, 'learn', 'fx');
  for (const f of ['MISSION.md', 'GLOSSARY.md', 'lessons/0001-good.html', 'reference/good.html', 'evidence/0001/PLAN.md']) {
    mkdirSync(dirname(join(ws, f)), { recursive: true });
    cpSync(join(FIX, f), join(ws, f));
  }
  const other = mkdtempSync(join(tmpdir(), 'rv-teach-other-'));
  bind(other, join(other, 'no-vault'));
  const env = { ...process.env, RESEARCH_VAULT_PATH: join(other, 'nowhere') };
  const r = spawnSync(process.execPath, [BIN, 'teach', 'lint', ws], { cwd: other, env, encoding: 'utf8' });
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, 'lint: clean\n');
  assert.equal(r.status, 0);
  // The workspace's own binding names a missing vault: exit 2, not a wall of LESSON_CITE_UNRESOLVED.
  bind(repo, join(repo, 'gone'));
  const g = spawnSync(process.execPath, [BIN, 'teach', 'lint', ws], { cwd: other, env, encoding: 'utf8' });
  assert.equal(g.status, 2);
  assert.equal(g.stdout, '');
  assert.equal(g.stderr, `teach lint: no vault at ${join(repo, 'gone')}\n`);
});

test('CLI teach lint --fix migrates the legacy record and is idempotent', () => {
  const ws = copyFixture();
  const legacy = join(ws, 'learning-records', '0002-legacy.md');
  const r1 = cli(['lint', '--fix', ws]);
  assert.equal(r1.stdout.split('\n')[0], 'fixed 2 record(s)');
  assert.ok(!r1.stdout.includes('WARN_RECORD_FRONTMATTER_MISSING'));
  assert.ok(!r1.stdout.includes('learning-records/'));
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
  assert.equal(add.stdout, '0004-fx-linear\n');
  assert.equal(add.status, 0);
  const rec = readFileSync(join(ws, 'learning-records', '0004-fx-linear.md'), 'utf8');
  assert.match(rec, /^kind: misconception$/m);
  assert.match(rec, /^lesson: 0001-good$/m);
  assert.match(rec, /The learner thought fx was linear in general\./);

  const sup = cli(['record', 'supersede', '0001-known', '--by', '0004-fx-linear', '--reason', 'learner revised', ws]);
  assert.equal(sup.stdout, 'superseded 0001-known by 0004-fx-linear\n');
  assert.equal(sup.status, 0);
  const old = readFileSync(join(ws, 'learning-records', '0001-known.md'), 'utf8');
  assert.match(old, /^status: superseded$/m);
  assert.match(old, /^superseded_by: 0004-fx-linear$/m);
  assert.match(old, /Superseded by 0004-fx-linear: learner revised/);

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

test('CLI teach lint with a positional path that is missing or lacks MISSION.md exits 2', () => {
  const empty = mkdtempSync(join(tmpdir(), 'rv-teach-nomission-'));
  for (const ws of [join(empty, 'does-not-exist'), empty]) {
    const r = cli(['lint', ws]);
    console.log(`lint ${ws} -> ${r.status}, stdout ${r.stdout.length} bytes`);
    assert.equal(r.status, 2, ws);
    assert.equal(r.stderr, USAGE, ws);
    assert.equal(r.stdout, '', ws);
  }
  // Positive control: the fixture copy, which holds MISSION.md, lints.
  const ok = cli(['lint', copyFixture()]);
  assert.equal(ok.status, 1);
  assert.match(ok.stdout, /LESSON_BLOCK_MISSING/);
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

test('CLI teach progress prints every attempt per lesson with first, latest and best', () => {
  const ws = copyFixture();
  const r1 = cli(['progress', ws]);
  assert.equal(r1.status, 0);
  assert.equal(r1.stdout, '| lesson | attempts | first | latest | best |\n|---|---|---|---|---|\n' +
    '| 0001-good | 1 | 2/3 on 2026-01-01 | 2/3 on 2026-01-01 | 2/3 on 2026-01-01 |\n' +
    '| 0002-bad | 0 | none | none | none |\n| 0003-review-good | 0 | none | none | none |\n\n' +
    'attempts: 1\nrecords: 1 active (understanding 1)\nreview-due: 0001-known\nreview-failed: none\n');
  assert.equal(cli(['attempt', 'add', '--lesson', '0001-good', '--answers', '0,1,3', ws]).status, 0);
  const r2 = cli(['progress', ws]);
  assert.match(r2.stdout, new RegExp(`\\| 0001-good \\| 2 \\| 2/3 on 2026-01-01 \\| 3/3 on ${TODAY} \\| 3/3 on ${TODAY} \\|`));
  assert.match(r2.stdout, /attempts: 2/);
});
