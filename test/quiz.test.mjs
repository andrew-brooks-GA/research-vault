import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shuffleOptions, grade, answerLengthSpread, lessonIdFrom, neighbours, pathPosition, mergeQuizzes, answerMark, renderQuiz, resultsFile, renderLab, labStatus, LAB_ENDED_EARLY } from '../skills/research-teach/assets/quiz.js';

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
  assert.deepEqual(out.exports, ['LAB_ENDED_EARLY', 'answerLengthSpread', 'answerMark', 'grade', 'labStatus', 'lessonIdFrom', 'mergeQuizzes', 'neighbours', 'pathPosition', 'renderLab', 'renderQuiz', 'resultsFile', 'shuffleOptions']);
  assert.equal(out.touched, 0);
  assert.equal(out.hasDocument, false);
});

test('neighbours gives prev and next around the current lesson, null at the ends or when absent', () => {
  const list = [{ id: '0001-a' }, { id: '0002-b' }, { id: '0003-c' }];
  assert.deepEqual(neighbours(list, '0002-b'), { prev: { id: '0001-a' }, next: { id: '0003-c' } });
  assert.deepEqual(neighbours(list, '0001-a'), { prev: null, next: { id: '0002-b' } });
  assert.deepEqual(neighbours(list, '0003-c'), { prev: { id: '0002-b' }, next: null });
  assert.deepEqual(neighbours(list, '0009-z'), { prev: null, next: null });
  assert.deepEqual(neighbours([], null), { prev: null, next: null });
});

test('pathPosition gives line N of M from /lessons.json, null without a line or a count', () => {
  const index = { lines: 10, lessons: [{ id: '0004-x', line: 4 }, { id: '0005-y', line: null }] };
  assert.equal(pathPosition(index, '0004-x'), 'line 4 of 10');
  assert.equal(pathPosition(index, '0005-y'), null);
  assert.equal(pathPosition(index, '0009-z'), null);
  assert.equal(pathPosition({ lines: null, lessons: [{ id: '0004-x', line: 4 }] }, '0004-x'), null);
});

test('mergeQuizzes puts the predict item first, so it is item 0 of the one graded attempt', () => {
  const predict = { predict: true, items: [{ correct: 0 }] };
  const quiz = { predict: false, items: [{ correct: 1 }, { correct: 2 }, { correct: 0 }] };
  const merged = mergeQuizzes([quiz, predict]);
  assert.deepEqual(merged, [predict, quiz]);
  assert.deepEqual(grade(merged.flatMap((p) => p.items), [1, 1, 2, 2]), { total: 4, wrong: [0, 3] });
});

test('answerMark is the visible text of a revealed option', () => {
  assert.equal(answerMark(2, 2), 'Correct');
  assert.equal(answerMark(0, 2), 'Not this one');
});

// The smallest DOM renderQuiz touches: enough to read roles, labels and texts back.
function fakeDocument(dataset = {}) {
  const make = (tag) => {
    const node = {
      tag, children: [], attrs: {}, listeners: {}, className: '', id: '', textContent: '',
      classList: { add(c) { node.className += ` ${c}`; } },
      setAttribute(k, v) { node.attrs[k] = v; },
      append(...c) { node.children.push(...c); },
      addEventListener(t, f) { node.listeners[t] = f; },
      click() { node.clicked = true; }, remove() { node.removed = true; },
      querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.tag === sel) out.push(c); walk(c); }); walk(node); return out; },
    };
    return node;
  };
  const body = make('body');
  body.dataset = { lesson: '0005-diagnose-fx', ...dataset };
  return { createElement: make, body };
}

