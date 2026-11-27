import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { advise } from '../bin/lib/advise.mjs';

const WARN = fileURLToPath(new URL('./fixtures/warn', import.meta.url));
const GOOD = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

test('warns on fast docs missing subject.version and un-aliased topics', () => {
  const { warnings } = lintVault(WARN, REPO_ROOT);
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes('WARN_MISSING_VERSION'));
  assert.ok(codes.includes('WARN_TOPIC_ALIAS'));
});

test('warns on synthesis citing only sources with no contributing note', () => {
  const { warnings, violations } = lintVault(WARN, REPO_ROOT);
  assert.equal(violations.length, 0, 'fixture should be lint-clean: ' + JSON.stringify(violations));
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes('WARN_SYNTHESIS_NO_NOTE_COVERAGE'), 'expected WARN_SYNTHESIS_NO_NOTE_COVERAGE: ' + codes.join(','));
});

test('synthesis_basis: primary-rollup exempts source-only synthesis from note-coverage warn', () => {
  // The GOOD fixture's synthesis cites only a source but declares primary-rollup; should not warn.
  const { warnings } = lintVault(GOOD, REPO_ROOT);
  const codes = warnings.map(w => w.code);
  assert.ok(!codes.includes('WARN_SYNTHESIS_NO_NOTE_COVERAGE'), 'primary-rollup should exempt: ' + codes.join(','));
});

test('warns on monolithic synthesis (>1500 words, no note contributors, no primary-rollup)', () => {
  const { warnings } = lintVault(WARN, REPO_ROOT);
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes('WARN_SYNTHESIS_MONOLITHIC'), 'expected WARN_SYNTHESIS_MONOLITHIC: ' + codes.join(','));
});

test('clean vault has no warnings', () => {
  const { warnings } = lintVault(GOOD, REPO_ROOT);
  assert.equal(warnings.length, 0);
});

test('warns on a source whose only provenance is capture (never independently verified)', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  mkdirSync(join(dir, 'sources'), { recursive: true });
  const entry = (slug, method) =>
    `---\ntitle: ${slug}\ntype: source\ncreated: 2026-01-01\ndomain: [meta]\nstage: raw\ntopics: []\nstatus: active\nrelated: []\nvolatility: slow\n` +
    `verifications:\n  - date: 2026-01-01\n    by_type: agent\n    by_id: ""\n    method: ${method}\n    result: confirmed\n    notes: ""\n` +
    `source_type: article\nsource_url: https://e.com/${slug}\n---\n# ${slug}\n`;
  writeFileSync(join(dir, 'sources', '2026-01-01-cap.md'), entry('cap', 'captured'), 'utf8');
  writeFileSync(join(dir, 'sources', '2026-01-01-ver.md'), entry('ver', 'refetched-source'), 'utf8');
  // spec 53 point 4: a quote found on the page by a program is not an independent check either
  const row = m => `  - date: 2026-01-01\n    by_type: agent\n    by_id: ""\n    method: ${m}\n    result: confirmed\n    notes: ""\n`;
  writeFileSync(join(dir, 'sources', '2026-01-01-quo.md'), entry('quo', 'captured').replace('source_type:', row('quote-matched') + 'source_type:'), 'utf8');
  const { warnings } = lintVault(dir, REPO_ROOT);
  const flagged = warnings.filter(w => w.code === 'WARN_SOURCE_UNVERIFIED').map(w => w.file).sort();
  assert.equal(flagged.length, 2, 'two unverified-source warnings: ' + JSON.stringify(warnings));
  assert.ok(flagged[0].includes('2026-01-01-cap') && flagged[1].includes('2026-01-01-quo'), 'the captured-only source and the captured plus quote-matched one, not the refetched one');
  assert.deepEqual(advise(dir, REPO_ROOT).unverifiedSources.sort(), ['2026-01-01-cap', '2026-01-01-quo']);
});

test('warns on note/synthesis without a one-line summary', () => {
  const { warnings } = lintVault(WARN, REPO_ROOT);
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes('WARN_MISSING_SUMMARY'), 'expected WARN_MISSING_SUMMARY: ' + codes.join(','));
});

test('warns on an answered question with no answer_summary (silently exports nothing)', () => {
  const { warnings, violations } = lintVault(WARN, REPO_ROOT);
  assert.equal(violations.length, 0, 'fixture should be lint-clean: ' + JSON.stringify(violations));
  const flagged = warnings.filter(w => w.code === 'WARN_ANSWERED_NO_SUMMARY').map(w => w.file);
  assert.equal(flagged.length, 1, 'exactly one answered-no-summary warning: ' + JSON.stringify(warnings));
  assert.ok(flagged[0].includes('2026-03-01-answered-no-summary'), 'warning is on the answered question');
});

test('lint flags mojibake (runtime fixture, never committed)', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  mkdirSync(join(dir, 'sources'), { recursive: true });
  // Build the mojibake sequence from \u escapes so this SOURCE file stays mojibake-free.
  const moji = 'em dash mojibake: \u00C3\u00A2\u00E2\u201A\u00AC here';
  const entry = `---\ntitle: m\ntype: source\ncreated: 2026-01-01\ndomain: [meta]\nstage: raw\ntopics: []\nstatus: active\nrelated: []\nvolatility: slow\nverifications: []\nsource_type: article\nsource_url: https://e.com\n---\n${moji}\n`;
  writeFileSync(join(dir, 'sources', '2026-01-01-m.md'), entry, 'utf8');
  const { violations } = lintVault(dir, REPO_ROOT);
  assert.ok(violations.map(v => v.code).includes('ENCODING_MOJIBAKE'));
});
