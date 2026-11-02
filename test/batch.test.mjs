import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBatch, run, ingest } from '../bin/commands/capture.mjs';
import { makeId, sha256 } from '../bin/lib/ids.mjs';
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

test('batch: intra-batch dedup normalizes both sides (trailing slash vs tracking param)', () => {
  const dir = freshVault();
  const r = runBatch(dir, writePlan([
    { type: 'source', title: 'Canonical', url: 'https://normeq.example.com/page/' },
    { type: 'source', title: 'Tracked', url: 'https://normeq.example.com/page?utm_source=x' },
  ]), NOW);
  assert.equal(r.created.length, 1, 'normalization-equivalent URLs must collapse to one entry');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].id, '2026-06-12-canonical');
});

test('batch: a mid-loop write failure reports created-so-far and rebuilds the manifest', () => {
  const dir = freshVault();
  // Pre-create a directory where the second entry's temp file would be written, so its
  // writeFileSync throws EISDIR (portable across win/mac/linux) after the first is on disk.
  mkdirSync(join(dir, 'sources'), { recursive: true });
  mkdirSync(join(dir, 'sources', '2026-06-12-second.md.tmp'), { recursive: true });
  const r = runBatch(dir, writePlan([
    { type: 'source', title: 'First', url: 'https://fault.example.com/a' },
    { type: 'source', title: 'Second', url: 'https://fault.example.com/b' },
  ]), NOW);
  assert.equal(r.created.length, 1, 'entries written before the failure are reported');
  assert.equal(r.created[0].id, '2026-06-12-first');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].error, /write failed/);
  assert.ok(existsSync(join(dir, 'sources', '2026-06-12-first.md')), 'first entry persisted (tmp+rename)');
  const manifest = JSON.parse(readFileSync(join(dir, '.vault-manifest.json'), 'utf8'));
  assert.ok(manifest.entries.some(e => e.id === '2026-06-12-first'), 'manifest rebuilt to include the written entry');
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

