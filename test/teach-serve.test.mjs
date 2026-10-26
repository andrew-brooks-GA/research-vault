// `teach serve`: host, origin, content-type, body-size and path limits (spec 12 "Serving and recording").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixtureVault } from './helpers.mjs';
import { createServer, ATTEMPT_BODY_MAX } from '../bin/lib/teach.mjs';
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
      '/evidence/0001/PLAN.md', '/', '/lessons', '/lessons/', '/lessons/0001-good.html%00.png', '/.teach-serve.json',
      '/lessons/.hidden.html',
    ];
    let ok = 0;
    for (const [p, type] of Object.entries(served)) {
      const r = await req(port, { path: p });
      console.log(`GET ${p} -> ${r.status}`);
      assert.equal(r.status, 200, p);
      assert.equal(r.headers['content-type'], type);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      if (p === '/lessons/0001-good.html') assert.equal(r.text, readFileSync(join(ws, 'lessons', '0001-good.html'), 'utf8'));
      ok++;
    }
    let notFound = 0;
    for (const p of hidden) {
      const r = await req(port, { path: p });
      console.log(`GET ${p} -> ${r.status}`);
      assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
      assert.ok(!r.text.includes('Success looks like') && !r.text.includes('type: attempt'), p);
      notFound++;
    }
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
