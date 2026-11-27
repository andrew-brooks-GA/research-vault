import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { advise, OPEN_QUESTION_DAYS } from '../bin/lib/advise.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { REPO_ROOT, tmpVault, put, testEnv } from './helpers.mjs';
import { run as adviseRun } from '../bin/commands/advise.mjs';
import { listStale } from '../bin/lib/stale.mjs';
import { applyVerification } from '../bin/commands/verify.mjs';
import { appendUsage } from '../bin/lib/usagelog.mjs';

const CLI = join(REPO_ROOT, 'bin', 'research-vault.mjs');

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('advise returns the signal arrays', () => {
  const dir = freshVault();
  const r = advise(dir, REPO_ROOT);
  for (const k of ['stale', 'orphans', 'sourcesWithoutNotes', 'aliasable', 'unverifiedSources']) {
    assert.ok(Array.isArray(r[k]), `${k} must be an array`);
  }
});

test('a source whose only verification is capture appears in unverifiedSources', () => {
  const dir = freshVault();
  const { id } = captureEntry(dir, { type: 'source', title: 'Captured Only', url: 'https://cap.example.com/x', now: '2026-05-27', repoRoot: REPO_ROOT });
  const r = advise(dir, REPO_ROOT);
  assert.ok(r.unverifiedSources.includes(id), 'captured-only source should be flagged unverified');
  assert.ok(!r.unverifiedSources.includes('2026-01-01-a'), 'the human-spot-check fixture source is verified, not flagged');
});

test('a source with no distilling note appears in sourcesWithoutNotes', () => {
  const dir = freshVault();
  const { id } = captureEntry(dir, { type: 'source', title: 'Lonely', url: 'https://lonely.example.com/x', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.ok(advise(dir, REPO_ROOT).sourcesWithoutNotes.includes(id));
});

test('advise lists notes/synthesis lacking a summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-asum-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/z', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Bare', sources: '2026-01-01-src', now: '2026-01-02' });
  captureEntry(dir, { type: 'note', title: 'Crisp', sources: '2026-01-01-src', summary: 'A claim.', now: '2026-01-03' });
  const r = advise(dir, REPO_ROOT);
  assert.deepEqual(r.missingSummaries, ['2026-01-02-bare']);
});

test('advise flags scaffold-only and empty bodies on authored types, not sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-stub-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/st', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Hollow', sources: '2026-01-01-src', scaffold: true, now: '2026-01-02', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'note', title: 'Bare', sources: '2026-01-01-src', now: '2026-01-03' });
  captureEntry(dir, {
    type: 'note', title: 'Full', sources: '2026-01-01-src',
    body: '## Load-bearing claims\n- A real claim.', now: '2026-01-04',
  });
  const r = advise(dir, REPO_ROOT);
  assert.deepEqual(r.stubBodies.sort(), ['2026-01-02-hollow', '2026-01-03-bare']);
});

test('advise does not mutate the vault (lint-clean before and after)', () => {
  const dir = freshVault();
  lintAndReport(dir, { check: false }); // establish a clean baseline manifest
  advise(dir, REPO_ROOT);
  assert.equal(lintAndReport(dir, { check: true }).violations.length, 0, 'clean before');
  advise(dir, REPO_ROOT);
  assert.equal(lintAndReport(dir, { check: true }).violations.length, 0, 'clean after');
});

test('advise flags entries with baked-in quote residue in frontmatter', () => {
  const dir = freshVault();
  writeFileSync(join(dir, 'sources', '2026-01-01-residue.md'),
    '---\ntitle: say \\"hi\\" now\ntype: source\n---\nbody\n', 'utf8');
  const r = advise(dir, REPO_ROOT);
  assert.ok(r.quoteResidue.includes('2026-01-01-residue'));
});

test('advise reports no residue for clean frontmatter', () => {
  const dir = freshVault();
  const r = advise(dir, REPO_ROOT);
  assert.equal(r.quoteResidue.length, 0);
});