test('batch: specs carry inline body prose; source body in a spec is a per-entry error', () => {
  const dir = freshVault();
  const ok = runBatch(dir, writePlan([
    { type: 'source', title: 'Body docs', url: 'https://body.example.com/x' },
    { type: 'note', title: 'Body note', sources: ['2026-06-12-body-docs'], summary: 'One claim.', body: '## Load-bearing claims\n- Real prose.' },
  ]), NOW);
  assert.equal(ok.errors.length, 0);
  assert.match(readFileSync(ok.created[1].path, 'utf8'), /- Real prose\./);

  const bad = runBatch(dir, writePlan([
    { type: 'source', title: 'Gated batch', url: 'https://body.example.com/y', body: 'pasted' },
  ]), NOW);
  assert.equal(bad.created.length, 0);
  assert.match(bad.errors[0].error, /store-body/);
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

const URLS = ['https://a.example.com/one', '', '# comment', 'https://b.example.com/two', 'https://c.example.com/bad'];
const BODY_A = Buffer.from('<html><head><title> One \n Page </title></head></html>');
const fakeFetch = async (url) => {
  if (url.endsWith('/one')) return { status: 200, hash: sha256(BODY_A), body: BODY_A };
  if (url.endsWith('/two')) return { status: 200, hash: sha256('plain'), body: Buffer.from('plain') };
  throw new Error('boom');
};
function writeUrls() {
  const p = join(mkdtempSync(join(tmpdir(), 'rv-urls-')), 'urls.txt');
  writeFileSync(p, URLS.join('\n') + '\n', 'utf8');
  return p;
}

test('ingest: a URL list fetches each line, fails the item on a thrown fetch, writes nothing without --continue and the rest with it (spec 31 D1)', async () => {
  const dir = freshVault();
  const file = writeUrls();
  const r = await ingest(dir, file, { ...NOW, fetch: fakeFetch });
  assert.deepEqual(r.errors, [{ index: 2, error: 'fetch failed: boom' }]);
  assert.deepEqual(r.created, []);
  assert.ok(!existsSync(join(dir, 'sources', '2026-06-12-one-page.md')));
  const c = await ingest(dir, file, { ...NOW, fetch: fakeFetch, continue: true });
  assert.deepEqual(c.created.map(x => x.id), ['2026-06-12-one-page', makeId('2026-06-12', 'https://b.example.com/two')]);
  assert.deepEqual(c.errors, [{ index: 2, error: 'fetch failed: boom' }]);
  const one = readFileSync(join(dir, 'sources', '2026-06-12-one-page.md'), 'utf8');
  assert.ok(one.includes(`content_hash: "${sha256(BODY_A)}"`));
  assert.ok(!one.includes('<html'), 'no body stored without --store-body');
  const dir2 = freshVault();
  const s = await ingest(dir2, file, { ...NOW, fetch: fakeFetch, continue: true, storeBody: true, ackDataEgress: true });
  assert.equal(s.created.length, 2);
  assert.ok(readFileSync(join(dir2, 'sources', '2026-06-12-one-page.md'), 'utf8').includes('<title>'));
  const noAck = await ingest(freshVault(), file, { ...NOW, fetch: fakeFetch, continue: true, storeBody: true });
  assert.equal(noAck.errors.length, 3, 'every kept line is an error');
  assert.equal(noAck.created.length, 0);
  const off = await ingest(freshVault(), file, NOW);
  assert.equal(off.errors[0].index, -1);
  assert.match(off.errors[0].error, /RESEARCH_VAULT_ALLOW_NETWORK/);
  assert.equal(lintVault(dir, process.cwd()).violations.length, 0);
});

test('ingest: a Markdown directory takes the URL, title and author from frontmatter, else the first link and heading; a file with no URL fails (spec 31 D1)', async () => {
  const dir = freshVault();
  const md = mkdtempSync(join(tmpdir(), 'rv-md-'));
  writeFileSync(join(md, 'a.md'), '---\ntitle: Alpha doc\nauthor: Ada\nsource_url: https://d.example.com/a\n---\n# Alpha\n\nbody\n', 'utf8');
  writeFileSync(join(md, 'b.md'), '# Beta\n\nsee [it](https://d.example.com/b)\n', 'utf8');
  writeFileSync(join(md, 'c.md'), '# Gamma\n\nno link\n', 'utf8');
  const r = await ingest(dir, md, NOW);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].index, 2);
  assert.match(r.errors[0].error, /^no source URL/);
  assert.deepEqual(r.created, []);
  const c = await ingest(dir, md, { ...NOW, continue: true });
  assert.deepEqual(c.created.map(x => x.id), ['2026-06-12-alpha-doc', '2026-06-12-beta']);
  assert.equal(c.errors.length, 1);
  const a = readFileSync(join(dir, 'sources', '2026-06-12-alpha-doc.md'), 'utf8');
  assert.ok(a.includes(`content_hash: "${sha256(readFileSync(join(md, 'a.md')))}"`));
  assert.match(a, /^source_author: Ada$/m);
  assert.equal(lintVault(dir, process.cwd()).violations.length, 0);
});

test('capture --batch via run(): a URL list goes to ingest, exits 1 with the failed item under --continue, and refuses without the network variable (spec 31 D1)', async () => {
  const dir = freshVault();
  const file = writeUrls();
  const saved = process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  delete process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = s => { out.push(s); return true; };
  let code, parsed;
  try {
    code = await run({ batch: file, vault: dir, fetch: fakeFetch, continue: true });
    parsed = JSON.parse(out.join(''));
    out.length = 0;
    const off = await run({ batch: file, vault: freshVault() });
    assert.equal(off, 1);
    assert.equal(JSON.parse(out.join('')).errors[0].index, -1);
  } finally {
    process.stdout.write = orig;
    if (saved !== undefined) process.env.RESEARCH_VAULT_ALLOW_NETWORK = saved;
  }
  assert.equal(code, 1);
  assert.equal(parsed.created.length, 2);
  assert.equal(parsed.errors[0].error, 'fetch failed: boom');
});