test('renderQuiz: one attempt over predict and quiz, group roles, status roles, aria-disabled and visible marks', async () => {
  globalThis.document = fakeDocument();
  globalThis.location = { pathname: '/lessons/0005-diagnose-fx.html' };
  try {
    const item = (q) => ({ q, options: ['a', 'b', 'c'], correct: 0, why: ['wa', 'wb', 'wc'] });
    const predictBox = document.createElement('div');
    const quizBox = document.createElement('div');
    const posts = [];
    renderQuiz(mergeQuizzes([{ container: quizBox, items: [item('q1'), item('q2')] }, { container: predictBox, items: [item('p0')], predict: true }]),
      { rand: () => 0.999, submit: async (p) => { posts.push(p); return 'recorded a-1: 2/3'; } });
    const boxes = [...predictBox.children[0].children, ...quizBox.children[0].children].filter((c) => c.className === 'quiz-item');
    assert.deepEqual(boxes.map((b) => b.children[0].textContent), ['p0', 'q1', 'q2']);
    for (const b of boxes) {
      assert.equal(b.attrs.role, 'group');
      assert.equal(b.attrs['aria-labelledby'], b.children[0].id);
      assert.equal(b.children.at(-1).className, 'quiz-why');
      assert.equal(b.children.at(-1).attrs.role, 'status');
    }
    const result = quizBox.children[0].children.at(-1);
    assert.equal(result.className, 'quiz-result');
    assert.equal(result.attrs.role, 'status');
    assert.equal(predictBox.children[0].children.some((c) => c.className === 'quiz-result'), false);
    // rand 0.999 leaves the authored order, so option 0 is correct.
    const opts = (b) => b.querySelectorAll('button');
    await opts(boxes[0])[0].listeners.click();
    assert.equal(opts(boxes[0])[0].textContent, 'Correct: a');
    assert.ok(opts(boxes[0]).every((b) => b.attrs['aria-disabled'] === 'true' && b.disabled === undefined));
    await opts(boxes[0])[1].listeners.click(); // a second answer is ignored
    assert.equal(opts(boxes[0])[1].textContent, 'b');
    await opts(boxes[1])[1].listeners.click();
    assert.equal(opts(boxes[1])[1].textContent, 'Not this one: b');
    assert.equal(boxes[1].children.at(-1).textContent, 'wb');
    await opts(boxes[2])[0].listeners.click();
    assert.deepEqual(posts, [{ lesson: '0005-diagnose-fx', answers: [0, 1, 0] }]);
    assert.equal(result.textContent, 'Score: 2/3');
  } finally {
    delete globalThis.document;
    delete globalThis.location;
  }
});

// Spec 48 D4: with data-export on <body>, the default submit stores the attempt in localStorage under the workspace
// key, never fetches, and the Export my results button downloads resultsFile of what is stored plus what is held.
test('export mode: the attempt goes to localStorage, and Export my results carries it even when storage throws (spec 48)', async () => {
  const realCreate = URL.createObjectURL;
  const blobs = [];
  globalThis.location = { pathname: '/Users/me/out/lessons/0005-diagnose-fx.html', origin: 'http://127.0.0.1:8080' };
  const fetched = [];
  globalThis.fetch = (u) => { fetched.push(u); return new Promise(() => {}); };
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x'; };
  const item = (q) => ({ q, options: ['a', 'b', 'c'], correct: 0, why: ['wa', 'wb', 'wc'] });
  const answer = async (picks) => {
    const box = document.createElement('div');
    renderQuiz([{ container: box, items: [item('q1'), item('q2')] }], { rand: () => 0.999 });
    const items = box.children[0].children.filter((c) => c.className === 'quiz-item');
    for (const [i, k] of picks.entries()) await items[i].querySelectorAll('button')[k].listeners.click();
    return box.children[0].children.at(-1);
  };
  const exported = async (result) => {
    const btn = result.children.find((c) => c.className === 'quiz-export');
    assert.equal(btn.textContent, 'Export my results');
    btn.listeners.click();
    const a = document.body.children.at(-1);
    assert.ok(a.clicked && a.removed);
    assert.match(a.download, /^results-learn-ws-\d{8}-\d{6}\.json$/);
    return JSON.parse(await blobs.at(-1).text());
  };
  try {
    globalThis.document = fakeDocument({ export: 'learn-ws' });
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    const before = new Date().toISOString();
    const result = await answer([0, 1]);
    assert.equal(result.textContent, 'Score: 1/2');
    assert.equal(result.children[0].textContent, ' Saved in this browser.');
    const saved = JSON.parse(store.get('research-vault-attempts:learn-ws'));
    assert.equal(saved.length, 1);
    assert.deepEqual(Object.keys(saved[0]), ['lesson', 'answers', 'at', 'total', 'wrong']);
    assert.deepEqual({ ...saved[0], at: undefined }, { lesson: '0005-diagnose-fx', answers: [0, 1], at: undefined, total: 2, wrong: [1] });
    assert.ok(saved[0].at >= before && saved[0].at <= new Date().toISOString());
    const file = await exported(result);
    assert.equal(await blobs.at(-1).text(), resultsFile('learn-ws', saved));
    assert.deepEqual(file, { format: 'research-vault-attempts', version: 1, workspace: 'learn-ws', attempts: saved });

    // Storage that throws on every read and write: the attempt is held in memory and still exported.
    globalThis.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    const result2 = await answer([0, 0]);
    assert.equal(result2.children[0].textContent, ' Not saved in this browser.');
    const file2 = await exported(result2);
    assert.equal(file2.attempts.length, 1);
    assert.deepEqual({ ...file2.attempts[0], at: undefined }, { lesson: '0005-diagnose-fx', answers: [0, 0], at: undefined, total: 2, wrong: [] });
    assert.deepEqual(fetched, []);
  } finally {
    URL.createObjectURL = realCreate;
    for (const k of ['document', 'location', 'fetch', 'localStorage']) delete globalThis[k];
  }
});

