import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { REPO_ROOT, tmpVault, put } from './helpers.mjs';
import { fillSource } from '../bin/lib/fill.mjs';
import { htmlToText, mdToText, extractText } from '../bin/lib/extract.mjs';
import { fetchSource, rawFileUrl } from '../bin/lib/fetchsource.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { evidenceFor } from '../bin/lib/gate.mjs';
import { sha256 } from '../bin/lib/ids.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';

const NOW = { now: '2026-06-12', ackDataEgress: true };
const SENT = 'The fixture page says the flag reads <code>one</code> file &mdash; and it&rsquo;s stable. ';
const PAGE = Buffer.from(`<html><head><title>T</title><script>var x = "<p>no</p>";</script></head><body><p>${SENT.repeat(4)}</p><pre>a\n  b</pre></body></html>`);
const page = (body = PAGE) => async () => ({ status: 200, hash: sha256(body), body });
const src = (dir, id, extra = {}, body) => put(dir, 'source', id, { source_type: 'article', source_url: 'https://example.org/p', ...extra }, body);
const entry = (dir, id) => readEntry(join(dir, 'sources', `${id}.md`));
const raw = (dir, id) => readFileSync(join(dir, 'sources', `${id}.md`), 'utf8');

test('extract: a sentence over a code element is one line, pre is kept, entities are decoded, script is dropped, gzip and charset are read', () => {
  const text = extractText(PAGE);
  assert.ok(text.split('\n').some(l => l.includes('the flag reads one file — and it’s stable.')), text);
  assert.ok(text.includes('a\n  b'), 'pre keeps its lines');
  assert.ok(!text.includes('no'), 'script is dropped');
  assert.equal(extractText(gzipSync(PAGE)), text);
  assert.equal(extractText(Buffer.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x22, 0x6c, 0x61, 0x74, 0x69, 0x6e, 0x31, 0x22, 0x3e, 0x3c, 0x70, 0x3e, 0x63, 0x61, 0x66, 0xe9])).trim(), 'café');
  assert.equal(extractText(Buffer.from([1, 0, 2])), null, 'binary gives no text');
  assert.equal(htmlToText('<p>a &#x41; &#0; &bogus;</p>'), 'a A &#0; &bogus;\n');
});

test('extract: the constructor entity is left as text', () => {
  assert.equal(htmlToText('&constructor;'), '&constructor;\n');
});

test('extract: amp decodes in lower, upper and mixed case', () => {
  assert.equal(htmlToText('&amp; &AMP; &Amp;'), '& & &\n');
});

test('extract: a decimal character reference decodes', () => {
  assert.equal(htmlToText('&#38;'), '&\n');
});

test('extract: a hexadecimal character reference with uppercase X decodes', () => {
  assert.equal(htmlToText('&#X26;'), '&\n');
});

test('extract: an out-of-range character reference is left as text', () => {
  assert.equal(htmlToText('&#x110000;'), '&#x110000;\n');
});

test('extract: Markdown is stored as a reader sees it, and only for a .md path', () => {
  const line = '* \\[[`f69ed4bc3f`](https://github.com/n/n/commit/f69)] - **crypto**: rename _one_ `content_hash` (A B) [#61875](https://github.com/n/n/pull/61875)';
  assert.equal(mdToText(line), '* [f69ed4bc3f] - crypto: rename one content_hash (A B) #61875');
  assert.equal(mdToText('a * b and 2 \\* 3'), 'a * b and 2 * 3');
  assert.equal(extractText(Buffer.from(line), '/x/README.md'), mdToText(line));
  assert.equal(extractText(Buffer.from(line), '/x/notes.txt'), line);
});

