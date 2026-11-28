import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, tmpVault, put } from './helpers.mjs';
import { checkQuotes } from '../bin/lib/quotes.mjs';
import { applyVerification, run as verifyRun } from '../bin/commands/verify.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { sha256Tagged } from '../bin/lib/hash.ts';
import { writeBlocklist } from './blocklist.test.mjs';

const NOW = { now: '2026-06-12', repoRoot: REPO_ROOT };
const ID = '2026-01-01-page';
const BODY = `# ${ID}\n\nThe flag reads one file — and it’s “stable” today.\nA sentence that begins on this line and\nends on the next one here.\nRepeat me here please.\nRepeat me here please.\nx\nRepeat me here please.\n${'Filler line of stored text. '.repeat(8)}\n`;
const seed = [{ date: '2026-01-01', by_type: 'agent', by_id: '', method: 'captured', result: 'confirmed', notes: '' }];
const src = (dir, body) => put(dir, 'source', ID, { source_type: 'article', source_url: 'https://example.org/p', content_hash: 'sha256:old', verifications: seed }, body);
const entry = dir => readEntry(join(dir, 'sources', `${ID}.md`));
const matched = dir => entry(dir).data.verifications.filter(v => v.method === 'quote-matched');
const page = html => async () => { const body = Buffer.from(html); return { status: 200, hash: sha256Tagged(body), body }; };

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

