import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embedTexts, cosine, readIndex, INDEX } from '../bin/lib/embed.mjs';
import { run as embedRun } from '../bin/commands/embed.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';
import { applyVerification } from '../bin/commands/verify.mjs';

export function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-embed-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

// A bound scratch repo: its .research-vault.json carries the vault path and the embedding block.
export function boundRepo(vault, embedding = { url: 'http://127.0.0.1:1/v1/embeddings', model: 'fake' }) {
  const repo = mkdtempSync(join(tmpdir(), 'rv-embed-repo-'));
  writeFileSync(join(repo, '.research-vault.json'), JSON.stringify({ vault, embedding }), 'utf8');
  return repo;
}

// The fake endpoint: a vector of counts over a fixed vocabulary, so the ranking is predictable.
export const VOCAB = ['zig', 'kubernetes', 'scheduler'];
export const vec = (t) => VOCAB.map(w => (t.toLowerCase().match(new RegExp(w, 'g')) || []).length);
export function fakeFetch(calls = [], shape = 'data') {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, method: init.method, headers: init.headers, body });
    const vectors = body.input.map(vec);
    return { ok: true, status: 200, json: async () => shape === 'data' ? { data: vectors.map(embedding => ({ embedding })) } : { embeddings: vectors } };
  };
}

function withNetwork(fn) {
  const saved = process.env.RESEARCH_VAULT_ALLOW_NETWORK;
  process.env.RESEARCH_VAULT_ALLOW_NETWORK = '1';
  return fn().finally(() => { if (saved === undefined) delete process.env.RESEARCH_VAULT_ALLOW_NETWORK; else process.env.RESEARCH_VAULT_ALLOW_NETWORK = saved; });
}

test('embedTexts posts { input, model } as JSON, adds the bearer key only when set, reads both response shapes, and throws on a bad status or count (spec 34 D2)', async () => {
  const cfg = { url: 'http://h/e', model: 'm' };
  const calls = [];
  delete process.env.RESEARCH_VAULT_EMBED_KEY;
  const v = await embedTexts(cfg, ['zig zig', 'kubernetes'], { fetch: fakeFetch(calls) });
  assert.deepEqual(v, [[2, 0, 0], [0, 1, 0]]);
  assert.deepEqual(calls[0], { url: 'http://h/e', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { input: ['zig zig', 'kubernetes'], model: 'm' } });
  process.env.RESEARCH_VAULT_EMBED_KEY = 'k';
  try { await embedTexts(cfg, ['x'], { fetch: fakeFetch(calls) }); } finally { delete process.env.RESEARCH_VAULT_EMBED_KEY; }
  assert.equal(calls[1].headers.Authorization, 'Bearer k');
  assert.deepEqual(await embedTexts(cfg, ['scheduler'], { fetch: fakeFetch([], 'embeddings') }), [[0, 0, 1]]);
  await assert.rejects(embedTexts(cfg, ['x'], { fetch: async () => ({ ok: false, status: 500 }) }), /embedding endpoint 500/);
  await assert.rejects(embedTexts(cfg, ['x', 'y'], { fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: [1] }] }) }) }), /1 vectors for 2 texts/);
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test('embed writes the index (a header, one row per window, superseded entries left out) and refuses without the block, the variable or the ack (spec 34 D2)', async () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'note', title: 'Zig writer', sources: ['2026-01-01-a'], summary: 'zig', body: 'zig zig zig' });
  const gone = captureEntry(dir, { type: 'note', title: 'Old zig', sources: ['2026-01-01-a'], summary: 'zig', body: 'zig' });
  applyVerification(dir, { id: gone.id, method: 'cross-referenced', result: 'outdated', supersededBy: '2026-01-01-a', repoRoot: process.cwd() });
  const repo = boundRepo(dir);
  const orig = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr);
  const errs = [];
  process.stdout.write = () => true; process.stderr.write = (s) => { errs.push(s); return true; };
  try {
    delete process.env.RESEARCH_VAULT_ALLOW_NETWORK;
    assert.equal(await embedRun({ vault: dir, cwd: repo, 'ack-data-egress': true, fetch: fakeFetch() }), 1);
    assert.match(errs.at(-1), /RESEARCH_VAULT_ALLOW_NETWORK/);
    await withNetwork(async () => {
      assert.equal(await embedRun({ vault: dir, cwd: repo, fetch: fakeFetch() }), 1);
      assert.match(errs.at(-1), /--ack-data-egress/);
      assert.ok(!existsSync(join(dir, INDEX)));
      assert.equal(await embedRun({ vault: dir, cwd: mkdtempSync(join(tmpdir(), 'rv-unbound-')), 'ack-data-egress': true, fetch: fakeFetch() }), 1);
      assert.match(errs.at(-1), /no embedding endpoint/);
      const calls = [];
      assert.equal(await embedRun({ vault: dir, cwd: repo, 'ack-data-egress': true, fetch: fakeFetch(calls) }), 0);
      assert.ok(calls.length >= 1);
    });
  } finally { process.stdout.write = orig; process.stderr.write = origErr; }
  const index = readIndex(dir);
  assert.deepEqual(Object.keys(index.header), ['url', 'model', 'dimensions', 'chunk', 'overlap', 'built']);
  assert.equal(index.header.dimensions, 3);
  assert.ok(index.rows.length > 0);
  assert.ok(index.rows.every(r => typeof r.id === 'string' && 'index' in r.chunk && typeof r.text === 'string' && r.vector.length === 3));
  assert.ok(!index.rows.some(r => r.id === gone.id), 'the superseded entry is not indexed');
  assert.equal(readIndex(freshVault()), null);
});
