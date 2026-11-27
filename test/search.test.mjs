import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, appendFileSync, existsSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchVault, matchRows, semanticSearch, sortRows } from '../bin/commands/search.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { relatedTo } from '../bin/commands/related.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';
import { run as searchRun, STALE_WEIGHT } from '../bin/commands/search.mjs';
import { run as embedRun } from '../bin/commands/embed.mjs';
import { applyVerification } from '../bin/commands/verify.mjs';
import { writeEntry } from '../bin/lib/fsutil.mjs';
import { PROJECT_CONFIG_FILENAME } from '../bin/lib/projectconfig.mjs';
import { INDEX } from '../bin/lib/embed.mjs';
import { fieldOrder } from '../bin/lib/schema.mjs';
import { mkdirSync } from 'node:fs';
import {
  assertEmbeddingRefusal, assertEmbeddingReplyRefusal, boundRepo, embeddingEnv, fakeFetch, HTTPS_ENDPOINT,
  LOOPBACK_ENDPOINT, normalisedEndpoints, recordEmbeddingRun, refusedEmbeddingReplies, refusedEndpoints, unapprovedUrls,
} from './embed.test.mjs';
import { REPO_ROOT, assertVaultUntouched, outsideVaultRepo, put, testEnv, tmpVault } from './helpers.mjs';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-search-')), 'v');
  cpSync(VAULT, dir, { recursive: true });
  return dir;
}

test('CLI search reports a refused project vault and accepts an explicit --vault', (t) => {
  const fixture = outsideVaultRepo(t);
  const { vault, id, title } = fixture;
  const cwd = realpathSync(fixture.cwd);
  const binding = join(cwd, PROJECT_CONFIG_FILENAME);
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const search = (...args) => spawnSync(process.execPath, [cli, 'search', '--type', 'note', '--json', ...args], {
    cwd, env: testEnv(), encoding: 'utf8',
  });
  const refused = search();
  assert.equal(refused.status, 2, refused.stderr);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^error: .*vault outside its repository[^\r\n]+\n$/);
  assert.ok(refused.stderr.includes(binding));
  assertVaultUntouched(fixture);

  const selected = search('--vault', vault);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.stderr, '');
  assert.deepEqual(JSON.parse(selected.stdout).map(row => [row.id, row.title]), [[id, title]]);
});

test('search filters by type and topic', () => {
  const r = searchVault(freshVault(), { type: 'source', topic: 'x' });
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
    confidence: 'high', now: '2026-05-30', repoRoot: REPO_ROOT,
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
  applyVerification(dir, { id: '2026-01-02-old', method: 'refetched-source', result: 'outdated', supersededBy: '2026-01-03-new', now: '2026-01-05', repoRoot: REPO_ROOT });
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
    try { await run({ _: ['search'], vault: dir, cwd: dir, type: 'source', ...args }); } finally { process.stdout.write = so; }
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
  const vault = freshVault();
  const rows = buildManifest(vault).entries.filter(e => e.status !== 'superseded');
  for (const q of [{ type: 'source', topic: 'x' }, { text: 'a' }, { topic: 'tdd' }]) {
    assert.deepEqual(matchRows(rows, q, { tdd: 'test-driven-development' }).map(e => e.id), searchVault(vault, q).map(e => e.id));
  }
});

test('sortRows authority: taxonomy order, untiered last, ties keep incoming order (spec 23 D2)', () => {
  const schema = loadSchema(REPO_ROOT);
  const rows = ['tertiary', null, 'primary', 'secondary', null].map((authority_tier, i) => ({ id: `r${i}`, authority_tier }));
  assert.deepEqual(sortRows(rows, 'authority', schema).map(e => e.id), ['r2', 'r3', 'r0', 'r1', 'r4']);
  assert.throws(() => sortRows(rows, 'nope', schema), /--sort must be authority or fresh/);
});

