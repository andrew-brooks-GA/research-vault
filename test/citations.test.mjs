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

import { extractCitationsDetailed } from '../bin/lib/citations.mjs';

test('a URL in a fenced block is skipped and a URL in prose on the next line is kept', () => {
  const text = '```bash\ncurl https://in.code/fence\n```\nsee https://in.prose/next\n~~~\nhttps://in.code/tilde\n~~~\n';
  const { citations, skipped } = extractCitationsDetailed(text);
  assert.deepEqual(citations, [{ type: 'url', value: 'https://in.prose/next' }]);
  assert.deepEqual(skipped, [
    { type: 'url', value: 'https://in.code/fence' },
    { type: 'url', value: 'https://in.code/tilde' },
  ]);
  assert.deepEqual(extractCitations(text), citations);
});

test('an inline code span URL is skipped, single or double backticks', () => {
  const { citations, skipped } = extractCitationsDetailed('run `curl https://a/one` or ``x ` https://a/two`` then read https://a/three');
  assert.deepEqual(citations, [{ type: 'url', value: 'https://a/three' }]);
  assert.deepEqual(skipped, [{ type: 'url', value: 'https://a/one' }, { type: 'url', value: 'https://a/two' }]);
});

test('a markdown link URL is kept, not skipped', () => {
  const { citations, skipped } = extractCitationsDetailed('see [x](https://a/b) and `https://c/d`');
  assert.deepEqual(citations, [{ type: 'url', value: 'https://a/b' }]);
  assert.deepEqual(skipped, [{ type: 'url', value: 'https://c/d' }]);
});

test('a bare URL followed by a stray backtick is trimmed', () => {
  assert.deepEqual(extractCitations('at https://a/b` here'), [{ type: 'url', value: 'https://a/b' }]);
  assert.notDeepEqual(extractCitations('at https://a/b` here'), [{ type: 'url', value: 'https://a/b`' }]);
});

test('an id inside backticks is skipped while the same id in prose is kept', () => {
  const inCode = extractCitationsDetailed('the file `2026-01-02-foo-bar` only');
  assert.deepEqual(inCode.citations, []);
  assert.deepEqual(inCode.skipped, [{ type: 'id', value: '2026-01-02-foo-bar' }]);
  const both = extractCitationsDetailed('per 2026-01-02-foo-bar, file `2026-01-02-foo-bar`');
  assert.deepEqual(both.citations, [{ type: 'id', value: '2026-01-02-foo-bar' }]);
  assert.deepEqual(both.skipped, [], 'an id also cited in prose is not reported as skipped');
});

test('an inline code span stays within one line, so a stray backtick does not swallow list items', () => {
  const list = extractCitationsDetailed('- use the ` flag\n- see https://a/listed\n- run `foo`\n');
  assert.deepEqual(list.citations, [{ type: 'url', value: 'https://a/listed' }]);
  assert.deepEqual(list.skipped, []);
  const sameLine = extractCitationsDetailed('- run `curl https://a/inline` now\n');
  assert.deepEqual(sameLine.citations, []);
  assert.deepEqual(sameLine.skipped, [{ type: 'url', value: 'https://a/inline' }]);
});

test('URLs and ids inside HTML <pre> and <code> elements are code, not citations', () => {
  const html = '<p>See <a data-cite="2026-01-01-fx-doc">2026-01-01-fx-doc</a>.</p>\n' +
    '<pre><code>$ kubectl --server https://127.0.0.1:8443 get ns\nserver: https://localhost:8443</code></pre>\n' +
    '<p>Also <code>https://example.org/in-code</code> and <code class="x">2026-02-02-in-code</code>.</p>';
  const { citations, skipped } = extractCitationsDetailed(html);
  assert.deepEqual(citations, [{ type: 'id', value: '2026-01-01-fx-doc' }]);
  assert.deepEqual(skipped.map((s) => s.value).sort(), ['2026-02-02-in-code', 'https://127.0.0.1:8443', 'https://example.org/in-code', 'https://localhost:8443']);
});

test('a markdown image URL is a picture, not a citation, and is not reported as skipped either', () => {
  const text = [
    '![CI](https://github.com/x/y/actions/workflows/ci.yml/badge.svg)',
    '![License](https://img.shields.io/badge/license-MIT-blue.svg "MIT")',
    'See [the docs](https://example.org/docs) and 2026-01-01-some-entry.',
  ].join('\n');
  const { citations, skipped } = extractCitationsDetailed(text);
  assert.deepEqual(citations, [{ type: 'url', value: 'https://example.org/docs' }, { type: 'id', value: '2026-01-01-some-entry' }]);
  assert.deepEqual(skipped, []);
});
