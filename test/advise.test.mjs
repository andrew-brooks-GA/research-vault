import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advise } from '../bin/lib/advise.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('advise returns the signal arrays', () => {
  const dir = freshVault();
  const r = advise(dir, process.cwd());
  for (const k of ['stale', 'orphans', 'sourcesWithoutNotes', 'aliasable', 'unverifiedSources']) {
    assert.ok(Array.isArray(r[k]), `${k} must be an array`);
  }
});

test('a source whose only verification is capture appears in unverifiedSources', () => {
  const dir = freshVault();
  const { id } = captureEntry(dir, { type: 'source', title: 'Captured Only', url: 'https://cap.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  const r = advise(dir, process.cwd());
  assert.ok(r.unverifiedSources.includes(id), 'captured-only source should be flagged unverified');
  assert.ok(!r.unverifiedSources.includes('2026-01-01-a'), 'the human-spot-check fixture source is verified, not flagged');
});

test('a source with no distilling note appears in sourcesWithoutNotes', () => {
  const dir = freshVault();
  const { id } = captureEntry(dir, { type: 'source', title: 'Lonely', url: 'https://lonely.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(advise(dir, process.cwd()).sourcesWithoutNotes.includes(id));
});

test('advise does not mutate the vault (lint-clean before and after)', () => {
  const dir = freshVault();
  lintAndReport(dir, { check: false }); // establish a clean baseline manifest
  advise(dir, process.cwd());
  assert.equal(lintAndReport(dir, { check: true }).violations.length, 0, 'clean before');
  advise(dir, process.cwd());
  assert.equal(lintAndReport(dir, { check: true }).violations.length, 0, 'clean after');
});
