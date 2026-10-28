// The integration contract of docs/REFERENCE.md "Reading the graph from outside": the keys an outside
// consumer joins on. A change here is a breaking change in the CHANGELOG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { codeRepo } from './helpers.mjs';

const ENTRY = ['id', 'type', 'title', 'summary', 'domain', 'topics', 'source_url', 'content_hash', 'volatility', 'last_verified', 'status',
  'subject', 'series', 'stage', 'state', 'confidence', 'outcome', 'authority_tier', 'authority_basis', 'superseded_by', 'related', 'contributing_ids', 'sources'];

test('manifest: top-level keys, entry fields, edge shape and backlinks', () => {
  const { vault } = codeRepo();
  const m = buildManifest(vault);
  assert.deepEqual(Object.keys(m), ['generated', 'entries', 'edges', 'backlinks']);
  for (const e of m.entries) assert.deepEqual(Object.keys(e), ENTRY, e.id);
  for (const e of m.edges) assert.deepEqual(Object.keys(e), ['from', 'rel', 'to']);
  for (const [id, from] of Object.entries(m.backlinks)) assert.ok(Array.isArray(from) && from.every((f) => typeof f === 'string'), id);
});

test('check --json: top-level keys, a code row and a prose row', () => {
  const { root } = codeRepo();
  writeFileSync(join(root, 'docs', 'd.md'), 'See 2026-01-01-fx-doc and 2026-01-01-fx-missing.\n');
  const out = execFileSync(process.execPath, [join(process.cwd(), 'bin', 'research-vault.mjs'), 'check', '--json'], { cwd: root, encoding: 'utf8' });
  const j = JSON.parse(out);
  assert.deepEqual(Object.keys(j), ['generated', 'summary', 'rows', 'skipped', 'versions']);
  const code = j.rows.filter((r) => 'symbol' in r);
  const prose = j.rows.filter((r) => !('symbol' in r));
  assert.deepEqual(Object.keys(code.find((r) => r.status === 'ok')), ['file', 'type', 'value', 'symbol', 'line', 'key', 'version', 'id', 'volatility', 'status']);
  assert.deepEqual(Object.keys(code.find((r) => r.status === 'uncovered')), ['file', 'type', 'value', 'symbol', 'line', 'key', 'version', 'status']);
  assert.deepEqual(Object.keys(prose.find((r) => r.status === 'ok')), ['file', 'type', 'value', 'status', 'id', 'volatility']);
  assert.deepEqual(Object.keys(prose.find((r) => r.status === 'uncovered')), ['file', 'type', 'value', 'status']);
  assert.deepEqual(j.versions, { dep: '1.2.3' });
  const doc = readFileSync(join(process.cwd(), 'docs', 'REFERENCE.md'), 'utf8');
  for (const k of ENTRY) assert.ok(doc.includes('`' + k + '`'), `REFERENCE names ${k}`);
});