test('sortRows fresh: fresh, stale, not assessable, ties keep incoming order (spec 23 D3)', () => {
  const schema = loadSchema(REPO_ROOT);
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
  captureEntry(dir, { type: 'source', title: 'T', url: 'https://example.com/t', authorityTier: 'tertiary', now: '2026-01-01', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'source', title: 'N', url: 'https://example.com/n', now: '2026-01-02', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'source', title: 'P', url: 'https://example.com/p', authorityTier: 'primary', now: '2026-01-03', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'note', title: 'Note', sources: '2026-01-03-p', now: '2026-01-04', repoRoot: REPO_ROOT });
  const ids = q => searchVault(dir, q).map(e => e.id);
  assert.deepEqual(ids({}), ['2026-01-01-t', '2026-01-02-n', '2026-01-03-p', '2026-01-04-note'], 'default is manifest order');
  assert.deepEqual(ids({ sort: 'authority' }), ['2026-01-03-p', '2026-01-01-t', '2026-01-02-n', '2026-01-04-note']);
  const { run } = await import('../bin/commands/search.mjs');
  const out = [];
  const so = process.stdout.write; process.stdout.write = c => { out.push(String(c)); return true; };
  try { await run({ _: ['search'], vault: dir, cwd: dir, now: '2026-01-05' }); } finally { process.stdout.write = so; }
  const text = out.join('');
  assert.match(text, /^2026-01-03-p {2}\[source\] {2}P {2}\(primary, fresh\)$/m);
  assert.match(text, /^2026-01-02-n {2}\[source\] {2}N {2}\(no tier, fresh\)$/m);
  assert.match(text, /^2026-01-04-note {2}\[note\] {2}Note {2}\(no tier, fresh\)$/m);
});

test('a vault alias pair reaches search: --topic kubernetes finds an entry carrying only k8s (spec 24 D2)', () => {
  const root = mkdtempSync(join(tmpdir(), 'rv-alias-'));
  writeFileSync(join(root, '.research-vault.json'), '{"vault":"v","taxonomy_extensions":{"topic_aliases":{"k8s":"kubernetes"}}}');
  const dir = join(root, 'v');
  captureEntry(dir, { type: 'source', title: 'K', url: 'https://example.com/k', topics: 'k8s', now: '2026-01-01', repoRoot: REPO_ROOT });
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
  try { await run({ _: ['search'], vault: dir, cwd: dir, type: 'source', text: 'first' }); } finally { process.stdout.write = so; }
  const e = readUsage(dir).at(-1);
  assert.deepEqual([e.kind, e.via, e.type, e.outcome, e.ids, 'text' in e], ['queried', 'search', 'source', 'hits', ['2026-01-01-first'], false]);
});

