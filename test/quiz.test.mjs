import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shuffleOptions, grade, answerLengthSpread, lessonIdFrom } from '../skills/research-teach/assets/quiz.js';

const QUIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills/research-teach/assets/quiz.js');

test('shuffleOptions keeps why aligned, remaps correct, and order maps back', () => {
  const item = { q: 'q', options: ['a', 'b', 'c'], correct: 2, why: ['wa', 'wb', 'wc'] };
  // Fisher-Yates walks i = 2 then i = 1 and swaps i with floor(rand() * (i + 1)).
  // Returns 0 then 0.5: i=2 swaps with 0 (c,b,a), i=1 swaps with floor(0.5 * 2) = 1 (no-op), so reversed.
  const seq = [0, 0.5];
  const out = shuffleOptions(item, () => seq.shift());
  assert.deepEqual(out.options, ['c', 'b', 'a']);
  assert.deepEqual(out.why, ['wc', 'wb', 'wa']);
  assert.equal(out.correct, 0);
  assert.deepEqual(out.order, [2, 1, 0]);
  assert.equal(out.q, 'q');
  assert.deepEqual(item, { q: 'q', options: ['a', 'b', 'c'], correct: 2, why: ['wa', 'wb', 'wc'] });
  assert.equal(seq.length, 0);
});

test('grade uses authored-order answers and lists wrong item indexes', () => {
  const items = [{ correct: 0 }, { correct: 2 }, { correct: 1 }, { correct: 3 }];
  assert.deepEqual(grade(items, [0, 1, 1, 0]), { total: 4, wrong: [1, 3] });
  assert.deepEqual(grade(items, [0, 2, 1, 3]), { total: 4, wrong: [] });
  assert.deepEqual(grade(items, [0, 2]), { total: 4, wrong: [2, 3] });
});

test('answerLengthSpread is longest over shortest and 1 for one option', () => {
  assert.equal(answerLengthSpread({ options: ['ab', 'abcd', 'abc'] }), 2);
  assert.equal(answerLengthSpread({ options: ['abc', 'xyz'] }), 1);
  assert.equal(answerLengthSpread({ options: ['only one'] }), 1);
});

test('lessonIdFrom prefers the served path, falls back to data-lesson, else null', () => {
  assert.equal(lessonIdFrom('/lessons/0002-tls.html', '0001-other'), '0002-tls');
  assert.equal(lessonIdFrom('/lessons/0002-tls.html', undefined), '0002-tls');
  for (const p of ['/', '/lessons/0002-tls.htm', '/lessons/x/0002-tls.html', '/reference/0002-tls.html', '/lessons/0002-TLS.html', '']) {
    assert.equal(lessonIdFrom(p, '0001-other'), '0001-other', p);
  }
  assert.equal(lessonIdFrom('/index.html', undefined), null);
  assert.equal(lessonIdFrom(undefined, undefined), null);
});

test('importing quiz.js in Node touches no DOM', () => {
  // A child process with no document and counting getters on window, location and fetch.
  // document stays undefined so the module's typeof guard is what is under test.
  const script = `
    let touched = 0;
    for (const k of ['window', 'location', 'fetch']) {
      const real = globalThis[k];
      Object.defineProperty(globalThis, k, { configurable: true, get() { touched++; return real; } });
    }
    const m = await import(${JSON.stringify(QUIZ)});
    console.log(JSON.stringify({ touched, hasDocument: typeof document !== 'undefined', exports: Object.keys(m).sort() }));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  console.log(`exports=${out.exports.length} dom_accesses=${out.touched}`);
  assert.deepEqual(out.exports, ['answerLengthSpread', 'grade', 'lessonIdFrom', 'renderQuiz', 'shuffleOptions']);
  assert.equal(out.touched, 0);
  assert.equal(out.hasDocument, false);
});
