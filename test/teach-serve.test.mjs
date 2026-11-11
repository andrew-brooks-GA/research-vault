// `teach serve`: host, origin, content-type, body-size and path limits (spec 12 "Serving and recording").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, chmodSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixtureVault } from './helpers.mjs';
import { createServer, ATTEMPT_BODY_MAX } from '../bin/lib/teach.mjs';
import { footnoteCitations, markdownHtml } from '../bin/lib/teach.mjs';
import { loadTeachSchema } from '../bin/lib/schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'research-vault.mjs');
const FIX = join(ROOT, 'test', 'fixtures', 'teach');
const SCHEMA = loadTeachSchema(ROOT);
const NOW = new Date('2026-10-26T09:00:00Z');

const copyFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-teach-serve-'));
  cpSync(FIX, dir, { recursive: true });
  return dir;
};
const attempts = (ws) => readdirSync(join(ws, 'attempts')).length;

async function start(ws) {
  const server = createServer(ws, { schema: SCHEMA, now: () => NOW });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

// node:http rather than fetch: fetch will not send a caller-chosen Host header.
// `body` is a string; `chunked` sends it without a Content-Length.
function req(port, { method = 'GET', path = '/', headers = {}, body, chunked = false }) {
  return new Promise((resolve) => {
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    if (body !== undefined && !chunked && !('Content-Length' in h)) h['Content-Length'] = Buffer.byteLength(body);
    if (chunked) h['Transfer-Encoding'] = 'chunked';
    const r = request({ host: '127.0.0.1', port, method, path, headers: h, setHost: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code }));
    if (body !== undefined) r.write(body);
    r.end();
  });
}

const json = (port, body, headers = {}) => req(port, {
  method: 'POST', path: '/attempt', body,
  headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', ...headers },
});

test('serves a lesson and the glossary; returns 404 for NOTES.md, a record, an attempt and ../ escape', async () => {
  const ws = copyFixture();
  // Every refused path exists on disk, so a 404 means refused, not missing.
  writeFileSync(join(ws, 'NOTES.md'), '# Notes\n\nSuccess looks like a private note.\n');
  writeFileSync(join(ws, '.teach-serve.json'), '{"port":1,"pid":1}\n');
  writeFileSync(join(ws, 'lessons', '.hidden.html'), '<p>Success looks like a dotfile</p>\n');
  const { server, port } = await start(ws);
  try {
    const served = {
      '/lessons/0001-good.html': 'text/html; charset=utf-8',
      '/GLOSSARY.md': 'text/markdown; charset=utf-8',
      '/reference/good.html': 'text/html; charset=utf-8',
    };
    const hidden = [
      '/NOTES.md', '/MISSION.md', '/learning-records/0001-known.md', '/attempts/a-20260101-120000-0001.md',
      '/lessons/../MISSION.md', '/lessons/%2e%2e/MISSION.md', '/lessons/..%2fMISSION.md', '/../../etc/passwd',
      '/evidence/0001/PLAN.md', '/lessons', '/lessons/', '/lessons/0001-good.html%00.png', '/.teach-serve.json',
      '/lessons/.hidden.html',
    ];
    let ok = 0;
    for (const [p, type] of Object.entries(served)) {
      const r = await req(port, { path: p });
      console.log(`GET ${p} -> ${r.status}`);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers['content-type'], type);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      if (p === '/lessons/0001-good.html') assert.equal(r.text, footnoteCitations(readFileSync(join(ws, 'lessons', '0001-good.html'), 'utf8')), 'a lesson is served with its citations rendered as footnotes');
      ok++;
    }
    let notFound = 0;
    for (const p of hidden) {
      const r = await req(port, { path: p });
      console.log(`GET ${p} -> ${r.status}`);
      assert.equal(r.status, 404, p);
      assert.ok(!r.text.includes('Success looks like') && !r.text.includes('type: attempt'), p);
      notFound++;
    }
    const root = await req(port, { path: '/' });
    console.log(`GET / -> ${root.status} ${JSON.stringify(root.text)}`);
    assert.equal(root.status, 200);
    assert.equal(root.headers['content-type'], 'text/html; charset=utf-8');
    for (const p of ['/lessons/0001-good.html', '/lessons/0002-bad.html', '/lessons/0003-review-good.html', '/reference/good.html']) assert.ok(root.text.includes(`href="${p}"`), p);
    assert.ok(root.text.includes('What fx returns'), 'index links carry the lesson title');
    assert.ok(!root.text.includes('Success looks like') && !root.text.includes('learning-records') && !root.text.includes('.hidden'));
    const idx = await req(port, { path: '/lessons.json' });
    assert.equal(idx.headers['content-type'], 'application/json');
    const parsed = JSON.parse(idx.text);
    assert.deepEqual(parsed.lessons.map((l) => l.id), ['0001-good', '0002-bad', '0003-review-good', '0004-tool-fxctl', '0005-diagnose-fx', '0006-project-fx']);
    assert.equal(parsed.lessons[0].title, 'What fx returns');
    assert.equal(parsed.lines, 9);
    assert.deepEqual(parsed.lessons[4], { id: '0005-diagnose-fx', title: 'Reading what fx printed', path: '/lessons/0005-diagnose-fx.html', line: 8, shape: 'diagnose', project: 'Project: Predict, then run' });
    assert.deepEqual(parsed.reference.map((r) => r.path), ['/reference/good.html']);
    const page = await req(port, { path: '/lessons/0001-good.html' });
    assert.ok(page.text.includes('class="cite" href="#src-2026-01-01-fx-doc" title="2026-01-01-fx-doc">[1]</a>'), 'inline citations render as numbered footnotes');
    assert.ok(page.text.includes('id="src-2026-01-01-fx-doc">[1] 2026-01-01-fx-doc</a>'), 'the sources block carries the anchor id and number');
    assert.ok(!/<a data-cite="2026-01-01-fx-snippet">2026-01-01-fx-snippet<\/a>/.test(page.text), 'no raw id link text outside the sources block');
    const prog = await req(port, { path: '/progress' });
    assert.equal(prog.status, 200);
    assert.equal(prog.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(prog.text.includes('<b>2/3</b>') && prog.text.includes('2026-01-01') && prog.text.includes('href="/lessons/0001-good.html"'), 'progress page shows the attempt');
    const progJson = JSON.parse((await req(port, { path: '/progress.json' })).text);
    assert.equal(progJson.attempts, 1);
    assert.equal(progJson.lessons.find((l) => l.id === '0001-good').best.score, 2);
    const bad = await req(port, { path: '/lessons/%E0%A4%A' });
    console.log(`GET /lessons/%E0%A4%A -> ${bad.status}`);
    assert.equal(bad.status, 400);
    const head = await req(port, { method: 'HEAD', path: '/lessons/0001-good.html' });
    assert.equal(head.status, 200);
    assert.equal(head.text, '');
    const put = await req(port, { method: 'PUT', path: '/lessons/0001-good.html', body: 'x' });
    console.log(`PUT -> ${put.status}`);
    assert.equal(put.status, 405);
    console.log(`served ${ok}/${Object.keys(served).length}, refused ${notFound}/${hidden.length}`);
  } finally {
    server.close();
  }
});