test('search --semantic ranks by cosine over the index, weights stale rows down, drops superseded rows, honours --limit and refuses as the plan says (spec 34 D3)', async (t) => {
  const dir = freshVault();
  const schema = loadSchema(REPO_ROOT);
  const src = (id, body, extra = {}) => {
    const data = { title: id, type: 'note', created: '2026-01-01', domain: ['software-engineering'], stage: 'distilled', topics: [], status: 'active', related: [], volatility: 'slow', sources: ['2026-01-01-a'], confidence: 'medium', summary: body,
      verifications: [{ date: '2026-11-02', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }], ...extra };
    mkdirSync(join(dir, 'notes'), { recursive: true });
    writeEntry(join(dir, 'notes', `${id}.md`), data, `# ${id}\n\n${body}\n`, fieldOrder(schema, 'note'));
  };
  src('2026-01-01-zig-note', 'zig zig zig');
  src('2026-01-01-k8s-note', 'kubernetes kubernetes');
  src('2026-01-01-k8s-stale', 'kubernetes kubernetes', { volatility: 'fast', verifications: [{ date: '2026-01-01', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }] });
  src('2026-01-01-zig-old', 'zig zig');
  const repo = boundRepo(dir);
  embeddingEnv(t);
  const out = [], errs = [];
  const so = process.stdout.write.bind(process.stdout), se = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(s); return true; }; process.stderr.write = (s) => { errs.push(s); return true; };
  try {
    assert.equal(await searchRun({ _: ['search'], vault: dir, cwd: repo, semantic: 'zig writer', 'ack-data-egress': true, fetch: fakeFetch() }), 1);
    assert.match(errs.at(-1), /run embed first/);
    assert.equal(await embedRun({ vault: dir, cwd: repo, 'ack-data-egress': true, fetch: fakeFetch() }), 0);
    applyVerification(dir, { id: '2026-01-01-zig-old', method: 'cross-referenced', result: 'outdated', supersededBy: '2026-01-01-zig-note', repoRoot: REPO_ROOT });
    out.length = 0;
    assert.equal(await searchRun({ _: ['search'], vault: dir, cwd: repo, semantic: 'zig writer', 'ack-data-egress': true, fetch: fakeFetch(), json: true, now: '2026-11-02' }), 0);
    const rows = JSON.parse(out.join(''));
    assert.equal(rows[0].id, '2026-01-01-zig-note');
    assert.equal(rows[0].score.toFixed(2), '1.00');
    assert.ok(!rows.some(r => r.id === '2026-01-01-zig-old'), 'the superseded row is dropped');
    out.length = 0;
    assert.equal(await searchRun({ _: ['search'], vault: dir, cwd: repo, semantic: 'kubernetes scheduler', 'ack-data-egress': true, fetch: fakeFetch(), json: true, now: '2026-11-02' }), 0);
    const k = JSON.parse(out.join(''));
    assert.equal(k[0].id, '2026-01-01-k8s-note');
    assert.equal(k[1].id, '2026-01-01-k8s-stale');
    assert.ok(Math.abs(k[1].score - k[0].score * STALE_WEIGHT) < 1e-9, 'the stale row is weighted down');
    out.length = 0;
    assert.equal(await searchRun({ _: ['search'], vault: dir, cwd: repo, semantic: 'zig writer', 'ack-data-egress': true, fetch: fakeFetch(), limit: '1', now: '2026-11-02' }), 0);
    const lines = out.join('').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^2026-01-01-zig-note  \[note\]  2026-01-01-zig-note  \(no tier, fresh\)  score 1\.00 #0$/);
    assert.equal(await searchRun({ _: ['search'], vault: dir, cwd: repo, semantic: 'zig', 'ack-data-egress': true, fetch: fakeFetch(), sort: 'fresh' }), 1);
    assert.match(errs.at(-1), /cannot be combined with --sort/);
    assert.equal(await searchRun({ _: ['search'], vault: dir, cwd: repo, semantic: 'zig', fetch: fakeFetch() }), 1);
    assert.match(errs.at(-1), /--ack-data-egress/);
  } finally {
    process.stdout.write = so; process.stderr.write = se;
  }
});

test('search --semantic refuses an unset, empty, invalid or different approved URL before reading the index', async (t) => {
  embeddingEnv(t);
  const vault = freshVault();
  const cwd = boundRepo(vault, { url: HTTPS_ENDPOINT });
  for (const [label, url] of unapprovedUrls) await t.test(label, async () => {
    if (url === undefined) delete process.env.RESEARCH_VAULT_EMBED_URL;
    else process.env.RESEARCH_VAULT_EMBED_URL = url;
    assertEmbeddingRefusal(await recordEmbeddingRun(searchRun, { vault, cwd, semantic: 'zig' }), 'search', `set RESEARCH_VAULT_EMBED_URL to ${HTTPS_ENDPOINT} to allow this embedding endpoint`);
    assert.equal(existsSync(join(vault, INDEX)), false);
  });
});

function writeEmptyIndex(vault) {
  mkdirSync(join(vault, '_index'), { recursive: true });
  writeFileSync(join(vault, INDEX), '{}\n');
}

