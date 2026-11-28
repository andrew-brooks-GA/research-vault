import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { fixVault } from '../bin/lib/lintrules.mjs';
import { run } from '../bin/commands/lint.mjs';
import { parseFrontmatter } from '../bin/lib/frontmatter.ts';

test('--fix strips BOM and CRLF and re-serializes canonically', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  const f = join(dir, 'sources', '2026-01-01-a.md');
  writeFileSync(f, '﻿' + readFileSync(f, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
  const { fixed } = fixVault(dir, REPO_ROOT);
  const after = readFileSync(f, 'utf8');
  assert.notEqual(after.charCodeAt(0), 0xFEFF);
  assert.ok(!/\r/.test(after));
  assert.ok(fixed > 0);
});

test('lint --fix via run() strips BOM/CRLF on a temp vault', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  const f = join(dir, 'sources', '2026-01-01-a.md');
  writeFileSync(f, '﻿' + readFileSync(f, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
  const code = await run({ fix: true, vault: dir });
  const after = readFileSync(f, 'utf8');
  assert.notEqual(after.charCodeAt(0), 0xFEFF);
  assert.ok(!/\r/.test(after));
  assert.equal(code, 0, 'normalized vault lints clean');
});

test('lint --fix preserves the parsed values in a mixed verifications list', async t => {
  const root = mkdtempSync(join(tmpdir(), 'rv-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  const f = join(dir, 'sources', '2026-01-01-a.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^source_type:/m, '  - x\nsource_type:'));
  await run({ fix: true, vault: dir });
  assert.deepEqual(parseFrontmatter(readFileSync(f, 'utf8')).data.verifications, [
    { date: '2026-01-01', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' },
    'x',
  ]);
});

// A vault under a directory holding a .research-vault.json with the k8s pair, and one entry carrying an alias.
function aliasVault() {
  const root = mkdtempSync(join(tmpdir(), 'rv-alias-'));
  writeFileSync(join(root, '.research-vault.json'), '{"vault":"v","taxonomy_extensions":{"topic_aliases":{"k8s":"kubernetes"}}}');
  const dir = join(root, 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  const f = join(dir, 'sources', '2026-01-01-a.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^topics:.*$/m, 'topics: [k8s, kubernetes, tdd]'), 'utf8');
  return { dir, f };
}
const topicsOf = f => readFileSync(f, 'utf8').match(/^topics:.*$/m)[0];

test('lint --fix --topics rewrites aliased topics through built-in and vault pairs and deduplicates; --fix alone does not (spec 24 D3)', async () => {
  const { dir, f } = aliasVault();
  fixVault(dir, REPO_ROOT);
  assert.equal(topicsOf(f), 'topics: [k8s, kubernetes, tdd]', '--fix alone leaves topics');
  fixVault(dir, REPO_ROOT, { topics: true });
  assert.equal(topicsOf(f), 'topics: [kubernetes, test-driven-development]');
  const { dir: dir2, f: f2 } = aliasVault();
  const so = process.stdout.write; process.stdout.write = () => true;
  try { await run({ _: ['lint'], vault: dir2, fix: true, topics: true }); } finally { process.stdout.write = so; }
  assert.equal(topicsOf(f2), 'topics: [kubernetes, test-driven-development]', 'through run with a value-less --topics');
});

test('R08 fixVault replaces entries and leaves the old temporary name untouched', async t => {
  const { linkSync, rmSync } = await import('node:fs');
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-fix-atomic-')), 'v');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  const path = join(dir, 'sources', '2026-01-01-a.md');
  const raw = '\uFEFF' + readFileSync(path, 'utf8');
  writeFileSync(path, raw);
  writeFileSync(path + '.tmp', 'sentinel');
  linkSync(path, join(dir, 'original'));
  fixVault(dir, REPO_ROOT);
  assert.equal(readFileSync(path, 'utf8').startsWith('\uFEFF'), false);
  assert.equal(readFileSync(join(dir, 'original'), 'utf8'), raw);
  assert.equal(readFileSync(path + '.tmp', 'utf8'), 'sentinel');
});

test('R08 round2 lint --fix preserves private entry permissions', async t => {
  if (process.platform === 'win32') return t.skip('POSIX permission bits unavailable on Windows');
  const { chmodSync, statSync, rmSync } = await import('node:fs');
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-mode-')), 'v');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  const path = join(dir, 'sources', '2026-01-01-a.md');
  writeFileSync(path, '\uFEFF' + readFileSync(path, 'utf8')); chmodSync(path, 0o600);
  assert.equal(await run({ fix: true, vault: dir }), 0);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readFileSync(path, 'utf8').startsWith('\uFEFF'), false);
});
