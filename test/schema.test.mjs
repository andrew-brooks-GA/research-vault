import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchema, stageAllowedInFolder, fieldOrder } from '../bin/lib/schema.mjs';

test('loads taxonomy and field definitions', () => {
  const s = loadSchema(process.cwd());
  assert.ok(s.taxonomy.domain.includes('software-engineering'));
  assert.equal(s.taxonomy.volatility.fast.refresh_after_days, 90);
  assert.ok(s.fields.common.includes('title'));
});

test('stage/folder matrix enforced', () => {
  const s = loadSchema(process.cwd());
  assert.equal(stageAllowedInFolder(s, 'sources', 'raw'), true);
  assert.equal(stageAllowedInFolder(s, 'sources', 'distilled'), false);
  assert.equal(stageAllowedInFolder(s, 'synthesis', 'stable'), true);
});

test('fieldOrder returns deterministic key order for a type', () => {
  const s = loadSchema(process.cwd());
  const order = fieldOrder(s, 'source');
  assert.equal(order[0], 'title');
  assert.ok(order.includes('source_url'));
});
