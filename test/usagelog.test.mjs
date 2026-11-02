import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpVault } from './helpers.mjs';
import { appendUsage, readUsage, USAGE_LOG } from '../bin/lib/usagelog.mjs';

test('usage log: append one JSON line per event with a timestamp; undefined keys are absent; read returns them in order (spec 29 D1)', () => {
  const v = tmpVault('rv-usage-');
  assert.deepEqual(readUsage(v), []);
  appendUsage(v, { kind: 'queried', via: 'search', ids: ['a'], outcome: 'hits', text: undefined });
  appendUsage(v, { kind: 'cited', via: 'post-tool-use', file: 'docs/a.md', id: 'a' });
  const lines = readFileSync(join(v, USAGE_LOG), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(!lines[0].includes('text'));
  const r = readUsage(v);
  assert.equal(r.length, 2);
  assert.equal(typeof r[0].ts, 'string');
  assert.equal(r[0].kind, 'queried');
  assert.equal(r[1].id, 'a');
});
