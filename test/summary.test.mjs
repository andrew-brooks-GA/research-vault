import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs';
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

test('vaultSummary counts a source with no confirming verification (null last_verified) as stale', () => {
  const dir = freshVault();
  // Only a non-confirming verification → last_verified null → Infinity → stale.
  writeFileSync(join(dir, 'sources', '2026-01-01-nc.md'), `---
title: "NC"
type: source
created: 2026-01-01
domain: [software-engineering]
stage: raw
topics: [x]
status: active
related: []
volatility: slow
verifications:
  - date: 2027-01-01
    by_type: human
    by_id: ""
    method: refetched-source
    result: unreachable
    notes: ""
source_type: article
source_url: https://example.com/nc
---
# NC
`, 'utf8');
  const one = Number(/(\d+) stale/.exec(vaultSummary(dir, { repoRoot: process.cwd(), now: '2026-01-02' }))[1]);
  assert.ok(one >= 1, 'null last_verified is treated as Infinity → stale');
});