test('export mode on a page whose data-block is progress: the stored attempts, linked, with the button, and no nav fetch (spec 48)', async () => {
  const doc = fakeDocument({ export: 'learn-ws' });
  const section = doc.createElement('section');
  doc.querySelectorAll = () => [];
  doc.querySelector = (sel) => (sel === '[data-block="progress"]' ? section : null);
  const attempt = { lesson: '0001-one', answers: [0, 1], at: '2026-11-11T20:57:00.690Z', total: 2, wrong: [1] };
  globalThis.document = doc;
  // A 127.0.0.1 origin, where a served page's renderNav would fetch /lessons.json.
  globalThis.location = { pathname: '/lessons/0001-one.html', origin: 'http://127.0.0.1:8080' };
  const fetched = [];
  globalThis.fetch = (u) => { fetched.push(u); return new Promise(() => {}); };
  // A null and a number among the stored entries are dropped, not rendered or exported.
  globalThis.localStorage = { getItem: (k) => (k === 'research-vault-attempts:learn-ws' ? JSON.stringify([null, attempt, 7]) : null), setItem() {} };
  const realCreate = URL.createObjectURL;
  let blob;
  URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
  try {
    await import(`${QUIZ}?progress`); // a fresh module instance, so its auto-run block runs on this document
    const [table, btn] = section.children;
    const rows = table.children.map((r) => r.children.map((c) => c.children[0]?.textContent ?? c.textContent));
    assert.deepEqual(rows, [['lesson', 'date', 'score'], ['0001-one', '2026-11-11', '1/2']]);
    assert.equal(table.children[1].children[0].children[0].href, 'lessons/0001-one.html');
    assert.equal(btn.textContent, 'Export my results');
    btn.listeners.click();
    assert.equal(await blob.text(), resultsFile('learn-ws', [attempt]));
    assert.deepEqual(fetched, []);
  } finally {
    URL.createObjectURL = realCreate;
    for (const k of ['document', 'location', 'fetch', 'localStorage']) delete globalThis[k];
  }
});

