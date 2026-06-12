import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBatch, run } from '../bin/commands/capture.mjs';
import { makeId } from '../bin/lib/ids.mjs';
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

test('batch: later entries may reference earlier batch ids; unresolved refs are errors', () => {
  const dir = freshVault();
  const ok = runBatch(dir, writePlan([
    { type: 'source', title: 'Sleep mode docs', url: 'https://docs.vcluster.com/sleep' },
    { type: 'note', title: 'Sleep mode essentials', sources: ['2026-06-12-sleep-mode-docs'], summary: 'Scales idle workloads to zero.' },
    { type: 'synthesis', title: 'Tenant idle cost posture', contributingIds: ['2026-06-12-sleep-mode-essentials'], summary: 'Sleep mode is the cost lever.' },
  ]), NOW);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.created.length, 3);
  assert.equal(lintVault(dir, process.cwd()).violations.length, 0);

  const bad = runBatch(dir, writePlan([
    { type: 'note', title: 'Dangling', sources: ['2026-06-12-no-such-entry'] },
  ]), NOW);
  assert.equal(bad.created.length, 0);
  assert.match(bad.errors[0].error, /unresolved reference: 2026-06-12-no-such-entry/);
});

test('batch: note without sources / synthesis without contributing_ids are errors', () => {
  const dir = freshVault();
  const r = runBatch(dir, writePlan([
    { type: 'note', title: 'No sources' },
    { type: 'synthesis', title: 'No contributors' },
  ]), NOW);
  assert.equal(r.created.length, 0);
  assert.match(r.errors[0].error, /note requires sources/);
  assert.match(r.errors[1].error, /synthesis requires contributingIds/);
});

test('batch: duplicate of an existing vault source is skipped, not a failure', () => {
  const dir = freshVault();
  runBatch(dir, writePlan([{ type: 'source', title: 'First', url: 'https://dup.example.com/x' }]), NOW);
  const r = runBatch(dir, writePlan([
    { type: 'source', title: 'Same again', url: 'https://dup.example.com/x/?utm_source=z' },
    { type: 'question', title: 'Still lands?', state: 'open' },
  ]), NOW);
  assert.equal(r.errors.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].id, '2026-06-12-first');
  assert.equal(r.created.length, 1, 'non-duplicate siblings still land');
});

test('batch: intra-batch duplicate source is skipped against the pending sibling', () => {
  const dir = freshVault();
  const r = runBatch(dir, writePlan([
    { type: 'source', title: 'Original', url: 'https://intra.example.com/x' },
    { type: 'source', title: 'Same url', url: 'https://intra.example.com/x' },
  ]), NOW);
  assert.equal(r.created.length, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].id, '2026-06-12-original');
});

test('batch: content-changed tripwire is an error, not a silent skip', () => {
  const dir = freshVault();
  runBatch(dir, writePlan([{ type: 'source', title: 'Hashed', url: 'https://trip.example.com/x', content: 'v1' }]), NOW);
  const r = runBatch(dir, writePlan([
    { type: 'source', title: 'Hashed again', url: 'https://trip.example.com/x', content: 'v2' },
  ]), NOW);
  assert.equal(r.created.length, 0);
  assert.match(r.errors[0].error, /content changed at same url\+version/);
});

test('capture --batch via run(): JSON to stdout, exit 0 clean / 1 on errors', async () => {
  const dir = freshVault();
  const good = writePlan([{ type: 'source', title: 'Via CLI', url: 'https://cli.example.com/x' }]);
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = s => { out.push(s); return true; };
  let code;
  try { code = await run({ batch: good, vault: dir }); }
  finally { process.stdout.write = orig; }
  assert.equal(code, 0);
  const parsed = JSON.parse(out.join(''));
  assert.equal(parsed.created[0].id, makeId(new Date().toISOString().slice(0, 10), 'Via CLI'));

  const bad = writePlan([{ type: 'note', title: 'No sources' }]);
  process.stdout.write = () => true;
  try { code = await run({ batch: bad, vault: dir }); }
  finally { process.stdout.write = orig; }
  assert.equal(code, 1);
});