test('search --semantic sends the query to approved HTTPS or loopback HTTP and shows the destination before fetching', async (t) => {
  embeddingEnv(t, LOOPBACK_ENDPOINT, 'test-key');
  const vault = freshVault();
  writeEmptyIndex(vault);
  for (const address of ['HTTPS://EMBED.EXAMPLE.TEST:443', 'http://127.0.0.1:1/', 'http://localhost:1/', 'http://[::1]:1/']) {
    const url = new URL(address).href;
    process.env.RESEARCH_VAULT_EMBED_URL = url;
    const result = await recordEmbeddingRun(searchRun, { vault, cwd: boundRepo(vault, { url: address }), semantic: 'zig', json: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '[]\n');
    assert.equal(result.stderr, `search: sending the query to ${url}\n`);
    assert.equal(result.calls.length, 1);
    const [call] = result.calls;
    assert.equal(call.url, url);
    assert.equal(call.init.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(call.init.body), { input: ['zig'] });
    assert.equal(call.stderr, result.stderr);
  }
});

test('search --semantic refuses non-loopback HTTP and URLs with user-info, including in direct calls', async (t) => {
  embeddingEnv(t);
  const vault = freshVault();
  for (const [url, reason] of refusedEndpoints) {
    process.env.RESEARCH_VAULT_EMBED_URL = url;
    assertEmbeddingRefusal(await recordEmbeddingRun(searchRun, { vault, cwd: boundRepo(vault, { url }), semantic: 'zig' }), 'search', reason);
    const calls = [];
    await assert.rejects(semanticSearch(vault, { url }, 'zig', {}, { fetch: fakeFetch(calls) }), { message: reason });
    assert.deepEqual(calls, []);
    assert.equal(existsSync(join(vault, INDEX)), false);
  }
});

test('semanticSearch refuses an unapproved address before reading the index', async (t) => {
  embeddingEnv(t);
  const vault = freshVault();
  mkdirSync(join(vault, INDEX), { recursive: true });
  const calls = [];
  await assert.rejects(semanticSearch(vault, { url: HTTPS_ENDPOINT }, 'zig', {}, { fetch: fakeFetch(calls) }), {
    message: `set RESEARCH_VAULT_EMBED_URL to ${HTTPS_ENDPOINT} to allow this embedding endpoint`,
  });
  assert.deepEqual(calls, []);
});

test('search --semantic prints the normalised address in the refusal and before fetching', async (t) => {
  const vault = freshVault();
  writeEmptyIndex(vault);
  for (const [label, address, url] of normalisedEndpoints) await t.test(label, async (t) => {
    embeddingEnv(t, '');
    const args = { vault, cwd: boundRepo(vault, { url: address }), semantic: 'zig' };
    const refused = await recordEmbeddingRun(searchRun, args);
    assertEmbeddingRefusal(refused, 'search', `set RESEARCH_VAULT_EMBED_URL to ${url} to allow this embedding endpoint`);
    process.env.RESEARCH_VAULT_EMBED_URL = refused.stderr.match(/ to (\S+) to allow this embedding endpoint\n$/)[1];
    const allowed = await recordEmbeddingRun(searchRun, args);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(allowed.stderr, `search: sending the query to ${url}\n`);
    assert.equal(allowed.calls.length, 1);
    assert.equal(allowed.calls[0].url, url);
    assert.equal(allowed.calls[0].stderr, allowed.stderr);
  });
});

test('search --semantic refuses unusable replies with one fixed error line and leaves the index intact', async (t) => {
  embeddingEnv(t, HTTPS_ENDPOINT);
  const vault = freshVault();
  writeEmptyIndex(vault);
  const cwd = boundRepo(vault, { url: HTTPS_ENDPOINT });
  for (const [label, reply, reason] of refusedEmbeddingReplies) await t.test(label, async () => {
    const result = await recordEmbeddingRun(searchRun, { vault, cwd, semantic: 'zig', fetch: async () => reply(1) });
    assertEmbeddingReplyRefusal(result, 'search', reason);
    assert.equal(readFileSync(join(vault, INDEX), 'utf8'), '{}\n');
  });
});

test('search --semantic refuses a rejected redirect without printing its location or writing the index', async (t) => {
  embeddingEnv(t, HTTPS_ENDPOINT);
  const vault = freshVault();
  writeEmptyIndex(vault);
  const result = await recordEmbeddingRun(searchRun, { vault, cwd: boundRepo(vault, { url: HTTPS_ENDPOINT }), semantic: 'zig', fetch: async () => {
    throw new Error('redirect to https://redirect.example.test/');
  } });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].init.redirect, 'error');
  assert.equal(result.stderr, `${result.calls[0].stderr}search refused: embedding endpoint request failed\n`);
  assert.equal(readFileSync(join(vault, INDEX), 'utf8'), '{}\n');
});

