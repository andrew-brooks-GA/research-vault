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

// Spec 15 D7: an existing vault sees nothing from code links. An entry carrying a field the schema does
// not know survives refreshDocs and lint --check byte for byte, and lint stays clean.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { put } from './helpers.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { ENTRY_FOLDERS } from '../bin/lib/fsutil.mjs';

test('refreshDocs and lint --check leave every entry of an existing vault unchanged, unknown field included', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  runInit({ vaultPath: dir });
  const id = put(dir, 'source', '2026-01-01-keep', { source_type: 'article', source_url: 'https://e.com/keep' });
  const entry = join(dir, 'sources', `${id}.md`);
  writeFileSync(entry, readFileSync(entry, 'utf8').replace('\n---\n', '\nrecheck: version-change\n---\n'));
  assert.match(readFileSync(entry, 'utf8'), /^recheck: version-change$/m);
  lintAndReport(dir); // rebuild the manifest after the write, as lint does
  const hashes = () => Object.fromEntries(ENTRY_FOLDERS.flatMap((f) => readdirSync(join(dir, f), { recursive: true })
    .filter((n) => n.endsWith('.md')).map((n) => [`${f}/${n}`, createHash('sha256').update(readFileSync(join(dir, f, n))).digest('hex')])));
  const before = hashes();
  assert.ok(Object.keys(before).includes(`sources/${id}.md`));
  assert.equal(refreshDocs({ vaultPath: dir }).refreshed, true);
  const { violations } = lintAndReport(dir, { check: true });
  assert.deepEqual(violations, []);
  assert.deepEqual(hashes(), before);
  assert.match(readFileSync(entry, 'utf8'), /^recheck: version-change$/m);
});