test('fetchSource: a file view on a code host is read as the raw file, and the result names the address read', async () => {
  assert.equal(rawFileUrl('https://github.com/o/r/blob/feature/x/doc/A.md?plain=1#L3'), 'https://raw.githubusercontent.com/o/r/feature/x/doc/A.md');
  assert.equal(rawFileUrl('https://github.com/o/r/tree/main/doc'), 'https://github.com/o/r/tree/main/doc');
  let asked;
  const request = (opts, cb) => {
    asked = opts;
    const req = new EventEmitter(); req.end = () => {}; req.destroy = () => {};
    const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; res.resume = () => {};
    process.nextTick(() => { cb(res); res.emit('data', Buffer.from('x')); res.emit('end'); });
    return req;
  };
  const r = await fetchSource('https://github.com/o/r/blob/main/A.md', { request, lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal(asked.hostname, 'raw.githubusercontent.com');
  assert.equal(asked.path, '/o/r/main/A.md');
  assert.equal(r.url, 'https://raw.githubusercontent.com/o/r/main/A.md');
});

test('fill: filled stores the text, the bytes\' hash and one row that does not reset freshness; the address is unchanged', async () => {
  const dir = tmpVault();
  const id = src(dir, '2026-01-01-a', { content_hash: 'sha256:old' });
  const before = buildManifest(dir).entries.find(e => e.id === id).last_verified;
  const r = await fillSource(dir, id, { ...NOW, fetch: async () => ({ status: 200, hash: sha256(PAGE), body: PAGE, url: 'https://raw.example.org/p' }) });
  assert.equal(r.result, 'filled');
  assert.equal(r.fetchedFrom, 'https://raw.example.org/p');
  const e = entry(dir, id);
  assert.ok(e.body.startsWith(`# ${id}\n\n`) && e.body.includes('it’s stable.'));
  assert.equal(e.data.content_hash, sha256(PAGE));
  assert.equal(e.data.source_url, 'https://example.org/p');
  assert.equal(e.data.updated, '2026-06-12');
  const row = e.data.verifications.at(-1);
  assert.deepEqual([row.method, row.result], ['refetched-source', 'inconclusive']);
  assert.match(row.notes, /^filled: 2026-06-12, \d+ bytes of text, content_hash was sha256:old, read from https:\/\/raw\.example\.org\/p$/);
  assert.equal(buildManifest(dir).entries.find(x => x.id === id).last_verified, before);
  assert.equal(evidenceFor(join(dir, 'sources', `${id}.md`), dir, { extra: [id] }).entries.find(x => x.id === id).noBody, false);
  assert.equal(lintVault(dir, REPO_ROOT).violations.length, 0);
});

test('fill: kept leaves the entry byte-identical, and every refusal and failure leaves it too', async () => {
  const dir = tmpVault();
  const long = `# t\n\n${'Two hundred characters of text or more. '.repeat(6)}\n`;
  const same = async (id, opts, result) => {
    const was = raw(dir, id);
    assert.equal((await fillSource(dir, id, { ...NOW, fetch: page(), ...opts })).result, result, id);
    assert.equal(raw(dir, id), was, `${id} unchanged`);
  };
  await same(src(dir, '2026-01-01-kept', {}, long), {}, 'kept');
  await same(src(dir, '2026-01-01-notfill', {}, long), { replace: true }, 'refused');
  await same(src(dir, '2026-01-01-gone', { status: 'superseded', superseded_by: '2026-01-01-kept' }), {}, 'refused');
  await same(src(dir, '2026-01-01-http', { source_url: 'http://example.org/p' }), {}, 'refused');
  await same(src(dir, '2026-01-01-float', { source_url: 'https://example.org/docs/Latest/p', subject: { name: 'x', version: '1.2' } }), {}, 'version-floating');
  await same(src(dir, '2026-01-01-404'), { fetch: async () => ({ status: 404, hash: 'h', body: Buffer.from('') }) }, 'unreachable');
  await same(src(dir, '2026-01-01-throw'), { fetch: async () => { throw new Error('boom'); } }, 'unreachable');
  await same(src(dir, '2026-01-01-bin'), { fetch: page(Buffer.from([1, 0, 2])) }, 'no-text');
  await same(src(dir, '2026-01-01-short'), { fetch: page(Buffer.from('short')) }, 'no-text');
  await same(src(dir, '2026-01-01-big'), { fetch: page(Buffer.from('x '.repeat(160000))) }, 'too-large');
  put(dir, 'note', '2026-01-01-note', { sources: ['2026-01-01-kept'], confidence: 'medium' });
  assert.equal((await fillSource(dir, '2026-01-01-note', NOW)).result, 'refused');
  mkdirSync(join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, 'meta', 'source-blocklist.json'), JSON.stringify([{ pattern: 'raw.githubusercontent.com', scope: 'domain', reason: 'test' }]));
  await same(src(dir, '2026-01-01-blocked', { source_url: 'https://github.com/o/r/blob/main/A.md' }), {}, 'refused');
  await assert.rejects(fillSource(dir, src(dir, '2026-01-01-noack'), { now: NOW.now, fetch: page() }), /ack-data-egress/);
  await assert.rejects(fillSource(dir, '2026-01-01-noack', NOW), /RESEARCH_VAULT_ALLOW_NETWORK/);
});

test('fill: --replace refills what a fill wrote and keeps the first hash; --discard restores it, writes its row and refuses twice', async () => {
  const dir = tmpVault();
  const id = src(dir, '2026-01-01-a', { content_hash: 'sha256:old' });
  await fillSource(dir, id, { ...NOW, fetch: page() });
  const second = Buffer.from(`<html><body><p>${'Another page of text altogether, long enough. '.repeat(6)}</p></body></html>`);
  assert.equal((await fillSource(dir, id, { ...NOW, fetch: page(second) })).result, 'kept');
  assert.equal((await fillSource(dir, id, { ...NOW, fetch: page(second), replace: true })).result, 'filled');
  let e = entry(dir, id);
  assert.ok(e.body.includes('Another page'));
  assert.equal(e.data.content_hash, sha256(second));
  assert.match(e.data.verifications.at(-1).notes, /content_hash was sha256:old/);
  assert.equal((await fillSource(dir, id, { now: NOW.now, discard: true })).result, 'discarded');
  e = entry(dir, id);
  assert.equal(e.body, `# ${id}\n`);
  assert.equal(e.data.content_hash, 'sha256:old');
  const row = e.data.verifications.at(-1);
  assert.deepEqual([row.method, row.result], ['human-spot-check', 'inconclusive']);
  assert.match(row.notes, /^discarded: /);
  assert.equal((await fillSource(dir, id, { now: NOW.now, discard: true })).result, 'refused');
  const bare = src(dir, '2026-01-01-b');
  await fillSource(dir, bare, { ...NOW, fetch: page() });
  await fillSource(dir, bare, { now: NOW.now, discard: true });
  assert.equal(entry(dir, bare).data.content_hash, undefined, 'a hash the fill set is removed');
  assert.equal(lintVault(dir, REPO_ROOT).violations.length, 0);
});

test('fill: --content-file stores extracted text, leaves content_hash alone, refuses other file types, and discard leaves the hash', async () => {
  const dir = tmpVault();
  const id = src(dir, '2026-01-01-a', { content_hash: 'sha256:old' });
  const file = join(tmpVault('rv-file-'), 'saved.html');
  writeFileSync(file, PAGE);
  writeFileSync(file.replace('.html', '.env'), SENT.repeat(4));
  assert.equal((await fillSource(dir, id, { ...NOW, contentFile: file.replace('.html', '.env') })).result, 'refused');
  assert.equal((await fillSource(dir, id, { ...NOW, contentFile: file })).result, 'filled');
  let e = entry(dir, id);
  assert.ok(e.body.includes('it’s stable.'));
  assert.equal(e.data.content_hash, 'sha256:old');
  const row = e.data.verifications.at(-1);
  assert.equal(row.method, 'human-spot-check');
  assert.equal(row.notes, `filled-from-file: saved.html, ${sha256(PAGE)}, ${Buffer.byteLength(extractText(PAGE).trim())} bytes of text`);
  assert.equal((await fillSource(dir, id, { now: NOW.now, discard: true })).result, 'discarded');
  assert.equal(entry(dir, id).data.content_hash, 'sha256:old');
});

test('fill: a fill that names the address it read is undone exactly, through --replace and --discard', async () => {
  const dir = tmpVault();
  const id = src(dir, '2026-01-01-a', { content_hash: 'sha256:old', source_url: 'https://github.com/o/r/blob/main/a content_hash was sha256:evil' });
  const read = async (url) => ({ status: 200, hash: sha256(PAGE), body: PAGE, url: 'https://raw.example.org/a%20content_hash%20was%20sha256:evil' });
  await fillSource(dir, id, { ...NOW, fetch: read });
  await fillSource(dir, id, { ...NOW, fetch: read, replace: true });
  assert.match(entry(dir, id).data.verifications.at(-1).notes, /content_hash was sha256:old, read from/);
  await fillSource(dir, id, { now: NOW.now, discard: true });
  assert.equal(entry(dir, id).data.content_hash, 'sha256:old');
  const none = src(dir, '2026-01-01-b');
  await fillSource(dir, none, { ...NOW, fetch: read });
  await fillSource(dir, none, { now: NOW.now, discard: true });
  assert.equal(entry(dir, none).data.content_hash, undefined);
});

test('fill: an id that is not an entry id, a non-source and an untouched entry are refused; a blocklisted redirect or saved copy stores nothing', async () => {
  const dir = tmpVault();
  put(dir, 'note', '2026-01-01-n', { sources: [], confidence: 'medium' });
  const file = join(tmpVault('rv-file-'), 'saved.html');
  writeFileSync(file, PAGE);
  const note = readFileSync(join(dir, 'notes', '2026-01-01-n.md'), 'utf8');
  for (const id of ['../notes/2026-01-01-n', '..', 'a/b', ''])
    assert.equal((await fillSource(dir, id, { ...NOW, contentFile: file })).result, 'refused', id);
  assert.equal(readFileSync(join(dir, 'notes', '2026-01-01-n.md'), 'utf8'), note);
  assert.equal((await fillSource(dir, src(dir, '2026-01-01-a'), { now: NOW.now, discard: true })).result, 'refused');
  mkdirSync(join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, 'meta', 'source-blocklist.json'), JSON.stringify([{ pattern: 'bad.example.org', scope: 'domain', reason: 'test' }]));
  assert.equal((await fillSource(dir, '2026-01-01-a', { ...NOW, fetch: async () => ({ status: 200, hash: 'h', body: PAGE, url: 'https://bad.example.org/x' }) })).result, 'refused');
  const bad = src(dir, '2026-01-01-bad', { source_url: 'https://bad.example.org/p' });
  assert.equal((await fillSource(dir, bad, { ...NOW, contentFile: file })).result, 'refused');
  assert.equal(entry(dir, '2026-01-01-a').body, '# 2026-01-01-a\n');
});

test('extract: a file view outside its repo is not rewritten, a gzip bomb gives no text, and hostile input stays fast', () => {
  assert.equal(rawFileUrl('https://github.com/o/r/blob/main/../../../evil/repo/main/x'), 'https://github.com/o/r/blob/main/../../../evil/repo/main/x');
  assert.equal(rawFileUrl('https://github.com/o/r/blob/main/a/%2e%2e/b.md'), 'https://raw.githubusercontent.com/o/r/main/b.md');
  assert.equal(rawFileUrl('https://user@github.com/o/r/blob/main/a.md'), 'https://user@github.com/o/r/blob/main/a.md');
  assert.equal(extractText(gzipSync(Buffer.alloc(40 * 1024 * 1024, 32))), null);
  assert.equal(htmlToText('<p>kept</p><script>var x = 1;'), 'kept\n', 'an unclosed script is not text');
  const n = 400000, t0 = performance.now();
  for (const s of ['<', '<!--', '<script ', '<pre ', '<p ', '&a']) htmlToText(`<html><p>x</p>${s.repeat(n)}`);
  mdToText('['.repeat(n));
  assert.ok(performance.now() - t0 < 10000, `hostile input took ${Math.round(performance.now() - t0)} ms`);
});
