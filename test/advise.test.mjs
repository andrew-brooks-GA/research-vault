import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advise } from '../bin/lib/advise.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { tmpVault, put } from './helpers.mjs';
import { run as adviseRun } from '../bin/commands/advise.mjs';
import { listStale } from '../bin/lib/stale.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('advise returns the signal arrays', () => {
  const dir = freshVault();
  const r = advise(dir, process.cwd());
  for (const k of ['stale', 'orphans', 'sourcesWithoutNotes', 'aliasable', 'unverifiedSources']) {
    assert.ok(Array.isArray(r[k]), `${k} must be an array`);
  }
});

test('a source whose only verification is capture appears in unverifiedSources', () => {
  const dir = freshVault();
  const { id } = captureEntry(dir, { type: 'source', title: 'Captured Only', url: 'https://cap.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  const r = advise(dir, process.cwd());
  assert.ok(r.unverifiedSources.includes(id), 'captured-only source should be flagged unverified');
  assert.ok(!r.unverifiedSources.includes('2026-01-01-a'), 'the human-spot-check fixture source is verified, not flagged');
});

test('a source with no distilling note appears in sourcesWithoutNotes', () => {
  const dir = freshVault();
  const { id } = captureEntry(dir, { type: 'source', title: 'Lonely', url: 'https://lonely.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(advise(dir, process.cwd()).sourcesWithoutNotes.includes(id));
});

test('advise lists notes/synthesis lacking a summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-asum-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/z', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Bare', sources: '2026-01-01-src', now: '2026-01-02' });
  captureEntry(dir, { type: 'note', title: 'Crisp', sources: '2026-01-01-src', summary: 'A claim.', now: '2026-01-03' });
  const r = advise(dir, process.cwd());
  assert.deepEqual(r.missingSummaries, ['2026-01-02-bare']);
});

test('advise flags scaffold-only and empty bodies on authored types, not sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-stub-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/st', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Hollow', sources: '2026-01-01-src', scaffold: true, now: '2026-01-02', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'note', title: 'Bare', sources: '2026-01-01-src', now: '2026-01-03' });
  captureEntry(dir, {
    type: 'note', title: 'Full', sources: '2026-01-01-src',
    body: '## Load-bearing claims\n- A real claim.', now: '2026-01-04',
  });
  const r = advise(dir, process.cwd());
  assert.deepEqual(r.stubBodies.sort(), ['2026-01-02-hollow', '2026-01-03-bare']);
});

test('advise does not mutate the vault (lint-clean before and after)', () => {
  const dir = freshVault();
  lintAndReport(dir, { check: false }); // establish a clean baseline manifest
  advise(dir, process.cwd());
  assert.equal(lintAndReport(dir, { check: true }).violations.length, 0, 'clean before');
  advise(dir, process.cwd());
  assert.equal(lintAndReport(dir, { check: true }).violations.length, 0, 'clean after');
});

test('advise flags entries with baked-in quote residue in frontmatter', () => {
  const dir = freshVault();
  writeFileSync(join(dir, 'sources', '2026-01-01-residue.md'),
    '---\ntitle: say \\"hi\\" now\ntype: source\n---\nbody\n', 'utf8');
  const r = advise(dir, process.cwd());
  assert.ok(r.quoteResidue.includes('2026-01-01-residue'));
});

test('advise reports no residue for clean frontmatter', () => {
  const dir = freshVault();
  const r = advise(dir, process.cwd());
  assert.equal(r.quoteResidue.length, 0);
});

test('orphans weigh every edge rel: source_id and superseded_by links are not orphans', () => {
  const dir = tmpVault();
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '2026-01-01-s' });
  put(dir, 'note', '2026-01-03-old', { sources: [], confidence: 'medium', status: 'superseded', superseded_by: '2026-01-04-new' });
  put(dir, 'note', '2026-01-04-new', { sources: [], confidence: 'medium' });
  put(dir, 'note', '2026-01-05-alone', { sources: [], confidence: 'medium' });
  assert.deepEqual(advise(dir, process.cwd()).orphans, ['2026-01-04-new', '2026-01-05-alone']);
});

// Spec 04: stale evidence dependencies. `now` pinned; a `fast` entry verified 2026-01-01 is 200 days old.
const NOW = '2026-07-20';
const src = (dir, id, extra = {}) => put(dir, 'source', id, { source_type: 'article', source_url: `https://e.com/${id}`, ...extra });
const ver = date => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];
const STALE = { volatility: 'fast', verifications: ver('2026-01-01') };
const FRESH = { volatility: 'fast', verifications: ver('2026-07-10') };
const evidence = dir => advise(dir, process.cwd(), { now: NOW }).staleEvidence;

test('staleEvidence reports each dependent with the path to the stale source', () => {
  const dir = tmpVault('rv-se-');
  src(dir, '2026-01-01-s', STALE);
  put(dir, 'note', '2026-02-01-n', { sources: ['2026-01-01-s'], confidence: 'medium', ...FRESH });
  put(dir, 'synthesis', '2026-03-01-y', { contributing_ids: ['2026-02-01-n'], ...FRESH });
  assert.deepEqual(evidence(dir), [
    { id: '2026-02-01-n', via: [{ id: '2026-01-01-s', reason: 'stale', path: ['2026-02-01-n', '2026-01-01-s'] }] },
    { id: '2026-03-01-y', via: [{ id: '2026-01-01-s', reason: 'stale', path: ['2026-03-01-y', '2026-02-01-n', '2026-01-01-s'] }] },
  ]);
});