test('CLI search --semantic refuses an endpoint without URL approval', () => {
  // There is no index, so this fixture cannot reach fetch even if the refusal is absent.
  const vault = freshVault();
  const cwd = boundRepo(vault, { url: HTTPS_ENDPOINT });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'search', '--vault', vault, '--semantic', 'zig', '--ack-data-egress'], {
    cwd, env: testEnv({ RESEARCH_VAULT_ALLOW_NETWORK: '1' }), encoding: 'utf8',
  });
  assert.equal(result.stderr, `search refused: set RESEARCH_VAULT_EMBED_URL to ${HTTPS_ENDPOINT} to allow this embedding endpoint\n`);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(join(vault, INDEX)), false);
});

test('CLI search --semantic refuses an unapproved address before resolving the bound vault', () => {
  const cwd = boundRepo('missing\0vault', { url: HTTPS_ENDPOINT });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const run = approved => spawnSync(process.execPath, [cli, 'search', '--semantic', 'zig', '--ack-data-egress'], {
    cwd, env: testEnv({ RESEARCH_VAULT_ALLOW_NETWORK: '1', RESEARCH_VAULT_EMBED_URL: approved }), encoding: 'utf8',
  });
  const refused = run();
  assert.equal(refused.stderr, `search refused: set RESEARCH_VAULT_EMBED_URL to ${HTTPS_ENDPOINT} to allow this embedding endpoint\n`);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, '');
  const approved = run(HTTPS_ENDPOINT);
  assert.equal(approved.status, 2, approved.stderr);
  assert.match(approved.stderr, /vault that could not be resolved/);
});

// S-11: a text line shows each value from an entry on one line, with no control, zero-width or bidi character.
test('search text output: a title and a superseded-by id from an entry cannot add a line or hide text', t => {
  const v = tmpVault('rv-search-s11-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  put(v, 'source', '2026-01-01-forged', {
    title: 'zig writer\n2026-01-09-fake  [source]  forged line\u200b\u202e\u0007 tail', source_url: 'https://example.org/forged', source_type: 'article',
    status: 'superseded', superseded_by: '2026-01-02-x\n2026-01-03-forged  [note]  forged\u2028',
  });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'search', '--vault', v, '--text', 'zig', '--include-superseded', '--now', '2026-01-02'], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '2026-01-01-forged  [source]  zig writer 2026-01-09-fake [source] forged line tail  (no tier, fresh) (superseded by 2026-01-02-x 2026-01-03-forged [note] forged)\n');
});

// Tag characters spelling "ignore", invisible in a terminal and in most renderers.
const TAGS = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';

test("search text output: an entry's type and authority tier cannot add a line or hide text", t => {
  const v = tmpVault('rv-search-s11-type-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  put(v, 'source', '2026-01-01-forged', {
    type: `source\n2026-01-09-fake  [note]${TAGS}`, authority_tier: `primary\n2026-01-08-fake  [note]${TAGS}`,
    title: 'zig writer', source_url: 'https://example.org/forged', source_type: 'article',
  });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'search', '--vault', v, '--text', 'zig', '--now', '2026-01-02'], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '2026-01-01-forged  [source 2026-01-09-fake [note]]  zig writer  (primary 2026-01-08-fake [note], fresh)\n');
});