test('verify --quotes: a quote over two lines is found with its first line in the row, a short quote is refused, and a quote on three lines reports all three', async () => {
  const dir = tmpVault(); src(dir, BODY);
  const [two, short, three] = await checkQuotes(dir, ID, ['A sentence that begins on this line and ends on the next one here.', 'Repeat me', 'Repeat me here please.'], NOW);
  assert.deepEqual([two.found, two.foundIn, two.lines, two.occurrences], [true, 'body', [4], 1]);
  assert.match(two.context, /A sentence that begins on this line and \/ ends on the next one here\. \/ Repeat me here please\. \/ Repeat me here please\./);
  assert.equal(short.refused, true);
  assert.deepEqual(three.lines, [6, 7, 9]);
  assert.equal(three.occurrences, 3);
  const rows = matched(dir);
  assert.equal(rows.length, 2);
  assert.match(rows[0].notes, /^[0-9a-f]{8} L4@[0-9a-f]{8}: A sentence that begins on this line and ends on the next one here\.$/);
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

// Issue 77: a quote may run over adjacent lines with no blank line between them.
test('verify --quotes: a quote over adjacent lines is found in a body and on a page; one across a blank line or over block quote marks is not; a body of 15,000 lines with no blank line is checked in under two seconds', async () => {
  const dir = tmpVault();
  src(dir, `# ${ID}\n\n## Install\nRun the installer with the flag set.\n\n- never commit secrets to\n- the repo should be public\n\nThe last line of one paragraph ends here.\n\nThe first line of the next paragraph starts here.\n\n> A quoted paragraph whose sentence is long enough that the file wraps it\n> onto a second line with its own mark.\n\n${'Filler line of stored text. '.repeat(8)}\n`);
  const [head, items, blank, marks] = await checkQuotes(dir, ID, [
    'Install Run the installer with the flag set.',
    'never commit secrets to - the repo should be public',
    'The last line of one paragraph ends here. The first line of the next paragraph starts here.',
    'A quoted paragraph whose sentence is long enough that the file wraps it onto a second line with its own mark.',
  ], NOW);
  assert.deepEqual([head.found, head.lines], [true, [3]], 'a heading and the text under it are adjacent lines');
  assert.deepEqual([items.found, items.lines], [true, [6]], 'two list items are adjacent lines');
  assert.equal(blank.found, false);
  assert.match(blank.reason, /not on one line or over adjacent lines of the stored text/);
  assert.equal(marks.found, false);
  const [onPage] = await checkQuotes(dir, ID, ['Only the live page holds this sentence, and its source breaks it here.'], { ...NOW, fetch: page('Only the live page holds this sentence,\nand its source breaks it here.\n') });
  assert.deepEqual([onPage.found, onPage.foundIn, onPage.lines], [true, 'page', [1]]);
  assert.equal(matched(dir).at(-1).result, 'confirmed');
  const big = tmpVault(); src(big, 'ab ab ab ab ab ab ab\n'.repeat(15000));
  const t0 = performance.now();
  const many = await checkQuotes(big, ID, Array.from({ length: 16 }, (_, i) => 'ab '.repeat(20 + i).trim()), NOW);
  assert.equal(many.filter(r => r.found).length, 16);
  assert.ok(performance.now() - t0 < 2000, 'sixteen quotes on 15,000 lines with no blank line take under two seconds');
});

// Issue 77: a line is joined with as many next lines as the quote needs past the line's own length, so a quote
// that starts late in a line longer than the quote, and runs onto the next line, is found.
test('verify --quotes: a quote that starts late in a long line and ends on the next line is found at the long line', async () => {
  const dir = tmpVault();
  src(dir, `# ${ID}\n\n${'Filler words of a long opening line. '.repeat(4)}The quoted sentence starts here\nand ends on the next line.\n`);
  const [r] = await checkQuotes(dir, ID, ['The quoted sentence starts here and ends on the next line.'], NOW);
  assert.deepEqual([r.found, r.lines], [true, [3]]);
});

// S-11: the context shows page text to the agent on one line, with no control, zero-width or bidi character.
test('verify --quotes context: lines around a quote are shown on one line with hidden characters removed', async () => {
  const dir = tmpVault();
  src(dir, `# ${ID}\n\nBefore\u202e hidden\u200b text\u0007 here.\nThe quoted sentence sits on this line.\nAfter\u2028line\u0085two.\n\n${'Filler line of stored text. '.repeat(8)}\n`);
  const [r] = await checkQuotes(dir, ID, ['The quoted sentence sits on this line.'], NOW);
  assert.equal(r.found, true);
  assert.equal(r.context, 'Before hidden text here. / The quoted sentence sits on this line. / After line two.');
});

// Tag characters spelling "ignore", and the same characters as a URL holds them percent-encoded.
const TAGS = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';
const TAGS_URL = '%F3%A0%80%81%F3%A0%81%A9%F3%A0%81%A7%F3%A0%81%AE%F3%A0%81%AF%F3%A0%81%B2%F3%A0%81%A5%F3%A0%81%BF';

// The URL parser drops a line break and percent-encodes a tag character, so a url row written with them
// still matches the source; the reason quotes the pattern as the row holds it.
test('verify --quotes reason: a blocked-source pattern is shown on one line with no hidden characters', async () => {
  const dir = tmpVault();
  put(dir, 'source', ID, { source_type: 'article', source_url: `https://example.org/pb${TAGS_URL}/x`, verifications: seed });
  writeBlocklist(dir, [{ pattern: `https://example.org/p\nb${TAGS}`, scope: 'url', reason: 'farm', added: '2026-11-02' }]);
  let calls = 0;
  const [r] = await checkQuotes(dir, ID, ['The page says this whole sentence.'], { ...NOW, fetch: async () => { calls++; return { status: 200 }; } });
  assert.equal(r.reason, 'blocked source: https://example.org/p b');
  assert.equal(calls, 0, 'a blocked page is not fetched');
});

test('verify --quotes reason: a page-unreachable message is shown on one line with no hidden characters', async () => {
  const dir = tmpVault(); src(dir);
  const fetch = async () => { throw new Error(`socket closed\nresearch-vault: forged${TAGS}`); };
  const [r] = await checkQuotes(dir, ID, ['The page says this whole sentence.'], { ...NOW, fetch });
  assert.equal(r.reason, 'page unreachable: socket closed research-vault: forged');
});

test('verify --quotes context: the lines around a quote are cut at 900 characters with a mark', async () => {
  const dir = tmpVault();
  src(dir, `# ${ID}\n\nThe quoted sentence sits on this line. ${'y'.repeat(1000)}\n`);
  const [r] = await checkQuotes(dir, ID, ['The quoted sentence sits on this line.'], NOW);
  assert.equal(r.found, true);
  assert.equal(r.context, `# ${ID} / The quoted sentence sits on this line. ${'y'.repeat(840)}\u2026`);
});
