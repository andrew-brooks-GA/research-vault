import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../bin/lib/manifest.mjs';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

test('builds one row per entry with last_verified derived', () => {
  const m = buildManifest(VAULT);
  const a = m.entries.find(e => e.id === '2026-01-01-a');
  assert.equal(a.type, 'source');
  assert.equal(a.last_verified, '2026-01-01');
  assert.equal(a.source_url, 'https://example.com/a');
});

test('computes backlinks from related/contributing_ids', () => {
  const m = buildManifest(VAULT);
  assert.deepEqual(m.backlinks['2026-01-01-a'].sort(), ['2026-01-02-b']);
});
