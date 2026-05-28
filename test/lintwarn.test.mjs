import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintVault } from '../bin/lib/lintrules.mjs';

const WARN = fileURLToPath(new URL('./fixtures/warn', import.meta.url));
const GOOD = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

test('warns on fast docs missing subject.version and un-aliased topics', () => {
  const { warnings } = lintVault(WARN, process.cwd());
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes('WARN_MISSING_VERSION'));
  assert.ok(codes.includes('WARN_TOPIC_ALIAS'));
});

test('warns on synthesis citing only sources with no contributing note', () => {
  const { warnings, violations } = lintVault(WARN, process.cwd());
  assert.equal(violations.length, 0, 'fixture should be lint-clean: ' + JSON.stringify(violations));
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes('WARN_SYNTHESIS_NO_NOTE_COVERAGE'), 'expected WARN_SYNTHESIS_NO_NOTE_COVERAGE: ' + codes.join(','));
});

test('synthesis_basis: primary-rollup exempts source-only synthesis from note-coverage warn', () => {
  // The GOOD fixture's synthesis cites only a source but declares primary-rollup; should not warn.
  const { warnings } = lintVault(GOOD, process.cwd());
  const codes = warnings.map(w => w.code);
  assert.ok(!codes.includes('WARN_SYNTHESIS_NO_NOTE_COVERAGE'), 'primary-rollup should exempt: ' + codes.join(','));
});

test('clean vault has no warnings', () => {
  const { warnings } = lintVault(GOOD, process.cwd());
  assert.equal(warnings.length, 0);
});

test('lint flags mojibake (runtime fixture, never committed)', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  mkdirSync(join(dir, 'sources'), { recursive: true });
  // Build the mojibake sequence from \u escapes so this SOURCE file stays mojibake-free.
  const moji = 'em dash mojibake: \u00C3\u00A2\u00E2\u201A\u00AC here';
  const entry = `---\ntitle: m\ntype: source\ncreated: 2026-01-01\ndomain: [meta]\nstage: raw\ntopics: []\nstatus: active\nrelated: []\nvolatility: slow\nverifications: []\nsource_type: article\nsource_url: https://e.com\n---\n${moji}\n`;
  writeFileSync(join(dir, 'sources', '2026-01-01-m.md'), entry, 'utf8');
  const { violations } = lintVault(dir, process.cwd());
  assert.ok(violations.map(v => v.code).includes('ENCODING_MOJIBAKE'));
});