test('orphans weigh every edge rel: source_id and superseded_by links are not orphans', () => {
  const dir = tmpVault();
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '2026-01-01-s' });
  put(dir, 'note', '2026-01-03-old', { sources: [], confidence: 'medium', status: 'superseded', superseded_by: '2026-01-04-new' });
  put(dir, 'note', '2026-01-04-new', { sources: [], confidence: 'medium' });
  put(dir, 'note', '2026-01-05-alone', { sources: [], confidence: 'medium' });
  assert.deepEqual(advise(dir, REPO_ROOT).orphans, ['2026-01-04-new', '2026-01-05-alone']);
});

// Spec 04: stale evidence dependencies. `now` pinned; a `fast` entry verified 2026-01-01 is 200 days old.
const NOW = '2026-07-20';
const src = (dir, id, extra = {}) => put(dir, 'source', id, { source_type: 'article', source_url: `https://e.com/${id}`, ...extra });
const ver = date => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];
const STALE = { volatility: 'fast', verifications: ver('2026-01-01') };
const FRESH = { volatility: 'fast', verifications: ver('2026-07-10') };
const evidence = dir => advise(dir, REPO_ROOT, { now: NOW }).staleEvidence;

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
  assert.deepEqual(advise(dir, REPO_ROOT, { now: NOW }).stale, listStale(dir, { now: NOW, repoRoot: REPO_ROOT }));
});

test('a vault alias pair reaches advise: aliasable before lint --fix --topics, empty after (spec 24 D2, D3)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rv-alias-'));
  writeFileSync(join(root, '.research-vault.json'), '{"vault":"v","taxonomy_extensions":{"topic_aliases":{"k8s":"kubernetes"}}}');
  const dir = join(root, 'v');
  captureEntry(dir, { type: 'source', title: 'K', url: 'https://example.com/k', topics: 'k8s', now: '2026-01-01', repoRoot: REPO_ROOT });
  const f = join(dir, 'sources', '2026-01-01-k.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^topics:.*$/m, 'topics: [k8s]'), 'utf8'); // capture already normalised it; put the alias back
  assert.deepEqual(advise(dir, REPO_ROOT).aliasable, ['2026-01-01-k']);
  const { fixVault } = await import('../bin/lib/lintrules.mjs');
  fixVault(dir, REPO_ROOT, { topics: true });
  assert.deepEqual(advise(dir, REPO_ROOT).aliasable, []);
});

test('advise lists active questions not yet answered and older than 60 days by their id date (spec 25 D1)', () => {
  const dir = tmpVault();
  put(dir, 'question', '2026-01-01-q', { question: 'Q?', state: 'open' });
  put(dir, 'question', '2026-01-01-i', { question: 'I?', state: 'investigating' });
  put(dir, 'question', '2026-01-01-a', { question: 'A?', state: 'answered', answer_summary: 'Yes.' });
  assert.equal(OPEN_QUESTION_DAYS, 60);
  assert.deepEqual(advise(dir, REPO_ROOT, { now: '2026-03-15' }).openQuestions,
    [{ id: '2026-01-01-i', state: 'investigating', ageDays: 73 }, { id: '2026-01-01-q', state: 'open', ageDays: 73 }]);
  assert.deepEqual(advise(dir, REPO_ROOT, { now: '2026-03-02' }).openQuestions, []);
  assert.equal(advise(dir, REPO_ROOT, { now: '2026-03-03' }).openQuestions.length, 2);
  const out = execFileSync(process.execPath, [CLI, 'advise', '--vault', dir], { env: testEnv(), encoding: 'utf8' });
  assert.match(out, /^open questions over 60 days \(2\): 2026-01-01-i \(investigating, \d+d\), 2026-01-01-q \(open, \d+d\)$/m);
});

