import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultSummary } from '../bin/lib/summary.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('vaultSummary reports an entry count', () => {
  const dir = freshVault();
  const s = vaultSummary(dir, { repoRoot: process.cwd() });
  assert.match(s, /\d+ entries/);
});

test('vaultSummary reports a stale count', () => {
  const dir = freshVault();
  const s = vaultSummary(dir, { repoRoot: process.cwd(), now: '2030-01-01' });
  assert.match(s, /\d+ stale/);
});
