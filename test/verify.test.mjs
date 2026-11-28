import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyVerification, answerQuestion, run as verifyRun } from '../bin/commands/verify.mjs';
import { advise } from '../bin/lib/advise.mjs';
import { REPO_ROOT, tmpVault, put, testEnv } from './helpers.mjs';
import { listStale } from '../bin/lib/stale.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

// Hand-write a source with an arbitrary verification log (and volatility) so the freshness
// boundary cases can be pinned without going through capture/verify.
function writeSource(dir, id, { volatility = 'slow', verifications = [] } = {}) {
  const vlog = verifications.length
    ? 'verifications:\n' + verifications.map(v => `  - date: ${v.date}
    by_type: human
    by_id: ""
    method: ${v.method || 'human-spot-check'}
    result: ${v.result}
    notes: ""`).join('\n') + '\n'
    : 'verifications: []\n';
  writeFileSync(join(dir, 'sources', `${id}.md`), `---
title: "${id}"
type: source
created: 2026-01-01
domain: [software-engineering]
stage: raw
topics: [x]
status: active
related: []
volatility: ${volatility}
${vlog}source_type: article
source_url: https://example.com/${id}
---
# ${id}
`, 'utf8');
}

test('confirmed appends a verification and bumps updated', () => {
  const dir = freshVault();
  applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'confirmed', now: '2026-05-27', byId: 'claude-opus-4-7', repoRoot: REPO_ROOT });
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.verifications.length, 2);
  assert.equal(e.data.updated, '2026-05-27');
});

test('self-confirmation refused: inferred-stable on slow entry throws', () => {
  const dir = freshVault();
  assert.throws(() => applyVerification(dir, { id: '2026-01-01-a', method: 'inferred-stable', result: 'confirmed', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /inferred-stable/);
});

test('listStale flags entries past their volatility window', () => {
  const dir = freshVault();
  const stale = listStale(dir, { now: '2030-01-01', repoRoot: REPO_ROOT });
  assert.ok(stale.some(s => s.id === '2026-01-01-a'));
});

test('outdated without --superseded-by is refused and leaves the entry lint-clean', () => {
  const dir = freshVault();
  assert.throws(
    () => applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'outdated', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /outdated requires --superseded-by/,
  );
  const { violations } = lintVault(dir, REPO_ROOT);
  assert.equal(violations.length, 0, 'entry must remain lint-clean: ' + JSON.stringify(violations));
});

test('verify with a bogus result throws', () => {
  const dir = freshVault();
  assert.throws(
    () => applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'bogus', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /invalid result: bogus/,
  );
});

test('a successful verify leaves the vault lint-clean under --check', () => {
  const dir = freshVault();
  applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'confirmed', now: '2026-05-27', byId: 'claude-opus-4-7', repoRoot: REPO_ROOT });
  const { violations } = lintAndReport(dir, { check: true });
  assert.equal(violations.length, 0, 'expected clean --check after verify: ' + JSON.stringify(violations));
});

test('version succession keeps the entry active and does NOT supersede', () => {
  const dir = freshVault();
  const r = applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'confirmed', succession: true, byId: 'claude-opus-4-7', now: '2026-05-27', repoRoot: REPO_ROOT });
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.status, 'active');          // NOT superseded
  assert.equal(e.data.verifications.length, 2);   // verification recorded
  assert.equal(r.action, 'version-succeeded');
});

test('verify refuses the capture-time `captured` method', () => {
  const dir = freshVault();
  assert.throws(
    () => applyVerification(dir, { id: '2026-01-01-a', method: 'captured', result: 'confirmed', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /captured is a capture-time seed/,
  );
});

test('unreachable does NOT clear staleness and does not bump last_verified', () => {
  const dir = freshVault();
  // 2026-01-01-a is slow (window 365), last confirming = 2026-01-01. At 2027-06-01 it is stale.
  assert.ok(listStale(dir, { now: '2027-06-01', repoRoot: REPO_ROOT }).some(s => s.id === '2026-01-01-a'), 'stale before');
  const r = applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'unreachable', now: '2027-06-01', repoRoot: REPO_ROOT });
  assert.equal(r.action, 'recorded');
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.verifications.length, 2, 'unreachable is recorded for audit');
  assert.equal(e.data.updated, undefined, 'a failed check must not bump updated');
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-a');
  assert.equal(row.last_verified, '2026-01-01', 'last_verified unchanged by unreachable');
  assert.ok(listStale(dir, { now: '2027-06-01', repoRoot: REPO_ROOT }).some(s => s.id === '2026-01-01-a'), 'still stale after unreachable');
});

