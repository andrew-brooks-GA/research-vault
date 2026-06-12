import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBatch } from '../bin/commands/capture.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';

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

test('batch: any invalid entry → nothing written, per-entry error report', () => {
  const dir = freshVault();
  const before = buildManifest(dir).entries.length;
  const r = runBatch(dir, writePlan([
    { type: 'source', title: 'Good one', url: 'https://ok.example.com/a' },
    { type: 'note', title: 'Bad confidence', sources: ['2026-01-01-a'], confidence: 'certain' },
    { type: 'nonsense', title: 'Bad type' },
  ]), NOW);
  assert.equal(r.created.length, 0);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.errors.map(e => e.index), [1, 2]);
  assert.match(r.errors[0].error, /unknown confidence/);
  assert.match(r.errors[1].error, /invalid type/);
  assert.ok(!existsSync(join(dir, 'sources', '2026-06-12-good-one.md')), 'valid sibling must not be written');
  assert.equal(buildManifest(dir).entries.length, before, 'no entries written');
  assert.ok(!existsSync(join(dir, '.vault-manifest.json')), 'manifest not flushed on a failed batch');
});

test('batch: unreadable or non-array plan reports index -1 and writes nothing', () => {
  const dir = freshVault();
  const notArray = writePlan([]).replace(/plan\.json$/, 'obj.json');
  writeFileSync(notArray, JSON.stringify({ type: 'source' }), 'utf8');
  assert.equal(runBatch(dir, notArray, NOW).errors[0].index, -1);
  assert.equal(runBatch(dir, join(tmpdir(), 'rv-none', 'missing.json'), NOW).errors[0].index, -1);
});

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