test('a stale intermediate note is reported; `related` is not a dependency', () => {
  const dir = tmpVault('rv-se-');
  src(dir, '2026-01-01-s', FRESH);
  src(dir, '2026-01-01-r', STALE);
  put(dir, 'note', '2026-02-01-n', { sources: ['2026-01-01-s'], confidence: 'medium', ...STALE });
  put(dir, 'synthesis', '2026-03-01-y', { contributing_ids: ['2026-02-01-n'], related: ['2026-01-01-r'], ...FRESH });
  assert.deepEqual(evidence(dir), [
    { id: '2026-03-01-y', via: [{ id: '2026-02-01-n', reason: 'stale', path: ['2026-03-01-y', '2026-02-01-n'] }] },
  ]);
});

test('a superseded dependency is reported as superseded, regardless of its window or volatility', () => {
  for (const mExtra of [FRESH, STALE, { volatility: undefined }]) {
    const dir = tmpVault('rv-se-');
    put(dir, 'note', '2026-02-01-m', { sources: [], confidence: 'medium', status: 'superseded', superseded_by: '2026-02-02-m2', ...mExtra });
    put(dir, 'note', '2026-02-02-m2', { sources: [], confidence: 'medium', ...FRESH });
    put(dir, 'synthesis', '2026-03-01-z', { contributing_ids: ['2026-02-01-m'], ...FRESH });
    assert.deepEqual(evidence(dir), [
      { id: '2026-03-01-z', via: [{ id: '2026-02-01-m', reason: 'superseded', path: ['2026-03-01-z', '2026-02-01-m'] }] },
    ], JSON.stringify(mExtra));
  }
});

test('unknown volatility upstream is unassessed, not stale; superseded dependents are skipped', () => {
  const dir = tmpVault('rv-se-');
  src(dir, '2026-01-01-u', { volatility: undefined });
  put(dir, 'note', '2026-02-01-n', { sources: ['2026-01-01-u'], confidence: 'medium', ...FRESH });
  src(dir, '2026-01-01-s', STALE);
  put(dir, 'synthesis', '2026-03-01-old', { contributing_ids: [], sources: ['2026-01-01-s'], status: 'superseded', superseded_by: '2026-03-02-new', ...FRESH });
  put(dir, 'synthesis', '2026-03-02-new', { contributing_ids: [], ...FRESH });
  assert.deepEqual(evidence(dir), []);
});

test('dependency cycles terminate and an entry never appears in its own via', () => {
  const dir = tmpVault('rv-se-');
  src(dir, '2026-01-01-s', STALE);
  put(dir, 'synthesis', '2026-02-01-a', { contributing_ids: ['2026-02-02-b'], sources: ['2026-01-01-s'], ...FRESH });
  put(dir, 'synthesis', '2026-02-02-b', { contributing_ids: ['2026-02-01-a'], ...FRESH });
  const r = evidence(dir);
  assert.deepEqual(r.map(d => d.id), ['2026-02-01-a', '2026-02-02-b']);
  assert.deepEqual(r[0].via, [{ id: '2026-01-01-s', reason: 'stale', path: ['2026-02-01-a', '2026-01-01-s'] }]);
  assert.ok(!r[0].via.some(v => v.id === '2026-02-01-a'));
});

test('a dangling dependency is skipped without crashing', () => {
  const dir = tmpVault('rv-se-');
  put(dir, 'note', '2026-02-01-n', { sources: ['2026-01-01-gone'], confidence: 'medium', ...FRESH });
  assert.deepEqual(evidence(dir), []);
});

test('equal-length paths resolve by edge order (lowest id first)', () => {
  const dir = tmpVault('rv-se-');
  src(dir, '2026-01-01-s', STALE);
  put(dir, 'note', '2026-01-02-n1', { sources: ['2026-01-01-s'], confidence: 'medium', ...FRESH });
  put(dir, 'note', '2026-01-02-n2', { sources: ['2026-01-01-s'], confidence: 'medium', ...FRESH });
  put(dir, 'synthesis', '2026-03-01-y', { contributing_ids: ['2026-01-02-n1', '2026-01-02-n2'], ...FRESH });
  const y = evidence(dir).find(d => d.id === '2026-03-01-y');
  assert.deepEqual(y.via.find(v => v.id === '2026-01-01-s').path, ['2026-03-01-y', '2026-01-02-n1', '2026-01-01-s']);
});

test('advise text output renders the stale evidence section with the via chain', async () => {
  const dir = tmpVault('rv-se-');
  src(dir, '2026-01-01-s', STALE); // 2026-01-01 is past the fast window on any real clock from here on
  put(dir, 'note', '2026-02-01-n', { sources: ['2026-01-01-s'], confidence: 'medium', volatility: 'stable', verifications: ver('2026-02-01') });
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = c => { chunks.push(String(c)); return true; };
  try { await adviseRun({ _: ['advise'], vault: dir }); } finally { process.stdout.write = orig; }
  const out = chunks.join('');
  assert.ok(out.includes('stale evidence (1)'), out);
  assert.ok(out.includes('2026-02-01-n <- stale 2026-01-01-s  via 2026-02-01-n -> 2026-01-01-s'), out);
});

test('advise with a pinned now agrees with listStale on the same clock', () => {
  const dir = tmpVault('rv-se-');
  src(dir, '2026-01-01-s', STALE);
  src(dir, '2026-01-01-f', FRESH);
  assert.deepEqual(advise(dir, process.cwd(), { now: NOW }).stale, listStale(dir, { now: NOW, repoRoot: process.cwd() }));
});
