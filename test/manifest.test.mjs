import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, lastVerified, writeManifest, danglingEdges } from '../bin/lib/manifest.mjs';
import { traverse } from '../bin/lib/graph.ts';
import { captureEntry } from '../bin/commands/capture.mjs';
import { REPO_ROOT, tmpVault, put, testEnv } from './helpers.mjs';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

test('builds one row per entry with last_verified derived', () => {
  const m = buildManifest(VAULT);
  const a = m.entries.find(e => e.id === '2026-01-01-a');
  assert.equal(a.type, 'source');
  assert.equal(a.last_verified, '2026-01-01');
  assert.equal(a.source_url, 'https://example.com/a');
});

test('lastVerified counts only confirming results (confirmed/changed-trivially)', () => {
  assert.equal(lastVerified([]), null, 'no verifications → null');
  assert.equal(lastVerified(undefined), null, 'missing log → null');
  // A later non-confirming check must not win over an earlier confirming one.
  assert.equal(lastVerified([
    { date: '2026-01-01', result: 'confirmed' },
    { date: '2026-06-01', result: 'unreachable' },
    { date: '2026-07-01', result: 'inconclusive' },
    { date: '2026-08-01', result: 'outdated' },
  ]), '2026-01-01');
  assert.equal(lastVerified([
    { date: '2026-01-01', result: 'confirmed' },
    { date: '2026-06-01', result: 'changed-trivially' },
  ]), '2026-06-01', 'changed-trivially confirms freshness');
  assert.equal(lastVerified([{ date: '2026-06-01', result: 'unreachable' }]), null, 'non-confirming only → null');
});

test('computes backlinks from related/contributing_ids', () => {
  const m = buildManifest(VAULT);
  assert.deepEqual(m.backlinks['2026-01-01-a'].sort(), ['2026-01-02-b']);
});

test('two buildManifest runs are byte-identical except generated', () => {
  const norm = m => { const { generated, ...rest } = m; return JSON.stringify(rest); };
  assert.equal(norm(buildManifest(VAULT)), norm(buildManifest(VAULT)));
});

test('manifest row carries summary for note/synthesis, null elsewhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-msum-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/x', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Claim note', sources: '2026-01-01-src', summary: 'The load-bearing claim.', now: '2026-01-02' });
  const m = buildManifest(dir);
  assert.equal(m.entries.find(e => e.type === 'note').summary, 'The load-bearing claim.');
  assert.equal(m.entries.find(e => e.type === 'source').summary, null);
});

test('manifest coerces a non-string summary to a string (hand-edited YAML)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-msum2-'));
  mkdirSync(join(dir, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'notes', '2026-01-02-arr.md'), `---
title: "Arr"
type: note
created: 2026-01-02
domain: [software-engineering]
stage: distilled
topics: [x]
status: active
related: []
volatility: slow
verifications:
  - date: 2026-01-02
    by_type: human
    by_id: ""
    method: human-spot-check
    result: confirmed
    notes: ""
summary: [not, a, string]
sources: []
confidence: medium
---
# Arr
`, 'utf8');
  const row = buildManifest(dir).entries.find(e => e.id === '2026-01-02-arr');
  assert.equal(typeof row.summary, 'string');
});

// Spec 01: scalar edge fields (source_id, prompt_id) must not be iterated character by character.
test('backlinks from scalar source_id/prompt_id are exact (no char keys, no duplicates)', () => {
  const dir = tmpVault();
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '2026-01-01-s' });
  put(dir, 'experiment', '2026-01-03-e', { provider: 'p', model_id: 'm', date_run: '2026-01-03', task: 't', outcome: 'success', prompt_id: '2026-01-02-p' });
  put(dir, 'note', '2026-01-04-n', { sources: ['2026-01-01-s', '2026-01-01-s'], related: ['2026-01-01-s'], confidence: 'medium' });
  assert.deepEqual(buildManifest(dir).backlinks, {
    '2026-01-01-s': ['2026-01-02-p', '2026-01-04-n'],
    '2026-01-02-p': ['2026-01-03-e'],
  });
});

test('an empty scalar source_id adds no backlink key', () => {
  const dir = tmpVault();
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '' });
  assert.deepEqual(buildManifest(dir).backlinks, {});
});

