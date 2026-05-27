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
