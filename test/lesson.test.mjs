// Lesson parser and lint: lessons, reference docs and the workspace store (spec 12 "Lesson lint").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureVault, tmpVault, put } from './helpers.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../bin/lib/schema.mjs';
import { checkCitations } from '../bin/commands/check.mjs';
import {
  lessonClass, parseLesson, lintLesson, lintStore, lintWorkspace, FACT_WORDS, QUIZ_MIN_ITEMS, QUIZ_SPREAD_MAX,
} from '../bin/lib/lesson.mjs';

const FIX = join(process.cwd(), 'test', 'fixtures', 'teach');
const NOW = '2026-10-26';
const schema = loadSchema(process.cwd());
const teachSchema = loadTeachSchema(process.cwd());
const VAULT = fixtureVault();
const entries = buildManifest(VAULT).entries;
const ctxFor = (workspaceDir, extra = {}) => ({ workspaceDir, vaultPath: VAULT, entries, schema, teachSchema, now: NOW, ...extra });
const copyFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-lesson-'));
  cpSync(FIX, dir, { recursive: true });
  return dir;
};
const codes = (findings) => findings.map((f) => f.code).sort();
const lintFile = (dir, rel, ctx = ctxFor(dir)) => lintLesson(join(dir, rel), ctx);

test('constants match the spec', () => {
  assert.equal(FACT_WORDS, 300);
  assert.equal(QUIZ_MIN_ITEMS, 3);
  assert.equal(QUIZ_SPREAD_MAX, 1.6);
});

test('lessonClass by file name', () => {
  assert.equal(lessonClass('/w/lessons/0001-good.html'), 'lesson');
  assert.equal(lessonClass('/w/lessons/0003-review-good.html'), 'review');
  assert.equal(lessonClass('/w/reference/good.html'), 'reference');
  assert.equal(lessonClass('/w/lessons/notes.html'), null);
  assert.equal(lessonClass('/w/lessons/0001-Good.html'), null);
  assert.equal(lessonClass('/w/lessons/0001-good.md'), null);
  assert.equal(lessonClass('/w/other/0001-good.html'), null);
  assert.equal(lessonClass('/w/reference/good.md'), null);
});

test('parseLesson finds blocks, quiz, cites and links', () => {
  const p = parseLesson(readFileSync(join(FIX, 'lessons', '0001-good.html'), 'utf8'));
  assert.deepEqual([...p.blocks.keys()].sort(), ['example', 'fact', 'followup', 'mission', 'prereq', 'quiz', 'sources', 'step']);
  assert.equal(p.quiz.items.length, 3);
  assert.deepEqual(p.cites, ['2026-01-01-fx-snippet', '2026-01-01-fx-experiment', '2026-01-01-fx-doc']);
  assert.ok(p.links.includes('https://example.org/fx'));
  assert.ok(p.links.includes('../GLOSSARY.md#term'));
  assert.ok(p.links.includes('../reference/good.html'));
});

test('a good lesson lints clean', () => {
  const lessons = ['lessons/0001-good.html', 'lessons/0003-review-good.html', 'reference/good.html'];
  for (const rel of lessons) {
    const f = lintFile(FIX, rel);
    console.log(`${rel}: ${f.length} finding(s)`);
    assert.deepEqual(f, [], rel);
  }
});

test('a bad lesson reports each expected code exactly once', () => {
  const f = lintFile(FIX, 'lessons/0002-bad.html');
  const expected = [
    'EVIDENCE_PLAN_MISSING', 'LESSON_BLOCK_MISSING', 'LESSON_CITE_UNRESOLVED', 'LESSON_CLAIM_UNCITED',
    'LESSON_LINK_DANGLING', 'QUIZ_ANSWER_SPREAD', 'QUIZ_CORRECT_RANGE', 'QUIZ_TOO_FEW', 'QUIZ_WHY_MISSING',
  ];
  for (const x of f) console.log(`${x.code}  ${x.file}: ${x.message}`);
  assert.deepEqual(codes(f), expected);
  const by = Object.fromEntries(f.map((x) => [x.code, x]));
  assert.equal(by.LESSON_BLOCK_MISSING.message, 'missing block: step');
  assert.match(by.LESSON_CITE_UNRESOLVED.message, /2026-01-01-nope/);
  assert.match(by.LESSON_LINK_DANGLING.message, /0009-missing\.html/);
  assert.match(by.QUIZ_CORRECT_RANGE.message, /item 0/);
  assert.match(by.QUIZ_ANSWER_SPREAD.message, /item 1/);
  assert.match(by.QUIZ_WHY_MISSING.message, /item 1/);
  assert.ok(f.every((x) => x.file === 'lessons/0002-bad.html' && x.warning === false));
});