// Spec 02: typed edges over all seven edge fields.
test('manifest edges cover all seven rels, sorted and deduplicated; backlinks exclude superseded_by', () => {
  const dir = tmpVault();
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '2026-01-01-s' });
  put(dir, 'experiment', '2026-01-03-e', { provider: 'p', model_id: 'm', date_run: '2026-01-03', task: 't', outcome: 'success', prompt_id: '2026-01-02-p' });
  put(dir, 'note', '2026-01-04-n', { sources: ['2026-01-01-s', '2026-01-01-s'], related: ['2026-01-01-s'], confidence: 'medium' });
  put(dir, 'synthesis', '2026-01-05-y', { contributing_ids: ['2026-01-04-n'] });
  put(dir, 'question', '2026-01-06-q', { question: 'q', state: 'open', contributing: ['2026-01-05-y'] });
  put(dir, 'synthesis', '2026-01-07-o', { contributing_ids: ['2026-01-04-n'], status: 'superseded', superseded_by: '2026-01-05-y' });
  const m = buildManifest(dir);
  assert.deepEqual(m.edges, [
    { from: '2026-01-02-p', rel: 'source_id', to: '2026-01-01-s' },
    { from: '2026-01-03-e', rel: 'prompt_id', to: '2026-01-02-p' },
    { from: '2026-01-04-n', rel: 'related', to: '2026-01-01-s' },
    { from: '2026-01-04-n', rel: 'sources', to: '2026-01-01-s' },
    { from: '2026-01-05-y', rel: 'contributing_ids', to: '2026-01-04-n' },
    { from: '2026-01-06-q', rel: 'contributing', to: '2026-01-05-y' },
    { from: '2026-01-07-o', rel: 'contributing_ids', to: '2026-01-04-n' },
    { from: '2026-01-07-o', rel: 'superseded_by', to: '2026-01-05-y' },
  ]);
  // two rels between n and s → two edges, one backlink
  assert.deepEqual(m.backlinks['2026-01-01-s'], ['2026-01-02-p', '2026-01-04-n']);
  // superseded_by forms no backlink
  assert.deepEqual(m.backlinks['2026-01-05-y'], ['2026-01-06-q']);
});

test('manifest row carries per-type facets and superseded_by, null when absent (spec 08)', () => {
  const dir = tmpVault('rv-facets-');
  put(dir, 'source', '2026-01-01-s', { source_type: 'paper', source_url: 'https://e.com/s', authority_tier: 'primary', authority_basis: 'spec', summary: 'Claim worth knowing.' });
  put(dir, 'question', '2026-01-02-q', { question: 'q', state: 'open' });
  put(dir, 'experiment', '2026-01-03-e', { provider: 'p', model_id: 'm', date_run: '2026-01-03', task: 't', outcome: 'success' });
  put(dir, 'synthesis', '2026-01-04-y', { contributing_ids: [], confidence: 'high' });
  put(dir, 'synthesis', '2026-01-05-o', { contributing_ids: [], status: 'superseded', superseded_by: '2026-01-04-y' });
  put(dir, 'note', '2026-01-06-n', { sources: ['2026-01-01-s'], confidence: 'low', stage: undefined });
  put(dir, 'snippet', '2026-01-07-p', { language: 'js', tested: false });
  const m = Object.fromEntries(buildManifest(dir).entries.map(e => [e.id, e]));
  const FACETS = ['stage', 'state', 'confidence', 'outcome', 'authority_tier', 'authority_basis', 'superseded_by'];
  for (const row of Object.values(m)) for (const k of FACETS) assert.ok(Object.hasOwn(row, k), `${row.id} has ${k}`);
  assert.equal(m['2026-01-06-n'].confidence, 'low');
  assert.strictEqual(m['2026-01-06-n'].stage, null, 'absent stage is null, not undefined');
  assert.strictEqual(m['2026-01-07-p'].stage, 'distilled', 'snippet default stage from the schema');
  assert.equal(m['2026-01-01-s'].authority_tier, 'primary');
  assert.equal(m['2026-01-01-s'].authority_basis, 'spec');
  assert.equal(m['2026-01-01-s'].summary, 'Claim worth knowing.');
  assert.equal(m['2026-01-01-s'].stage, 'raw');
  assert.equal(m['2026-01-02-q'].state, 'open');
  assert.equal(m['2026-01-03-e'].outcome, 'success');
  assert.equal(m['2026-01-04-y'].confidence, 'high');
  assert.equal(m['2026-01-05-o'].superseded_by, '2026-01-04-y');
  for (const k of ['state', 'outcome', 'authority_tier', 'authority_basis', 'superseded_by'])
    assert.strictEqual(m['2026-01-04-y'][k], null, k);
  for (const k of ['state', 'confidence', 'outcome', 'authority_tier', 'authority_basis', 'superseded_by'])
    assert.strictEqual(m['2026-01-07-p'][k], null, k);
});

const CLI = join(REPO_ROOT, 'bin', 'research-vault.mjs');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: testEnv(), encoding: 'utf8' });

