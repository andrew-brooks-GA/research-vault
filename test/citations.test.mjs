import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations } from '../bin/lib/citations.mjs';

test('extracts the URL from a markdown link', () => {
  const c = extractCitations('see [Vulkan tutorial](https://docs.vulkan.org/tutorial/latest/x.html) here');
  assert.deepEqual(c, [{ type: 'url', value: 'https://docs.vulkan.org/tutorial/latest/x.html' }]);
});

test('extracts a bare URL and trims trailing sentence punctuation', () => {
  const c = extractCitations('available at https://example.com/sdk/home.');
  assert.deepEqual(c, [{ type: 'url', value: 'https://example.com/sdk/home' }]);
});

test('extracts a date-prefixed vault id from a wikilink and inline', () => {
  const c = extractCitations('per [[2026-05-28-kubernetes-apf-concept-docs]] and also 2026-01-02-foo-bar');
  assert.deepEqual(c, [
    { type: 'id', value: '2026-05-28-kubernetes-apf-concept-docs' },
    { type: 'id', value: '2026-01-02-foo-bar' },
  ]);
});

test('ignores wikilinks that are not date-prefixed ids', () => {
  assert.deepEqual(extractCitations('a [[Rendering-API-Decision]] cross-reference'), []);
});

test('dedups repeated citations', () => {
  const c = extractCitations('https://x.com/a and again https://x.com/a');
  assert.deepEqual(c, [{ type: 'url', value: 'https://x.com/a' }]);
});

test('returns empty for prose with no citations', () => {
  assert.deepEqual(extractCitations('just some ordinary prose, no links.'), []);
});
