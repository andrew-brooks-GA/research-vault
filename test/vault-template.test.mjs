import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('both templates define last_verified from confirmed and changed-trivially only (spec 14 D6)', () => {
  for (const f of ['vault-template/meta/freshness-policy.md', 'vault-template/meta/prompt-templates/verify-entry.md']) {
    const line = readFileSync(join(ROOT, f), 'utf8').split('\n').find((l) => l.includes('last_verified'));
    for (const w of ['confirmed', 'changed-trivially']) assert.ok(line?.includes(w), `${f}: first last_verified line lacks ${w}: ${line}`);
  }
});
