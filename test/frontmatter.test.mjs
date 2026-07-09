import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter } from '../bin/lib/frontmatter.mjs';

const sample = `---
title: "Effective Go"
type: source
created: 2026-05-06
topics: [go, errors]
related: []
verifications:
  - date: 2026-05-06
    by_type: agent
    by_id: claude-opus-4-7
    method: refetched-source
    result: confirmed
    notes: "hash unchanged"
subject:
  name: vcluster
  version: "0.19"
---
# Body
text here
`;

test('parses scalars, flow lists, block-map sequences, nested map', () => {
  const { data, body } = parseFrontmatter(sample);
  assert.equal(data.title, 'Effective Go');
  assert.equal(data.type, 'source');
  assert.deepEqual(data.topics, ['go', 'errors']);
  assert.deepEqual(data.related, []);
  assert.equal(data.verifications.length, 1);
  assert.equal(data.verifications[0].method, 'refetched-source');
  assert.equal(data.subject.version, '0.19');
  assert.match(body, /# Body/);
});

test('round-trip is stable', () => {
  const { data, body } = parseFrontmatter(sample);
  const out = serializeFrontmatter(data, body);
  const reparsed = parseFrontmatter(out);
  assert.deepEqual(reparsed.data, data);
});

test('rejects entry with no frontmatter', () => {
  assert.throws(() => parseFrontmatter('no frontmatter here'), /frontmatter/);
});

test('serializer emits no BOM, LF endings, no trailing whitespace', () => {
  const out = serializeFrontmatter({ title: 'x', type: 'note' }, '# b\n');
  assert.equal(out.charCodeAt(0), 0x2d); // '-' not BOM
  assert.ok(!/\r/.test(out));
  assert.ok(!/ \n/.test(out));
});

test('scalar round-trip is idempotent for quotes, brackets, commas, type-looking strings', () => {
  const tricky = [
    'say "hi" now',
    'he said "\\" backslash',
    'a\\b',
    '[2026 roadmap]',
    '[]',
    'one, two, three',
    'true',
    'false',
    '42',
    '-7',
    'plain value',
  ];
  for (const title of tricky) {
    const data = { title, type: 'note' };
    const once = serializeFrontmatter(data, '# b\n');
    const first = parseFrontmatter(once);
    assert.equal(first.data.title, title, `parse(serialize(x)) === x for ${JSON.stringify(title)}`);
    const twice = serializeFrontmatter(first.data, first.body);
    assert.equal(twice, once, `serialize is idempotent for ${JSON.stringify(title)}`);
  }
});

test('body trailing whitespace survives serialization byte-for-byte (minus CR)', () => {
  const body = [
    '# Notes',
    'line with hard break  ',
    'next line',
    '',
    '```',
    'code with trailing spaces   ',
    '\tindented\t',
    '```',
    '',
  ].join('\n');
  const out = serializeFrontmatter({ title: 'x', type: 'snippet' }, '\n' + body);
  const emittedBody = out.slice(out.indexOf('\n---\n') + '\n---\n'.length);
  assert.equal(emittedBody, body);
  assert.ok(/  \n/.test(out), 'markdown hard break preserved');
  assert.ok(/spaces   \n/.test(out), 'code-block trailing spaces preserved');
});

test('two serialize/parse cycles are byte-identical to one', () => {
  const data = {
    title: 'has "quotes" and [brackets]',
    type: 'source',
    topics: ['go', 'errors'],
    count: 3,
  };
  const body = '# Body\nhard break  \nmore\n';
  const once = serializeFrontmatter(data, body);
  const reparsed = parseFrontmatter(once);
  const twice = serializeFrontmatter(reparsed.data, reparsed.body);
  assert.equal(twice, once);
});