test('writeManifest refuses to drop a listed entry whose folder is missing or whose file is present; a deleted file is gone; removing the manifest is the override (spec 18 D1)', () => {
  const dir = tmpVault('rv-shrink-');
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s' });
  put(dir, 'note', '2026-01-02-n', { sources: ['2026-01-01-s'], confidence: 'medium' });
  writeManifest(dir);
  const mf = join(dir, '.vault-manifest.json');
  const before = readFileSync(mf, 'utf8');
  renameSync(join(dir, 'notes'), join(dir, 'notes.off'));
  assert.throws(() => writeManifest(dir), { message: `manifest not written: it would drop 1 listed entry that is not gone (2026-01-02-n: notes/ is missing); remove ${mf} to accept the shrink` });
  assert.equal(readFileSync(mf, 'utf8'), before, 'the file on disk is untouched');
  renameSync(join(dir, 'notes.off'), join(dir, 'notes'));
  rmSync(join(dir, 'notes', '2026-01-02-n.md'));
  writeManifest(dir);
  assert.equal(JSON.parse(readFileSync(mf, 'utf8')).entries.length, 1, 'a deleted file is gone');
  // A listed file the walk never sees (INDEX.md is skipped) is "still exists".
  writeFileSync(join(dir, 'sources', 'INDEX.md'), '# index\n');
  writeFileSync(mf, JSON.stringify({ entries: [{ id: '2026-01-01-s', type: 'source' }, { id: 'INDEX', type: 'source' }] }));
  assert.throws(() => writeManifest(dir), /INDEX: sources\/INDEX\.md still exists/);
  rmSync(mf);
  writeManifest(dir);
  assert.equal(JSON.parse(readFileSync(mf, 'utf8')).entries.length, 1, 'no previous manifest: written');
  writeFileSync(mf, 'not json');
  writeManifest(dir);
  assert.equal(JSON.parse(readFileSync(mf, 'utf8')).entries.length, 1, 'an unparsable previous manifest guards nothing');
});

test('danglingEdges lists the edges to no entry, and manifest --rebuild reports them on stderr before writing (spec 18 D2)', () => {
  assert.deepEqual(danglingEdges(buildManifest(VAULT)), []);
  const dir = tmpVault('rv-dangling-');
  put(dir, 'note', '2026-01-03-d', { sources: ['2026-01-09-missing'], confidence: 'medium' });
  assert.deepEqual(danglingEdges(buildManifest(dir)), [{ from: '2026-01-03-d', rel: 'sources', to: '2026-01-09-missing' }]);
  const r = cli('manifest', '--rebuild', '--vault', dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, 'manifest: 1 dangling edge(s)\n  2026-01-03-d --sources--> 2026-01-09-missing\n');
  assert.equal(r.stdout, 'manifest: 1 entries\n');
  assert.equal(JSON.parse(readFileSync(join(dir, '.vault-manifest.json'), 'utf8')).edges.length, 1, 'still written');
});

test('manifest --topics lists the topic vocabulary with counts, superseded entries left out, in either flag position (spec 18 D4)', () => {
  const dir = tmpVault('rv-topics-');
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s', topics: ['zig', 'vulkan'] });
  put(dir, 'source', '2026-01-02-t', { source_type: 'article', source_url: 'https://example.com/t', topics: ['zig'] });
  put(dir, 'source', '2026-01-03-u', { source_type: 'article', source_url: 'https://example.com/u', topics: ['old'], status: 'superseded', superseded_by: '2026-01-02-t' });
  assert.equal(cli('manifest', '--topics', '--vault', dir).stdout, 'vulkan 1\nzig 2\n');
  assert.equal(cli('manifest', '--vault', dir, '--topics').stdout, 'vulkan 1\nzig 2\n');
  const r = cli('manifest', '--rebuild', '--topics', '--vault', dir);
  assert.equal(r.stdout, 'manifest: 3 entries\nvulkan 1\nzig 2\n', 'with --rebuild: written, then the list instead of the JSON');
});

