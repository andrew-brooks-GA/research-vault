import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchVault, matchRows, sortRows } from '../bin/commands/search.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
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
  assert.match(textAll, /2026-01-02-old  \[source\]  Old  \(no tier, fresh\) \(superseded by 2026-01-03-new\)/, 'annotation precedes the superseded suffix');
  assert.ok(!/A first \(superseded/.test(textAll), 'active rows get no suffix');
  assert.deepEqual(JSON.parse(await cli({ json: true })).map(e => e.id), ACTIVE, 'json default hides superseded');
  assert.deepEqual(JSON.parse(await cli({ json: true, 'include-superseded': true })).map(e => e.id), ALL);
});

test('matchRows is searchVault without the body walk and the superseded gate (spec 20 D0)', () => {
  const rows = buildManifest(VAULT).entries.filter(e => e.status !== 'superseded');
  for (const q of [{ type: 'source', topic: 'x' }, { text: 'a' }, { topic: 'tdd' }]) {
    assert.deepEqual(matchRows(rows, q, { tdd: 'test-driven-development' }).map(e => e.id), searchVault(VAULT, q).map(e => e.id));
  }
});

test('sortRows authority: taxonomy order, untiered last, ties keep incoming order (spec 23 D2)', () => {
  const schema = loadSchema(process.cwd());
  const rows = ['tertiary', null, 'primary', 'secondary', null].map((authority_tier, i) => ({ id: `r${i}`, authority_tier }));
  assert.deepEqual(sortRows(rows, 'authority', schema).map(e => e.id), ['r2', 'r3', 'r0', 'r1', 'r4']);
  assert.throws(() => sortRows(rows, 'nope', schema), /--sort must be authority or fresh/);
});

test('sortRows fresh: fresh, stale, not assessable, ties keep incoming order (spec 23 D3)', () => {
  const schema = loadSchema(process.cwd());
  const now = new Date('2026-06-01');
  const rows = [
    { id: 'stable-fresh', volatility: 'stable', last_verified: '2026-05-31' },
    { id: 'fast-stale', volatility: 'fast', last_verified: '2026-02-21' },
    { id: 'volatile-reason', volatility: 'volatile', last_verified: '2026-05-31' },
    { id: 'none', volatility: null, last_verified: null },
    { id: 'slow-fresh', volatility: 'slow', last_verified: '2026-05-31' },
  ];
  assert.deepEqual(sortRows(rows, 'fresh', schema, now).map(e => e.id), ['stable-fresh', 'slow-fresh', 'fast-stale', 'volatile-reason', 'none']);
});

test('search --sort authority through a vault, default order unchanged, text annotation (spec 23 D1, D4)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-sort-'));
  const repoRoot = process.cwd();
  captureEntry(dir, { type: 'source', title: 'T', url: 'https://example.com/t', authorityTier: 'tertiary', now: '2026-01-01', repoRoot });
  captureEntry(dir, { type: 'source', title: 'N', url: 'https://example.com/n', now: '2026-01-02', repoRoot });
  captureEntry(dir, { type: 'source', title: 'P', url: 'https://example.com/p', authorityTier: 'primary', now: '2026-01-03', repoRoot });
  captureEntry(dir, { type: 'note', title: 'Note', sources: '2026-01-03-p', now: '2026-01-04', repoRoot });
  const ids = q => searchVault(dir, q).map(e => e.id);
  assert.deepEqual(ids({}), ['2026-01-01-t', '2026-01-02-n', '2026-01-03-p', '2026-01-04-note'], 'default is manifest order');
  assert.deepEqual(ids({ sort: 'authority' }), ['2026-01-03-p', '2026-01-01-t', '2026-01-02-n', '2026-01-04-note']);
  const { run } = await import('../bin/commands/search.mjs');
  const out = [];
  const so = process.stdout.write; process.stdout.write = c => { out.push(String(c)); return true; };
  try { await run({ _: ['search'], vault: dir, now: '2026-01-05' }); } finally { process.stdout.write = so; }
  const text = out.join('');
  assert.match(text, /^2026-01-03-p {2}\[source\] {2}P {2}\(primary, fresh\)$/m);
  assert.match(text, /^2026-01-02-n {2}\[source\] {2}N {2}\(no tier, fresh\)$/m);
  assert.match(text, /^2026-01-04-note {2}\[note\] {2}Note {2}\(no tier, fresh\)$/m);
});

test('a vault alias pair reaches search: --topic kubernetes finds an entry carrying only k8s (spec 24 D2)', () => {
  const root = mkdtempSync(join(tmpdir(), 'rv-alias-'));
  writeFileSync(join(root, '.research-vault.json'), '{"vault":"v","taxonomy_extensions":{"topic_aliases":{"k8s":"kubernetes"}}}');
  const dir = join(root, 'v');
  captureEntry(dir, { type: 'source', title: 'K', url: 'https://example.com/k', topics: 'k8s', now: '2026-01-01', repoRoot: process.cwd() });
  const f = join(dir, 'sources', '2026-01-01-k.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^topics:.*$/m, 'topics: [k8s]'), 'utf8');
  assert.deepEqual(searchVault(dir, { topic: 'kubernetes' }).map(e => e.id), ['2026-01-01-k']);
});

test('search logs a queried event with its facets and the ids returned, no text by default (spec 29 D2)', async () => {
  const { readUsage } = await import('../bin/lib/usagelog.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'rv-search-log-'));
  captureEntry(dir, { type: 'source', title: 'A first', url: 'https://example.com/a', now: '2026-01-01' });
  captureEntry(dir, { type: 'source', title: 'Z last', url: 'https://example.com/z', now: '2026-01-04' });
  const { run } = await import('../bin/commands/search.mjs');
  const so = process.stdout.write; process.stdout.write = () => true;
  try { await run({ _: ['search'], vault: dir, type: 'source', text: 'first' }); } finally { process.stdout.write = so; }
  const e = readUsage(dir).at(-1);
  assert.deepEqual([e.kind, e.via, e.type, e.outcome, e.ids, 'text' in e], ['queried', 'search', 'source', 'hits', ['2026-01-01-first'], false]);
});
