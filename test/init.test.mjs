import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, refreshDocs } from '../bin/commands/init.mjs';

test('init scaffolds vault, generates AGENTS.md, is idempotent', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'vault');
  const repoRoot = process.cwd();
  const r1 = runInit({ vaultPath: dir, repoRoot });
  assert.equal(r1.created, true);
  assert.ok(existsSync(join(dir, 'AGENTS.md')));
  assert.ok(existsSync(join(dir, 'sources')), 'entry folders are created by init');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /Research Vault/);
  // taxonomy is copied verbatim from the single source of truth (no hand-maintained duplicate)
  assert.equal(
    readFileSync(join(dir, 'taxonomy.json'), 'utf8'),
    readFileSync(join(repoRoot, 'schema', 'taxonomy.json'), 'utf8'),
    'vault taxonomy.json must be a verbatim copy of schema/taxonomy.json');
  writeFileSync(join(dir, 'sources', '2026-01-01-x.md'), 'content');
  const r2 = runInit({ vaultPath: dir, repoRoot });
  assert.equal(r2.created, false);
  assert.match(r2.reason, /non-empty/);
});

test('init refuses to overwrite a vault with custom non-entry files (no entries)', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'vault');
  const repoRoot = process.cwd();
  assert.equal(runInit({ vaultPath: dir, repoRoot }).created, true);
  const readme = join(dir, 'README.md');
  writeFileSync(readme, 'CUSTOM README keep this', 'utf8');
  const r2 = runInit({ vaultPath: dir, repoRoot });
  assert.equal(r2.created, false);
  assert.match(r2.reason, /non-empty/);
  assert.equal(readFileSync(readme, 'utf8'), 'CUSTOM README keep this', 'custom file untouched');
});

test('refreshDocs regenerates AGENTS.md but leaves entries untouched', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  runInit({ vaultPath: dir });                 // scaffold a real vault
  writeFileSync(join(dir, 'AGENTS.md'), 'STALE', 'utf8');
  const entryPath = join(dir, 'sources', '2026-01-01-keep.md');
  writeFileSync(entryPath, '---\ntitle: keep\n---\nbody\n', 'utf8');
  const r = refreshDocs({ vaultPath: dir });
  assert.equal(r.refreshed, true);
  assert.notEqual(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'STALE');   // regenerated
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /research vault/i);
  assert.equal(readFileSync(entryPath, 'utf8'), '---\ntitle: keep\n---\nbody\n'); // entry untouched
});

test('refreshDocs refuses a non-vault target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-empty-'));
  const r = refreshDocs({ vaultPath: dir });
  assert.equal(r.refreshed, false);
  assert.match(r.reason, /not an existing vault/);
});
