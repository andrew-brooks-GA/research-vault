import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';

const GOOD = fileURLToPath(new URL('./fixtures/vault', import.meta.url));
const BAD = fileURLToPath(new URL('./fixtures/bad', import.meta.url));

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-lint-')), 'v');
  cpSync(GOOD, dir, { recursive: true });
  return dir;
}

test('clean fixture vault passes', () => {
  const { violations } = lintVault(GOOD, process.cwd());
  assert.equal(violations.length, 0);
});

test('detects stored derived field, bad stage, dangling ref', () => {
  const { violations } = lintVault(BAD, process.cwd());
  const codes = violations.map(v => v.code);
  assert.ok(codes.includes('STORED_DERIVED'));
  assert.ok(codes.includes('STAGE_FOLDER'));
  assert.ok(codes.includes('DANGLING_REF'));
});

test('lint --check flags MANIFEST_STALE after an out-of-band entry edit on a populated vault', () => {
  const dir = freshVault();
  // Make the on-disk manifest match reality, then confirm it is clean under --check.
  lintAndReport(dir, { check: false });
  assert.ok(
    !lintAndReport(dir, { check: true }).violations.some(v => v.code === 'MANIFEST_STALE'),
    'a freshly-rebuilt manifest must be clean under --check',
  );

  // Simulate a non-tooling writer editing an entry without rebuilding the manifest.
  const f = join(dir, 'sources', '2026-01-01-a.md');
  const original = readFileSync(f, 'utf8');
  const edited = original.replace(/^title:.*/m, 'title: Edited Out Of Band');
  assert.notEqual(edited, original, 'precondition: the entry had a title line to edit');
  writeFileSync(f, edited, 'utf8');

  const res = lintAndReport(dir, { check: true });
  assert.ok(
    res.violations.some(v => v.code === 'MANIFEST_STALE'),
    'an out-of-band entry edit must make lint --check report MANIFEST_STALE',
  );
});
