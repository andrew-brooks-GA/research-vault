import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchVault } from '../bin/commands/search.mjs';
import { relatedTo } from '../bin/commands/related.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-search-')), 'v');
  cpSync(VAULT, dir, { recursive: true });
  return dir;
}

test('search filters by type and topic', () => {
  const r = searchVault(VAULT, { type: 'source', topic: 'x' });
  assert.ok(r.some(e => e.id === '2026-01-01-a'));
  assert.ok(!r.some(e => e.type === 'synthesis'));
});

test('related returns forward edges and backlinks', () => {
  const r = relatedTo(VAULT, '2026-01-01-a');
  assert.ok(r.backlinks.includes('2026-01-02-b'));
});

test('related forward edges are de-duplicated across edge fields', () => {
  // 2026-01-02-b references 2026-01-01-a in BOTH related and contributing_ids
  const r = relatedTo(VAULT, '2026-01-02-b');
  const counts = r.forward.filter(x => x === '2026-01-01-a').length;
  assert.equal(counts, 1, 'forward edge should appear once, not per-field: ' + JSON.stringify(r.forward));
});

test('search --body matches entry body text, not just title/topics', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'note', title: 'Plain Title', sources: '2026-01-01-a',
    confidence: 'high', now: '2026-05-30', repoRoot: process.cwd(),
  });
  appendFileSync(r.path, 'The syncer shares the host APF bucket under contention.\n');

  const hit = searchVault(dir, { body: 'apf bucket' });
  assert.ok(hit.some(e => e.id === r.id), '--body finds the appended body phrase');

  const miss = searchVault(dir, { body: 'no such phrase zzz' });
  assert.ok(!miss.some(e => e.id === r.id), '--body excludes entries without the phrase');

  const viaText = searchVault(dir, { text: 'apf bucket' });
  assert.ok(!viaText.some(e => e.id === r.id), 'title/topic --text must NOT match body-only text');
});

test('--text matches topics case-insensitively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-topic-'));
  captureEntry(dir, { type: 'source', title: 'K8s docs', url: 'https://example.com/k', topics: 'Kubernetes', now: '2026-01-01' });
  const rows = searchVault(dir, { text: 'kubernetes' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topics[0], 'Kubernetes');
});

test('--text matches a note summary without a body read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-ssum-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/y', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Note', sources: '2026-01-01-src', summary: 'Pin the socket to the validated IP.', now: '2026-01-02' });
  const rows = searchVault(dir, { text: 'validated ip' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'note');
});

test('search hides superseded entries unless --include-superseded (spec 09)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-gate-'));
  captureEntry(dir, { type: 'source', title: 'A first', url: 'https://example.com/a', now: '2026-01-01' });
  captureEntry(dir, { type: 'source', title: 'Old', url: 'https://example.com/old', now: '2026-01-02' });
  captureEntry(dir, { type: 'source', title: 'New', url: 'https://example.com/new', now: '2026-01-03' });
  captureEntry(dir, { type: 'source', title: 'Z last', url: 'https://example.com/z', now: '2026-01-04' });
  const { applyVerification } = await import('../bin/commands/verify.mjs');
  applyVerification(dir, { id: '2026-01-02-old', method: 'refetched-source', result: 'outdated', supersededBy: '2026-01-03-new', now: '2026-01-05', repoRoot: process.cwd() });
  const ACTIVE = ['2026-01-01-first', '2026-01-03-new', '2026-01-04-z-last'];
  const ALL = ['2026-01-01-first', '2026-01-02-old', '2026-01-03-new', '2026-01-04-z-last'];
  assert.deepEqual(searchVault(dir, { type: 'source' }).map(e => e.id), ACTIVE, 'default drops only the superseded row, order preserved');
  const all = searchVault(dir, { type: 'source', includeSuperseded: true });
  assert.deepEqual(all.map(e => e.id), ALL);
  assert.equal(all[1].superseded_by, '2026-01-03-new');
  const { run } = await import('../bin/commands/search.mjs');
  const cli = async args => {
    const out = [];
    const so = process.stdout.write; process.stdout.write = c => { out.push(String(c)); return true; };
    try { await run({ _: ['search'], vault: dir, type: 'source', ...args }); } finally { process.stdout.write = so; }
    return out.join('');
  };
  const text = await cli({});
  assert.ok(!text.includes('2026-01-02-old'), 'text default hides superseded');
  assert.ok(!text.includes('superseded by'), 'no suffix without the flag');
  const textAll = await cli({ 'include-superseded': true });
  assert.match(textAll, /2026-01-02-old  \[source\]  Old \(superseded by 2026-01-03-new\)/);
  assert.ok(!/A first \(superseded/.test(textAll), 'active rows get no suffix');
  assert.deepEqual(JSON.parse(await cli({ json: true })).map(e => e.id), ACTIVE, 'json default hides superseded');
  assert.deepEqual(JSON.parse(await cli({ json: true, 'include-superseded': true })).map(e => e.id), ALL);
});
