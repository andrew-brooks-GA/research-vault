import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixVault } from '../bin/lib/lintrules.mjs';
import { run } from '../bin/commands/lint.mjs';

test('--fix strips BOM and CRLF and re-serializes canonically', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  const f = join(dir, 'sources', '2026-01-01-a.md');
  writeFileSync(f, '﻿' + readFileSync(f, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
  const { fixed } = fixVault(dir, process.cwd());
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
  fixVault(dir, process.cwd());
  assert.equal(topicsOf(f), 'topics: [k8s, kubernetes, tdd]', '--fix alone leaves topics');
  fixVault(dir, process.cwd(), { topics: true });
  assert.equal(topicsOf(f), 'topics: [kubernetes, test-driven-development]');
  const { dir: dir2, f: f2 } = aliasVault();
  const so = process.stdout.write; process.stdout.write = () => true;
  try { await run({ _: ['lint'], vault: dir2, fix: true, topics: undefined }); } finally { process.stdout.write = so; }
  assert.equal(topicsOf(f2), 'topics: [kubernetes, test-driven-development]', 'through run with a value-less --topics');
});
