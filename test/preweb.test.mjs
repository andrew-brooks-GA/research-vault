import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertVaultUntouched, outsideVaultRepo, tmpVault, put, testEnv } from './helpers.mjs';
import { vaultContext } from '../hooks/pre-web.mjs';
import { writeBlocklist } from './blocklist.test.mjs';

test('pre-web hook surfaces matching entries and exact URL hits', () => {
  const v = tmpVault('rv-preweb-');
  put(v, 'source', '2026-01-01-zig-io-writer', { title: 'std.Io.Writer print doc comment', topics: ['zig', 'formatting'], summary: 'format specifiers', source_url: 'https://ziglang.org/doc/writer', source_type: 'official-docs', subject: { name: 'Zig', version: '0.17.0' } });
  put(v, 'note', '2026-01-01-unrelated', { title: 'kubernetes sleep mode', topics: ['k8s'] });
  const ctx = vaultContext(v, 'WebSearch', { query: 'zig format specifiers print' });
  assert.match(ctx, /2026-01-01-zig-io-writer/);
  assert.doesNotMatch(ctx, /unrelated/);
  const fetch = vaultContext(v, 'WebFetch', { url: 'https://ZIGLANG.org/doc/writer/?utm_source=feed', prompt: 'anything' });
  assert.equal(fetch, 'research-vault: this URL is already captured as 2026-01-01-zig-io-writer. Cite it; do not capture a duplicate.');
  assert.equal(fetch.split('\n').length, 1, 'a captured URL returns only that line');
  assert.equal(vaultContext(v, 'WebFetch', { url: 'https://other.example.com/x', prompt: 'Return the full page text verbatim' }), '', 'fetch instructions are not search terms');
  const none = vaultContext(v, 'WebSearch', { query: 'rust borrow checker' });
  assert.match(none, /no entry matches/);
});

test('pre-web hook CLI emits PreToolUse additionalContext and exits 0', () => {
  const v = tmpVault('rv-preweb-');
  put(v, 'source', '2026-01-01-vcluster-sleep', { title: 'vcluster sleep mode', topics: ['vcluster'], source_url: 'https://docs.vcluster.com/sleep-mode', source_type: 'official-docs', subject: { name: 'vcluster', version: '0.20' } });
  const r = spawnSync(process.execPath, ['hooks/pre-web.mjs'], { input: JSON.stringify({ tool_name: 'WebSearch', tool_input: { query: 'vcluster sleep mode' }, cwd: v }), env: testEnv({ RESEARCH_VAULT_PATH: v }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /vcluster-sleep/);
});

test('PreToolUse stays silent for a refused outside vault', (t) => {
  const fixture = outsideVaultRepo(t);
  const { cwd, vault, title, id } = fixture;
  const run = env => spawnSync(process.execPath, ['hooks/pre-web.mjs'], {
    env: testEnv(env), encoding: 'utf8', input: JSON.stringify({ cwd, tool_name: 'WebSearch', tool_input: { query: title } }),
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assertVaultUntouched(fixture);

  const chosen = run({ RESEARCH_VAULT_PATH: vault });
  assert.equal(chosen.status, 0, chosen.stderr);
  const lines = readFileSync(join(vault, '_index', 'usage.jsonl'), 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 1);
  const { kind, via, tool, outcome, ids } = JSON.parse(lines[0]);
  assert.deepEqual({ kind, via, tool, outcome, ids },
    { kind: 'queried', via: 'pre-web', tool: 'WebSearch', outcome: 'hits', ids: [id] });
});

test('pre-web hook logs one queried event per call: hits, url-hit, no-match; text only when asked (spec 29 D2)', async () => {
  const { readUsage } = await import('../bin/lib/usagelog.mjs');
  const v = tmpVault('rv-preweb-log-');
  put(v, 'source', '2026-01-01-zig-io-writer', { title: 'std.Io.Writer print doc comment', topics: ['zig', 'formatting'], summary: 'format specifiers', source_url: 'https://ziglang.org/doc/writer', source_type: 'official-docs' });
  vaultContext(v, 'WebSearch', { query: 'zig format specifiers print' });
  vaultContext(v, 'WebFetch', { url: 'https://ZIGLANG.org/doc/writer/?utm_source=feed', prompt: 'anything' });
  vaultContext(v, 'WebFetch', { url: 'https://other.example.com/x', prompt: 'Return the full page text verbatim' });
  vaultContext(v, 'WebSearch', { query: 'rust borrow checker' });
  const r = readUsage(v);
  assert.deepEqual(r.map(e => [e.kind, e.via, e.tool, e.outcome, e.ids]), [
    ['queried', 'pre-web', 'WebSearch', 'hits', ['2026-01-01-zig-io-writer']],
    ['queried', 'pre-web', 'WebFetch', 'url-hit', ['2026-01-01-zig-io-writer']],
    ['queried', 'pre-web', 'WebFetch', 'no-match', []],
    ['queried', 'pre-web', 'WebSearch', 'no-match', []],
  ]);
  assert.ok(r.every(e => !('text' in e)));
  vaultContext(v, 'WebSearch', { query: 'zig format specifiers print' }, { text: true });
  assert.equal(readUsage(v).at(-1).text, 'zig format specifiers print');
});

test('pre-web names a blocklisted URL\'s reason before a fetch, ahead of the captured-already line; WebSearch is unchanged (spec 32 D2)', () => {
  const v = tmpVault('rv-preweb-block-');
  writeBlocklist(v);
  const first = "research-vault: this URL is on the vault's source blocklist (spam.example.com, domain): content farm.";
  assert.equal(vaultContext(v, 'WebFetch', { url: 'https://spam.example.com/a', prompt: 'x' }), first);
  put(v, 'source', '2026-01-01-spam', { source_url: 'https://spam.example.com/a', source_type: 'article' });
  const both = vaultContext(v, 'WebFetch', { url: 'https://spam.example.com/a', prompt: 'x' }).split('\n');
  assert.equal(both.length, 2);
  assert.equal(both[0], first);
  assert.match(both[1], /already captured as 2026-01-01-spam/);
  assert.doesNotMatch(vaultContext(v, 'WebSearch', { query: 'spam example content' }), /blocklist/);
});

test('hooks stay silent and write nothing in a default folder containing only config records', t => {
  const root = tmpVault('rv-not-vault-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo'); mkdirSync(cwd);
  const home = join(root, 'home'); mkdirSync(home);
  const env = testEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), APPDATA: join(home, 'config'), LOCALAPPDATA: join(home, 'data') });
  const vault = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'research-vault') : join(home, 'data', 'research-vault');
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, 'trusted-bindings.json'), '{"version":1,"bindings":[]}');
  writeFileSync(join(vault, 'config.json'), '{}');
  const before = readdirSync(vault).map(name => [name, readFileSync(join(vault, name), 'utf8')]);
  for (const name of ['session-start.mjs', 'pre-web.mjs']) {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL(`../hooks/${name}`, import.meta.url))], {
      cwd, env: testEnv(env), input: JSON.stringify({ cwd, tool_name: 'WebSearch', tool_input: { query: 'unmatched query' } }), encoding: 'utf8', timeout: 20000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.deepEqual(readdirSync(vault).map(name => [name, readFileSync(join(vault, name), 'utf8')]), before);
  }
});

