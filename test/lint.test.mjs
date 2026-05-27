import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { lintVault } from '../bin/lib/lintrules.mjs';

const GOOD = fileURLToPath(new URL('./fixtures/vault', import.meta.url));
const BAD = fileURLToPath(new URL('./fixtures/bad', import.meta.url));

test('clean fixture vault passes', () => {
  const { violations } = lintVault(GOOD, process.cwd());
  assert.equal(violations.length, 0);
});

test('detects stored derived field, bad stage, dangling ref', () => {
  const { violations } = lintVault(BAD, process.cwd());
  const codes = violations.map(v => v.code);
  assert.ok(codes.includes('STORED_DERIVED'));
  assert.ok(codes.includes('STAGE_FOLDER'));
  assert.ok(codes.includes('DANGLING_REF'));
});
