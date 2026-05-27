import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, makeId, normalizeUrl, sha256 } from '../bin/lib/ids.mjs';

test('slugify lowercases, kebab-cases, drops stopwords, caps 6 words', () => {
  assert.equal(slugify('The Quick Brown Fox Jumps Over A Lazy Dog'), 'quick-brown-fox-jumps-over-lazy');
});
test('makeId prefixes date', () => {
  assert.equal(makeId('2026-05-27', 'Effective Go'), '2026-05-27-effective-go');
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