// The served widget (no data-export, no submit option): one POST /attempt, the recorded line, no export button,
// no local progress table, and localStorage never read or written.
test('served mode: the default submit posts once, with no export button, no local progress and no localStorage (spec 48)', async () => {
  const doc = fakeDocument();
  const section = doc.createElement('section');
  doc.querySelectorAll = () => [];
  doc.querySelector = () => section;
  const calls = [];
  let storage = 0;
  globalThis.document = doc;
  globalThis.location = { pathname: '/lessons/0005-diagnose-fx.html', origin: 'http://127.0.0.1:8080' };
  globalThis.fetch = async (u, o) => {
    calls.push([u, o?.method ?? 'GET', o?.body]);
    return u === '/attempt' ? { ok: true, json: async () => ({ id: 'a-1', score: 1, total: 2, wrong: [1] }) } : { ok: false };
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { storage++; return { getItem() { storage++; return null; }, setItem() { storage++; } }; } });
  try {
    const m = await import(`${QUIZ}?served`); // a fresh module instance, so its auto-run block runs on this served document
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(section.children.length, 0);
    const item = (q) => ({ q, options: ['a', 'b', 'c'], correct: 0, why: ['wa', 'wb', 'wc'] });
    const box = doc.createElement('div');
    m.renderQuiz([{ container: box, items: [item('q1'), item('q2')] }], { rand: () => 0.999 });
    const items = box.children[0].children.filter((c) => c.className === 'quiz-item');
    await items[0].querySelectorAll('button')[0].listeners.click();
    await items[1].querySelectorAll('button')[1].listeners.click();
    assert.deepEqual(calls, [['/lessons.json', 'GET', undefined], ['/attempt', 'POST', JSON.stringify({ lesson: '0005-diagnose-fx', answers: [0, 1] })]]);
    const result = box.children[0].children.at(-1);
    assert.equal(result.textContent, 'Score: 1/2');
    assert.deepEqual(result.children.map((c) => [c.tag, c.className, c.textContent]), [['span', '', ' recorded a-1: 1/2']]);
    assert.equal(storage, 0);
  } finally {
    for (const k of ['document', 'location', 'fetch', 'localStorage']) delete globalThis[k];
  }
});

