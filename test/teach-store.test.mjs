import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTeachSchema } from '../bin/lib/schema.mjs';
import { parseFrontmatter } from '../bin/lib/frontmatter.mjs';
import {
  SPACING_DAYS, ATTEMPT_ID_RE, LESSON_ID_RE, RECORD_ID_RE, STORED_DERIVED,
  validateEntry, nextRecordId, attemptId, writeRecord, supersedeRecord, readQuiz,
  writeAttempt, teachIndex, fixRecordFrontmatter,
} from '../bin/lib/teach.mjs';

// Copied from bin/lib/citations.mjs (not exported there): the vault citation id pattern.
const CITATION_RE = /\b\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\b/;

const schema = loadTeachSchema(process.cwd());
const ws = () => mkdtempSync(join(tmpdir(), 'rv-teach-'));
const NOW = new Date('2026-10-26T12:34:56Z');
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const list = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

function lesson(dir, id, items, title = 'Lesson title') {
  mkdirSync(join(dir, 'lessons'), { recursive: true });
  const json = typeof items === 'string' ? items : JSON.stringify({ items });
  writeFileSync(join(dir, 'lessons', `${id}.html`),
    `<!doctype html><html><head><title>${title}</title></head><body><h1>H</h1>\n` +
    `<p>Fact <a data-cite="2026-01-01-fx-doc">x</a> and <a data-cite="2026-01-01-fx-doc">again</a>, ` +
    `<a data-cite="2026-01-02-other">y</a>.</p>\n` +
    `<script type="application/json" data-quiz>${json}</script></body></html>\n`);
}

const item = (correct, record) => ({ q: 'q', options: ['a', 'b', 'c'], correct, why: ['1', '2', '3'], ...(record ? { record } : {}) });

test('loadTeachSchema returns field lists and taxonomy', () => {
  assert.deepEqual(schema.common, ['title', 'type', 'date']);
  assert.deepEqual(schema.by_type['learning-record'], ['status', 'superseded_by', 'lesson', 'kind']);
  assert.deepEqual(schema.required_by_type.attempt, ['type', 'date', 'lesson', 'total', 'wrong', 'records']);
  assert.deepEqual(schema.edge_fields, { backlink: ['records'], reference_only: ['superseded_by', 'lesson'] });
  assert.deepEqual(schema.derived_forbidden, ['score', 'evidence', 'last_verified']);
  assert.deepEqual(STORED_DERIVED, schema.derived_forbidden);
  assert.deepEqual(schema.taxonomy.status, ['active', 'superseded']);
  assert.deepEqual(schema.taxonomy.kind, ['understanding', 'prior-knowledge', 'misconception', 'mission-shift']);
  assert.deepEqual(schema.taxonomy.type_folder, { 'learning-record': 'learning-records', attempt: 'attempts' });
  assert.equal(SPACING_DAYS, 21);
  assert.ok(LESSON_ID_RE.test('0003-review-tls') && !LESSON_ID_RE.test('0003-2026-10-01-x'));
  assert.ok(RECORD_ID_RE.test('0001-tls-basics') && !RECORD_ID_RE.test('LR-0001'));
});

test('validateEntry reports missing required, bad enum and stored derived fields', () => {
  const good = { title: 't', type: 'learning-record', date: '2026-10-01', status: 'active', kind: 'understanding' };
  assert.deepEqual(validateEntry(good, schema), []);
  const msgs = validateEntry({ type: 'learning-record', date: '2026-10-01', status: 'done', kind: 'guess', score: 3, evidence: [] }, schema);
  assert.ok(msgs.includes('missing required field: title'), msgs.join('|'));
  assert.ok(msgs.includes('unknown status: done'), msgs.join('|'));
  assert.ok(msgs.includes('unknown kind: guess'), msgs.join('|'));
  assert.ok(msgs.includes('stored derived field: score'), msgs.join('|'));
  assert.ok(msgs.includes('stored derived field: evidence'), msgs.join('|'));
  assert.ok(validateEntry({ type: 'note' }, schema).includes('unknown type: note'));
  // An attempt has no title: none required.
  assert.deepEqual(validateEntry({ type: 'attempt', date: '2026-10-01', lesson: '0001-x', total: 3, wrong: [], records: [] }, schema), []);
});

