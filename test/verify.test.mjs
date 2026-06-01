import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyVerification, listStale } from '../bin/commands/verify.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('confirmed appends a verification and bumps updated', () => {
  const dir = freshVault();
  applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'confirmed', now: '2026-05-27', byId: 'claude-opus-4-7', repoRoot: process.cwd() });
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.verifications.length, 2);
  assert.equal(e.data.updated, '2026-05-27');
});

test('self-confirmation refused: inferred-stable on slow entry throws', () => {
  const dir = freshVault();
  assert.throws(() => applyVerification(dir, { id: '2026-01-01-a', method: 'inferred-stable', result: 'confirmed', now: '2026-05-27', repoRoot: process.cwd() }),
    /inferred-stable/);
});

test('listStale flags entries past their volatility window', () => {
  const dir = freshVault();
  const stale = listStale(dir, { now: '2030-01-01', repoRoot: process.cwd() });
  assert.ok(stale.some(s => s.id === '2026-01-01-a'));
});

test('outdated without --superseded-by is refused and leaves the entry lint-clean', () => {
  const dir = freshVault();
  assert.throws(
    () => applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'outdated', now: '2026-05-27', repoRoot: process.cwd() }),
    /outdated requires --superseded-by/,
  );
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'entry must remain lint-clean: ' + JSON.stringify(violations));
});

test('verify with a bogus result throws', () => {
  const dir = freshVault();
  assert.throws(
    () => applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'bogus', now: '2026-05-27', repoRoot: process.cwd() }),
    /invalid result: bogus/,
  );
});

test('a successful verify leaves the vault lint-clean under --check', () => {
  const dir = freshVault();
  applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'confirmed', now: '2026-05-27', byId: 'claude-opus-4-7', repoRoot: process.cwd() });
  const { violations } = lintAndReport(dir, { check: true });
  assert.equal(violations.length, 0, 'expected clean --check after verify: ' + JSON.stringify(violations));
});

test('version succession keeps the entry active and does NOT supersede', () => {
  const dir = freshVault();
  const r = applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'confirmed', succession: true, byId: 'claude-opus-4-7', now: '2026-05-27', repoRoot: process.cwd() });
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.status, 'active');          // NOT superseded
  assert.equal(e.data.verifications.length, 2);   // verification recorded
  assert.equal(r.action, 'version-succeeded');
});

test('verify refuses the capture-time `captured` method', () => {
  const dir = freshVault();
  assert.throws(
    () => applyVerification(dir, { id: '2026-01-01-a', method: 'captured', result: 'confirmed', now: '2026-05-27', repoRoot: process.cwd() }),
    /captured is a capture-time seed/,
  );
});
