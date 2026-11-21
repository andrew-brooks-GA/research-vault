import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertVaultUntouched, outsideVaultRepo, tmpVault, put, testEnv } from './helpers.mjs';
import { citationWarnings } from '../hooks/post-tool-use.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'post-tool-use.mjs');
const NOW = '2026-07-20';
const ver = (date) => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

// A bound repo whose docs/ are referenced; the vault holds one fresh and one stale source.
function repo() {
  const root = tmpVault('rv-posttooluse-');
  const vault = join(root, 'research');
  mkdirSync(vault, { recursive: true });
  const cfg = { vault: 'research', references: { globs: ['docs/*.md'] } };
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
  const run = (file_path) => spawnSync(process.execPath, [HOOK], { env: testEnv(), cwd: root, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path }, cwd: root }), encoding: 'utf8' });
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

test('PostToolUse skips a refused outside vault and fixes a user-selected one', (t) => {
  const fixture = outsideVaultRepo(t);
  const { cwd, vault, entry, draft, bytes } = fixture;
  const run = (file_path, env = {}) => spawnSync(process.execPath, [HOOK], {
    cwd, env: testEnv(env), encoding: 'utf8',
    input: JSON.stringify({ cwd, tool_name: 'Edit', tool_input: { file_path } }),
  });
  for (const file of [entry, draft]) {
    const result = run(file);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assertVaultUntouched(fixture);
  }
  const selected = run(entry, { RESEARCH_VAULT_PATH: vault });
  assert.equal(selected.status, 0, selected.stderr);
  assert.notDeepEqual(readFileSync(entry), bytes);
  assert.doesNotMatch(readFileSync(entry, 'utf8'), /\r|# fixture comment/);
  assert.ok(existsSync(join(vault, '.vault-manifest.json')));
});

// ---- code links (spec 15 D3) ----
import { codeRepo } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { parseProjectConfig } from '../bin/lib/projectconfig.mjs';

const parsed = (root) => parseProjectConfig(readFileSync(join(root, '.research-vault.json'), 'utf8'), loadSchema(process.cwd()));

test('citationWarnings reports code rows for a code.globs file and the unpinned links for a versions file', () => {
  const { root, vault } = codeRepo();
  const cfg = parsed(root);
  assert.equal(citationWarnings(join(root, 'src', 'b.lua'), root, vault, cfg, NOW), [
    'research-vault: UNCOVERED 2026-01-01-fx-missing in src/b.lua:1 ns.g',
    'capture it (or verify the entry) before the claims gate.',
  ].join('\n'));
  assert.equal(citationWarnings(join(root, 'deps.txt'), root, vault, cfg, NOW), '', 'nothing to say while the pins match');
  writeFileSync(join(root, 'src', 'c.lua'), '-- per 2026-01-01-fx-doc@dep=1.0.0\nfunction ns.behind()\nend\n\n-- per 2026-01-01-fx-doc\n  local nested = 1\n');
  assert.equal(citationWarnings(join(root, 'src', 'c.lua'), root, vault, cfg, NOW), [
    'research-vault: STALE 2026-01-01-fx-doc in src/c.lua:1 ns.behind  (dep 1.0.0 -> 1.2.3)',
    'research-vault: UNATTACHED 2026-01-01-fx-doc in src/c.lua:5',
    'capture it (or verify the entry) before the claims gate.',
  ].join('\n'));
  assert.equal(citationWarnings(join(root, 'src', 'a.lua'), root, vault, cfg, NOW), '', 'an ok link says nothing');
  // A versions-file edit names every link whose pin differs from the version now declared.
  writeFileSync(join(root, 'deps.txt'), 'dep 2.0.0\n');
  assert.equal(citationWarnings(join(root, 'deps.txt'), root, vault, cfg, NOW), [
    'research-vault: STALE 2026-01-01-fx-missing in src/b.lua:1 ns.g  (dep 1.2.3 -> 2.0.0)',
    'research-vault: STALE 2026-01-01-fx-doc in src/c.lua:1 ns.behind  (dep 1.0.0 -> 2.0.0)',
    'capture it (or verify the entry) before the claims gate.',
  ].join('\n'));
});

test('CLI emits additionalContext for a versions-file edit in a repo with a code block', () => {
  const { root } = codeRepo();
  writeFileSync(join(root, 'deps.txt'), 'dep 2.0.0\n');
  const r = spawnSync(process.execPath, [HOOK], { env: testEnv(), cwd: root, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(root, 'deps.txt') }, cwd: root }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^research-vault: STALE 2026-01-01-fx-missing in src\/b\.lua:1 ns\.g {2}\(dep 1\.2\.3 -> 2\.0\.0\)$/m);
});

test('PostToolUse stays silent when a binding names an outside versions file', () => {
  const { root, cfg } = codeRepo();
  const file_path = join(root, 'src', 'a.lua');
  writeFileSync(file_path, '-- per 2026-01-01-fx-doc@dep=1.2.3\nfunction ns.f()\nend\n');
  const run = () => spawnSync(process.execPath, [HOOK], { env: testEnv(), cwd: root, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path }, cwd: root }), encoding: 'utf8' });
  const version = 'dep s02-version-canary\n';
  writeFileSync(join(root, 'deps.txt'), version);
  const allowed = run();
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(JSON.parse(allowed.stdout).hookSpecificOutput.additionalContext,
    /^research-vault: STALE 2026-01-01-fx-doc in src\/a\.lua:1 ns\.f {2}\(dep 1\.2\.3 -> s02-version-canary\)$/m);

  const outside = join(tmpVault('rv-posttooluse-version-'), 'outside.txt');
  writeFileSync(outside, version);
  cfg.code.versions.dep.file = relative(root, outside);
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify(cfg) + '\n');
  const r = run();
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

// Absent state (spec 15 D7): without a code block a .lua file is neither referenced nor gated.
test('citationWarnings and the CLI are silent for a .lua edit in a repo without a code block', () => {
  const { root, vault } = codeRepo({ code: false });
  assert.equal(citationWarnings(join(root, 'src', 'a.lua'), root, vault, parsed(root), NOW), '');
  const r = spawnSync(process.execPath, [HOOK], { env: testEnv(), cwd: root, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'b.lua') }, cwd: root }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('post-tool-use logs one cited event per newly cited id of a watched file, none twice, none for an unwatched file (spec 29 D2)', async () => {
  const { readUsage } = await import('../bin/lib/usagelog.mjs');
  const { root, vault, cfg } = repo();
  citationWarnings(join(root, 'docs', 'a.md'), root, vault, cfg, NOW);
  assert.deepEqual(readUsage(vault).map(e => [e.kind, e.via, e.file, e.id]), [
    ['cited', 'post-tool-use', 'docs/a.md', '2026-07-10-fresh'],
    ['cited', 'post-tool-use', 'docs/a.md', '2026-01-01-old'],
  ]);
  citationWarnings(join(root, 'docs', 'a.md'), root, vault, cfg, NOW);
  citationWarnings(join(root, 'other', 'b.md'), root, vault, cfg, NOW);
  assert.equal(readUsage(vault).length, 2);
});
