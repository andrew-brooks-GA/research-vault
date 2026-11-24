import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, makeId, normalizeUrl, sha256 } from '../bin/lib/ids.mjs';

test('slugify lowercases, kebab-cases, drops stopwords, caps 6 words', () => {
  assert.equal(slugify('The Quick Brown Fox Jumps Over A Lazy Dog'), 'quick-brown-fox-jumps-over-lazy');
});
test('makeId prefixes date', () => {
  assert.equal(makeId('2026-05-27', 'Effective Go'), '2026-05-27-effective-go');
});
// R-57: the hex is the first 8 characters of `printf '%s' <title> | shasum -a 256`, computed outside the code.
test('makeId gives t- and a title hash only when no ASCII word is left', () => {
  assert.equal(makeId('2026-11-24', '日本語のタイトル'), '2026-11-24-t-348774f3');
  assert.equal(makeId('2026-11-24', 'The Of And'), '2026-11-24-t-a6b92725');
  assert.equal(makeId('2026-11-24', 'The Effective Go'), '2026-11-24-effective-go');
});
test('normalizeUrl strips tracking params, trailing slash, lowercases scheme/host', () => {
  assert.equal(
    normalizeUrl('HTTPS://Go.dev/doc/effective_go/?utm_source=x&ref=y'),
    'https://go.dev/doc/effective_go');
});
test('sha256 is stable', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
});