// R-31: one URL key with capture (normalizeUrl), and every active entry for it named.
const today = new Date().toISOString().slice(0, 10);
const fresh = [{ date: today, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

test('pre-web names every active entry for a URL with its version and freshness, and no longer says not to capture', t => {
  const v = tmpVault('rv-preweb-many-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  put(v, 'source', '2026-01-01-page-v1', { source_type: 'official-docs', source_url: 'https://example.org/page', subject: { name: 'lib', version: '1.0' }, verifications: fresh });
  put(v, 'source', '2026-01-02-page-latest', { source_type: 'official-docs', source_url: 'https://example.org/page', volatility: 'volatile' });
  put(v, 'source', '2026-01-03-page-gone', { source_type: 'official-docs', source_url: 'https://example.org/page', status: 'superseded', superseded_by: '2026-01-01-page-v1' });
  const ctx = vaultContext(v, 'WebFetch', { url: 'https://example.org/page', prompt: 'x' });
  assert.equal(ctx, 'research-vault: this URL is captured as more than one entry: 2026-01-01-page-v1 (1.0, fresh), 2026-01-02-page-latest (no version, STALE); cite the one for the version you need.');
  assert.doesNotMatch(ctx, /do not capture a duplicate/);
});

test('pre-web does not take a URL whose path differs only in case for a captured one', async t => {
  const { readUsage } = await import('../bin/lib/usagelog.mjs');
  const v = tmpVault('rv-preweb-case-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  put(v, 'source', '2026-01-01-page', { source_type: 'official-docs', source_url: 'https://example.org/Page' });
  assert.doesNotMatch(vaultContext(v, 'WebFetch', { url: 'https://example.org/page', prompt: 'x' }), /captured as/);
  assert.notEqual(readUsage(v).at(-1).outcome, 'url-hit');
});

test('pre-web does not take a captured URL with a #fragment added for the captured one (capture keys it apart too)', async t => {
  const { readUsage } = await import('../bin/lib/usagelog.mjs');
  const v = tmpVault('rv-preweb-fragment-');
  t.after(() => rmSync(v, { recursive: true, force: true }));
  put(v, 'source', '2026-01-01-page', { source_type: 'official-docs', source_url: 'https://example.org/page' });
  assert.doesNotMatch(vaultContext(v, 'WebFetch', { url: 'https://example.org/page#install', prompt: 'x' }), /captured as/);
  assert.notEqual(readUsage(v).at(-1).outcome, 'url-hit');
});
