// Lesson parser and lint: lessons, reference docs and the workspace store (spec 12 "Lesson lint").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureVault, tmpVault, put } from './helpers.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../bin/lib/schema.mjs';
import { checkCitations } from '../bin/commands/check.mjs';
import {
  lessonClass, parseLesson, lintLesson, lintStore, lintWorkspace, QUIZ_MIN_ITEMS, QUIZ_SPREAD_MAX, MAX_INTRODUCES, readPath, missionFloor, pathFringe, lintPath,
  lintPathTerms, pathCandidates, topicSlug, pathEdges, lessonUses, SHAPES, FIGURE_VIEWBOX_MAX, FIGURE_LABEL_MIN, FIGURE_LABEL_MAX,
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
  assert.equal(MAX_INTRODUCES, 3);
  assert.equal(QUIZ_MIN_ITEMS, 3);
  assert.equal(QUIZ_SPREAD_MAX, 1.6);
  assert.equal(FIGURE_VIEWBOX_MAX, 440);
  assert.equal(FIGURE_LABEL_MIN, 14);
  assert.equal(FIGURE_LABEL_MAX, 40);
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
  assert.deepEqual([...p.blocks.keys()].sort(), ['example', 'fact', 'followup', 'mission', 'model', 'prereq', 'quiz', 'sources', 'step']);
  assert.equal(p.quiz.items.length, 3);
  assert.deepEqual(p.cites, ['2026-01-01-fx-doc', '2026-01-01-fx-snippet', '2026-01-01-fx-experiment']);
  assert.ok(p.links.includes('https://example.org/fx'));
  assert.ok(p.links.includes('../GLOSSARY.md#term'));
  assert.ok(p.links.includes('../reference/good.html'));
});

test('a good lesson lints clean', () => {
  const lessons = ['lessons/0001-good.html', 'lessons/0003-review-good.html', 'reference/good.html',
    'lessons/0004-tool-fxctl.html', 'lessons/0005-diagnose-fx.html', 'lessons/0006-project-fx.html'];
  for (const rel of lessons) {
    const f = lintFile(FIX, rel);
    console.log(`${rel}: ${f.length} finding(s)`);
    assert.deepEqual(f, [], rel);
  }
});