test('writeRecord numbers sequentially and writes valid frontmatter', () => {
  const dir = ws();
  assert.equal(nextRecordId(dir, 'tls-basics'), '0001-tls-basics');
  const a = writeRecord(dir, { title: 'TLS basics', kind: 'understanding', now: NOW }, schema);
  assert.equal(a.id, '0001-tls-basics');
  const b = writeRecord(dir, { title: 'SNI routing', kind: 'misconception', lesson: '0002-sni', body: 'Learner thought X.', now: NOW }, schema);
  assert.equal(b.id, '0002-sni-routing');
  writeFileSync(join(dir, 'learning-records', '0009-gap.md'), '---\ntitle: g\n---\n');
  assert.equal(nextRecordId(dir, 'next'), '0010-next');
  const text = readFileSync(b.path, 'utf8');
  assert.equal(text, '---\ntitle: SNI routing\ntype: learning-record\ndate: 2026-10-26\nstatus: active\nlesson: 0002-sni\nkind: misconception\n---\n# SNI routing\n\nLearner thought X.\n');
  assert.deepEqual(validateEntry(parseFrontmatter(text).data, schema), []);
  assert.throws(() => writeRecord(dir, { title: 'x', kind: 'guess', now: NOW }, schema), /unknown kind: guess/);
  assert.equal(list(join(dir, 'learning-records')).length, 3);
});

test('supersedeRecord sets status and superseded_by and appends the reason; refuses an unknown id', () => {
  const dir = ws();
  const old = writeRecord(dir, { title: 'Old view', kind: 'understanding', now: NOW }, schema);
  const neu = writeRecord(dir, { title: 'New view', kind: 'understanding', now: NOW }, schema);
  const before = readFileSync(old.path, 'utf8');
  assert.throws(() => supersedeRecord(dir, old.id, '0099-missing', 'r', schema), /0099-missing/);
  assert.throws(() => supersedeRecord(dir, '0098-missing', neu.id, 'r', schema), /0098-missing/);
  assert.equal(readFileSync(old.path, 'utf8'), before);
  supersedeRecord(dir, old.id, neu.id, 'probe showed otherwise', schema);
  const { data, body } = parseFrontmatter(readFileSync(old.path, 'utf8'));
  assert.equal(data.status, 'superseded');
  assert.equal(data.superseded_by, neu.id);
  assert.ok(body.endsWith(`\nSuperseded by ${neu.id}: probe showed otherwise\n`), body);
  assert.ok(readFileSync(old.path, 'utf8').startsWith('---\ntitle: Old view\ntype: learning-record\ndate: 2026-10-26\nstatus: superseded\nsuperseded_by: 0002-new-view\nkind: understanding\n---\n'));
  const c = writeRecord(dir, { title: 'Third', kind: 'understanding', now: NOW }, schema);
  supersedeRecord(dir, neu.id, c.id, '', schema);
  assert.ok(parseFrontmatter(readFileSync(neu.path, 'utf8')).body.endsWith(`\nSuperseded by ${c.id}.\n`));
});

test('attemptId never matches the vault citation pattern and suffixes on collision', () => {
  const taken = new Set();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const id = attemptId(NOW, '0007', (x) => taken.has(x));
    taken.add(id);
    ids.push(id);
  }
  assert.deepEqual(ids, ['a-20261026-123456-0007', 'a-20261026-123456-0007-2', 'a-20261026-123456-0007-3']);
  const citeHits = ids.filter((id) => CITATION_RE.test(id)).length;
  const grammarHits = ids.filter((id) => ATTEMPT_ID_RE.test(id)).length;
  console.log(`attempt ids: ${grammarHits}/${ids.length} match ATTEMPT_ID_RE, ${citeHits}/${ids.length} match the citation pattern`);
  assert.equal(grammarHits, 3);
  assert.equal(citeHits, 0);
  // The citation pattern itself does fire on a vault id, so the zero above is meaningful.
  assert.ok(CITATION_RE.test('2026-10-26-some-note'));
});

