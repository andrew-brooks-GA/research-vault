import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LESSON_ID_RE, RECORD_ID_RE, blockSpans, extractCites, imgAttr, lessonItems, parseQuiz, readPath, uniq } from '../bin/lib/lesson-format.mjs';

function pathFixture(t, text) {
  const dir = mkdtempSync(join(tmpdir(), 'rv-lesson-format-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'PATH.md'), text);
  return dir;
}

test('lesson and record id patterns accept and refuse the same ids', () => {
  const cases = [
    ['0001-fx-returns6', true],
    ['fx-returns6', false],
    ['0001-6fx', false],
    ['0001-fx-Returns', false],
    ['0001-Fx-returns', false],
    ['0001-fx.returns', false],
    ['00001-fx', false],
    ['', false],
  ];
  for (const [id, expected] of cases) {
    assert.equal(LESSON_ID_RE.test(id), expected, `lesson id ${JSON.stringify(id)}`);
    assert.equal(RECORD_ID_RE.test(id), expected, `record id ${JSON.stringify(id)}`);
  }
});

test('uniq keeps the first occurrence order', () => {
  assert.deepEqual(uniq(['b', 'a', 'b']), ['b', 'a']);
});

test('blockSpans uses the outer closing tag when the same tag is nested', () => {
  const [block] = blockSpans('<div data-block="fact"><div>inner</div> tail</div>');
  assert.deepEqual({ html: block.html, end: block.end }, { html: '<div>inner</div> tail', end: 44 });
});

test('blockSpans extends an unclosed block to the end of the document', () => {
  const [block] = blockSpans('<div data-block="fact">tail');
  assert.deepEqual({ html: block.html, end: block.end }, { html: 'tail', end: 27 });
});

test('lessonItems ignores a loose quiz when there is a predict block and no quiz block', () => {
  const html = `<script type="application/json" data-quiz>{"items":[{"options":["Loose"]}]}</script>
<section data-block="predict">
  <script type="application/json" data-quiz>{"items":[{"options":["Prediction"]}]}</script>
</section>`;
  assert.deepEqual(lessonItems(html), { items: [{ options: ['Prediction'] }] });
});

test('readPath matches field names case-insensitively and preserves the lesson value as written', (t) => {
  const dir = pathFixture(t, '1. Inspect results | Terms: output | TOOL: fxctl | After: floor | Lesson: 0001-Inspect\n');
  assert.deepEqual(readPath(dir), [
    { n: 1, title: 'Inspect results', terms: ['output'], tool: 'fxctl', after: ['floor'], lesson: '0001-Inspect' },
  ]);
});

test('readPath lowercases each terms value', (t) => {
  const dir = pathFixture(t, '1. Inspect results | terms: Output, EXIT STATUS\n');
  assert.deepEqual(readPath(dir)[0].terms, ['output', 'exit status']);
});

test('readPath lowercases the tool value', (t) => {
  const dir = pathFixture(t, '1. Inspect results | tool: FxCTL\n');
  assert.equal(readPath(dir)[0].tool, 'fxctl');
});

test('readPath lowercases after values', (t) => {
  const dir = pathFixture(t, '1. Inspect results | after: FLOOR\n');
  assert.deepEqual(readPath(dir)[0].after, ['floor']);
});

test('readPath treats CRLF as a line ending, including on an untitled draft line', (t) => {
  const dir = pathFixture(t, '1. Inspect results | terms: output\r\n2. \r\n3. Check status | lesson: 0003-status\r\n');
  assert.deepEqual(readPath(dir), [
    { n: 1, title: 'Inspect results', terms: ['output'], tool: null, after: [], lesson: null },
    { n: 3, title: 'Check status', terms: [], tool: null, after: [], lesson: '0003-status' },
  ]);
});

test('imgAttr matches an uppercase attribute name with a lowercase lookup', () => {
  assert.equal(imgAttr(' SRC="x.png"', 'src'), 'x.png');
});

test('parseQuiz ignores a data-quiz marker in the script body', () => {
  const html = '<script type="application/json">{"items":[],"label":"data-quiz"}</script>';
  assert.deepEqual(parseQuiz(html), { error: 'no quiz data block' });
});

test('parseQuiz includes the JSON parser message for an empty script', () => {
  const html = '<script type="application/json" data-quiz></script>';
  assert.match(parseQuiz(html).error, /^quiz JSON does not parse: ./s);
});

test('extractCites returns attribute values including an empty citation', () => {
  assert.deepEqual(extractCites('<a data-cite="source"></a><a data-cite=\'\'></a>'), ['source', '']);
});

test('blockSpans preserves the opening tag attributes', () => {
  const [block] = blockSpans('<section id="claim" data-block="fact" class="card">text</section>');
  assert.equal(block.attrs, ' id="claim" data-block="fact" class="card"');
});

test('parseQuiz reports a missing items array for a null quiz', () => {
  const html = '<script type="application/json" data-quiz>null</script>';
  assert.deepEqual(parseQuiz(html), { error: 'quiz JSON has no items array' });
});

test('parseQuiz reports a missing items array for numeric items', () => {
  const html = '<script type="application/json" data-quiz>{"items":5}</script>';
  assert.deepEqual(parseQuiz(html), { error: 'quiz JSON has no items array' });
});

test('parseQuiz reports the first invalid item index when that item is null', () => {
  const html = '<script type="application/json" data-quiz>{"items":[{"options":[]},null,{}]}</script>';
  assert.deepEqual(parseQuiz(html), { error: 'quiz item 1 has no options array' });
});

test('parseQuiz reports a missing options array for numeric options', () => {
  const html = '<script type="application/json" data-quiz>{"items":[{"options":5}]}</script>';
  assert.deepEqual(parseQuiz(html), { error: 'quiz item 0 has no options array' });
});

test('lessonItems puts predict items before quiz items even when quiz appears first', () => {
  const html = `<section data-block="quiz">
  <script type="application/json" data-quiz>{"items":[{"options":["Quiz"]}]}</script>
</section>
<section data-block="predict">
  <script type="application/json" data-quiz>{"items":[{"options":["Prediction"]}]}</script>
</section>`;
  assert.deepEqual(lessonItems(html), { items: [{ options: ['Prediction'] }, { options: ['Quiz'] }] });
});

test('lessonItems returns the predict error when both parts fail to parse', () => {
  const html = `<section data-block="predict">
  <script type="application/json" data-quiz>{"items":5}</script>
</section>
<section data-block="quiz">
  <script type="application/json" data-quiz>{"items":[null]}</script>
</section>`;
  assert.deepEqual(lessonItems(html), { error: 'quiz JSON has no items array' });
});

test('readPath fills in defaults for a line without fields', (t) => {
  const dir = pathFixture(t, '1. Inspect results\n');
  assert.deepEqual(readPath(dir), [
    { n: 1, title: 'Inspect results', terms: [], tool: null, after: [], lesson: null },
  ]);
});

test('readPath clears an earlier tool field when the next tool value is empty', (t) => {
  const dir = pathFixture(t, '1. Inspect results | tool: fxctl | tool:\n');
  assert.equal(readPath(dir)[0].tool, null);
});