// The CLI runs as a child process against a loopback stub endpoint served from this one, which answers every
// window and the query with one vector, so the one entry scores 1.00. Embeds vault v, then returns the run of
// `search --semantic 'zig writer'`.
async function semanticSearchCli(t, v) {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: JSON.parse(body).input.map(() => ({ embedding: [1, 0] })) }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/v1/embeddings`;
  const repo = boundRepo(v, { url, model: 'fake' });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const runCli = async (args) => {
    const child = spawn(process.execPath, [cli, ...args, '--vault', v, '--ack-data-egress'], {
      cwd: repo, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], env: testEnv({ RESEARCH_VAULT_ALLOW_NETWORK: '1', RESEARCH_VAULT_EMBED_URL: url }),
    });
    t.after(() => child.kill('SIGKILL'));
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    const [status] = await once(child, 'exit');
    return { status, stdout, stderr };
  };
  const embedded = await runCli(['embed']);
  assert.equal(embedded.status, 0, embedded.stderr);
  return runCli(['search', '--semantic', 'zig writer', '--now', '2026-01-02']);
}

test('search --semantic text output: an entry title cannot add a line or hide text', { timeout: 60000 }, async t => {
  const v = tmpVault('rv-search-s11-semantic-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  put(v, 'source', '2026-01-01-forged', { title: `zig writer\n2026-01-09-fake  [source]  forged  score 1.00 #0${TAGS}`, source_url: 'https://example.org/forged', source_type: 'article' });
  const r = await semanticSearchCli(t, v);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '2026-01-01-forged  [source]  zig writer 2026-01-09-fake [source] forged score 1.00 #0  (no tier, fresh)  score 1.00 #0\n');
});

// An entry id comes from its file name, which can hold a line break and tag characters.
test('search --semantic text output: an entry id from a file name cannot add a line or hide text', { timeout: 60000 }, async t => {
  const v = tmpVault('rv-search-s11-semantic-id-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  put(v, 'source', `2026-01-01-forged\n2026-01-09-fake  [source]  forged${TAGS}`, { title: 'zig writer', source_url: 'https://example.org/forged', source_type: 'article' });
  const r = await semanticSearchCli(t, v);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '2026-01-01-forged 2026-01-09-fake [source] forged  [source]  zig writer  (no tier, fresh)  score 1.00 #0\n');
});

// S-13: a topic, a query or an alias target that names an Object.prototype member is a word, not a member.
test('S-13: a topic or alias target that names an Object.prototype member is matched as a word', () => {
  for (const name of ['__proto__', 'toString', 'hasOwnProperty', 'constructor']) {
    const rows = [{ id: 'a', topics: ['al'] }, { id: 'b', topics: [name] }, { id: 'c', topics: ['x'] }];
    assert.deepEqual(matchRows(rows, { topic: name }, { al: name }).map(e => e.id), ['a', 'b'], name);
    assert.deepEqual(matchRows(rows, { topic: 'al' }, { al: name }).map(e => e.id), ['a', 'b'], name);
    assert.deepEqual(matchRows(rows, { topic: name }).map(e => e.id), ['b'], name);
  }
});

test('S-13: related on an entry whose id names an Object.prototype member and has no backlinks lists none', t => {
  for (const name of ['__proto__', 'toString', 'hasOwnProperty', 'constructor']) {
    const dir = tmpVault('rv-s13-related-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    put(dir, 'source', name, { created: '2026-01-01', source_type: 'article', source_url: 'https://example.com/s' });
    assert.deepEqual(relatedTo(dir, name).backlinks, [], name);
  }
});