test('lesson-specific codes fire on their own fixture and not on the good lesson', () => {
  const dir = copyFixture();
  const good = readFileSync(join(dir, 'lessons', '0001-good.html'), 'utf8');
  const variant = (name, edit) => {
    writeFileSync(join(dir, 'lessons', `0001-good.html`), edit(good));
    const f = lintFile(dir, 'lessons/0001-good.html');
    console.log(`${name}: ${codes(f).join(', ') || 'clean'}`);
    return f;
  };
  // Positive control: the unedited copy is clean.
  assert.deepEqual(variant('unchanged', (h) => h), []);
  const long = Array(FACT_WORDS).fill('word').join(' ');
  assert.deepEqual(codes(variant('long fact', (h) => h.replace('Called with 7, fx returns 42.', `Called with 7, fx returns 42. ${long}`))), ['LESSON_FACT_TOO_LONG']);
  assert.deepEqual(codes(variant('no fixed sentence', (h) => h.replace('You can ask follow-up questions in the terminal.', 'Ask me anything.'))), ['LESSON_FOLLOWUP_MISSING']);
  const noFollowup = variant('no followup block', (h) => h.replace(/<section data-block="followup">[\s\S]*?<\/section>/, ''));
  assert.deepEqual(codes(noFollowup), ['LESSON_BLOCK_MISSING']);
  assert.equal(noFollowup[0].message, 'missing block: followup');
  assert.deepEqual(codes(variant('two options', (h) => h.replace('["42", "13", "49"]', '["42", "13"]').replace(', "That squares seven."]', ']'))), ['QUIZ_OPTION_COUNT']);
  assert.deepEqual(codes(variant('bad glossary anchor', (h) => h.replace('GLOSSARY.md#term', 'GLOSSARY.md#nope'))), ['LESSON_LINK_DANGLING']);
  assert.deepEqual(codes(variant('dangling reference', (h) => h.replace('../reference/good.html', '../reference/gone.html#x'))), ['LESSON_LINK_DANGLING']);
  // Hrefs outside lessons/, reference/ and GLOSSARY.md are not checked.
  assert.deepEqual(variant('external hrefs', (h) => h.replace('</body>', '<a href="https://example.org/x">x</a><a href="#top">t</a><a href="mailto:a@b">m</a><a href="../assets/none.css">c</a></body>')), []);
  // A reference note block without data-cite.
  const ref = readFileSync(join(dir, 'reference', 'good.html'), 'utf8');
  writeFileSync(join(dir, 'reference', 'good.html'), ref.replace(' data-cite="2026-01-01-old"', ''));
  const rf = lintFile(dir, 'reference/good.html');
  console.log(`reference without data-cite: ${codes(rf).join(', ')}`);
  assert.deepEqual(codes(rf), ['LESSON_CLAIM_UNCITED']);
  assert.equal(rf[0].message, 'note block has no data-cite');
});

test('malformed quiz JSON is QUIZ_JSON_INVALID, not a throw', () => {
  const dir = copyFixture();
  const path = join(dir, 'lessons', '0001-good.html');
  const good = readFileSync(path, 'utf8');
  const shapes = {
    truncated: (h) => h.replace('{ "items": [', '{ "items": [ {'),
    'no items': (h) => h.replace('{ "items": [', '{ "things": ['),
    'item without options': (h) => h.replace('"options": ["42", "13", "49"]', '"choices": ["42", "13", "49"]'),
    'no script': (h) => h.replace(/<script type="application\/json" data-quiz>[\s\S]*?<\/script>/, ''),
  };
  for (const [name, edit] of Object.entries(shapes)) {
    writeFileSync(path, edit(good));
    const f = lintFile(dir, 'lessons/0001-good.html');
    const quiz = f.filter((x) => x.code.startsWith('QUIZ_'));
    console.log(`${name}: ${quiz.length} quiz finding(s): ${codes(quiz).join(', ')}`);
    assert.deepEqual(codes(quiz), ['QUIZ_JSON_INVALID'], name);
    assert.deepEqual(codes(f), ['QUIZ_JSON_INVALID'], name);
  }
  const p = parseLesson('<section data-block="quiz"><script type="application/json" data-quiz>{</script></section>');
  assert.ok(p.quiz.error);
});

