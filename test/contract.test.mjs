// The integration contract of docs/REFERENCE.md "Reading the graph from outside": the keys an outside
// consumer joins on. A change here is a breaking change in the CHANGELOG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { codeRepo, put } from './helpers.mjs';

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

test('examples/graph-dot.mjs joins the two outputs into DOT with an edge per manifest edge and per code link', () => {
  const { root } = codeRepo();
  const dot = execFileSync(process.execPath, [join(process.cwd(), 'examples', 'graph-dot.mjs'), root], { encoding: 'utf8' });
  assert.ok(dot.startsWith('digraph research {'));
  assert.ok(dot.includes('"src/a.lua#f" -> "2026-01-01-fx-doc" [label="" color=black];'), dot);
  assert.ok(dot.includes('"src/b.lua#ns.g" -> "2026-01-01-fx-missing" [label="dep=1.2.3" color=red];'), dot);
  assert.ok(dot.includes('"docs/d.md" -> "2026-01-01-fx-doc"'), dot);
  assert.ok(dot.includes('"2026-01-01-fx-snippet" -> "2026-01-01-fx-doc" [label="source_id"];'), 'a manifest edge');
});

test('examples/blast-radius.mjs walks sources and contributing_ids inward and lists every check row citing a dependent', () => {
  const { root, vault } = codeRepo();
  put(vault, 'note', '2026-01-02-fx-note', { sources: ['2026-01-01-fx-doc'], confidence: 'medium' });
  put(vault, 'synthesis', '2026-01-03-fx-syn', { contributing_ids: ['2026-01-02-fx-note'] });
  writeFileSync(join(root, 'src', 'c.lua'), '-- per 2026-01-03-fx-syn\nlocal function h()\n  return 3\nend\n');
  writeFileSync(join(root, 'docs', 'e.md'), 'See 2026-01-02-fx-note.\n');
  const bin = join(process.cwd(), 'bin', 'research-vault.mjs');
  execFileSync(process.execPath, [bin, 'manifest', '--rebuild', '--vault', vault], { cwd: root });
  writeFileSync(join(root, 'check.json'), execFileSync(process.execPath, [bin, 'check', '--json'], { cwd: root, encoding: 'utf8' }));
  const out = execFileSync(process.execPath, [join(process.cwd(), 'examples', 'blast-radius.mjs'), join(vault, '.vault-manifest.json'), '2026-01-01-fx-doc', 'check.json'], { cwd: root, encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.equal(lines[0], 'downstream of 2026-01-01-fx-doc: 2026-01-02-fx-note (1), 2026-01-03-fx-syn (2)');
  assert.deepEqual(lines.slice(1), [
    'check.json  docs/d.md  ok  cites 2026-01-01-fx-doc (distance 0)',
    'check.json  docs/e.md  ok  cites 2026-01-02-fx-note (distance 1)',
    'check.json  src/a.lua#f:3  ok  cites 2026-01-01-fx-doc (distance 0)',
    'check.json  src/c.lua#h:1  ok  cites 2026-01-03-fx-syn (distance 2)',
  ]);
});