test('writeAttempt grades from the quiz, snapshots total and records, refuses out-of-range answers without writing', () => {
  const dir = ws();
  lesson(dir, '0004-review-tls', [item(0, '0001-a'), item(1, '0002-b'), item(2, '0001-a'), item(0)]);
  const bad = [
    { lesson: '0004-review-tls', answers: [0, 1, 2] },
    { lesson: '0004-review-tls', answers: [0, 1, 2, 3] },
    { lesson: '0004-review-tls', answers: [0, 1, 2, -1] },
    { lesson: '0004-review-tls', answers: [0, 1, 2, 0.5] },
    { lesson: '0004-review-tls', answers: '0,1,2,0' },
    { lesson: '../0004-review-tls', answers: [0, 1, 2, 0] },
    { lesson: '0005-missing', answers: [0, 1, 2, 0] },
  ];
  let thrown = 0;
  for (const b of bad) { try { writeAttempt(dir, { ...b, now: NOW }, schema); } catch { thrown++; } }
  const afterBad = list(join(dir, 'attempts')).length;
  console.log(`bad attempts: ${thrown}/${bad.length} refused, ${afterBad} attempt file(s) written`);
  assert.equal(thrown, bad.length);
  assert.equal(afterBad, 0);

  const r = writeAttempt(dir, { lesson: '0004-review-tls', answers: [1, 0, 1, 0], now: NOW }, schema);
  assert.deepEqual({ id: r.id, score: r.score, total: r.total, wrong: r.wrong },
    { id: 'a-20261026-123456-0004', score: 1, total: 4, wrong: [0, 1, 2] });
  const { data } = parseFrontmatter(readFileSync(r.path, 'utf8'));
  assert.deepEqual(data, { type: 'attempt', date: '2026-10-26', lesson: '0004-review-tls', total: 4, wrong: [0, 1, 2], records: ['0001-a', '0002-b'] });
  assert.ok(!('score' in data));
  const r2 = writeAttempt(dir, { lesson: '0004-review-tls', answers: [0, 1, 2, 0], now: NOW }, schema);
  assert.equal(r2.id, 'a-20261026-123456-0004-2');
  assert.equal(r2.score, 4);
  const files = list(join(dir, 'attempts'));
  console.log(`good attempts: ${files.length} attempt file(s) written`);
  assert.equal(files.length, 2);
});

test('writeAttempt errors on malformed quiz JSON without writing', () => {
  const dir = ws();
  lesson(dir, '0001-broken', '{ "items": [ {"q": "x", ');
  lesson(dir, '0002-shape', JSON.stringify({ questions: [] }));
  lesson(dir, '0003-noopts', JSON.stringify({ items: [{ q: 'x', correct: 0 }] }));
  writeFileSync(join(dir, 'lessons', '0004-noquiz.html'), '<html><body><p>no quiz</p></body></html>\n');
  for (const id of ['0001-broken', '0002-shape', '0003-noopts', '0004-noquiz']) {
    assert.throws(() => readQuiz(dir, id), new RegExp(`^Error: quiz JSON invalid in ${id}$`));
    assert.throws(() => writeAttempt(dir, { lesson: id, answers: [0], now: NOW }, schema), new RegExp(`quiz JSON invalid in ${id}`));
  }
  const n = list(join(dir, 'attempts')).length;
  console.log(`malformed quizzes: ${n} attempt file(s) written`);
  assert.equal(n, 0);
  // Positive control: a well-formed quiz in the same workspace does write.
  lesson(dir, '0005-good', [item(0)]);
  writeAttempt(dir, { lesson: '0005-good', answers: [0], now: NOW }, schema);
  assert.equal(list(join(dir, 'attempts')).length, 1);
});