test('advise pairs supersede suspects by source_url or subject at one version, older first; a superseded side drops the pair (spec 26 D1)', () => {
  const dir = tmpVault();
  const src = (id, url, extra = {}) => put(dir, 'source', id, { source_type: 'article', source_url: url, ...extra });
  src('2026-01-01-a', 'https://example.com/x');
  src('2026-02-01-b', 'https://example.com/x/');
  src('2026-03-01-c', 'https://example.com/c', { subject: { name: 'tool', version: '1' } });
  src('2026-04-01-d', 'https://example.com/d', { subject: { name: 'tool', version: '1' } });
  src('2026-05-01-e', 'https://example.com/e', { subject: { name: 'tool', version: '2' } });
  src('2026-06-01-f', 'https://example.com/f', { subject: { name: 'tool', version: '' } });
  src('2026-07-01-g', 'https://example.com/g', { subject: { name: 'tool' } });
  src('2026-08-01-h', 'https://example.com/x', { status: 'superseded', superseded_by: '2026-02-01-b' });
  src('2026-10-01-v1', 'https://example.com/v', { subject: { name: 'v', version: '1' } });
  src('2026-11-01-v2', 'https://example.com/v', { subject: { name: 'v', version: '2' } });
  put(dir, 'note', '2026-09-01-n', { subject: { name: 'tool', version: '1' }, sources: ['2026-03-01-c'], confidence: 'medium' });
  assert.deepEqual(advise(dir, REPO_ROOT).supersedeSuspects, [
    { older: '2026-01-01-a', newer: '2026-02-01-b', by: 'source_url' },
    { older: '2026-03-01-c', newer: '2026-04-01-d', by: 'subject' },
    { older: '2026-06-01-f', newer: '2026-07-01-g', by: 'subject' },
  ]);
  applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'outdated', supersededBy: '2026-02-01-b', repoRoot: REPO_ROOT });
  assert.equal(advise(dir, REPO_ROOT).supersedeSuspects.length, 2);
  const out = execFileSync(process.execPath, [CLI, 'advise', '--vault', dir], { env: testEnv(), encoding: 'utf8' });
  assert.match(out, /^supersede suspects \(2\): 2026-03-01-c -> 2026-04-01-d \(subject\), 2026-06-01-f -> 2026-07-01-g \(subject\)$/m);
});

test('advise pairs near duplicates by host and path or by title terms, older first; a superseded side drops the pair (spec 28 D1)', () => {
  const dir = tmpVault();
  const src = (id, title, url) => put(dir, 'source', id, { title, source_type: 'article', source_url: url });
  src('2026-01-01-a', 'Install guide for Linux', 'https://docs.example.com/guide/install/linux');
  src('2026-02-01-b', 'Second copy', 'https://docs.example.com/guide/install/linux?v=2');
  src('2026-03-01-c', 'Linux install guide, second edition', 'https://other.example.com/guide/install/linux');
  src('2026-04-01-d', 'Unrelated post', 'https://docs.example.com/guide/blog/post');
  src('2026-05-01-e', 'Install guide for Linux', 'https://docs.example.com/guide/install/linux/');
  const r = advise(dir, REPO_ROOT);
  assert.deepEqual(r.nearDuplicates, [
    { older: '2026-01-01-a', newer: '2026-02-01-b', by: 'url' },
    { older: '2026-01-01-a', newer: '2026-03-01-c', by: 'title' },
    { older: '2026-02-01-b', newer: '2026-05-01-e', by: 'url' },
    { older: '2026-03-01-c', newer: '2026-05-01-e', by: 'title' },
  ]);
  assert.deepEqual(r.supersedeSuspects, [{ older: '2026-01-01-a', newer: '2026-05-01-e', by: 'source_url' }]);
  applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'outdated', supersededBy: '2026-05-01-e', repoRoot: REPO_ROOT });
  assert.ok(advise(dir, REPO_ROOT).nearDuplicates.every(p => p.older !== '2026-01-01-a' && p.newer !== '2026-01-01-a'));
  const out = execFileSync(process.execPath, [CLI, 'advise', '--vault', dir], { env: testEnv(), encoding: 'utf8' });
  assert.match(out, /^near duplicates \(2\): 2026-02-01-b -> 2026-05-01-e \(url\), 2026-03-01-c -> 2026-05-01-e \(title\)$/m);
});

