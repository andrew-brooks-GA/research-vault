import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { searchVault } from '../bin/commands/search.mjs';
import { relatedTo } from '../bin/commands/related.mjs';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

test('search filters by type and topic', () => {
  const r = searchVault(VAULT, { type: 'source', topic: 'x' });
  assert.ok(r.some(e => e.id === '2026-01-01-a'));
  assert.ok(!r.some(e => e.type === 'synthesis'));
});

test('related returns forward edges and backlinks', () => {
  const r = relatedTo(VAULT, '2026-01-01-a');
  assert.ok(r.backlinks.includes('2026-01-02-b'));
});

test('related forward edges are de-duplicated across edge fields', () => {
  // 2026-01-02-b references 2026-01-01-a in BOTH related and contributing_ids
  const r = relatedTo(VAULT, '2026-01-02-b');
  const counts = r.forward.filter(x => x === '2026-01-01-a').length;
  assert.equal(counts, 1, 'forward edge should appear once, not per-field: ' + JSON.stringify(r.forward));
});
