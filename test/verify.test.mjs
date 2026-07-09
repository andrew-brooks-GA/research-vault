import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyVerification, listStale } from '../bin/commands/verify.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

// Hand-write a source with an arbitrary verification log (and volatility) so the freshness
// boundary cases can be pinned without going through capture/verify.
function writeSource(dir, id, { volatility = 'slow', verifications = [] } = {}) {
  const vlog = verifications.length
    ? 'verifications:\n' + verifications.map(v => `  - date: ${v.date}
    by_type: human
    by_id: ""
    method: ${v.method || 'human-spot-check'}
    result: ${v.result}
    notes: ""`).join('\n') + '\n'
    : 'verifications: []\n';
  writeFileSync(join(dir, 'sources', `${id}.md`), `---
title: "${id}"
type: source
created: 2026-01-01
domain: [software-engineering]
stage: raw
topics: [x]
status: active
related: []
volatility: ${volatility}
${vlog}source_type: article
source_url: https://example.com/${id}
---
# ${id}
`, 'utf8');
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

test('unreachable does NOT clear staleness and does not bump last_verified', () => {
  const dir = freshVault();
  // 2026-01-01-a is slow (window 365), last confirming = 2026-01-01. At 2027-06-01 it is stale.
  assert.ok(listStale(dir, { now: '2027-06-01', repoRoot: process.cwd() }).some(s => s.id === '2026-01-01-a'), 'stale before');
  const r = applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'unreachable', now: '2027-06-01', repoRoot: process.cwd() });
  assert.equal(r.action, 'recorded');
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.verifications.length, 2, 'unreachable is recorded for audit');
  assert.equal(e.data.updated, undefined, 'a failed check must not bump updated');
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-a');
  assert.equal(row.last_verified, '2026-01-01', 'last_verified unchanged by unreachable');
  assert.ok(listStale(dir, { now: '2027-06-01', repoRoot: process.cwd() }).some(s => s.id === '2026-01-01-a'), 'still stale after unreachable');
});

test('inconclusive is recorded in the log but does not bump last_verified', () => {
  const dir = freshVault();
  const r = applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'inconclusive', now: '2026-05-27', repoRoot: process.cwd() });
  assert.equal(r.action, 'recorded');
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.verifications.length, 2, 'inconclusive is no longer silently discarded');
  assert.equal(e.data.updated, undefined);
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-a');
  assert.equal(row.last_verified, '2026-01-01', 'last_verified unchanged by inconclusive');
});

test('confirmed does bump manifest last_verified', () => {
  const dir = freshVault();
  applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'confirmed', now: '2026-05-27', byId: 'claude-opus-4-7', repoRoot: process.cwd() });
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-a');
  assert.equal(row.last_verified, '2026-05-27');
});

test('a source whose only log entry is non-confirming has last_verified null and IS stale', () => {
  const dir = freshVault();
  writeSource(dir, '2026-01-01-nc', { verifications: [{ date: '2027-01-01', method: 'refetched-source', result: 'unreachable' }] });
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-nc');
  assert.equal(row.last_verified, null, 'no confirming verification → null');
  assert.ok(listStale(dir, { now: '2027-06-01', repoRoot: process.cwd() }).some(s => s.id === '2026-01-01-nc'), 'null last_verified is treated as Infinity → stale');
});

test('freshness boundary: at exactly the window is NOT stale (strict >), one day past is', () => {
  const dir = freshVault();
  // 2026-01-01-a: slow window 365, last confirming 2026-01-01. 2027-01-01 is exactly 365 days.
  assert.ok(!listStale(dir, { now: '2027-01-01', repoRoot: process.cwd() }).some(s => s.id === '2026-01-01-a'), 'ageDays === win is not stale');
  assert.ok(listStale(dir, { now: '2027-01-02', repoRoot: process.cwd() }).some(s => s.id === '2026-01-01-a'), 'one day past window is stale');
});

test('a never-verified entry (empty log) is stale', () => {
  const dir = freshVault();
  writeSource(dir, '2026-01-01-never', { verifications: [] });
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-never');
  assert.equal(row.last_verified, null);
  assert.ok(listStale(dir, { now: '2026-01-02', repoRoot: process.cwd() }).some(s => s.id === '2026-01-01-never'), 'never-verified is stale even one day after creation');
});

test('a volatile entry (window 0) is always flagged regardless of last_verified', () => {
  const dir = freshVault();
  writeSource(dir, '2026-01-01-vol', { volatility: 'volatile', verifications: [{ date: '2030-01-01', result: 'confirmed' }] });
  const hit = listStale(dir, { now: '2030-01-02', repoRoot: process.cwd() }).find(s => s.id === '2026-01-01-vol');
  assert.ok(hit, 'volatile is always stale');
  assert.equal(hit.reason, 'always re-check');
});
