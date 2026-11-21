import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { editedPaths, adaptCodex } from '../hooks/codex.mjs';
import { assertVaultUntouched, outsideVaultRepo, testEnv, tmpVault } from './helpers.mjs';

test('Codex patch normalization includes creations, edits, moves and deletes once', () => {
  const cwd = tmpVault('rv-patch-');
  const evt = { cwd, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: a.md\n+x\n*** Update File: b.md\n*** Move to: c.md\n*** Delete File: a.md\n*** End Patch' } };
  assert.deepEqual(editedPaths(evt), ['a.md', 'b.md', 'c.md'].map(p => join(cwd, p)));
  const calls = [];
  const output = adaptCodex('PostToolUse', evt, { invoke: (file, payload) => { calls.push(payload.tool_input.file_path); return JSON.stringify({ hookSpecificOutput: { additionalContext: payload.tool_input.file_path } }); } });
  assert.deepEqual(calls, editedPaths(evt));
  assert.ok(output.hookSpecificOutput.additionalContext.includes('c.md'));
});

test('Codex adapter rejects traversal and shell-shaped patches rather than evaluating them', () => {
  const cwd = tmpVault('rv-patch-');
  const evt = command => ({ cwd, tool_name: 'apply_patch', tool_input: { command } });
  assert.throws(() => adaptCodex('PostToolUse', evt('*** Begin Patch\n*** Add File: ../outside.md\n+x\n*** End Patch')), /escapes/);
  assert.throws(() => editedPaths(evt('sh -c "touch anything"')), /unrecognized/);
});

test('Codex adapter preserves Stop decisions and merges session guidance', () => {
  assert.deepEqual(adaptCodex('Stop', {}, { invoke: () => '{"decision":"block","reason":"missing verdict"}' }), { decision: 'block', reason: 'missing verdict' });
  const s = adaptCodex('SessionStart', {}, { invoke: () => 'research-vault: 3 entries; 1 stale' });
  assert.match(s.hookSpecificOutput.additionalContext, /3 entries/);
  assert.match(s.hookSpecificOutput.additionalContext, /search the vault explicitly/);
});

test('Codex PostToolUse gives only a notice for a refused outside vault', (t) => {
  const fixture = outsideVaultRepo(t);
  const { cwd, binding, entry, id, title } = fixture;
  const hook = fileURLToPath(new URL('../hooks/codex.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [hook, 'PostToolUse'], {
    cwd, env: testEnv(), encoding: 'utf8',
    input: JSON.stringify({ cwd, tool_name: 'Write', tool_input: { file_path: entry } }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ['systemMessage']);
  assert.match(output.systemMessage, /Codex hook skipped.*vault outside its repository/);
  assert.ok(output.systemMessage.includes(binding));
  assert.ok(!output.systemMessage.includes(id));
  assert.ok(!output.systemMessage.includes(title));
  assertVaultUntouched(fixture);
});
