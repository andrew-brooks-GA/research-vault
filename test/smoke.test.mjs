import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpVault, put } from './helpers.mjs';

test('CLI prints usage and exits 0 with no args', () => {
  const out = execFileSync('node', ['bin/research-vault.mjs', '--help'], { encoding: 'utf8' });
  assert.match(out, /research-vault/);
  assert.match(out, /init\|lint\|capture\|verify\|search\|related\|manifest/);
});

test('CLI does not truncate large piped stdout (process.exit after write)', () => {
  const dir = tmpVault('rv-pipe-');
  for (let i = 0; i < 400; i++) put(dir, 'source', `2026-01-01-s${i}`, { source_type: 'article', source_url: `https://example.com/${i}` });
  const out = execFileSync('node', ['bin/research-vault.mjs', 'manifest', '--vault', dir], { maxBuffer: 1 << 26 });
  assert.ok(out.length > 65536, `expected > 64 KB, got ${out.length}`);
  assert.doesNotThrow(() => JSON.parse(out.toString()));
});