test('fixRecordFrontmatter migrates LR-NNNN supersession and is idempotent', () => {
  const dir = ws();
  const lr = join(dir, 'learning-records');
  mkdirSync(lr, { recursive: true });
  writeFileSync(join(lr, '0001-old-view.md'), '# Old view\n\nTLS ends at the gateway.\n\nStatus: superseded by LR-0002\n');
  writeFileSync(join(lr, '0002-new-view.md'), '# New view\n\nTLS passes through.\n');
  writeFileSync(join(lr, '0003-dangling.md'), 'No heading here.\n\nStatus: superseded by LR-0042\n');
  const mtime = new Date('2026-09-01T23:30:00Z');
  for (const f of readdirSync(lr)) utimesSync(join(lr, f), mtime, mtime);
  const valid = writeRecord(dir, { title: 'Already fine', kind: 'understanding', now: NOW }, schema);
  const validBytes = readFileSync(valid.path, 'utf8');

  const first = readdirSync(lr).sort().map((f) => fixRecordFrontmatter(dir, f, NOW));
  assert.deepEqual(first, [true, true, true, false]);
  const snap = Object.fromEntries(readdirSync(lr).map((f) => [f, readFileSync(join(lr, f), 'utf8')]));
  assert.equal(snap['0004-already-fine.md'], validBytes);

  const one = parseFrontmatter(snap['0001-old-view.md']);
  assert.deepEqual(one.data, { title: 'Old view', type: 'learning-record', date: '2026-09-01', status: 'superseded', superseded_by: '0002-new-view', kind: 'understanding' });
  assert.ok(one.body.includes('Status: superseded by LR-0002'), 'old line kept in the body');
  assert.deepEqual(parseFrontmatter(snap['0002-new-view.md']).data,
    { title: 'New view', type: 'learning-record', date: '2026-09-01', status: 'active', kind: 'understanding' });
  assert.deepEqual(parseFrontmatter(snap['0003-dangling.md']).data,
    { title: 'dangling', type: 'learning-record', date: '2026-09-01', status: 'active', kind: 'understanding' });
  for (const t of Object.values(snap)) assert.deepEqual(validateEntry(parseFrontmatter(t).data, schema), []);

  const second = readdirSync(lr).sort().map((f) => fixRecordFrontmatter(dir, f, NOW));
  const changed = readdirSync(lr).filter((f) => readFileSync(join(lr, f), 'utf8') !== snap[f]).length;
  console.log(`--fix second run: ${second.filter(Boolean).length} reported changed, ${changed} file(s) differ`);
  assert.deepEqual(second, [false, false, false, false]);
  assert.equal(changed, 0);
});

