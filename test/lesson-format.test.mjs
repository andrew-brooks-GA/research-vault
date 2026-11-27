import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockSpans, imgAttr, lessonItems, readPath } from '../bin/lib/lesson-format.mjs';

function pathFixture(t, text) {
  const dir = mkdtempSync(join(tmpdir(), 'rv-lesson-format-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'PATH.md'), text);
  return dir;
}

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
