import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('CLI prints usage and exits 0 with no args', () => {
  const out = execFileSync('node', ['bin/research-vault.mjs', '--help'], { encoding: 'utf8' });
  assert.match(out, /research-vault/);
  assert.match(out, /init\|lint\|capture\|verify\|search\|related\|manifest/);
});