test('teachIndex derives evidence, lastAttempt, reviewDue and reviewFailed', () => {
  const dir = ws();
  writeFileSync(join(dir, 'MISSION.md'), '# Mission\n\nWin.\n\n## Success Looks Like\n\n- Explain TLS\n* Route SNI\n1. Debug a cert\n\nprose\n\n## Other\n\n- not a criterion\n');
  const lr = join(dir, 'learning-records');
  mkdirSync(lr, { recursive: true });
  const rec = (id, date, extra = '') => writeFileSync(join(lr, `${id}.md`),
    `---\ntitle: ${id}\ntype: learning-record\ndate: ${date}\nstatus: active\n${extra}kind: understanding\n---\n# ${id}\n`);
  const old = iso(new Date(NOW - 40 * DAY));
  rec('0001-old-unreviewed', old);
  rec('0002-old-reviewed-recently', old);
  rec('0003-failed', iso(new Date(NOW - 2 * DAY)));
  rec('0004-old-superseded', old, 'superseded_by: 0003-failed\n');
  writeFileSync(join(lr, '0004-old-superseded.md'), readFileSync(join(lr, '0004-old-superseded.md'), 'utf8').replace('status: active', 'status: superseded'));
  rec('0005-old-reviewed-long-ago', old);
  writeFileSync(join(lr, '0006-legacy.md'), '# legacy, no frontmatter\n');

  lesson(dir, '0002-review-mixed', [item(0, '0002-old-reviewed-recently'), item(0, '0003-failed')], 'Review: mixed');
  lesson(dir, '0004-review-older', [item(0, '0005-old-reviewed-long-ago')], 'Review: older');
  lesson(dir, '0001-intro', [item(0)], 'Intro');
  writeFileSync(join(dir, 'lessons', '0003-broken.html'), '<html><h1>Broken <em>one</em></h1><script type="application/json" data-quiz>{nope</script></html>');
  writeFileSync(join(dir, 'lessons', 'notes.html'), '<html></html>');

  // 0005 last tested 30 days ago (older than the spacing cutoff), all right; 0002 and 0003 tested yesterday, 0003 wrong.
  const older = writeAttempt(dir, { lesson: '0004-review-older', answers: [0], now: new Date(NOW - 30 * DAY) }, schema);
  const recent = writeAttempt(dir, { lesson: '0002-review-mixed', answers: [0, 1], now: new Date(NOW - 1 * DAY) }, schema);
  mkdirSync(join(dir, 'attempts'), { recursive: true });
  writeFileSync(join(dir, 'attempts', 'a-20260101-000000-0009.md'), 'garbage, no frontmatter\n');

  const ix = teachIndex(dir, { now: NOW });
  assert.deepEqual(ix.criteria, ['Explain TLS', 'Route SNI', 'Debug a cert']);
  assert.deepEqual(ix.lessons.map((l) => [l.id, l.number, l.class, l.title]), [
    ['0001-intro', '0001', 'lesson', 'Intro'],
    ['0002-review-mixed', '0002', 'review', 'Review: mixed'],
    ['0003-broken', '0003', 'lesson', 'Broken one'],
    ['0004-review-older', '0004', 'review', 'Review: older'],
  ]);
  assert.deepEqual(ix.lessons[1].cites, ['2026-01-01-fx-doc', '2026-01-02-other']);
  assert.deepEqual(ix.lessons[1].records, ['0002-old-reviewed-recently', '0003-failed']);
  assert.deepEqual(ix.lessons[2].records, []);
  assert.equal(ix.attempts.length, 2);
  assert.deepEqual(ix.backlinks, { '0003-failed': [recent.id] });

  const by = Object.fromEntries(ix.records.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(by).sort(), ['0001-old-unreviewed', '0002-old-reviewed-recently', '0003-failed', '0004-old-superseded', '0005-old-reviewed-long-ago']);
  assert.deepEqual(by['0003-failed'].evidence, [recent.id]);
  assert.deepEqual(by['0003-failed'].lastAttempt, { id: recent.id, date: iso(new Date(NOW - DAY)), score: 1, total: 2, wrongHere: true });
  assert.equal(by['0002-old-reviewed-recently'].lastAttempt.wrongHere, false);
  assert.deepEqual(by['0002-old-reviewed-recently'].evidence, []);
  assert.equal(by['0001-old-unreviewed'].lastAttempt, null);
  assert.deepEqual(by['0005-old-reviewed-long-ago'].lastAttempt, { id: older.id, date: iso(new Date(NOW - 30 * DAY)), score: 1, total: 1, wrongHere: false });
  assert.deepEqual(ix.attempts.map((a) => a.id), [older.id, recent.id]);

  const due = ix.records.filter((r) => r.reviewDue).map((r) => r.id);
  const failed = ix.records.filter((r) => r.reviewFailed).map((r) => r.id);
  console.log(`reviewDue: ${due.length} [${due}]; reviewFailed: ${failed.length} [${failed}]`);
  assert.deepEqual(due, ['0001-old-unreviewed', '0005-old-reviewed-long-ago']);
  assert.deepEqual(failed, ['0003-failed']);
  for (const r of ix.records) for (const f of STORED_DERIVED) if (f !== 'evidence') assert.ok(!(f in r), `${r.id} carries ${f}`);
});

