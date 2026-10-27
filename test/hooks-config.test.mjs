import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every hook handler names an existing script and sets a numeric timeout (spec 13)', () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const handlers = Object.values(hooks).flat().flatMap((g) => g.hooks);
  assert.ok(handlers.length >= 4);
  for (const h of handlers) {
    assert.ok(Array.isArray(h.args) && h.args.length, `handler has args: ${JSON.stringify(h)}`);
    const script = h.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT);
    assert.ok(existsSync(script), `script exists: ${script}`);
    assert.equal(typeof h.timeout, 'number', `timeout on ${h.args[0]}`);
  }
});
