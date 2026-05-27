import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixVault } from '../bin/lib/lintrules.mjs';

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
