import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('package.json and both plugin manifests carry the same version (spec 13)', () => {
  const v = read('package.json').version;
  assert.ok(v);
  assert.equal(read('.claude-plugin/plugin.json').version, v);
  assert.equal(read('.codex-plugin/plugin.json').version, v);
});
