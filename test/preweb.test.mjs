import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpVault, put } from './helpers.mjs';
import { vaultContext } from '../hooks/pre-web.mjs';

test('pre-web hook surfaces matching entries and exact URL hits', () => {
  const v = tmpVault('rv-preweb-');
  put(v, 'source', '2026-01-01-zig-io-writer', { title: 'std.Io.Writer print doc comment', topics: ['zig', 'formatting'], summary: 'format specifiers', source_url: 'https://ziglang.org/doc/writer', source_type: 'official-docs', subject: { name: 'Zig', version: '0.17.0' } });
  put(v, 'note', '2026-01-01-unrelated', { title: 'kubernetes sleep mode', topics: ['k8s'] });
  const ctx = vaultContext(v, 'WebSearch', { query: 'zig format specifiers print' });
  assert.match(ctx, /2026-01-01-zig-io-writer/);
  assert.doesNotMatch(ctx, /unrelated/);
  const fetch = vaultContext(v, 'WebFetch', { url: 'https://ziglang.org/doc/writer/#frag', prompt: 'anything' });
  assert.match(fetch, /already captured as 2026-01-01-zig-io-writer/);
  const none = vaultContext(v, 'WebSearch', { query: 'rust borrow checker' });
  assert.match(none, /no entry matches/);
});

test('pre-web hook CLI emits PreToolUse additionalContext and exits 0', () => {
  const v = tmpVault('rv-preweb-');
  put(v, 'source', '2026-01-01-vcluster-sleep', { title: 'vcluster sleep mode', topics: ['vcluster'], source_url: 'https://docs.vcluster.com/sleep-mode', source_type: 'official-docs', subject: { name: 'vcluster', version: '0.20' } });
  const r = spawnSync(process.execPath, ['hooks/pre-web.mjs'], { input: JSON.stringify({ tool_name: 'WebSearch', tool_input: { query: 'vcluster sleep mode' } }), env: { ...process.env, RESEARCH_VAULT_PATH: v }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /vcluster-sleep/);
});
