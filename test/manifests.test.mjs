import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('package.json and the plugin manifest carry the same version (spec 13)', () => {
  const v = read('package.json').version;
  assert.ok(v);
  assert.equal(read('.claude-plugin/plugin.json').version, v);
});

test('the package has a marketplace entry with no version or the package version', () => {
  const pkg = read('package.json');
  const entry = read('.claude-plugin/marketplace.json').plugins.find((entry) => entry.name === pkg.name);
  assert.ok(entry, `missing marketplace entry for ${pkg.name}`);
  if (Object.hasOwn(entry, 'version')) assert.equal(entry.version, pkg.version);
});