test('a stale or superseded cited id still resolves', () => {
  // Stale: the reference doc cites 2026-01-01-old, which checkCitations reports stale.
  const [row] = checkCitations([{ type: 'id', value: '2026-01-01-old' }], entries, schema, NOW);
  console.log(`2026-01-01-old status: ${row.status}`);
  assert.equal(row.status, 'stale');
  assert.deepEqual(lintFile(FIX, 'reference/good.html'), []);

  // Superseded: a second vault where the cited note is superseded.
  const v = tmpVault('rv-lesson-sup-');
  const note = { sources: [], confidence: 'medium' };
  put(v, 'note', '2026-01-02-new', note);
  put(v, 'note', '2026-01-01-sup', { ...note, status: 'superseded', superseded_by: '2026-01-02-new' });
  const ents = buildManifest(v).entries;
  assert.equal(ents.find((e) => e.id === '2026-01-01-sup').status, 'superseded');
  const dir = copyFixture();
  const ref = join(dir, 'reference', 'good.html');
  writeFileSync(ref, readFileSync(ref, 'utf8').replaceAll('2026-01-01-old', '2026-01-01-sup'));
  const ctx = ctxFor(dir, { vaultPath: v, entries: ents });
  const f = lintFile(dir, 'reference/good.html', ctx);
  console.log(`superseded cite: ${f.length} finding(s)`);
  assert.deepEqual(f, []);
  // Negative control: an id absent from that vault is unresolved.
  writeFileSync(ref, readFileSync(ref, 'utf8').replaceAll('2026-01-01-sup', '2026-01-01-gone'));
  assert.deepEqual(codes(lintFile(dir, 'reference/good.html', ctx)), ['LESSON_CITE_UNRESOLVED']);
});

test('a review lesson needs its four blocks; an unknown record is QUIZ_RECORD_UNRESOLVED', () => {
  const dir = copyFixture();
  const path = join(dir, 'lessons', '0003-review-good.html');
  const good = readFileSync(path, 'utf8');
  const run = (h) => { writeFileSync(path, h); return lintFile(dir, 'lessons/0003-review-good.html'); };
  // Positive control: clean with no step, fact or example and no evidence folder.
  assert.deepEqual(run(good), []);
  for (const b of ['mission', 'quiz', 'followup', 'sources']) {
    const f = run(good.replace(new RegExp(`<section data-block="${b}">[\\s\\S]*?</section>`), ''));
    console.log(`review without ${b}: ${codes(f).join(', ')}`);
    assert.deepEqual(f.map((x) => x.message), [`missing block: ${b}`]);
  }
  const unknown = run(good.replace('"record": "0001-known" },\n  { "q": "What does fx(4)', '"record": "0099-unknown" },\n  { "q": "What does fx(4)'));
  assert.deepEqual(codes(unknown), ['QUIZ_RECORD_UNRESOLVED']);
  assert.match(unknown[0].message, /item 0/);
  const none = run(good.replace(', "record": "0001-known" },\n  { "q": "What does fx(4)', ' },\n  { "q": "What does fx(4)'));
  assert.deepEqual(none.map((x) => x.message), ['item 0 has no record']);
  assert.deepEqual(codes(run(good.replace('"record": "0001-known" },\n  { "q": "What does fx(4)', '"record": "../x" },\n  { "q": "What does fx(4)'))), ['QUIZ_RECORD_UNRESOLVED']);
});

test('a lesson with no evidence folder gets the advisory WARN_EVIDENCE_FOLDER_MISSING', () => {
  const dir = copyFixture();
  assert.deepEqual(lintFile(dir, 'lessons/0001-good.html'), []);
  rmSync(join(dir, 'evidence', '0001'), { recursive: true });
  const f = lintFile(dir, 'lessons/0001-good.html');
  console.log(`no evidence folder: ${f.map((x) => `${x.code} warning=${x.warning}`).join(', ')}`);
  assert.deepEqual(f.map((x) => [x.code, x.warning]), [['WARN_EVIDENCE_FOLDER_MISSING', true]]);
});