test('advise reports usage from the log: surfaced and cited counts, topic counts, and cold sources split by a queried topic (spec 30 D1)', () => {
  const dir = tmpVault();
  const src = (id, extra) => put(dir, 'source', id, { source_type: 'article', source_url: `https://example.com/${id}`, ...extra });
  src('2026-01-01-a', { topics: ['kubernetes'] });
  src('2026-02-01-b', { topics: ['zig'] });
  src('2026-03-01-c', { topics: ['zig'] });
  src('2026-04-01-d', { topics: ['kubernetes'], status: 'superseded', superseded_by: '2026-01-01-a' });
  put(dir, 'note', '2026-05-01-n', { sources: ['2026-01-01-a'], confidence: 'medium' });
  appendUsage(dir, { kind: 'queried', via: 'search', topic: 'kubernetes', outcome: 'hits', ids: ['2026-01-01-a'] });
  appendUsage(dir, { kind: 'queried', via: 'search', topic: 'kubernetes', outcome: 'no-match', ids: [] });
  appendUsage(dir, { kind: 'queried', via: 'pre-web', tool: 'WebSearch', outcome: 'hits', ids: ['2026-01-01-a', '2026-05-01-n', 'ghost'] });
  appendUsage(dir, { kind: 'cited', via: 'post-tool-use', file: 'docs/x.md', id: '2026-05-01-n' });
  appendUsage(dir, { kind: 'cited', via: 'post-tool-use', file: 'docs/y.md', id: '2026-05-01-n' });
  appendUsage(dir, { kind: 'cited', via: 'post-tool-use', file: 'docs/y.md', id: '2026-02-01-b' });
  assert.deepEqual(advise(dir, REPO_ROOT).usage, {
    entries: [{ id: '2026-01-01-a', surfaced: 2, cited: 0 }, { id: '2026-02-01-b', surfaced: 0, cited: 1 }, { id: '2026-05-01-n', surfaced: 1, cited: 2 }],
    topics: { kubernetes: { queried: 2, noMatch: 1 } },
    cold: { queried: ['2026-01-01-a'], unqueried: ['2026-03-01-c'] },
  });
  const empty = tmpVault();
  put(empty, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s' });
  assert.deepEqual(advise(empty, REPO_ROOT).usage, { entries: [], topics: {}, cold: { queried: [], unqueried: ['2026-01-01-s'] } });
  const out = execFileSync(process.execPath, [CLI, 'advise', '--vault', dir], { env: testEnv(), encoding: 'utf8' });
  assert.match(out, /^usage \(3\): 2026-01-01-a \(surfaced 2, cited 0\), 2026-02-01-b \(surfaced 0, cited 1\), 2026-05-01-n \(surfaced 1, cited 2\)$/m);
  assert.match(out, /^topics queried \(1\): kubernetes \(2 queried, 1 no-match\)$/m);
  assert.match(out, /^cold sources under a queried topic \(1\): 2026-01-01-a$/m);
  assert.match(out, /^cold sources never queried \(1\): 2026-03-01-c$/m);
});

// Issue 72 item 8: one URL captured with a subject version and without one is paired; two versions of one URL are not,
// and an empty version counts as none.
test('advise pairs one source_url captured with a version and without one (issue 72 item 8)', () => {
  const dir = tmpVault();
  const src = (id, url, extra = {}) => put(dir, 'source', id, { source_type: 'article', source_url: url, ...extra });
  src('2026-01-01-a', 'https://example.com/docs', { subject: { name: 'tool', version: '1.0' } });
  src('2026-02-01-b', 'https://example.com/docs');
  src('2026-03-01-c', 'https://example.com/other', { subject: { name: 'thing', version: '2' } });
  src('2026-04-01-d', 'https://example.com/other', { subject: { name: 'thing', version: '3' } });
  src('2026-05-01-e', 'https://example.com/plain', { subject: { name: 'plain', version: '' } });
  src('2026-06-01-f', 'https://example.com/plain', { subject: { name: 'plain', version: '1' }, status: 'superseded', superseded_by: '2026-05-01-e' });
  src('2026-07-01-g', 'https://example.com/empty', { subject: { name: 'empty', version: '' } });
  src('2026-08-01-h', 'https://example.com/empty');
  assert.deepEqual(advise(dir, REPO_ROOT).supersedeSuspects, [
    { older: '2026-01-01-a', newer: '2026-02-01-b', by: 'source_url-unversioned' },
    { older: '2026-07-01-g', newer: '2026-08-01-h', by: 'source_url' },
  ]);
  const out = execFileSync(process.execPath, [CLI, 'advise', '--vault', dir], { env: testEnv(), encoding: 'utf8' });
  assert.match(out, /^supersede suspects \(2\): 2026-01-01-a -> 2026-02-01-b \(source_url-unversioned\), 2026-07-01-g -> 2026-08-01-h \(source_url\)$/m);
});

// S-11: advise's text lines show each value from an entry on one line with no hidden characters. An id comes
// from the file name, which can hold a line break; tag characters spell "ignore".
test('advise text output: an entry id and a question state cannot add a line or hide text', t => {
  const dir = tmpVault('rv-advise-s11-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tags = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';
  put(dir, 'note', `2026-01-01-alone\norphans (0): forged${tags}`, { sources: [], confidence: 'medium', summary: 's' });
  put(dir, 'question', '2026-01-02-q', { question: 'Q?', state: `open\nnear duplicates (0): forged${tags}` });
  const out = execFileSync(process.execPath, [CLI, 'advise', '--vault', dir], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  const lines = out.split('\n');
  assert.ok(lines.includes('orphans (2): 2026-01-01-alone orphans (0): forged, 2026-01-02-q'), out);
  assert.match(out, /^open questions over 60 days \(1\): 2026-01-02-q \(open near duplicates \(0\): forged, \d+d\)$/m);
  assert.deepEqual(lines.filter(l => /forged/.test(l)).map(l => l.split(' (')[0]), ['orphans', 'open questions over 60 days']);
});

// S-13: an entry id, a logged id or a topic that names an Object.prototype member is counted as any other name.
test('S-13: advise reports usage, orphans, cold sources and aliasable topics for an id or topic named after an Object.prototype member as for any other', t => {
  const ver = [{ date: '2026-01-01', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];
  const run = name => {
    const dir = tmpVault('rv-s13-advise-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    put(dir, 'source', name, { created: '2026-01-01', verifications: ver, source_type: 'article', source_url: 'https://example.com/s', topics: [name] });
    put(dir, 'source', 'zz-t', { created: '2026-01-01', verifications: ver, source_type: 'article', source_url: 'https://example.com/t', topics: [name] });
    appendUsage(dir, { kind: 'queried', via: 'search', topic: name, outcome: 'no-match', ids: [] });
    appendUsage(dir, { kind: 'queried', via: 'search', topic: name, outcome: 'hits', ids: [name] });
    appendUsage(dir, { kind: 'cited', via: 'post-tool-use', file: 'docs/x.md', id: name });
    return JSON.stringify(advise(dir, REPO_ROOT, { now: '2026-01-03' })).replaceAll(name, 'NAME');
  };
  const plain = run('plainname');
  assert.match(plain, /"orphans":\["NAME","zz-t"\]/);
  assert.match(plain, /"usage":\{"entries":\[\{"id":"NAME","surfaced":1,"cited":1\}\],"topics":\{"NAME":\{"queried":2,"noMatch":1\}\},"cold":\{"queried":\["zz-t"\],"unqueried":\[\]\}\}/);
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(run(name), plain, name);
    assert.equal(Object.hasOwn(Object.prototype, 'queried'), false, `${name}: a topic counter landed on Object.prototype`);
  }
});