test('fixRecordFrontmatter migrates frontmatter that has only the old Status line', () => {
  const dir = ws();
  cpSync(join(process.cwd(), 'test', 'fixtures', 'teach', 'learning-records'), join(dir, 'learning-records'), { recursive: true });
  const lr = join(dir, 'learning-records');
  // A lowercase status pointing at a record that does not exist stays active.
  writeFileSync(join(lr, '0004-dangling-fm.md'), '---\ntitle: Kept title\nstatus: superseded by LR-0099\n---\nbody\n');
  const knownBytes = readFileSync(join(lr, '0001-known.md'), 'utf8');
  const files = readdirSync(lr).sort();
  const first = files.map((f) => fixRecordFrontmatter(dir, f, NOW));
  console.log(`--fix first run: ${files.map((f, i) => `${f}=${first[i]}`).join(' ')}`);
  assert.deepEqual(first, [false, true, true, true]);
  assert.equal(readFileSync(join(lr, '0001-known.md'), 'utf8'), knownBytes);
  const fm = parseFrontmatter(readFileSync(join(lr, '0003-legacy-frontmatter.md'), 'utf8'));
  const { date, ...rest } = fm.data;
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(rest, { title: 'Legacy with frontmatter', type: 'learning-record', status: 'superseded', superseded_by: '0001-known', kind: 'understanding' });
  assert.equal(fm.body, '# Legacy with frontmatter\n\nbody\n');
  const dangling = parseFrontmatter(readFileSync(join(lr, '0004-dangling-fm.md'), 'utf8')).data;
  assert.equal(dangling.title, 'Kept title');
  assert.equal(dangling.status, 'active');
  assert.ok(!('superseded_by' in dangling) && !('Status' in dangling));
  for (const f of files) assert.deepEqual(validateEntry(parseFrontmatter(readFileSync(join(lr, f), 'utf8')).data, schema), [], f);

  const snap = Object.fromEntries(files.map((f) => [f, readFileSync(join(lr, f), 'utf8')]));
  const second = files.map((f) => fixRecordFrontmatter(dir, f, NOW));
  const changed = files.filter((f) => readFileSync(join(lr, f), 'utf8') !== snap[f]).length;
  console.log(`--fix second run: ${second.filter(Boolean).length} reported changed, ${changed} file(s) differ`);
  assert.deepEqual(second, [false, false, false, false]);
  assert.equal(changed, 0);
});

test('teachIndex orders same-second attempts by numeric suffix', () => {
  const dir = ws();
  lesson(dir, '0001-x', [item(0, '0001-r')]);
  mkdirSync(join(dir, 'learning-records'), { recursive: true });
  writeFileSync(join(dir, 'learning-records', '0001-r.md'), '---\ntitle: r\ntype: learning-record\ndate: 2026-10-01\nstatus: active\nkind: understanding\n---\n# r\n');
  mkdirSync(join(dir, 'attempts'), { recursive: true });
  const att = '---\ntype: attempt\ndate: 2026-10-26\nlesson: 0001-x\ntotal: 1\nwrong: []\nrecords: []\n---\n';
  for (const id of ['a-20261026-123456-0001-10', 'a-20261026-123456-0001', 'a-20261026-123456-0001-2']) writeFileSync(join(dir, 'attempts', `${id}.md`), att);
  const ix = teachIndex(dir, { now: NOW });
  console.log(`attempt order: ${ix.attempts.map((a) => a.id).join(', ')}`);
  assert.deepEqual(ix.attempts.map((a) => a.id), ['a-20261026-123456-0001', 'a-20261026-123456-0001-2', 'a-20261026-123456-0001-10']);
  assert.equal(ix.records[0].lastAttempt.id, 'a-20261026-123456-0001-10');
});