test('a bad lesson reports each expected code exactly once', () => {
  const f = lintFile(FIX, 'lessons/0002-bad.html');
  const expected = [
    'EVIDENCE_PLAN_MISSING', 'LESSON_CITE_UNRESOLVED', 'LESSON_CLAIM_UNCITED',
    'LESSON_LINK_DANGLING', 'LESSON_MODEL_NO_FIGURE', 'LESSON_SHAPE_BLOCK_MISSING', 'LESSON_TERM_NOT_INTRODUCED', 'LESSON_TOOL_NOT_INTRODUCED', 'QUIZ_ANSWER_SPREAD', 'QUIZ_CORRECT_RANGE', 'QUIZ_TOO_FEW', 'QUIZ_WHY_MISSING',
  ];
  for (const x of f) console.log(`${x.code}  ${x.file}: ${x.message}`);
  assert.deepEqual(codes(f), expected);
  const by = Object.fromEntries(f.map((x) => [x.code, x]));
  assert.equal(by.LESSON_SHAPE_BLOCK_MISSING.message, 'missing block: step');
  assert.match(by.LESSON_CITE_UNRESOLVED.message, /2026-01-01-nope/);
  assert.match(by.LESSON_LINK_DANGLING.message, /0009-missing\.html/);
  assert.equal(by.LESSON_TOOL_NOT_INTRODUCED.message, 'example runs fxctl, which is neither in MISSION.md "Known tools" nor taught by this or an earlier lesson (data-teaches)');
  assert.match(by.LESSON_TERM_NOT_INTRODUCED.message, /"sextuple"/);
  assert.match(by.LESSON_MODEL_NO_FIGURE.message, /<figure>/);
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
  assert.deepEqual(codes(variant('no fixed sentence', (h) => h.replace('You can ask follow-up questions in the terminal.', 'Ask me anything.'))), ['LESSON_FOLLOWUP_MISSING']);
  const noFollowup = variant('no followup block', (h) => h.replace(/<section data-block="followup" aria-label="follow up">[\s\S]*?<\/section>/, ''));
  assert.deepEqual(codes(noFollowup), ['LESSON_SHAPE_BLOCK_MISSING']);
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

// Spec 22 D1-D2: one fixture lesson per shape (0001-good is concept by default); each code on an edited copy.
test('lesson shapes: SHAPES table, shape codes, complete, predict and the Elements part', () => {
  assert.deepEqual(SHAPES, {
    concept: ['model', 'fact', 'quiz', 'connect'], tool: ['model', 'example', 'complete', 'step'],
    diagnose: ['predict', 'model', 'fact', 'quiz'], project: ['step'],
  });
  const dir = copyFixture();
  const run = (rel, edit) => {
    const path = join(dir, rel);
    const before = readFileSync(path, 'utf8');
    writeFileSync(path, edit(before));
    const f = lintFile(dir, rel).map((x) => `${x.code} ${x.message}`).sort();
    writeFileSync(path, before);
    console.log(`${rel}: ${f.join(' | ') || 'clean'}`);
    return f;
  };
  const tool = 'lessons/0004-tool-fxctl.html';
  const diag = 'lessons/0005-diagnose-fx.html';
  const proj = 'lessons/0006-project-fx.html';
  assert.deepEqual(run('lessons/0001-good.html', (h) => h.replace('<body ', '<body data-shape="lab" ')), [
    'LESSON_PLAN_NO_ELEMENTS evidence/0001/PLAN.md has no Elements part',
    'LESSON_SHAPE_UNKNOWN data-shape lab is not one of concept, tool, diagnose, project',
  ]);
  // A declared concept lesson needs connect; the old list's example and step become optional.
  assert.deepEqual(run('lessons/0001-good.html', (h) => h.replace('<body ', '<body data-shape="concept" ')), [
    'LESSON_PLAN_NO_ELEMENTS evidence/0001/PLAN.md has no Elements part',
    'LESSON_SHAPE_BLOCK_MISSING missing block: connect (shape concept)',
  ]);
  // Dropping or adding data-teaches also breaks the PATH.md line (and the tool rule), so only the shape finding is compared.
  const shapeOnly = (f) => f.filter((x) => x.startsWith('LESSON_SHAPE_'));
  assert.deepEqual(shapeOnly(run(tool, (h) => h.replace(' data-teaches="fxctl"', ''))), ['LESSON_SHAPE_MISMATCH shape tool needs data-teaches naming the tool it teaches']);
  assert.deepEqual(shapeOnly(run(diag, (h) => h.replace('<body ', '<body data-teaches="fxctl" '))), ['LESSON_SHAPE_MISMATCH shape diagnose carries data-teaches; only a tool lesson does']);
  assert.deepEqual(run(tool, (h) => h.replace(/<section data-block="complete"[\s\S]*?<\/section>/, '')), ['LESSON_SHAPE_BLOCK_MISSING missing block: complete (shape tool)']);
  assert.deepEqual(run(tool, (h) => h.replace('fxctl <mark aria-label="withheld">____</mark> 7', 'fxctl <mark aria-label="withheld">____</mark> 8')),
    ['LESSON_COMPLETE_NOT_WORKED complete command "fxctl ____ 8" with the withheld part filled is no command the example block ran']);
  assert.deepEqual(run(tool, (h) => h.replace('<mark aria-label="withheld">____</mark>', 'run')),
    ['LESSON_COMPLETE_NOT_WORKED complete block has no <pre> command with <mark aria-label="withheld">']);
  assert.deepEqual(run(diag, (h) => h.replace('"correct": 0,\n    "why": ["Seven', '"correct": 0, "why": ["x", "y", "z"] },\n  { "q": "Again?", "options": ["7", "6", "36"], "correct": 0,\n    "why": ["Seven')),
    ['LESSON_PREDICT_INVALID predict block needs one <pre> output and a data-quiz with one item']);
  // The predict item is prose for the term rule; the quiz block, not the predict block, is the lesson's quiz.
  assert.deepEqual(run(diag, (h) => h.replace('Which input was it given?', 'Is 7 a sextuple?')),
    ['LESSON_TERM_NOT_INTRODUCED uses the term "sextuple" before this or an earlier lesson introduces it (data-introduces) and it is not in the Floor\'s known terms']);
  // Spec 22 D3: a later project carries no scaffold, so a project lesson without one is clean.
  assert.deepEqual(run(proj, (h) => h.replace(/<section data-block="scaffold"[\s\S]*?<\/section>/, '')), []);
  const plan = join(dir, 'evidence', '0006', 'PLAN.md');
  writeFileSync(plan, readFileSync(plan, 'utf8').replace(/## Elements[\s\S]*$/, ''));
  assert.deepEqual(codes(lintFile(dir, proj)), ['LESSON_PLAN_NO_ELEMENTS']);
  // A review lesson keeps its list whatever it declares.
  assert.deepEqual(run('lessons/0003-review-good.html', (h) => h.replace('<body ', '<body data-shape="tool" ')), []);
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

test('lintStore reports PARSE, MISSING_REQUIRED, ENUM_KIND, ENUM_STATUS, ENUM_TYPE, DANGLING_REF, SUPERSEDE, STORED_DERIVED, TYPE_FOLDER and the frontmatter warning', () => {
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
    'learning-records/0017-enum-status.md': rec(['status: gone', 'kind: understanding']),
    'learning-records/0018-enum-type.md': ['---', 'title: x', 'type: nope', 'date: 2026-01-01', 'status: active', 'kind: understanding', '---', '# x', ''].join('\n'),
  };
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  const f = lintStore(dir, ctxFor(dir));
  for (const x of f) console.log(`${x.warning ? 'warning ' : ''}${x.code}  ${x.file}: ${x.message}`);
  const byFile = {};
  for (const x of f) (byFile[x.file] ??= []).push(x.code);
  assert.deepEqual(byFile, {
    'learning-records/0002-legacy.md': ['WARN_RECORD_FRONTMATTER_MISSING'],
    'learning-records/0003-legacy-frontmatter.md': ['MISSING_REQUIRED'],
    'learning-records/0010-parse.md': ['PARSE'],
    'learning-records/0011-missing.md': ['MISSING_REQUIRED'],
    'learning-records/0012-enum.md': ['ENUM_KIND'],
    'learning-records/0013-dangling.md': ['DANGLING_REF'],
    'learning-records/0014-supersede.md': ['SUPERSEDE'],
    'learning-records/0015-active-by.md': ['SUPERSEDE'],
    'attempts/a-20260101-120000-0002.md': ['STORED_DERIVED'],
    'attempts/a-20260101-120000-0003.md': ['DANGLING_REF'],
    'learning-records/0016-typed.md': ['TYPE_FOLDER'],
    'learning-records/0017-enum-status.md': ['ENUM_STATUS'],
    // An unknown type is both outside the enum and outside the type-to-folder map.
    'learning-records/0018-enum-type.md': ['ENUM_TYPE', 'TYPE_FOLDER'],
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
  assert.equal(msg('learning-records/0017-enum-status.md'), 'unknown status: gone');
  assert.equal(msg('learning-records/0018-enum-type.md'), 'unknown type: nope');
  assert.equal(f.find((x) => x.code === 'WARN_RECORD_FRONTMATTER_MISSING').warning, true);
  assert.ok(f.filter((x) => x.code !== 'WARN_RECORD_FRONTMATTER_MISSING').every((x) => x.warning === false));
});

test('lintWorkspace walks lessons, reference, records and attempts', () => {
  const f = lintWorkspace(FIX, ctxFor(FIX));
  const rows = f.map((x) => `${x.file} ${x.code}`);
  for (const r of rows) console.log(r);
  assert.deepEqual(rows, [
    'learning-records/0002-legacy.md WARN_RECORD_FRONTMATTER_MISSING',
    'learning-records/0003-legacy-frontmatter.md MISSING_REQUIRED',
    'lessons/0002-bad.html EVIDENCE_PLAN_MISSING',
    'lessons/0002-bad.html LESSON_CITE_UNRESOLVED',
    'lessons/0002-bad.html LESSON_CLAIM_UNCITED',
    'lessons/0002-bad.html LESSON_LINK_DANGLING',
    'lessons/0002-bad.html LESSON_MODEL_NO_FIGURE',
    'lessons/0002-bad.html LESSON_SHAPE_BLOCK_MISSING',
    'lessons/0002-bad.html LESSON_TERM_NOT_INTRODUCED',
    'lessons/0002-bad.html LESSON_TOOL_NOT_INTRODUCED',
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
    'learning-records/0003-legacy-frontmatter.md MISSING_REQUIRED',
    'reference/good.html LESSON_SHAPE_BLOCK_MISSING',
  ]);
});

function att2() {
  return ['---', 'type: attempt', 'date: 2026-01-01', 'lesson: 0001-good', 'total: 3', 'wrong: []', '---', ''].join('\n');
}

test('missionFloor reads the two Floor term lists and readPath parses every field', () => {
  const floor = missionFloor(FIX);
  assert.deepEqual([...floor.knownTerms], ['function']);
  assert.deepEqual([...floor.newTerms], ['fx', 'sextuple']);
  const path = readPath(FIX);
  assert.equal(path.length, 9);
  assert.deepEqual(path[0], { n: 1, title: 'What fx returns', terms: ['fx'], tool: null, after: ['floor'], lesson: '0001-good' });
  assert.deepEqual(path[3], { n: 4, title: 'The sextuple, named', terms: ['sextuple'], tool: null, after: ['1'], lesson: null });
  assert.equal(readPath(join(tmpdir(), 'nowhere-' + Date.now())), null);
});

test('term rule: a tracked term is allowed by the Floor or by data-introduces on this or an earlier lesson; the model block needs a figure and a doc citation; PATH mismatch is reported', () => {
  const dir = copyFixture();
  const good = readFileSync(join(dir, 'lessons', '0001-good.html'), 'utf8');
  // 0002-bad uses "sextuple" (New to me, introduced nowhere): finding. Line 4 of PATH introduces it later, which does not help a lower-numbered lesson.
  assert.ok(codes(lintFile(dir, 'lessons/0002-bad.html')).includes('LESSON_TERM_NOT_INTRODUCED'));
  // A lesson 0004 that introduces sextuple with a dfn and a figure, built against PATH line 4: clean.
  const four = good.replace('data-lesson="0001-good" data-introduces="fx"', 'data-lesson="0004-sextuple" data-introduces="sextuple"')
    .replace('<dfn>fx</dfn> is the fixture function', 'fx is the fixture function, and a <dfn>sextuple</dfn> is six times a number');
  writeFileSync(join(dir, 'lessons', '0004-sextuple.html'), four);
  writeFileSync(join(dir, 'PATH.md'), readFileSync(join(dir, 'PATH.md'), 'utf8').replace('terms: sextuple | after: 1', 'terms: sextuple | after: 1 | lesson: 0004-sextuple'));
  let f = lintFile(dir, 'lessons/0004-sextuple.html');
  assert.deepEqual(codes(f).filter((c) => !c.startsWith('WARN_')), []);
  // Declaring a term without a dfn, and more than three terms, are findings; a PATH line that disagrees is a finding.
  writeFileSync(join(dir, 'lessons', '0004-sextuple.html'), four.replace('data-introduces="sextuple"', 'data-introduces="sextuple,a,b,c"'));
  f = lintFile(dir, 'lessons/0004-sextuple.html');
  assert.ok(codes(f).includes('LESSON_INTRODUCES_TOO_MANY'));
  assert.ok(codes(f).includes('LESSON_DFN_MISSING'));
  assert.ok(codes(f).includes('LESSON_PATH_MISMATCH'));
  // A model block that cites only an experiment warns; one with no figure and no data-no-figure fails.
  writeFileSync(join(dir, 'lessons', '0004-sextuple.html'), four.replace('<a data-cite="2026-01-01-fx-doc">[1]</a></p>\n</section>\n\n<section data-block="fact"', '<a data-cite="2026-01-01-fx-experiment">[3]</a></p>\n</section>\n\n<section data-block="fact"').replace(/<figure>[\s\S]*?<\/figure>/, ''));
  f = lintFile(dir, 'lessons/0004-sextuple.html');
  assert.ok(codes(f).includes('LESSON_MODEL_NO_FIGURE'));
  assert.ok(codes(f).includes('WARN_MODEL_LAB_ONLY'));
  // A workspace with lessons and no PATH.md warns once.
  rmSync(join(dir, 'PATH.md'));
  assert.ok(lintWorkspace(dir, ctxFor(dir)).some((x) => x.code === 'WARN_PATH_MISSING' && x.file === 'PATH.md'));
});

test('figure warnings: each fires on its own svg, once per figure, and not on the good lesson', () => {
  const dir = copyFixture();
  const good = readFileSync(join(dir, 'lessons', '0001-good.html'), 'utf8');
  const svg = /<svg[\s\S]*?<\/svg>/;
  const cases = {
    WARN_FIGURE_FIXED_SIZE: (h) => h.replace('<svg viewBox="0 0 200 60"', '<svg viewBox="0 0 200 60" width="200"'),
    WARN_FIGURE_VIEWBOX_WIDE: (h) => h.replace('viewBox="0 0 200 60"', 'viewBox="0 0 441 60"'),
    WARN_FIGURE_LABEL_SMALL: (h) => h.replace('font-size="14">fx<', 'font-size="13">fx<'),
    WARN_FIGURE_LABEL_LONG: (h) => h.replace('>6n</text>', '>6n<tspan>, which is the input value scaled by a factor of six</tspan></text>'),
    WARN_FIGURE_COLOR: (h) => h.replace('fill="none" stroke="currentColor"', 'fill="none" stroke="#c00"'),
    WARN_FIGURE_NO_ALT: (h) => h.replace(' role="img"', ''),
  };
  for (const [code, edit] of Object.entries(cases)) {
    writeFileSync(join(dir, 'lessons', '0001-good.html'), edit(good));
    const f = lintFile(dir, 'lessons/0001-good.html');
    for (const x of f) console.log(`${x.code}  ${x.message}`);
    assert.deepEqual(codes(f), [code], code);
    assert.ok(f[0].warning && f[0].message.startsWith('figure 1: '), code);
  }
  // Labels resolve their size through an ancestor's font-size; no font-size anywhere is unknown and warns.
  const grouped = good.replace(svg, (m) => m.replace(/ font-size="14"/g, '').replace('<rect', '<g font-size="16"><rect').replace('</svg>', '</g></svg>'));
  writeFileSync(join(dir, 'lessons', '0001-good.html'), grouped);
  assert.deepEqual(lintFile(dir, 'lessons/0001-good.html'), []);
  writeFileSync(join(dir, 'lessons', '0001-good.html'), good.replace(/ font-size="14"/g, ''));
  assert.match(lintFile(dir, 'lessons/0001-good.html')[0].message, /3 label\(s\) under 14 units or of unknown size \(unknown\)/);
  // var(--muted) is allowed; a second figure is numbered on its own.
  writeFileSync(join(dir, 'lessons', '0001-good.html'), good.replace('stroke="currentColor"/>', 'stroke="var(--muted)"/>').replace(/<figure>[\s\S]*?<\/figure>/, (m) => m + m.replace(' role="img"', '')));
  assert.deepEqual(lintFile(dir, 'lessons/0001-good.html').map((x) => x.message), ['figure 2: <svg> needs role="img" and an aria-label']);
});

test('LESSON_CITE_NUMBER: an authored [n] must be the id\'s position in the sources list', () => {
  const dir = copyFixture();
  const good = readFileSync(join(dir, 'lessons', '0001-good.html'), 'utf8');
  writeFileSync(join(dir, 'lessons', '0001-good.html'), good.replace('<a data-cite="2026-01-01-fx-doc">[1]</a>', '<a data-cite="2026-01-01-fx-doc">[2]</a>')
    .replace('Called with 7, fx returns 42. <a data-cite="2026-01-01-fx-experiment">[3]</a>', 'Called with 7, fx returns 42. <a data-cite="2026-01-01-fx-gone">[4]</a>'));
  const f = lintFile(dir, 'lessons/0001-good.html');
  assert.deepEqual(f.map((x) => `${x.code} ${x.message}`), [
    'LESSON_CITE_NUMBER data-cite 2026-01-01-fx-doc is numbered [2] but is source 1 in the sources list',
    'LESSON_CITE_NUMBER data-cite 2026-01-01-fx-gone is numbered [4] but is not in the sources list',
  ]);
  assert.ok(f.every((x) => x.warning === false));
});

test('a parked lesson still resolves the lesson field of records and attempts', () => {
  const dir = copyFixture();
  renameSync(join(dir, 'lessons', '0001-good.html'), join(dir, 'lessons', '0001-gone.html'));
  assert.ok(codes(lintStore(dir, ctxFor(dir))).includes('DANGLING_REF'), 'a missing lesson dangles');
  mkdirSync(join(dir, 'parked'), { recursive: true });
  renameSync(join(dir, 'lessons', '0001-gone.html'), join(dir, 'parked', '0001-good.html'));
  assert.ok(!codes(lintStore(dir, ctxFor(dir))).includes('DANGLING_REF'), 'a parked lesson resolves');
});

// Spec 17 D1 and D2, over inline paths; the probe workspaces of 2026-11-01-probe-teach-next-teach-lint-at.
test('pathFringe offers every ready line and the built non-review lines nothing depends on; lintPath names forward, missing, own and cyclic after:', () => {
  const L = (n, after, lesson = null) => ({ n, title: `L${n}`, terms: [], tool: null, after, lesson });
  const ns = (ls) => ls.map((l) => l.n);
  // The probe's branching path: 2 and 3 are ready, 4 waits; 1 is the inner fringe.
  const a = [L(1, ['floor'], '0001-good'), L(2, ['1']), L(3, ['1']), L(4, ['2', '3'])];
  assert.deepEqual(ns(pathFringe(a).fringe), [2, 3]);
  assert.deepEqual(ns(pathFringe(a).inner), [1]);
  assert.deepEqual(lintPath(a), []);
  // The fixture path as extended: the review on 3 is not an item, so 2 is inner; the Project: line 9 on 7 and 8
  // counts as a review (spec 22 D3), so 7 and 8 stay inner and 9 is not; 4 and 5 are ready, 6 waits.
  const fx = readPath(FIX);
  assert.deepEqual(ns(pathFringe(fx).fringe), [4, 5]);
  assert.deepEqual(ns(pathFringe(fx).inner), [8, 7, 2]);
  assert.deepEqual(lintPath(fx), []);
  // PATH_PROJECT_AFTER: a Project: line whose after: names fewer than two lines (floor is not a line).
  assert.deepEqual(lintPath([L(1, ['floor']), { ...L(2, ['1', 'floor']), title: 'Project: one' }, { ...L(3, ['1', '2']), title: 'project: two' }])
    .map((f) => `${f.code} ${f.message}`), ['PATH_PROJECT_AFTER line 2 is a Project: line whose after: names 1 line(s); a project integrates at least two']);
  // No after: is ready; a value naming no line never is; a parked line is taken; all taken gives an empty fringe; most recent inner first.
  assert.deepEqual(ns(pathFringe([L(1, []), L(2, ['9'])]).fringe), [1]);
  assert.deepEqual(ns(pathFringe([L(1, ['floor'], '0001-a'), L(2, ['1'], '0002-b, parked'), L(3, ['2'])]).fringe), [3]);
  const done = pathFringe([L(1, ['floor'], '0001-a'), L(2, ['floor'], '0002-b'), L(3, ['floor'], '0003-c')]);
  assert.deepEqual(done.fringe, []);
  assert.deepEqual(ns(done.inner), [3, 2, 1]);
  // The probe's workspace B.
  const b = [L(1, ['floor'], '0001-good'), L(2, ['3']), L(3, ['2']), L(4, ['9']), L(5, ['5'])];
  assert.deepEqual(ns(pathFringe(b).fringe), []);
  assert.deepEqual(lintPath(b).map((f) => `${f.code} ${f.message}`).sort(), [
    'PATH_AFTER_CYCLE lines 2 -> 3 -> 2 form an after: cycle',
    'PATH_AFTER_CYCLE lines 5 -> 5 form an after: cycle',
    'PATH_AFTER_FORWARD line 2 after: 3 names a later line',
    'PATH_AFTER_FORWARD line 4 after: 9 names no line',
    'PATH_AFTER_FORWARD line 5 after: 5 names itself',
  ]);
  assert.ok(lintPath(b).every((f) => f.file === 'PATH.md' && f.warning === false));
  // Through lintWorkspace, with file PATH.md.
  const dir = copyFixture();
  writeFileSync(join(dir, 'PATH.md'), readFileSync(join(dir, 'PATH.md'), 'utf8').replace('terms: sextuple | after: 1', 'terms: sextuple | after: 6'));
  assert.ok(lintWorkspace(dir, ctxFor(dir)).some((f) => f.code === 'PATH_AFTER_FORWARD' && f.file === 'PATH.md' && f.message === 'line 4 after: 6 names a later line'));
});

// Spec 20 D2-D3: candidates from the vault's own filters and traversal, grouped by the line they would follow.
test('pathCandidates pools by topic and term slugs, groups by the strongest --text match, lists uncovered terms and linked notes', () => {
  const L = (n, title, extra = {}) => ({ n, title, terms: [], tool: null, after: ['floor'], lesson: null, ...extra });
  const row = (id, type, title, topics, extra = {}) => ({ id, type, title, topics, status: 'active', summary: null, ...extra });
  const lines = [
    L(1, 'Two control planes', { lesson: '0001-a' }),
    L(2, 'The vcluster CLI', { tool: 'vcluster' }),
    L(3, 'Private nodes: real nodes joined', {}),
    L(4, 'Platform', { terms: ['platform agent'] }),
  ];
  const floor = { knownTerms: new Set(['private node', 'standalone']), newTerms: new Set(['platform agent', 'backing store']) };
  const entries = [
    row('2026-01-01-cited', 'source', 'vCluster docs', ['vcluster']),
    row('2026-01-02-cli', 'source', 'vcluster connect reference', ['vcluster'], { summary: 'lists all virtual clusters' }),
    row('2026-01-03-pn', 'source', 'X private-node architecture', ['vcluster']),
    row('2026-01-04-agent', 'source', 'Agent chart', ['vcluster-platform'], { summary: 'the Platform Agent chart' }),
    row('2026-01-05-sa', 'source', 'Standalone guide', ['standalones']),
    row('2026-01-06-old', 'source', 'Old vcluster page', ['vcluster'], { status: 'superseded' }),
    row('2026-01-07-note', 'note', 'A note over the cited doc', ['other']),
    row('2026-01-08-syn', 'synthesis', 'A synthesis over the note', ['other']),
    row('2026-01-09-body', 'source', 'Unrelated title', ['vcluster']),
    row('2026-01-10-far', 'note', 'Three hops away', ['other']),
  ];
  const edges = [
    { from: '2026-01-07-note', rel: 'sources', to: '2026-01-01-cited' },
    { from: '2026-01-08-syn', rel: 'contributing_ids', to: '2026-01-07-note' },
    { from: '2026-01-10-far', rel: 'sources', to: '2026-01-08-syn' },
  ];
  const readBody = (id) => (id === '2026-01-09-body' ? 'The backing store is etcd.' : '');
  const r = pathCandidates({ lines, floor, cites: ['2026-01-01-cited'], manifest: { entries, edges, backlinks: {} }, topics: ['vcluster'], readBody });
  // Pool: the given topic, plus `standalone` through its plural (the slug of a Known term); platform-agent is on no entry, so it does not widen.
  assert.deepEqual(r.poolTopics, [['vcluster', 4], ['standalones', 1]]);
  assert.equal(r.pool, 5);
  assert.deepEqual(r.cited, ['2026-01-01-cited']);
  const group = (n) => r.groups.find((g) => g.line.n === n)?.candidates.map((c) => c.id) ?? [];
  // The CLI reference matches line 2 through its tool and nothing stronger; "private node" meets "private-node" in a title via the slug query.
  assert.deepEqual(group(2), ['2026-01-02-cli', '2026-01-09-body']);
  assert.deepEqual(group(3), ['2026-01-03-pn']);
  const pn = r.groups.find((g) => g.line.n === 3).candidates[0];
  assert.deepEqual(pn.reasons, ['uncited']);
  assert.deepEqual(pn.queries, ['search --topic vcluster', 'search --topic vcluster --text "private-node"']);
  // A body-only hit is evidence, not grouping: the unrelated title lands on line 2 through `vcluster` in its title, not on line 4 through "backing store".
  assert.ok(r.groups.find((g) => g.line.n === 2).candidates.find((c) => c.id === '2026-01-09-body').queries.includes('search --topic vcluster --text "vcluster"'));
  // The linked note and synthesis (distance 1 and 2 from the cited id) are candidates outside the pool; the third hop is not; the cited entry and the superseded one never are.
  const ids = [...r.groups.flatMap((g) => g.candidates), ...r.noLine].map((c) => c.id);
  assert.ok(ids.includes('2026-01-07-note') && ids.includes('2026-01-08-syn'));
  assert.ok(!ids.includes('2026-01-10-far') && !ids.includes('2026-01-01-cited') && !ids.includes('2026-01-06-old'));
  const syn = r.noLine.find((c) => c.id === '2026-01-08-syn');
  assert.deepEqual(syn.reasons, ['linked']);
  assert.deepEqual(syn.queries, ['related 2026-01-01-cited --depth 2']);
  // The Standalone guide is in the pool through the plural topic and matches no line.
  assert.ok(r.noLine.some((c) => c.id === '2026-01-05-sa' && c.queries.includes('search --topic standalones')));
  // Uncovered mission terms: "standalone" (Known, no line names it, one hit) and "backing store" (New to me, body-only hit). "platform agent" and "private node" are covered.
  assert.deepEqual(r.uncovered.map((u) => [u.term, u.hits.map((h) => h.id)]), [['standalone', ['2026-01-05-sa']], ['backing store', ['2026-01-09-body']]]);
  assert.deepEqual(r.uncovered[1].hits[0].queries, ['search --topic vcluster --body "backing store"']);
  // A Known term with no entry is not printed; a New to me term with none is, with no hits.
  const f2 = { knownTerms: new Set(['nowhere']), newTerms: new Set(['also nowhere']) };
  assert.deepEqual(pathCandidates({ lines, floor: f2, cites: [], manifest: { entries, edges, backlinks: {} }, topics: ['vcluster'] }).uncovered, [{ term: 'also nowhere', hits: [] }]);
  // Empty everything.
  const none = pathCandidates({ lines: [], floor: { knownTerms: null, newTerms: null }, cites: [], manifest: { entries: [], edges: [], backlinks: {} }, topics: ['x'] });
  assert.deepEqual(none, { poolTopics: [['x', 0]], pool: 0, cited: [], groups: [], noLine: [], uncovered: [] });
  assert.equal(topicSlug(' vCluster Platform! '), 'vcluster-platform');
});

test('lintPathTerms warns for a New to me term on no line and is quiet on the fixture (spec 20 D5)', () => {
  assert.deepEqual(lintPathTerms(readPath(FIX), missionFloor(FIX).newTerms), []);
  const f = lintPathTerms(readPath(FIX), new Set(['fx', 'octuple']));
  assert.deepEqual(f.map((x) => [x.code, x.file, x.warning]), [['WARN_PATH_TERM_UNPLANNED', 'PATH.md', true]]);
  assert.match(f[0].message, /^New to me term "octuple" is on no line's terms:/);
  const dir = copyFixture();
  writeFileSync(join(dir, 'MISSION.md'), readFileSync(join(dir, 'MISSION.md'), 'utf8').replace('- sextuple\n', '- sextuple\n- octuple\n'));
  assert.ok(lintWorkspace(dir, ctxFor(dir)).some((x) => x.code === 'WARN_PATH_TERM_UNPLANNED' && x.file === 'PATH.md'));
});

test('pathEdges proposes after: for a term, tool or title use across a missing edge; lessonUses reads the prose as the term rule does (spec 19)', () => {
  const L = (n, after, lesson = null, extra = {}) => ({ n, title: `L${n}`, terms: [], tool: null, after, lesson, ...extra });
  const lines = [L(1, ['floor'], '0001-a', { terms: ['fx'] }), L(2, ['1'], '0002-b', { tool: 'kind' }), L(3, ['2'], '0003-c'), L(4, ['floor'], '0004-d'), L(5, ['floor'], null, { terms: ['six'] }), L(6, ['floor'], null, { title: 'The six and the fx' })];
  const run = (uses) => pathEdges({ lines, uses: new Map(Object.entries(uses).map(([k, v]) => [Number(k), v])) }).map((g) => [g.line.n, g.proposals.map((p) => [p.after, p.term, p.via, p.by.n])]);
  // A built line using a term an earlier unreached line introduces; one reached through a chain gives none.
  assert.deepEqual(run({ 4: [{ term: 'fx', via: 'uses' }], 3: [{ term: 'fx', via: 'uses' }] }), [[4, [[1, 'fx', 'uses', 1]]]]);
  // A tool run against the line whose tool: matches; an unbuilt title naming an introducer; sorted by after then term.
  assert.deepEqual(run({ 4: [{ term: 'kind', via: 'runs' }, { term: 'fx', via: 'uses' }], 6: [{ term: 'six', via: 'names' }, { term: 'fx', via: 'names' }] }),
    [[4, [[1, 'fx', 'uses', 1], [2, 'kind', 'runs', 2]]], [6, [[1, 'fx', 'names', 1], [5, 'six', 'names', 5]]]]);
  // A tool both named in the prose and run in the commands is one proposal, the first way it was used.
  assert.deepEqual(run({ 4: [{ term: 'kind', via: 'uses' }, { term: 'kind', via: 'runs' }] }), [[4, [[2, 'kind', 'uses', 2]]]]);
  // The line's own term, an introducer on a later line, a term no line introduces: nothing.
  assert.deepEqual(run({ 1: [{ term: 'fx', via: 'uses' }], 4: [{ term: 'six', via: 'uses' }, { term: 'nope', via: 'uses' }] }), []);
  // Spec 22 D3: a Project: line gets no proposals, whatever it uses.
  const proj = lines.map((l) => (l.n === 4 ? { ...l, title: 'Project: the fx kind' } : l));
  assert.deepEqual(pathEdges({ lines: proj, uses: new Map([[4, [{ term: 'fx', via: 'uses' }]]]) }), []);
  // A floor or unknown after: value contributes nothing to reach; a term on two lines takes the lower as its
  // introducer, so line 2's own use of fx proposes line 1 and line 3, which reaches only line 2, proposes line 1 too.
  const dup = [L(1, ['floor'], '0001-a', { terms: ['fx'] }), L(2, ['9'], '0002-b', { terms: ['fx'] }), L(3, ['2'], '0003-c')];
  assert.deepEqual(pathEdges({ lines: dup, uses: new Map([[3, [{ term: 'fx', via: 'uses' }]], [2, [{ term: 'fx', via: 'uses' }]]]) }).map((g) => [g.line.n, g.proposals.map((p) => p.after)]), [[2, [1]], [3, [1]]]);
  const good = readFileSync(join(FIX, 'lessons', '0001-good.html'), 'utf8');
  assert.deepEqual(lessonUses(good, ['fx', 'sextuple', 'fx']), ['fx']);
});