test('lintStore reports PARSE, MISSING_REQUIRED, ENUM, DANGLING_REF, SUPERSEDE, STORED_DERIVED, TYPE_FOLDER and the frontmatter warning', () => {
  const dir = copyFixture();
  const rec = (extra) => ['---', 'title: x', 'type: learning-record', 'date: 2026-01-01', ...extra, '---', '# x', ''].join('\n');
  const att = (extra) => ['---', 'type: attempt', 'date: 2026-01-01', 'lesson: 0001-good', 'total: 3', 'wrong: []', ...extra, '---', ''].join('\n');
  const files = {
    'learning-records/0010-parse.md': '---\ntitle: x\n',
    'learning-records/0011-missing.md': rec(['status: active']),
    'learning-records/0012-enum.md': rec(['status: active', 'kind: guess']),
    'learning-records/0013-dangling.md': rec(['status: active', 'lesson: 0099-nope', 'kind: understanding']),
    'learning-records/0014-supersede.md': rec(['status: superseded', 'kind: understanding']),
    'learning-records/0015-active-by.md': rec(['status: active', 'superseded_by: 0001-known', 'kind: understanding']),
    'attempts/a-20260101-120000-0002.md': att(['records: []', 'score: 3']),
    'attempts/a-20260101-120000-0003.md': att(['records: [0099-nope]']),
    'learning-records/0016-typed.md': att(['records: []']),
  };
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  const f = lintStore(dir, ctxFor(dir));
  for (const x of f) console.log(`${x.warning ? 'warning ' : ''}${x.code}  ${x.file}: ${x.message}`);
  const byFile = {};
  for (const x of f) (byFile[x.file] ??= []).push(x.code);
  assert.deepEqual(byFile, {
    'learning-records/0002-legacy.md': ['WARN_RECORD_FRONTMATTER_MISSING'],
    'learning-records/0010-parse.md': ['PARSE'],
    'learning-records/0011-missing.md': ['MISSING_REQUIRED'],
    'learning-records/0012-enum.md': ['ENUM_KIND'],
    'learning-records/0013-dangling.md': ['DANGLING_REF'],
    'learning-records/0014-supersede.md': ['SUPERSEDE'],
    'learning-records/0015-active-by.md': ['SUPERSEDE'],
    'attempts/a-20260101-120000-0002.md': ['STORED_DERIVED'],
    'attempts/a-20260101-120000-0003.md': ['DANGLING_REF'],
    'learning-records/0016-typed.md': ['TYPE_FOLDER'],
  });
  // The good record and the good attempt fire nothing.
  console.log(`good record/attempt findings: ${f.filter((x) => /0001-known|0001\.md$/.test(x.file)).length}`);
  assert.ok(!byFile['learning-records/0001-known.md'] && !byFile['attempts/a-20260101-120000-0001.md']);
  const msg = (file) => f.find((x) => x.file === file).message;
  assert.equal(msg('learning-records/0011-missing.md'), 'missing required field: kind');
  assert.equal(msg('learning-records/0012-enum.md'), 'unknown kind: guess');
  assert.equal(msg('learning-records/0013-dangling.md'), 'lesson -> missing id 0099-nope');
  assert.equal(msg('attempts/a-20260101-120000-0003.md'), 'records -> missing id 0099-nope');
  assert.equal(msg('attempts/a-20260101-120000-0002.md'), 'stored derived field: score');
  assert.equal(msg('learning-records/0016-typed.md'), 'type attempt in folder learning-records');
  assert.equal(f.find((x) => x.code === 'WARN_RECORD_FRONTMATTER_MISSING').warning, true);
  assert.ok(f.filter((x) => x.code !== 'WARN_RECORD_FRONTMATTER_MISSING').every((x) => x.warning === false));
});

test('lintWorkspace walks lessons, reference, records and attempts', () => {
  const f = lintWorkspace(FIX, ctxFor(FIX));
  const rows = f.map((x) => `${x.file} ${x.code}`);
  for (const r of rows) console.log(r);
  assert.deepEqual(rows, [
    'learning-records/0002-legacy.md WARN_RECORD_FRONTMATTER_MISSING',
    'lessons/0002-bad.html EVIDENCE_PLAN_MISSING',
    'lessons/0002-bad.html LESSON_BLOCK_MISSING',
    'lessons/0002-bad.html LESSON_CITE_UNRESOLVED',
    'lessons/0002-bad.html LESSON_CLAIM_UNCITED',
    'lessons/0002-bad.html LESSON_LINK_DANGLING',
    'lessons/0002-bad.html QUIZ_ANSWER_SPREAD',
    'lessons/0002-bad.html QUIZ_CORRECT_RANGE',
    'lessons/0002-bad.html QUIZ_TOO_FEW',
    'lessons/0002-bad.html QUIZ_WHY_MISSING',
  ]);
  // A reference doc and an attempt break and are picked up by the walk.
  const dir = copyFixture();
  renameSync(join(dir, 'lessons', '0002-bad.html'), join(dir, 'bad.html'));
  writeFileSync(join(dir, 'reference', 'good.html'), readFileSync(join(dir, 'reference', 'good.html'), 'utf8').replace(/<section data-block="sources">[\s\S]*?<\/section>/, ''));
  writeFileSync(join(dir, 'attempts', 'a-20260101-120000-0001.md'), att2());
  const g = lintWorkspace(dir, ctxFor(dir)).map((x) => `${x.file} ${x.code}`);
  console.log(g.join('\n'));
  assert.deepEqual(g, [
    'attempts/a-20260101-120000-0001.md MISSING_REQUIRED',
    'learning-records/0002-legacy.md WARN_RECORD_FRONTMATTER_MISSING',
    'reference/good.html LESSON_BLOCK_MISSING',
  ]);
});

function att2() {
  return ['---', 'type: attempt', 'date: 2026-01-01', 'lesson: 0001-good', 'total: 3', 'wrong: []', '---', ''].join('\n');
}