// Spec 49 test 2, browser side, and test 7's widget half: renderLab on a fake section with a stub fetch whose replies
// stream chunks the test releases.
test('renderLab: buttons enabled per D3, each chunk appended through textContent, the status from the final lab: line only (spec 49)', async () => {
  const doc = fakeDocument();
  const section = doc.createElement('section');
  section.dataset = { lab: 'demo', labLive: '', labVerify: '' };
  globalThis.document = doc;
  globalThis.location = { pathname: '/lessons/0001-lab.html', origin: 'http://127.0.0.1:8080' };
  const calls = [];
  const replies = [];
  const enc = new TextEncoder();
  globalThis.fetch = async (u, o) => {
    calls.push([u, o.method, o.headers['Content-Type'], o.body]);
    let ctl;
    const body = new ReadableStream({ start(c) { ctl = c; } });
    const r = { push: (s) => ctl.enqueue(enc.encode(s)), end: () => ctl.close(), fail: () => ctl.error(new Error('reset')) };
    replies.push(r);
    const [status, text] = u === '/lab/reset' && replies.length === 5 ? [409, 'busy: demo run\n'] : [200, null];
    if (text) { r.push(text); r.end(); }
    return { ok: status < 400, status, body };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  try {
    renderLab(section);
    const [bar, output, status] = section.children;
    assert.equal(output.tag, 'pre');
    assert.equal(status.attrs.role, 'status');
    const b = Object.fromEntries(bar.children.map((c) => [c.className.slice(4), c]));
    assert.deepEqual(bar.children.map((c) => [c.textContent, c.type]), [['Run', 'button'], ['Stop', 'button'], ['Reset', 'button'], ['Check my work', 'button']]);
    const state = () => ['run', 'stop', 'reset', 'verify'].map((k) => (b[k].disabled ? '-' : k)).join(' ');
    assert.equal(state(), 'run - reset verify');
    // Run: three chunks, an earlier "> lab: verify pass" line, then the server's final line.
    const run = b.run.listeners.click();
    await tick();
    assert.equal(state(), '- stop - verify', 'while Run is open: Run and Reset disabled, Stop and Check my work enabled');
    const chunks = ['pid 1\n', '> lab: verify pass\n', 'tick\nlab: exit 0\n'];
    for (const [i, c] of chunks.entries()) {
      replies[0].push(c);
      await tick();
      assert.equal(output.textContent, chunks.slice(0, i + 1).join(''));
    }
    // Check my work beside Run: its own button disabled while it is open, its output appended.
    const verify = b.verify.listeners.click();
    await tick();
    assert.equal(state(), '- stop - -');
    replies[1].push('lab: verify pass\n');
    replies[1].end();
    await verify;
    assert.equal(status.textContent, 'lab: verify pass');
    assert.equal(state(), '- stop - verify');
    replies[0].end();
    await run;
    assert.equal(status.textContent, 'lab: exit 0');
    assert.equal(state(), 'run - reset verify');
    assert.deepEqual(calls[0], ['/lab/run', 'POST', 'application/json', '{"lab":"demo"}']);
    // Reset: Stop disabled while it is open; a body with no final lab: line is "ended early".
    const reset = b.reset.listeners.click();
    await tick();
    assert.equal(state(), '- - - -');
    assert.equal(output.textContent, '', 'Run and Reset start a fresh output');
    replies[2].push('removed\n');
    replies[2].end();
    await reset;
    assert.equal(status.textContent, LAB_ENDED_EARLY);
    // A reply that fails part way is "ended early" too; Stop posts and leaves the output alone.
    const run2 = b.run.listeners.click();
    await tick();
    replies[3].push('x\n');
    replies[3].fail();
    await run2;
    assert.equal(status.textContent, LAB_ENDED_EARLY);
    // A 4xx reply's body becomes the status and is not output.
    await b.reset.listeners.click();
    assert.deepEqual([status.textContent, output.textContent], ['busy: demo run', '']);
    assert.deepEqual(calls.map((c) => c[0]), ['/lab/run', '/lab/verify', '/lab/reset', '/lab/run', '/lab/reset']);
  } finally {
    for (const k of ['document', 'location', 'fetch']) delete globalThis[k];
  }
  assert.equal(labStatus('a\n> lab: verify pass\n', true), LAB_ENDED_EARLY);
  assert.equal(labStatus('a\nlab: exit 0\n', false), LAB_ENDED_EARLY);
  assert.equal(labStatus('a\nlab: exit 0\n', true), 'lab: exit 0');
  assert.equal(labStatus('lab:exit 0\n', true), LAB_ENDED_EARLY);
});

test('renderLab adds nothing without data-lab-live, on an exported page, off the server\'s origin, or with no lab section; no verify button without data-lab-verify (spec 49)', () => {
  const cases = [
    [{ lab: 'demo' }, {}, 'http://127.0.0.1:8080'],
    [{ lab: 'demo', labLive: '' }, { export: 'learn-ws' }, 'http://127.0.0.1:8080'],
    [{ lab: 'demo', labLive: '' }, {}, 'null'],
    [{ lab: 'demo', labLive: '' }, {}, 'http://localhost:8080'],
  ];
  try {
    for (const [data, body, origin] of cases) {
      globalThis.document = fakeDocument(body);
      globalThis.location = { pathname: '/lessons/0001-lab.html', origin };
      const section = document.createElement('section');
      section.dataset = data;
      renderLab(section);
      assert.equal(section.children.length, 0, JSON.stringify([data, body, origin]));
    }
    renderLab(null);
    globalThis.document = fakeDocument();
    globalThis.location = { pathname: '/lessons/0001-lab.html', origin: 'http://127.0.0.1:8080' };
    const section = document.createElement('section');
    section.dataset = { lab: 'demo', labLive: '' };
    renderLab(section);
    assert.deepEqual(section.children[0].children.map((c) => c.textContent), ['Run', 'Stop', 'Reset']);
  } finally {
    for (const k of ['document', 'location']) delete globalThis[k];
  }
  // The widget writes the reply only as text.
  const src = readFileSync(QUIZ, 'utf8');
  const widget = src.slice(src.indexOf('export const LAB_ENDED_EARLY'), src.indexOf("if (typeof document !== 'undefined')"));
  assert.doesNotMatch(widget, /innerHTML|outerHTML|insertAdjacent|document\.write|DOMParser|createContextualFragment|\beval\b/);
});

test('the navigation bar links the reading page (spec 38)', () => {
  assert.match(readFileSync(QUIZ, 'utf8'), /link\('\/assets\/reading\.html', 'How to read', 'lesson-nav-reading'\)/);
});
