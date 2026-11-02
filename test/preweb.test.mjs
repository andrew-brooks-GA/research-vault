import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpVault, put } from './helpers.mjs';
import { vaultContext } from '../hooks/pre-web.mjs';
import { writeBlocklist } from './blocklist.test.mjs';

test('pre-web hook surfaces matching entries and exact URL hits', () => {
  const v = tmpVault('rv-preweb-');
  put(v, 'source', '2026-01-01-zig-io-writer', { title: 'std.Io.Writer print doc comment', topics: ['zig', 'formatting'], summary: 'format specifiers', source_url: 'https://ziglang.org/doc/writer', source_type: 'official-docs', subject: { name: 'Zig', version: '0.17.0' } });
  put(v, 'note', '2026-01-01-unrelated', { title: 'kubernetes sleep mode', topics: ['k8s'] });
  const ctx = vaultContext(v, 'WebSearch', { query: 'zig format specifiers print' });
  assert.match(ctx, /2026-01-01-zig-io-writer/);
  assert.doesNotMatch(ctx, /unrelated/);
  const fetch = vaultContext(v, 'WebFetch', { url: 'https://ziglang.org/doc/writer/#frag', prompt: 'anything' });
  assert.match(fetch, /already captured as 2026-01-01-zig-io-writer/);
  assert.equal(fetch.split('\n').length, 1, 'a captured URL returns only that line');
  assert.equal(vaultContext(v, 'WebFetch', { url: 'https://other.example.com/x', prompt: 'Return the full page text verbatim' }), '', 'fetch instructions are not search terms');
  const none = vaultContext(v, 'WebSearch', { query: 'rust borrow checker' });
  assert.match(none, /no entry matches/);
});

test('pre-web hook CLI emits PreToolUse additionalContext and exits 0', () => {
  const v = tmpVault('rv-preweb-');
  put(v, 'source', '2026-01-01-vcluster-sleep', { title: 'vcluster sleep mode', topics: ['vcluster'], source_url: 'https://docs.vcluster.com/sleep-mode', source_type: 'official-docs', subject: { name: 'vcluster', version: '0.20' } });
  const r = spawnSync(process.execPath, ['hooks/pre-web.mjs'], { input: JSON.stringify({ tool_name: 'WebSearch', tool_input: { query: 'vcluster sleep mode' }, cwd: v }), env: { ...process.env, RESEARCH_VAULT_PATH: v }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /vcluster-sleep/);
});

test('pre-web hook logs one queried event per call: hits, url-hit, no-match; text only when asked (spec 29 D2)', async () => {
  const { readUsage } = await import('../bin/lib/usagelog.mjs');
  const v = tmpVault('rv-preweb-log-');
  put(v, 'source', '2026-01-01-zig-io-writer', { title: 'std.Io.Writer print doc comment', topics: ['zig', 'formatting'], summary: 'format specifiers', source_url: 'https://ziglang.org/doc/writer', source_type: 'official-docs' });
  vaultContext(v, 'WebSearch', { query: 'zig format specifiers print' });
  vaultContext(v, 'WebFetch', { url: 'https://ziglang.org/doc/writer/#frag', prompt: 'anything' });
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
