import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBatch } from '../bin/commands/capture.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-batch-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

function writePlan(entries) {
  const p = join(mkdtempSync(join(tmpdir(), 'rv-plan-')), 'plan.json');
  writeFileSync(p, JSON.stringify(entries), 'utf8');
  return p;
}

const NOW = { now: '2026-06-12', repoRoot: process.cwd() };

test('batch: creates all entries, one manifest rebuild, lint-clean, JSON result', () => {
  const dir = freshVault();
  const r = runBatch(dir, writePlan([
    { type: 'source', title: 'APF concept docs', url: 'https://kubernetes.io/docs/apf', domain: ['systems-infrastructure'], topics: ['kubernetes'], authorityTier: 'primary' },
    { type: 'note', title: 'APF essentials', sources: ['2026-01-01-a'], confidence: 'high', summary: 'FlowSchemas match requests to priority levels.' },
    { type: 'question', title: 'Does the syncer share the host APF bucket?', state: 'open' },
  ]), NOW);
  assert.equal(r.errors.length, 0);
  assert.equal(r.created.length, 3);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.created[0].id, '2026-06-12-apf-concept-docs');
  for (const c of r.created) assert.ok(existsSync(c.path));
  const manifest = JSON.parse(readFileSync(join(dir, '.vault-manifest.json'), 'utf8'));
  assert.ok(manifest.entries.some(e => e.id === '2026-06-12-apf-essentials'));
  assert.equal(lintVault(dir, process.cwd()).violations.length, 0);
});