test('every request without the exact Host is 403, GET included', async () => {
  const ws = copyFixture();
  const { server, port } = await start(ws);
  try {
    const good = await req(port, { path: '/lessons/0001-good.html' });
    console.log(`Host 127.0.0.1:${port} GET -> ${good.status}`);
    assert.equal(good.status, 200);
    const before = attempts(ws);
    for (const host of [`localhost:${port}`, 'evil.example', '127.0.0.1', `127.0.0.1:${port + 1}`, `127.0.0.1:${port}.evil`, undefined]) {
      const g = await req(port, { path: '/lessons/0001-good.html', headers: { Host: host } });
      const p = await json(port, JSON.stringify({ lesson: '0003-review-good', answers: [0, 2, 1] }), { Host: host });
      console.log(`Host ${host} GET -> ${g.status}, POST -> ${p.status}`);
      assert.equal(g.status, 403);
      assert.equal(p.status, 403);
      assert.ok(!g.text.includes('<html'));
    }
    console.log(`attempts before ${before}, after ${attempts(ws)}`);
    assert.equal(attempts(ws), before);
  } finally {
    server.close();
  }
});

test('POST /attempt with a valid body writes exactly one attempt and replies id, score, total, wrong', async () => {
  const ws = copyFixture();
  const { server, port } = await start(ws);
  try {
    const before = attempts(ws);
    const r = await json(port, JSON.stringify({ lesson: '0003-review-good', answers: [0, 1, 1] }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
    console.log(`POST valid -> ${r.status} ${r.text}`);
    console.log(`attempts before ${before}, after ${attempts(ws)}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(r.text), { id: 'a-20261026-090000-0003', score: 2, total: 3, wrong: [1] });
    assert.equal(attempts(ws), before + 1);
    const text = readFileSync(join(ws, 'attempts', 'a-20261026-090000-0003.md'), 'utf8');
    assert.match(text, /lesson: 0003-review-good/);
    assert.match(text, /wrong: \[1\]/);
  } finally {
    server.close();
  }
});

test('POST /attempt rejects foreign Origin, wrong Content-Type, oversized body (413 or 403 per spec: 403), malformed JSON (400), unknown lesson (400), out-of-range answers (400), and writes zero files', async () => {
  const ws = copyFixture();
  const { server, port } = await start(ws);
  try {
    const valid = JSON.stringify({ lesson: '0003-review-good', answers: [0, 2, 1] });
    const big = JSON.stringify({ lesson: '0003-review-good', answers: [0, 2, 1], pad: 'x'.repeat(ATTEMPT_BODY_MAX) });
    const cases = [
      ['foreign Origin', 403, () => json(port, valid, { Origin: 'http://evil.example' })],
      ['localhost Origin', 403, () => json(port, valid, { Origin: `http://localhost:${port}` })],
      ['no Origin', 403, () => json(port, valid, { Origin: undefined })],
      ['text/plain', 403, () => json(port, valid, { 'Content-Type': 'text/plain' })],
      ['form', 403, () => json(port, valid, { 'Content-Type': 'application/x-www-form-urlencoded' })],
      ['no Content-Type', 403, () => json(port, valid, { 'Content-Type': undefined })],
      ['oversized, Content-Length', 403, () => json(port, big)],
      ['oversized, chunked', 403, () => req(port, {
        method: 'POST', path: '/attempt', body: big, chunked: true,
        headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      })],
      ['wrong path', 404, () => req(port, { method: 'POST', path: '/attempts', body: valid,
        headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' } })],
      ['wrong method', 405, () => req(port, { method: 'PUT', path: '/attempt', body: valid,
        headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' } })],
      ['malformed JSON', 400, () => json(port, '{"lesson": "0003-review-good", "answers": [0, 2,')],
      ['array body', 400, () => json(port, '[]')],
      ['answers not an array', 400, () => json(port, JSON.stringify({ lesson: '0003-review-good', answers: '0,2,1' }))],
      ['unknown lesson', 400, () => json(port, JSON.stringify({ lesson: '0009-nope', answers: [0, 2, 1] }))],
      ['lesson path escape', 400, () => json(port, JSON.stringify({ lesson: '../MISSION', answers: [0] }))],
      ['out-of-range answer', 400, () => json(port, JSON.stringify({ lesson: '0003-review-good', answers: [0, 2, 9] }))],
      ['too few answers', 400, () => json(port, JSON.stringify({ lesson: '0003-review-good', answers: [0, 2] }))],
      ['non-integer answer', 400, () => json(port, JSON.stringify({ lesson: '0003-review-good', answers: [0, 2, 1.5] }))],
    ];
    const before = attempts(ws);
    for (const [name, want, send] of cases) {
      const r = await send();
      console.log(`${name} -> ${r.status}${r.error ? ` (${r.error})` : ''} ${r.text ?? ''}`.trim());
      assert.equal(r.status, want, name);
    }
    console.log(`attempts before ${before}, after ${attempts(ws)}`);
    assert.equal(attempts(ws), before);
    // Positive control: the same server, the same valid body, writes one.
    const ok = await json(port, valid);
    console.log(`control -> ${ok.status}; attempts ${attempts(ws)}`);
    assert.equal(ok.status, 200);
    assert.equal(attempts(ws), before + 1);
  } finally {
    server.close();
  }
});

test('serve writes and removes .teach-serve.json', async () => {
  const ws = copyFixture();
  const file = join(ws, '.teach-serve.json');
  const child = spawn(process.execPath, [BIN, 'teach', 'serve', ws], {
    env: { ...process.env, RESEARCH_VAULT_PATH: fixtureVault() }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (c) => { stdout += c; if (stdout.includes('\n')) resolve(); });
    child.on('exit', (code) => reject(new Error(`serve exited ${code} before serving`)));
  });
  const m = stdout.match(/^serving (.+) at http:\/\/127\.0\.0\.1:(\d+)\/\n$/);
  console.log(stdout.trim());
  assert.ok(m, stdout);
  assert.equal(m[1], ws);
  const info = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`.teach-serve.json ${JSON.stringify(info)}`);
  assert.deepEqual(info, { port: Number(m[2]), pid: child.pid });
  const r = await req(info.port, { path: '/GLOSSARY.md' });
  assert.equal(r.status, 200);
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  console.log(`exit ${code}; file present after exit: ${existsSync(file)}`);
  assert.equal(code, 0);
  assert.equal(existsSync(file), false);
});

test('GET /assets/reading.html serves the copied reading page as html without footnoting, and 404s when the workspace lacks it (spec 38)', async () => {
  const ws = copyFixture();
  const { server, port } = await start(ws);
  try {
    const missing = await req(port, { path: '/assets/reading.html' });
    assert.equal(missing.status, 404);
    mkdirSync(join(ws, 'assets'), { recursive: true });
    cpSync(join(ROOT, 'skills', 'research-teach', 'assets', 'reading.html'), join(ws, 'assets', 'reading.html'));
    const r = await req(port, { path: '/assets/reading.html' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.text.replace(/<nav class="lesson-nav">.*?<\/nav>/, ''), readFileSync(join(ws, 'assets', 'reading.html'), 'utf8'), 'served as it is, not footnoted, apart from the navigation bar');
  } finally { server.close(); }
});

test('every html page teach serve returns carries the navigation bar or loads quiz.js (issue 61)', async () => {
  const ws = copyFixture();
  mkdirSync(join(ws, 'assets'), { recursive: true });
  cpSync(join(ROOT, 'skills', 'research-teach', 'assets', 'reading.html'), join(ws, 'assets', 'reading.html'));
  const { server, port } = await start(ws);
  try {
    const { lessons, reference } = JSON.parse((await req(port, { path: '/lessons.json' })).text);
    const paths = ['/', '/progress', '/assets/reading.html', ...[...lessons, ...reference].map((e) => e.path)];
    for (const path of paths) {
      const r = await req(port, { path });
      assert.equal(r.status, 200, path);
      const bars = (r.text.match(/class="lesson-nav"/g) ?? []).length;
      assert.equal(bars, /<script[^>]*quiz\.js/.test(r.text) ? 0 : 1, path);
    }
  } finally { server.close(); }
});

// Issue 66 part 2: GET / shows the workspace README above the lesson index, escaped, and is unchanged without one.
test('GET / renders README.md above the lesson index with its HTML escaped, and is unchanged without one (issue 66)', async () => {
  const ws = copyFixture();
  const { server, port } = await start(ws);
  try {
    const before = (await req(port, { path: '/' })).text;
    assert.ok(!before.includes('data-block="readme"'));
    writeFileSync(join(ws, 'README.md'), [
      '# Reading the fixture function', '', '## Lesson map', '| Group | Lessons | What it builds |', '|---|---|---|',
      '| Project: Predict, then run | 0001-good, 0003-review-good (review) | Predicting what a function prints |', '',
      'A <script>alert(1)</script> tag, [a bad link](javascript:alert(1)) and [the index](#top).', '',
    ].join('\n'));
    const r = await req(port, { path: '/' });
    assert.equal(r.status, 200);
    const at = (s) => { const i = r.text.indexOf(s); assert.ok(i !== -1, s); return i; };
    assert.ok(at('<h1>Reading the fixture function</h1>') < at('<td>0001-good, 0003-review-good (review)</td>'));
    assert.ok(at('<td>0001-good, 0003-review-good (review)</td>') < at('<h1>Lessons</h1>'));
    assert.ok(at('<h1>Lessons</h1>') < at('<section data-block="index">'));
    at('A &lt;script&gt;alert(1)&lt;/script&gt; tag');
    at('<a href="#top">the index</a>');
    assert.ok(!r.text.includes('<script>alert') && !r.text.includes('href="javascript'));
    assert.equal(r.text.replace(/<section data-block="readme">[\s\S]*?<\/section>\n/, ''), before, 'only the README section is added');
    // A symlinked README.md is not followed, and an unreadable one gives the page with no README.
    renameSync(join(ws, 'README.md'), join(ws, 'target.md'));
    symlinkSync(join(ws, 'target.md'), join(ws, 'README.md'));
    assert.equal((await req(port, { path: '/' })).text, before, 'symlink');
    if (process.getuid?.() !== 0) {
      renameSync(join(ws, 'target.md'), join(ws, 'README.md'));
      chmodSync(join(ws, 'README.md'), 0);
      const u = await req(port, { path: '/' });
      assert.equal(u.status, 200);
      assert.equal(u.text, before, 'unreadable');
    }
  } finally { server.close(); }
});

test('markdownHtml: headings, lists, fenced and inline code, tables and links, every character escaped (issue 66)', () => {
  assert.equal(markdownHtml([
    '### Small', 'one', 'two', '', '- a `<b>`', '- [x](https://example.com/?a=1&b=2)', '', '```sh', '<i>raw</i>', '```',
    '| h | i |', '|---|---|', '| [r](lessons/0001-good.html) | [m](mailto:a@b.c) |', '[d](data:text/html,x) [c](\x01javascript:alert(1))',
  ].join('\n')), [
    '<h3>Small</h3>', '<p>one two</p>',
    '<ul><li>a <code>&lt;b&gt;</code></li><li><a href="https://example.com/?a=1&amp;b=2">x</a></li></ul>',
    '<pre><code>&lt;i&gt;raw&lt;/i&gt;</code></pre>',
    '<table><thead><tr><th>h</th><th>i</th></tr></thead><tbody><tr><td><a href="lessons/0001-good.html">r</a></td><td>[m](mailto:a@b.c)</td></tr></tbody></table>',
    '<p>[d](data:text/html,x) [c](\x01javascript:alert(1))</p>',
  ].join('\n'));
});
