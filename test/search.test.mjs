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
