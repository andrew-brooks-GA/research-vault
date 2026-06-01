import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileVault } from '../bin/commands/compile.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('compile writes _index/INDEX.md including a fixture id', () => {
  const dir = freshVault();
  compileVault(dir);
  const p = join(dir, '_index', 'INDEX.md');
  assert.ok(existsSync(p), 'expected _index/INDEX.md to exist');
  assert.ok(readFileSync(p, 'utf8').includes('2026-01-01-a'), 'index should list fixture id');
});

test('compile is idempotent (byte-identical INDEX.md)', () => {
  const dir = freshVault();
  compileVault(dir);
  const p = join(dir, '_index', 'INDEX.md');
  const first = readFileSync(p);
  compileVault(dir);
  const second = readFileSync(p);
  assert.equal(first.toString(), second.toString());
});

test('compile leaves the vault lint-clean and does not pollute the manifest', () => {
  const dir = freshVault();
  const before = buildManifest(dir).entries.length;
  compileVault(dir);
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
  assert.equal(buildManifest(dir).entries.length, before, '_index/ must not change manifest entry count');
});