test('inconclusive is recorded in the log but does not bump last_verified', () => {
  const dir = freshVault();
  const r = applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'inconclusive', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.equal(r.action, 'recorded');
  const e = readEntry(join(dir, 'sources', '2026-01-01-a.md'));
  assert.equal(e.data.verifications.length, 2, 'inconclusive is no longer silently discarded');
  assert.equal(e.data.updated, undefined);
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-a');
  assert.equal(row.last_verified, '2026-01-01', 'last_verified unchanged by inconclusive');
});

test('confirmed does bump manifest last_verified', () => {
  const dir = freshVault();
  applyVerification(dir, { id: '2026-01-01-a', method: 'refetched-source', result: 'confirmed', now: '2026-05-27', byId: 'claude-opus-4-7', repoRoot: REPO_ROOT });
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-a');
  assert.equal(row.last_verified, '2026-05-27');
});

test('a source whose only log entry is non-confirming has last_verified null and IS stale', () => {
  const dir = freshVault();
  writeSource(dir, '2026-01-01-nc', { verifications: [{ date: '2027-01-01', method: 'refetched-source', result: 'unreachable' }] });
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-nc');
  assert.equal(row.last_verified, null, 'no confirming verification → null');
  const hit = listStale(dir, { now: '2027-06-01', repoRoot: REPO_ROOT }).find(s => s.id === '2026-01-01-nc');
  assert.equal(hit?.reason, 'never verified', 'null last_verified is stale with a reason, not an Infinity age');
});

test('freshness boundary: at exactly the window is NOT stale (strict >), one day past is', () => {
  const dir = freshVault();
  // 2026-01-01-a: slow window 365, last confirming 2026-01-01. 2027-01-01 is exactly 365 days.
  assert.ok(!listStale(dir, { now: '2027-01-01', repoRoot: REPO_ROOT }).some(s => s.id === '2026-01-01-a'), 'ageDays === win is not stale');
  assert.ok(listStale(dir, { now: '2027-01-02', repoRoot: REPO_ROOT }).some(s => s.id === '2026-01-01-a'), 'one day past window is stale');
});

test('a never-verified entry (empty log) is stale', () => {
  const dir = freshVault();
  writeSource(dir, '2026-01-01-never', { verifications: [] });
  const row = buildManifest(dir).entries.find(x => x.id === '2026-01-01-never');
  assert.equal(row.last_verified, null);
  assert.ok(listStale(dir, { now: '2026-01-02', repoRoot: REPO_ROOT }).some(s => s.id === '2026-01-01-never'), 'never-verified is stale even one day after creation');
});

test('a volatile entry (window 0) is always flagged regardless of last_verified', () => {
  const dir = freshVault();
  writeSource(dir, '2026-01-01-vol', { volatility: 'volatile', verifications: [{ date: '2030-01-01', result: 'confirmed' }] });
  const hit = listStale(dir, { now: '2030-01-02', repoRoot: REPO_ROOT }).find(s => s.id === '2026-01-01-vol');
  assert.ok(hit, 'volatile is always stale');
  assert.equal(hit.reason, 'always re-check');
});

test('verify --answered-by closes a question: state, the answering entry summary, contributing, updated, no verification row (spec 25 D2)', () => {
  const dir = tmpVault();
  put(dir, 'question', '2026-01-01-q', { question: 'Q?', state: 'open' });
  put(dir, 'synthesis', '2026-02-01-s', { summary: 'The answer.', contributing_ids: ['2026-01-01-q'] });
  assert.deepEqual(answerQuestion(dir, { id: '2026-01-01-q', answeredBy: '2026-02-01-s', now: '2026-03-01', repoRoot: REPO_ROOT }), { action: 'answered' });
  const { data } = readEntry(join(dir, 'questions', '2026-01-01-q.md'));
  assert.equal(data.state, 'answered');
  assert.equal(data.answer_summary, 'The answer.');
  assert.deepEqual(data.contributing, ['2026-02-01-s']);
  assert.equal(data.updated, '2026-03-01');
  assert.equal(data.verifications.length, 1);
  const m = buildManifest(dir);
  assert.equal(m.entries.find(e => e.id === '2026-01-01-q').state, 'answered');
  assert.ok(m.edges.some(e => e.from === '2026-01-01-q' && e.rel === 'contributing' && e.to === '2026-02-01-s'));
  const r = lintVault(dir, REPO_ROOT);
  const codes = [...r.violations, ...r.warnings].map(v => v.code);
  assert.ok(!codes.includes('DANGLING_REF') && !codes.includes('WARN_ANSWERED_NO_SUMMARY'), codes.join(','));
  assert.deepEqual(advise(dir, REPO_ROOT, { now: '2026-06-01' }).openQuestions, []);
});

