import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpVault, put } from './helpers.mjs';
import { citationWarnings } from '../hooks/post-tool-use.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'post-tool-use.mjs');
const NOW = '2026-07-20';
const ver = (date) => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

// A bound repo whose docs/ are referenced; the vault holds one fresh and one stale source.
function repo() {
  const root = tmpVault('rv-posttooluse-');
  const vault = join(root, 'research');
  mkdirSync(vault, { recursive: true });
  const cfg = { vault, references: { globs: ['docs/*.md'] } };
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify(cfg) + '\n');
  put(vault, 'source', '2026-07-10-fresh', { source_type: 'article', source_url: 'https://e.com/fresh', volatility: 'fast', verifications: ver('2026-07-10') });
  put(vault, 'source', '2026-01-01-old', { source_type: 'article', source_url: 'https://e.com/old', volatility: 'fast', verifications: ver('2026-01-01') });
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'other'));
  const body = 'See https://e.com/fresh and https://e.com/old and https://e.com/missing.\n';
  writeFileSync(join(root, 'docs', 'a.md'), body);
  writeFileSync(join(root, 'other', 'b.md'), body);
  return { root, vault, cfg };
}

test('citationWarnings reports uncovered and stale citations for a referenced file', () => {
  const { root, vault, cfg } = repo();
  assert.equal(citationWarnings(join(root, 'docs', 'a.md'), root, vault, cfg, NOW), [
    'research-vault: STALE https://e.com/old in docs/a.md',
    'research-vault: UNCOVERED https://e.com/missing in docs/a.md',
    'capture it (or verify the entry) before the claims gate.',
  ].join('\n'));
});

test('citationWarnings is empty for a file outside references.globs and gated files', () => {
  const { root, vault, cfg } = repo();
  assert.equal(citationWarnings(join(root, 'other', 'b.md'), root, vault, cfg, NOW), '');
  writeFileSync(join(root, 'docs', 'clean.md'), 'Only https://e.com/fresh here.\n');
  assert.equal(citationWarnings(join(root, 'docs', 'clean.md'), root, vault, cfg, NOW), '');
  // A gates.globs file is covered too, even outside references.globs.
  const gated = { ...cfg, gates: { globs: ['other/*.md'] } };
  assert.match(citationWarnings(join(root, 'other', 'b.md'), root, vault, gated, NOW), /^research-vault: UNCOVERED https:\/\/e\.com\/missing in other\/b\.md$/m);
});

test('CLI emits PostToolUse additionalContext for a doc edit and nothing for a vault edit', () => {
  const { root, vault } = repo();
  const run = (file_path) => spawnSync(process.execPath, [HOOK], { cwd: root, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path }, cwd: root }), encoding: 'utf8' });
  const doc = run(join(root, 'docs', 'a.md'));
  assert.equal(doc.status, 0, doc.stderr);
  const out = JSON.parse(doc.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /^research-vault: UNCOVERED https:\/\/e\.com\/missing in docs\/a\.md$/m);
  const v = run(join(vault, 'sources', '2026-07-10-fresh.md'));
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout, '');
  const other = run(join(root, 'other', 'b.md'));
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.stdout, '');
});
