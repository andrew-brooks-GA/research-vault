import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeUrl } from '../bin/lib/ids.mjs';
import { checkCitations, globToRegExp, expandFiles, run } from '../bin/commands/check.mjs';
import { runInit } from '../bin/commands/init.mjs';

const SCHEMA = {
  taxonomy: { volatility: { fast: { refresh_after_days: 90 }, stable: { refresh_after_days: 1095 }, volatile: { refresh_after_days: 0 } } },
};
const ENTRIES = [
  { id: '2026-01-10-vulkan-sdk', source_url: normalizeUrl('https://vulkan.lunarg.com/sdk/home'), volatility: 'fast', last_verified: '2026-05-20' },
  { id: '2026-01-10-nakama-pins', source_url: normalizeUrl('https://heroiclabs.com/docs'), volatility: 'fast', last_verified: '2026-01-15' },
  { id: '2024-09-09-raii-classic', source_url: null, volatility: 'stable', last_verified: '2024-09-09' },
  { id: '2026-03-03-current-model', source_url: normalizeUrl('https://example.com/models'), volatility: 'volatile', last_verified: '2026-05-30' },
];
const NOW = '2026-06-01';

// ---- checkCitations (pure coverage + freshness) ----
test('a URL backed by a fresh entry is ok', () => {
  assert.deepEqual(
    checkCitations([{ type: 'url', value: 'https://vulkan.lunarg.com/sdk/home' }], ENTRIES, SCHEMA, NOW),
    [{ type: 'url', value: 'https://vulkan.lunarg.com/sdk/home', status: 'ok', id: '2026-01-10-vulkan-sdk', volatility: 'fast' }],
  );
});
test('a URL backed by a past-window entry is stale', () => {
  const r = checkCitations([{ type: 'url', value: 'https://heroiclabs.com/docs' }], ENTRIES, SCHEMA, NOW)[0];
  assert.equal(r.status, 'stale');
  assert.equal(r.id, '2026-01-10-nakama-pins');
});
test('a URL with no governing entry is uncovered', () => {
  assert.deepEqual(
    checkCitations([{ type: 'url', value: 'https://unknown.example/page' }], ENTRIES, SCHEMA, NOW),
    [{ type: 'url', value: 'https://unknown.example/page', status: 'uncovered' }],
  );
});
test('a vault id citation matches by id', () => {
  const r = checkCitations([{ type: 'id', value: '2024-09-09-raii-classic' }], ENTRIES, SCHEMA, NOW)[0];
  assert.equal(r.status, 'ok');
  assert.equal(r.id, '2024-09-09-raii-classic');
});
test('a volatile entry is always stale', () => {
  assert.equal(checkCitations([{ type: 'id', value: '2026-03-03-current-model' }], ENTRIES, SCHEMA, NOW)[0].status, 'stale');
});
test('an unknown id citation is uncovered', () => {
  assert.equal(checkCitations([{ type: 'id', value: '2099-01-01-nope' }], ENTRIES, SCHEMA, NOW)[0].status, 'uncovered');
});

// ---- globToRegExp (pure) ----
test('globToRegExp: ** spans zero or more dirs', () => {
  const re = globToRegExp('plan/**/*.md');
  assert.ok(re.test('plan/c.md'));
  assert.ok(re.test('plan/a/b.md'));
  assert.ok(re.test('plan/a/b/c.md'));
  assert.ok(!re.test('other/x.md'));
  assert.ok(!re.test('plan/a.txt'));
});
test('globToRegExp: single * does not cross a path separator', () => {
  const re = globToRegExp('*.md');
  assert.ok(re.test('x.md'));
  assert.ok(!re.test('a/x.md'));
});

// ---- expandFiles + run (integration) ----
test('expandFiles resolves a glob to matching files under cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-check-'));
  try {
    mkdirSync(join(dir, 'plan', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'plan', 'a.md'), '# a');
    writeFileSync(join(dir, 'plan', 'sub', 'b.md'), '# b');
    writeFileSync(join(dir, 'plan', 'note.txt'), 'x');
    const files = expandFiles(['plan/**/*.md'], dir).map(f => f.replace(dir, '').replace(/\\/g, '/'));
    assert.deepEqual(files.sort(), ['/plan/a.md', '/plan/sub/b.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run exits non-zero under --check when a citation is uncovered', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-vault-'));
  const repo = mkdtempSync(join(tmpdir(), 'rv-repo-'));
  try {
    runInit({ vaultPath: vault });
    writeFileSync(join(repo, 'doc.md'), 'cites https://nobody.example/page that is not in the vault.');
    const code = await run({ _: ['check', 'doc.md'], vault, cwd: repo, check: true });
    assert.equal(code, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