test('R08 writeManifest leaves the old fixed temporary name untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-manifest-atomic-'));
  try {
    writeFileSync(join(dir, '.vault-manifest.json.tmp'), 'sentinel');
    writeManifest(dir, { entries: [], generated: 'fixture' });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.vault-manifest.json'), 'utf8')), { entries: [], generated: 'fixture' });
    assert.equal(readFileSync(join(dir, '.vault-manifest.json.tmp'), 'utf8'), 'sentinel');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('R08 round2 atomic leftovers do not affect lint or manifest entries', async t => {
  const { cpSync } = await import('node:fs');
  const { lintVault } = await import('../bin/lib/lintrules.mjs');
  const dir = tmpVault('rv-leftover-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(VAULT, dir, { recursive: true });
  const before = buildManifest(dir).entries;
  const text = readFileSync(join(dir, 'sources/2026-01-01-a.md'), 'utf8');
  for (const folder of [dir, join(dir, 'sources')])
    writeFileSync(join(folder, '.rv-atomic-12345678-1234-1234-1234-123456789abc.tmp'), text);
  const lint = lintVault(dir, REPO_ROOT);
  assert.deepEqual(lint.violations, []);
  assert.deepEqual(lint.warnings, []);
  assert.deepEqual(buildManifest(dir).entries, before);
});

// S-11: manifest's text output shows each value from an entry on one line with no hidden characters. Tag
// characters spell "ignore".
const TAGS = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';

test('manifest --topics: a topic is shown on one line with no hidden characters', t => {
  const dir = tmpVault('rv-topics-s11-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s', topics: [`zig\nforged 9${TAGS}`] });
  const r = spawnSync(process.execPath, [CLI, 'manifest', '--topics', '--vault', dir], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.stdout, 'zig forged 9 1\n', r.stderr);
});

// An entry id comes from its file name, and a reference from an entry field; either can hold a line break.
test('manifest --rebuild: a dangling edge is shown on one stderr line with no hidden characters', t => {
  const dir = tmpVault('rv-dangling-s11-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, 'note', `2026-01-03-d\n  2026-01-01-x --sources--> forged${TAGS}`, { sources: [`2026-01-09-missing\n  2026-01-02-y --sources--> forged${TAGS}`], confidence: 'medium' });
  const r = spawnSync(process.execPath, [CLI, 'manifest', '--rebuild', '--vault', dir], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, 'manifest: 1 dangling edge(s)\n  2026-01-03-d 2026-01-01-x --sources--> forged --sources--> 2026-01-09-missing 2026-01-02-y --sources--> forged\n');
});

// S-13: a reference that names an Object.prototype member, written by hand as an existing vault could hold it,
// is a dangling reference like any other: the manifest builds, and search and lint run.
test('S-13: a reference to constructor builds the manifest, and search and lint run', t => {
  const dir = tmpVault('rv-s13-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s', related: ['constructor'] });
  assert.deepEqual(buildManifest(dir).backlinks, { constructor: ['2026-01-01-s'] });
  const cli = (...a) => spawnSync(process.execPath, [CLI, ...a, '--vault', dir], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  const search = cli('search', '--json');
  assert.equal(search.status, 0, search.stderr);
  assert.deepEqual(JSON.parse(search.stdout).map(e => e.id), ['2026-01-01-s']);
  const lint = cli('lint', '--json');
  assert.equal(lint.status, 1, lint.stderr);
  assert.deepEqual(JSON.parse(lint.stdout).violations.map(v => [v.code, v.msg]), [['DANGLING_REF', 'related -> missing id constructor']]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.vault-manifest.json'), 'utf8')).backlinks, { constructor: ['2026-01-01-s'] });
});

test('S-13: a reference to __proto__, toString, hasOwnProperty or constructor is an edge, a backlink in the file and a traversal node', t => {
  for (const name of ['__proto__', 'toString', 'hasOwnProperty', 'constructor']) {
    const dir = tmpVault('rv-s13-rel-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    put(dir, 'note', '2026-01-02-n', { sources: [name], confidence: 'medium' });
    const m = buildManifest(dir);
    assert.deepEqual(m.edges, [{ from: '2026-01-02-n', rel: 'sources', to: name }], name);
    assert.deepEqual(Object.entries(m.backlinks), [[name, ['2026-01-02-n']]], name);
    writeManifest(dir, m);
    assert.deepEqual(Object.entries(JSON.parse(readFileSync(join(dir, '.vault-manifest.json'), 'utf8')).backlinks), [[name, ['2026-01-02-n']]], name);
    assert.deepEqual(Object.entries(traverse(m, '2026-01-02-n').parents), [[name, '2026-01-02-n']], name);
  }
});

test('S-13: the shrink guard takes a listed row whose type names an Object.prototype member as an unknown type', t => {
  for (const type of ['__proto__', 'toString', 'hasOwnProperty', 'constructor']) {
    const dir = tmpVault('rv-s13-shrink-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s' });
    writeFileSync(join(dir, '.vault-manifest.json'), JSON.stringify({ entries: [{ id: '2026-01-01-gone', type }] }));
    writeManifest(dir);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.vault-manifest.json'), 'utf8')).entries.map(e => e.id), ['2026-01-01-s'], type);
  }
});