test('verify --answered-by: the flag summary wins, a non-question and a missing answering id are refused, run returns 0 (spec 25 D2, D4)', async () => {
  const dir = tmpVault();
  put(dir, 'question', '2026-01-01-q', { question: 'Q?', state: 'open' });
  put(dir, 'synthesis', '2026-02-01-s', { summary: 'The answer.', contributing_ids: ['2026-01-01-q'] });
  put(dir, 'source', '2026-01-01-src', { source_type: 'article', source_url: 'https://example.com/s' });
  assert.throws(() => answerQuestion(dir, { id: '2026-01-01-src', answeredBy: '2026-02-01-s' }), /not a question/);
  assert.throws(() => answerQuestion(dir, { id: '2026-01-01-q', answeredBy: '2026-02-01-missing' }), /entry not found/);
  assert.equal(readEntry(join(dir, 'questions', '2026-01-01-q.md')).data.state, 'open');
  answerQuestion(dir, { id: '2026-01-01-q', answeredBy: '2026-02-01-s', answerSummary: 'Given.', now: '2026-03-01' });
  assert.equal(readEntry(join(dir, 'questions', '2026-01-01-q.md')).data.answer_summary, 'Given.');
  const dir2 = tmpVault();
  put(dir2, 'question', '2026-01-01-q', { question: 'Q?', state: 'open' });
  put(dir2, 'synthesis', '2026-02-01-s', { summary: 'The answer.', contributing_ids: ['2026-01-01-q'] });
  assert.equal(await verifyRun({ vault: dir2, id: '2026-01-01-q', 'answered-by': '2026-02-01-s' }), 0);
  assert.equal(readEntry(join(dir2, 'questions', '2026-01-01-q.md')).data.state, 'answered');
});


test('verify CLI stores a two-line note without corrupting the entry', () => {
  const dir = freshVault();
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url)), 'verify', '--vault', dir, '--id', '2026-01-01-a', '--method', 'refetched-source', '--result', 'confirmed', '--notes', 'first\nsecond'], { env: testEnv(), timeout: 30000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readEntry(join(dir, 'sources', '2026-01-01-a.md')).data.verifications.at(-1).notes, 'first\nsecond');
});


test('verify CLI reports a refused serialization once and preserves the entry bytes', t => {
  const dir = freshVault();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = join(dir, 'sources', '2026-01-01-a.md');
  const before = readFileSync(entry);
  const names = readdirSync(join(dir, 'sources'));
  const seam = join(mkdtempSync(join(tmpdir(), 'rv-write-refusal-')), 'serializer.mjs');
  t.after(() => rmSync(fileURLToPath(new URL('.', pathToFileURL(seam))), { recursive: true, force: true }));
  const moduleUrl = new URL('../bin/lib/frontmatter.ts', import.meta.url).href;
  // Inject a lossy writer through its module seam, without adding a production test flag.
  writeFileSync(seam, `import { mock } from 'node:test';
import * as original from ${JSON.stringify(moduleUrl)};
mock.module(${JSON.stringify(moduleUrl)}, { namedExports: {
  ...original,
  serializeFrontmatter: (data, ...args) => original.serializeFrontmatter({ ...data, title: 'lost title' }, ...args),
} });
`);
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--disable-warning=ExperimentalWarning', '--disable-warning=DeprecationWarning', '--import', pathToFileURL(seam).href, fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url)), 'verify', '--vault', dir, '--id', '2026-01-01-a', '--method', 'refetched-source', '--result', 'confirmed'], { env: testEnv(), timeout: 30000, encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /^error: frontmatter write refused .* at "title": value does not round-trip\n$/);
  assert.deepEqual(readFileSync(entry), before);
  assert.deepEqual(readdirSync(join(dir, 'sources')), names);
});

// S-11: a --stale text line shows an entry id from a file name on one line with no hidden characters. Tag
// characters spell "ignore".
test('verify --stale text output: an entry id from a file name cannot add a line or hide text', t => {
  const dir = tmpVault('rv-verify-s11-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tags = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';
  put(dir, 'source', `2026-01-01-live\n2026-01-09-fake  slow  1d${tags}`, { source_type: 'article', source_url: 'https://example.org/live', volatility: 'volatile' });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'verify', '--stale', '--vault', dir], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '2026-01-01-live 2026-01-09-fake slow 1d  volatile  always re-check\n');
});
