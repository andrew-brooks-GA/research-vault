import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

test('builds one row per entry with last_verified derived', () => {
  const m = buildManifest(VAULT);
  const a = m.entries.find(e => e.id === '2026-01-01-a');
  assert.equal(a.type, 'source');
  assert.equal(a.last_verified, '2026-01-01');
  assert.equal(a.source_url, 'https://example.com/a');
});

test('computes backlinks from related/contributing_ids', () => {
  const m = buildManifest(VAULT);
  assert.deepEqual(m.backlinks['2026-01-01-a'].sort(), ['2026-01-02-b']);
});

test('two buildManifest runs are byte-identical except generated', () => {
  const norm = m => { const { generated, ...rest } = m; return JSON.stringify(rest); };
  assert.equal(norm(buildManifest(VAULT)), norm(buildManifest(VAULT)));
});

test('manifest row carries summary for note/synthesis, null elsewhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-msum-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/x', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Claim note', sources: '2026-01-01-src', summary: 'The load-bearing claim.', now: '2026-01-02' });
  const m = buildManifest(dir);
  assert.equal(m.entries.find(e => e.type === 'note').summary, 'The load-bearing claim.');
  assert.equal(m.entries.find(e => e.type === 'source').summary, null);
});

test('manifest coerces a non-string summary to a string (hand-edited YAML)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-msum2-'));
  mkdirSync(join(dir, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'notes', '2026-01-02-arr.md'), `---
title: "Arr"
type: note
created: 2026-01-02
domain: [software-engineering]
stage: distilled
topics: [x]
status: active
related: []
volatility: slow
verifications:
  - date: 2026-01-02
    by_type: human
    by_id: ""
    method: human-spot-check
    result: confirmed
    notes: ""
summary: [not, a, string]
sources: []
confidence: medium
---
# Arr
`, 'utf8');
  const row = buildManifest(dir).entries.find(e => e.id === '2026-01-02-arr');
  assert.equal(typeof row.summary, 'string');
});
