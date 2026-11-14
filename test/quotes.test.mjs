import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpVault, put } from './helpers.mjs';
import { checkQuotes } from '../bin/lib/quotes.mjs';
import { applyVerification, run as verifyRun } from '../bin/commands/verify.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { sha256 } from '../bin/lib/ids.mjs';

const NOW = { now: '2026-06-12', repoRoot: process.cwd() };
const ID = '2026-01-01-page';
const BODY = `# ${ID}\n\nThe flag reads one file — and it’s “stable” today.\nA sentence that begins on this line and\nends on the next one here.\nRepeat me here please.\nRepeat me here please.\nx\nRepeat me here please.\n${'Filler line of stored text. '.repeat(8)}\n`;
const seed = [{ date: '2026-01-01', by_type: 'agent', by_id: '', method: 'captured', result: 'confirmed', notes: '' }];
const src = (dir, body) => put(dir, 'source', ID, { source_type: 'article', source_url: 'https://example.org/p', content_hash: 'sha256:old', verifications: seed }, body);
const entry = dir => readEntry(join(dir, 'sources', `${ID}.md`));
const matched = dir => entry(dir).data.verifications.filter(v => v.method === 'quote-matched');
const page = html => async () => { const body = Buffer.from(html); return { status: 200, hash: sha256(body), body }; };

test('verify --quotes: a quote on one line of a stored body adds one inconclusive row with its line and body hash, and a second call adds none', async () => {
  const dir = tmpVault(); src(dir, BODY);
  const q = 'The `flag` reads one file - and it\'s "stable"   today.'; // code marks, straight marks, a plain dash, extra white space
  const [r] = await checkQuotes(dir, ID, [{ n: 7, quote: q }], NOW);
  assert.deepEqual({ n: r.n, found: r.found, foundIn: r.foundIn, lines: r.lines, rowAdded: r.rowAdded }, { n: 7, found: true, foundIn: 'body', lines: [3], rowAdded: true });
  assert.match(r.context, /The flag reads one file/);
  const rows = matched(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'inconclusive');
  assert.match(rows[0].notes, /^[0-9a-f]{8} L3@[0-9a-f]{8}: The flag reads one file - and it's "stable" today\.$/);
  assert.equal(entry(dir).data.updated, undefined, 'an inconclusive row does not reset freshness');
  const [again] = await checkQuotes(dir, ID, [q], NOW);
  assert.equal(again.found, true);
  assert.equal(again.rowAdded, false);
  assert.equal(matched(dir).length, 1, 'a repeated run adds no second row');
  assert.equal(entry(dir).body, BODY, 'the body is unchanged');
});

test('verify --quotes: a quote over two lines is not found, a short quote is refused, and a quote on three lines reports all three', async () => {
  const dir = tmpVault(); src(dir, BODY);
  const [two, short, three] = await checkQuotes(dir, ID, ['A sentence that begins on this line and ends on the next one here.', 'Repeat me', 'Repeat me here please.'], NOW);
  assert.equal(two.found, false);
  assert.match(two.reason, /not on any one line of the stored text/);
  assert.equal(short.refused, true);
  assert.deepEqual(three.lines, [6, 7, 9]);
  assert.equal(three.occurrences, 3);
  assert.equal(matched(dir).length, 1);
});

test('verify --quotes: a quote absent from the stored body and present on the fetched page is found on the page, with the body and hash unchanged', async () => {
  const dir = tmpVault(); src(dir, BODY);
  const [r] = await checkQuotes(dir, ID, ['Only the live page holds this sentence.'], { ...NOW, fetch: page('<p>Only the live page holds this sentence.</p>') });
  assert.equal(r.found, true);
  assert.equal(r.foundIn, 'page');
  const e = entry(dir);
  assert.equal(e.body, BODY);
  assert.equal(e.data.content_hash, 'sha256:old');
  assert.match(matched(dir)[0].notes, /^[0-9a-f]{8}: Only the live page/, 'no line or body hash for a quote found on the page');
  assert.equal(matched(dir)[0].result, 'confirmed');
});

test('verify --quotes: with no stored body the page is fetched and the row is confirmed; without the network the command refuses', async () => {
  const dir = tmpVault(); src(dir);
  await assert.rejects(checkQuotes(dir, ID, ['The page says this whole sentence.'], NOW), /RESEARCH_VAULT_ALLOW_NETWORK=1/);
  let calls = 0;
  const fetch = async (...a) => { calls++; return page('<p>The page says this whole sentence.</p><p>And this is another whole sentence.</p>')(...a); };
  const out = await checkQuotes(dir, ID, ['The page says this whole sentence.', 'And this is another whole sentence.', 'This sentence is on no page at all.'], { ...NOW, fetch });
  assert.deepEqual(out.map(r => r.found), [true, true, false]);
  assert.equal(calls, 1, 'the page is fetched once');
  assert.deepEqual(matched(dir).map(v => v.result), ['confirmed', 'confirmed']);
  const e = entry(dir);
  assert.equal(e.data.updated, '2026-06-12');
  assert.equal(e.body, `# ${ID}\n`, 'nothing is stored');
  const down = await checkQuotes(dir, ID, ['A third sentence nobody has checked.'], { ...NOW, fetch: async () => ({ status: 503 }) });
  assert.match(down[0].reason, /page unreachable: http 503/);
});

test('verify --quotes: the method cannot be given by hand, a non-source is refused, and the command prints one JSON array', async () => {
  const dir = tmpVault(); src(dir, BODY);
  put(dir, 'note', '2026-01-01-n', { sources: [ID] });
  assert.throws(() => applyVerification(dir, { id: ID, method: 'quote-matched', result: 'confirmed', ...NOW }), /written by verify --quotes/);
  await assert.rejects(checkQuotes(dir, '2026-01-01-n', ['Repeat me here please.'], NOW), /not a source entry/);
  const file = join(dir, 'q.json');
  writeFileSync(file, JSON.stringify(['Repeat me here please.']));
  const written = [];
  const orig = process.stdout.write;
  process.stdout.write = s => { written.push(s); return true; };
  try { assert.equal(await verifyRun({ vault: dir, id: ID, quotes: file, 'by-id': 'research-orchestrate' }), 0); } finally { process.stdout.write = orig; }
  assert.equal(JSON.parse(written.join(''))[0].found, true);
  assert.equal(matched(dir)[0].by_id, 'research-orchestrate');
  assert.ok(readFileSync(join(dir, '.vault-manifest.json'), 'utf8').includes(ID));
});
