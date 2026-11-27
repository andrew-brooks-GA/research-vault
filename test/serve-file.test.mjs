import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { navHtml, serveFile } from '../bin/lib/serve-file.mjs';

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rv-serve-file-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('serveFile refuses a backslash path even when that file exists', {
  skip: process.platform === 'win32' && 'Windows uses backslashes as path separators',
}, (t) => {
  const ws = workspace(t);
  mkdirSync(join(ws, 'lessons'));
  writeFileSync(join(ws, 'lessons', 'a\\b.html'), '<p>Backslash filename</p>');
  assert.deepEqual(serveFile(ws, '/lessons/a%5Cb.html'), { status: 404 });
});

test('serveFile refuses a directory with and without bytes', (t) => {
  const ws = workspace(t);
  mkdirSync(join(ws, 'lessons', 'sub'), { recursive: true });
  assert.deepEqual(serveFile(ws, '/lessons/sub', { bytes: false }), { status: 404 }, 'without bytes');
  assert.deepEqual(serveFile(ws, '/lessons/sub'), { status: 404 }, 'with bytes');
});

test('serveFile footnotes citations on a reference page', (t) => {
  const ws = workspace(t);
  mkdirSync(join(ws, 'reference'));
  writeFileSync(join(ws, 'reference', 'guide.html'),
    '<p><a data-cite="x">Source</a></p><section data-block="sources"><a data-cite="x">Source</a></section>');
  const { body } = serveFile(ws, '/reference/guide.html', { titles: { x: 'Example source' } });
  assert.equal(body, '<p><a data-cite="x" class="cite" href="#src-x" title="Example source">[1]</a></p>' +
    '<section data-block="sources"><a data-cite="x" href="#src-x" id="src-x">[1] Example source</a></section>');
});

test('serveFile leaves lab steps out of a reference page that names a manifest lab', (t) => {
  const ws = workspace(t);
  mkdirSync(join(ws, 'reference'));
  mkdirSync(join(ws, 'labs'));
  const script = '#!/bin/sh\nexit 0\n';
  const sha256 = createHash('sha256').update(script).digest('hex');
  writeFileSync(join(ws, 'labs', 'up.sh'), script);
  writeFileSync(join(ws, 'labs', 'down.sh'), script);
  writeFileSync(join(ws, 'labs', 'labs.json'), JSON.stringify({
    version: 1, labs: { demo: {
      cost: 'No downloads', timeout: 60,
      up: { script: 'labs/up.sh', sha256 }, down: { script: 'labs/down.sh', sha256 },
    } },
  }));
  const html = '<section data-block="lab" data-lab="demo"><p>Instructions</p></section>';
  writeFileSync(join(ws, 'reference', 'guide.html'), html);
  const { status, body } = serveFile(ws, '/reference/guide.html');
  assert.deepEqual({ status, body }, { status: 200, body: html });
});

test('serveFile uses application/octet-stream for an unknown extension', (t) => {
  const ws = workspace(t);
  mkdirSync(join(ws, 'assets'));
  writeFileSync(join(ws, 'assets', 'data.bin'), 'File contents');
  assert.equal(serveFile(ws, '/assets/data.bin').type, 'application/octet-stream');
});

test('serveFile serves a lesson naming the inherited lab id constructor unchanged', (t) => {
  const ws = workspace(t);
  mkdirSync(join(ws, 'lessons'));
  mkdirSync(join(ws, 'labs'));
  writeFileSync(join(ws, 'labs', 'labs.json'), '{"version":1,"labs":{}}');
  const html = '<section data-block="lab" data-lab="constructor"><p>Instructions</p></section>';
  writeFileSync(join(ws, 'lessons', '0001-lab.html'), html);
  const { status, body } = serveFile(ws, '/lessons/0001-lab.html');
  assert.deepEqual({ status, body }, { status: 200, body: html });
});

test('serveFile refuses a request for an allowlisted folder path occupied by a regular file', (t) => {
  const ws = workspace(t);
  writeFileSync(join(ws, 'lessons'), 'Regular file named lessons');
  assert.deepEqual(serveFile(ws, '/lessons'), { status: 404 });
});

test('navHtml escapes the next page title', () => {
  const index = { pages: [
    { id: '0001-start', path: '/lessons/0001-start.html', title: 'Start' },
    { id: 'next', path: '/reference/next.html', title: 'A < B & "C"' },
  ] };
  assert.match(navHtml(index, '0001-start'), /<a class="lesson-nav-next" href="\/reference\/next\.html">A &lt; B &amp; &quot;C&quot; &#8594;<\/a>/);
});

test('navHtml escapes the href of a previous page link', () => {
  const index = { pages: [
    { id: 'previous', path: '/reference/a&"b".html', title: 'Previous' },
    { id: '0001-start', path: '/lessons/0001-start.html', title: 'Start' },
  ] };
  assert.match(navHtml(index, '0001-start'), /<a class="lesson-nav-prev" href="\/reference\/a&amp;&quot;b&quot;\.html">&#8592; Previous<\/a>/);
});
