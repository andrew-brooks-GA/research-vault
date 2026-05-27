import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../bin/commands/init.mjs';

test('init scaffolds vault, generates AGENTS.md, is idempotent', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'vault');
  const repoRoot = process.cwd();
  const r1 = runInit({ vaultPath: dir, repoRoot });
  assert.equal(r1.created, true);
  assert.ok(existsSync(join(dir, 'AGENTS.md')));
  assert.ok(existsSync(join(dir, 'sources', 'INDEX.md')));
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /Research Vault/);
  writeFileSync(join(dir, 'sources', '2026-01-01-x.md'), 'content');
  const r2 = runInit({ vaultPath: dir, repoRoot });
  assert.equal(r2.created, false);
  assert.match(r2.reason, /non-empty/);
});
