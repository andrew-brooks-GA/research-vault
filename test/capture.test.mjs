import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, testEnv } from './helpers.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureEntry, run, runBatch } from '../bin/commands/capture.mjs';
import { makeId } from '../bin/lib/ids.ts';
import { sha256Tagged } from '../bin/lib/hash.ts';
import { readEntry, writeEntry } from '../bin/lib/fsutil.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { refreshVault } from '../bin/commands/refresh.mjs';
import { writeBlocklist } from './blocklist.test.mjs';
import { loadSchema, fieldOrder } from '../bin/lib/schema.mjs';
import { buildExport } from '../bin/lib/exportjsonl.mjs';

const CLI = join(REPO_ROOT, 'bin', 'research-vault.mjs');

// Hand-write an entry to disk (mimicking a non-tooling writer that bypasses fail-fast
// capture) so the detective floor can be exercised on bad controlled values.
function handWrite(dir, folder, type, id, extra) {
  const schema = loadSchema(REPO_ROOT);
  const data = {
    title: id, type, created: '2026-01-01',
    domain: ['software-engineering'], stage: schema.taxonomy.stage_by_folder[folder].default,
    topics: ['x'], status: 'active', related: [], volatility: 'slow',
    verifications: [{ date: '2026-01-01', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }],
    ...extra,
  };
  mkdirSync(join(dir, folder), { recursive: true });
  writeEntry(join(dir, folder, `${id}.md`), data, `# ${id}\n`, fieldOrder(schema, type));
}

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('capture produces lint-clean entries for ALL six types', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'synthesis', title: 'S', contributingIds: '2026-01-01-a', now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'snippet', title: 'Sn', language: 'python', tested: true, now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'experiment', title: 'E', provider: 'anthropic', modelId: 'claude-opus-4-7', task: 't', outcome: 'success', now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'question', title: 'Does X hold?', now: '2026-05-27', repoRoot: REPO_ROOT });
  const { violations } = lintVault(dir, REPO_ROOT);
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('Kubernetes-ecosystem entry: broad domain + tech in topics is lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'source', title: 'vcluster config docs', url: 'https://docs.vcluster.com/config',
    domain: 'systems-infrastructure', topics: 'kubernetes,vcluster,multi-tenancy',
    subjectName: 'vcluster', subjectVersion: '0.19', series: 'vcluster-config',
    now: '2026-05-27', repoRoot: REPO_ROOT,
  });
  assert.equal(r.dedup, null);
  const { violations } = lintVault(dir, REPO_ROOT);
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('creates a conformant source entry and is lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'New Article', url: 'https://new.example.com/post', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.equal(r.dedup, null);
  assert.ok(existsSync(r.path));
  assert.match(r.id, /^2026-05-27-new-article$/);
});

test('dedup: same normalized url + same subject.version returns existing', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'Dup', url: 'https://dup.example.com/x', now: '2026-05-27', repoRoot: REPO_ROOT });
  const r2 = captureEntry(dir, { type: 'source', title: 'Dup Again', url: 'https://dup.example.com/x/?utm_source=z', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.ok(r2.dedup);
  assert.match(r2.dedup.reason, /url/);
});

test('dedup bypassed for distinct subject.version (version succession)', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'vc 19', url: 'https://docs.vcluster.com/config', subjectName: 'vcluster', subjectVersion: '0.19', series: 'vcluster-config', now: '2026-05-27', repoRoot: REPO_ROOT });
  const r2 = captureEntry(dir, { type: 'source', title: 'vc 20', url: 'https://docs.vcluster.com/config', subjectName: 'vcluster', subjectVersion: '0.20', series: 'vcluster-config', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.equal(r2.dedup, null);
});

test('stores content_hash and normalizes topics through aliases', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'Hashed', url: 'https://h.example.com/x', content: 'hello world', topics: 'tdd,go', now: '2026-05-27', repoRoot: REPO_ROOT });
  const e = readEntry(r.path);
  assert.equal(e.data.content_hash, sha256Tagged('hello world'));
  assert.ok(e.data.topics.includes('test-driven-development')); // 'tdd' alias-normalized
  assert.ok(e.data.topics.includes('go'));
});

test('content-file hashes the local file bytes, matching inline content', async () => {
  const dir = freshVault();
  const tmp = join(mkdtempSync(join(tmpdir(), 'rv-cf-')), 'src.txt');
  writeFileSync(tmp, 'hello world', 'utf8');
  const code = await run({ type: 'source', title: 'CF', url: 'https://cf.example.com/x', 'content-file': tmp, vault: dir });
  assert.equal(code, 0);
  const e = readEntry(join(dir, 'sources', makeId(new Date().toISOString().slice(0, 10), 'CF') + '.md'));
  assert.equal(e.data.content_hash, sha256Tagged('hello world'));
});

test('captured_via persists and stays lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'CV', url: 'https://cv.example.com/x', capturedVia: 'manual paste 2026-05-27', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.equal(readEntry(r.path).data.captured_via, 'manual paste 2026-05-27');
  const { violations } = lintVault(dir, REPO_ROOT);
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('store-body without ack throws and writes nothing', () => {
  const dir = freshVault();
  assert.throws(
    () => captureEntry(dir, { type: 'source', title: 'B', url: 'https://b.example.com/x', content: 'BODY TEXT', storeBody: true, now: '2026-05-27', repoRoot: REPO_ROOT }),
    /ack.*egress|egress.*ack/i,
  );
  const id = makeId('2026-05-27', 'B');
  assert.ok(!existsSync(join(dir, 'sources', `${id}.md`)), 'no entry file should be written on rejection');
});

test('store-body with ack appends content to body; default keeps it out', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'B', url: 'https://b.example.com/x', content: 'BODY TEXT', storeBody: true, ackDataEgress: true, now: '2026-05-27', repoRoot: REPO_ROOT });
  const { body } = readEntry(r.path);
  assert.ok(body.startsWith('# B'), 'body should start with H1');
  assert.ok(body.includes('BODY TEXT'), 'body should include the stored content');

  const dir2 = freshVault();
  const r2 = captureEntry(dir2, { type: 'source', title: 'B2', url: 'https://b2.example.com/x', content: 'BODY TEXT', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.ok(!readEntry(r2.path).body.includes('BODY TEXT'), 'default capture body must not include the content');
});

test('tripwire: same url+version but different content surfaces ambiguity', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'V1', url: 'https://t.example.com/p', content: 'AAA', now: '2026-05-27', repoRoot: REPO_ROOT });
  const r2 = captureEntry(dir, { type: 'source', title: 'V2', url: 'https://t.example.com/p', content: 'BBB', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.ok(r2.dedup);
  assert.equal(r2.dedup.ambiguous, true);
  assert.match(r2.dedup.reason, /content/);
});

test('exact duplicate: same url+version+content is a plain (non-ambiguous) dup', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'V1', url: 'https://e2.example.com/p', content: 'SAME', now: '2026-05-27', repoRoot: REPO_ROOT });
  const r2 = captureEntry(dir, { type: 'source', title: 'V1b', url: 'https://e2.example.com/p', content: 'SAME', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.ok(r2.dedup);
  assert.ok(!r2.dedup.ambiguous);
});

test('captures source with authority_tier and authority_basis, lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'source', title: 'Auth K8s', url: 'https://kubernetes.io/docs/x',
    authorityTier: 'primary', authorityBasis: 'official-docs',
    now: '2026-05-27', repoRoot: REPO_ROOT,
  });
  const e = readEntry(r.path);
  assert.equal(e.data.authority_tier, 'primary');
  assert.equal(e.data.authority_basis, 'official-docs');
  const { violations } = lintVault(dir, REPO_ROOT);
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('captures synthesis with synthesis_basis: primary-rollup', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'synthesis', title: 'Version diff', contributingIds: '2026-01-01-a',
    synthesisBasis: 'primary-rollup', now: '2026-05-27', repoRoot: REPO_ROOT,
  });
  const e = readEntry(r.path);
  assert.equal(e.data.synthesis_basis, 'primary-rollup');
});

test('lint rejects unknown synthesis_basis / authority_tier / authority_basis values', () => {
  const dir = freshVault();
  // Fail-fast capture would refuse these, so hand-write the bogus entries (a non-tooling
  // writer) and assert the detective floor still surfaces them.
  handWrite(dir, 'synthesis', 'synthesis', '2026-01-01-bad-sb', { contributing_ids: ['2026-01-01-a'], synthesis_basis: 'nonsense' });
  handWrite(dir, 'sources', 'source', '2026-01-01-bad-tier', { source_type: 'article', source_url: 'https://bt.example.com/x', authority_tier: 'mid' });
  handWrite(dir, 'sources', 'source', '2026-01-01-bad-ab', { source_type: 'article', source_url: 'https://bb.example.com/x', authority_basis: 'tweet' });
  const { violations } = lintVault(dir, REPO_ROOT);
  const codes = violations.map(v => v.code);
  assert.ok(codes.includes('ENUM_SYNTHESIS_BASIS'), 'expected ENUM_SYNTHESIS_BASIS: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_AUTHORITY_TIER'), 'expected ENUM_AUTHORITY_TIER: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_AUTHORITY_BASIS'), 'expected ENUM_AUTHORITY_BASIS: ' + codes.join(','));
});

test('capture rejects unknown controlled values up front and writes nothing', () => {
  const dir = freshVault();
  assert.throws(
    () => captureEntry(dir, { type: 'note', title: 'Bad conf', sources: '2026-01-01-a', confidence: 'certain', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /unknown confidence: certain/,
  );
  const id = makeId('2026-05-27', 'Bad conf');
  assert.ok(!existsSync(join(dir, 'notes', `${id}.md`)), 'no entry file should be written on rejection');
});

const SECTIONS = {
  source: ['## What it says', '## Authority & scope', '## Open questions'],
  note: ['## Load-bearing claims', '## Caveats / scope', "## How I'd use this"],
  synthesis: ['## Question', '## Cross-source claims', '## Tensions', '## What would change my mind'],
  snippet: ['## Usage context', '## Code', '## Caveats'],
  experiment: ['## Task', '## Setup', '## Result', '## Interpretation'],
  question: ['## Why it matters', '## What would answer it', '## Leads'],
};

const SCAFFOLD_ARGS = {
  source: { type: 'source', title: 'Src', url: 'https://sc.example.com/x' },
  note: { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high' },
  synthesis: { type: 'synthesis', title: 'S', contributingIds: '2026-01-01-a' },
  snippet: { type: 'snippet', title: 'Sn', language: 'python', tested: true },
  experiment: { type: 'experiment', title: 'E', provider: 'anthropic', modelId: 'm', task: 't', outcome: 'success' },
  question: { type: 'question', title: 'Does X hold?' },
};

for (const [type, sections] of Object.entries(SECTIONS)) {
  test(`capture --scaffold seeds ${type} body skeleton, lint-clean`, () => {
    const dir = freshVault();
    const r = captureEntry(dir, { ...SCAFFOLD_ARGS[type], scaffold: true, now: '2026-05-27', repoRoot: REPO_ROOT });
    const { body, data } = readEntry(r.path);
    assert.ok(body.startsWith(`# ${data.title}`), `body should start with H1: ${body.slice(0, 40)}`);
    for (const s of sections) assert.ok(body.includes(s), `missing section ${s} in ${type} body`);
    const bodyAfterH1 = body.slice(body.indexOf('\n') + 1);
    assert.ok(!/^---/m.test(bodyAfterH1), 'no frontmatter should leak into the body');
    const { violations } = lintVault(dir, REPO_ROOT);
    assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
  });
}

test('capture without --scaffold keeps body as bare H1', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: REPO_ROOT });
  const { body } = readEntry(r.path);
  assert.equal(body, '# N\n');
});

test('capture (all six types) leaves the vault lint-clean under --check', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://s.example.com/x', now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'synthesis', title: 'S', contributingIds: '2026-01-01-a', synthesisBasis: 'primary-rollup', now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'snippet', title: 'Sn', language: 'python', tested: true, now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'experiment', title: 'E', provider: 'anthropic', modelId: 'm', task: 't', outcome: 'success', now: '2026-05-27', repoRoot: REPO_ROOT });
  captureEntry(dir, { type: 'question', title: 'Does X hold?', now: '2026-05-27', repoRoot: REPO_ROOT });
  const { violations } = lintAndReport(dir, { check: true });
  assert.equal(violations.length, 0, 'expected clean --check after captures: ' + JSON.stringify(violations));
});

test('capture refuses a colliding id and leaves the first entry intact', () => {
  const dir = freshVault();
  const opts = { type: 'note', title: 'Same Title', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: REPO_ROOT };
  const r1 = captureEntry(dir, opts);
  assert.equal(r1.dedup, null);
  const before = readFileSync(r1.path);
  const r2 = captureEntry(dir, opts);
  assert.ok(r2.dedup && r2.dedup.ambiguous === false, 'second capture of same id must refuse');
  assert.match(r2.dedup.reason, /already exists/);
  assert.ok(readFileSync(r1.path).equals(before), 'first entry must be byte-identical');
  assert.ok(!lintAndReport(dir, { check: true }).violations.some(v => v.code === 'MANIFEST_STALE'), 'manifest not clobbered by the refusal');
});

test('dedup: same url + integer subject.version dedups on recapture', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'v20', url: 'https://int.example.com/d', subjectName: 'thing', subjectVersion: '20', series: 'thing-rel', now: '2026-05-27', repoRoot: REPO_ROOT });
  const r2 = captureEntry(dir, { type: 'source', title: 'v20 again', url: 'https://int.example.com/d', subjectName: 'thing', subjectVersion: '20', series: 'thing-rel', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.ok(r2.dedup, 'integer version must still dedup (string/number mismatch fixed)');
  assert.equal(r2.dedup.ambiguous, false);
});

test('content-file hashes raw bytes (non-UTF-8) and matches what refresh computes', async () => {
  const dir = freshVault();
  const tmp = join(mkdtempSync(join(tmpdir(), 'rv-bin-')), 'src.bin');
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x80, 0x81]);
  writeFileSync(tmp, bytes);
  const code = await run({ type: 'source', title: 'BIN', url: 'https://bin.example.com/x', 'content-file': tmp, vault: dir });
  assert.equal(code, 0);
  const e = readEntry(join(dir, 'sources', makeId(new Date().toISOString().slice(0, 10), 'BIN') + '.md'));
  assert.equal(e.data.content_hash, sha256Tagged(bytes), 'hash must be over raw bytes');
  assert.notEqual(e.data.content_hash, sha256Tagged(bytes.toString('utf8')), 'must not hash the lossy UTF-8 decode');
  const results = await refreshVault(dir, {
    targets: [{ id: e.id, type: 'source', source_url: e.data.source_url, content_hash: e.data.content_hash }],
    fetch: async () => ({ status: 200, hash: sha256Tagged(bytes) }),
  });
  assert.equal(results[0].result, 'confirmed', 'capture and refresh hashing must agree');
});

test('capture seeds an honest `captured` verification, not a fake existence-check', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'Seed', url: 'https://seed.example.com/x', now: '2026-05-27', repoRoot: REPO_ROOT });
  const v = readEntry(r.path).data.verifications;
  assert.equal(v.length, 1);
  assert.equal(v[0].method, 'captured');
  assert.equal(v[0].result, 'confirmed');
});

test('capture --summary persists on note and synthesis and stays lint-clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-sum-'));
  captureEntry(dir, { type: 'source', title: 'Sock pinning', url: 'https://example.com/pin', now: '2026-01-01' });
  const note = captureEntry(dir, {
    type: 'note', title: 'Pin sockets', sources: '2026-01-01-sock-pinning',
    summary: 'Pin the socket to the validated IP to defeat DNS rebinding.', now: '2026-01-02',
  });
  const syn = captureEntry(dir, {
    type: 'synthesis', title: 'SSRF posture', contributingIds: '2026-01-02-pin-sockets',
    summary: 'Allowlist global-unicast only; pin and re-validate every hop.', now: '2026-01-03',
  });
  assert.equal(readEntry(note.path).data.summary, 'Pin the socket to the validated IP to defeat DNS rebinding.');
  assert.equal(readEntry(syn.path).data.summary, 'Allowlist global-unicast only; pin and re-validate every hop.');
  // Without --summary the field is absent, not empty.
  const bare = captureEntry(dir, { type: 'note', title: 'Bare note', sources: '2026-01-01-sock-pinning', now: '2026-01-04' });
  assert.ok(!('summary' in readEntry(bare.path).data));
  assert.equal(lintVault(dir, REPO_ROOT).violations.length, 0);
});

test('capture body: author prose lands in the body for authored types; source body is gated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-body-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/b', now: '2026-01-01' });
  const note = captureEntry(dir, {
    type: 'note', title: 'Pinning', sources: '2026-01-01-src',
    body: '## Load-bearing claims\n- Baselines floor versions.\n\n## How I\'d use this\n- Pin via overrides.',
    now: '2026-01-02',
  });
  const text = readFileSync(note.path, 'utf8');
  assert.match(text, /# Pinning\n\n## Load-bearing claims\n- Baselines floor versions\./);
  assert.throws(
    () => captureEntry(dir, { type: 'source', title: 'Gated', url: 'https://example.com/g', body: 'pasted text', now: '2026-01-03' }),
    /store-body/,
  );
  assert.equal(lintVault(dir, REPO_ROOT).violations.length, 0);
});

test('capture --answer-summary writes an answered question the default export emits', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'question', title: 'Does X hold?', state: 'answered',
    answerSummary: 'Yes, under contention the syncer shares the bucket.',
    now: '2026-05-27', repoRoot: REPO_ROOT,
  });
  const e = readEntry(r.path);
  assert.equal(e.data.state, 'answered');
  assert.equal(e.data.answer_summary, 'Yes, under contention the syncer shares the bucket.');
  assert.equal(lintVault(dir, REPO_ROOT).violations.length, 0);
  const recs = buildExport(dir);
  assert.ok(recs.some(x => x.input === 'Does X hold?' && x.output === 'Yes, under contention the syncer shares the bucket.'),
    'default export must emit the answered question: ' + JSON.stringify(recs));
  // Without the flag the field is absent (export would drop the question).
  const bare = captureEntry(dir, { type: 'question', title: 'Open one?', now: '2026-05-27', repoRoot: REPO_ROOT });
  assert.ok(!('answer_summary' in readEntry(bare.path).data));
});

test('capture without a title is refused and writes nothing (spec 31, found by its REFERENCE gate)', () => {
  const dir = freshVault();
  assert.throws(() => captureEntry(dir, { type: 'source', url: 'https://notitle.example.com/a' }), /title required/);
  assert.ok(!existsSync(join(dir, 'sources', '2026-06-12-undefined.md')));
});

test('single capture enforces the batch requirements: note/synthesis/source', () => {
  const dir = freshVault();
  assert.throws(
    () => captureEntry(dir, { type: 'note', title: 'No sources', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /note requires sources/,
  );
  assert.throws(
    () => captureEntry(dir, { type: 'synthesis', title: 'No contributors', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /synthesis requires contributingIds/,
  );
  assert.throws(
    () => captureEntry(dir, { type: 'source', title: 'No url', now: '2026-05-27', repoRoot: REPO_ROOT }),
    /source requires url/,
  );
  assert.ok(!existsSync(join(dir, 'sources', makeId('2026-05-27', 'No url') + '.md')), 'nothing written on rejection');
});

test('capture consumes .research-vault.json defaults; explicit flags win; no config unchanged', async () => {
  const cfgDir = mkdtempSync(join(tmpdir(), 'rv-cfgd-'));
  const vault = mkdtempSync(join(tmpdir(), 'rv-cfgv-'));
  writeFileSync(join(cfgDir, '.research-vault.json'), JSON.stringify({
    vault, defaults: { domain: 'security', topics: ['ssrf', 'pinning'], volatility: 'fast' },
  }), 'utf8');
  const today = new Date().toISOString().slice(0, 10);

  // Flags absent → defaults fill domain / topics / volatility.
  await run({ type: 'source', title: 'Cfg src', url: 'https://example.com/cfg', vault, cwd: cfgDir });
  const d = readEntry(join(vault, 'sources', makeId(today, 'Cfg src') + '.md')).data;
  assert.deepEqual(d.domain, ['security']);
  assert.equal(d.volatility, 'fast');
  assert.ok(d.topics.includes('ssrf') && d.topics.includes('pinning'));

  // Explicit flags override the defaults; topics are NOT merged.
  await run({ type: 'source', title: 'Cfg override', url: 'https://example.com/o', domain: 'learning', volatility: 'slow', topics: 'go', vault, cwd: cfgDir });
  const o = readEntry(join(vault, 'sources', makeId(today, 'Cfg override') + '.md')).data;
  assert.deepEqual(o.domain, ['learning']);
  assert.equal(o.volatility, 'slow');
  assert.deepEqual(o.topics, ['go']);

  // No project config → hardcoded fallbacks unchanged.
  const plainVault = mkdtempSync(join(tmpdir(), 'rv-plainv-'));
  const plainCwd = mkdtempSync(join(tmpdir(), 'rv-plainc-'));
  await run({ type: 'source', title: 'Plain', url: 'https://example.com/p', vault: plainVault, cwd: plainCwd });
  const p = readEntry(join(plainVault, 'sources', makeId(today, 'Plain') + '.md')).data;
  assert.deepEqual(p.domain, ['software-engineering']);
  assert.equal(p.volatility, 'slow');
});

test('capture --body-file reads the body from disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-bodyf-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/bf', now: '2026-01-01' });
  const bf = join(mkdtempSync(join(tmpdir(), 'rv-bf-')), 'body.md');
  writeFileSync(bf, '## Load-bearing claims\n- From a file.', 'utf8');
  const code = await run({ type: 'note', title: 'From File', sources: '2026-01-01-src', 'body-file': bf, vault: dir });
  assert.equal(code, 0);
  const id = makeId(new Date().toISOString().slice(0, 10), 'From File');
  assert.match(readFileSync(join(dir, 'notes', `${id}.md`), 'utf8'), /- From a file\./);
});

test('capture persists a source summary and a synthesis confidence; synthesis confidence has no default (spec 08)', () => {
  const dir = freshVault();
  const s = captureEntry(dir, { type: 'source', title: 'Src with summary', url: 'https://example.com/ss', summary: 'The one claim.', now: '2026-05-28', repoRoot: REPO_ROOT });
  assert.equal(readEntry(s.path).data.summary, 'The one claim.');
  const y = captureEntry(dir, { type: 'synthesis', title: 'Y conf', contributingIds: '2026-01-01-a', confidence: 'high', now: '2026-05-28', repoRoot: REPO_ROOT });
  assert.equal(readEntry(y.path).data.confidence, 'high');
  const z = captureEntry(dir, { type: 'synthesis', title: 'Z no conf', contributingIds: '2026-01-01-a', now: '2026-05-28', repoRoot: REPO_ROOT });
  assert.ok(!('confidence' in readEntry(z.path).data));
  assert.throws(() => captureEntry(dir, { type: 'synthesis', title: 'Bad', contributingIds: '2026-01-01-a', confidence: 'certain', now: '2026-05-28', repoRoot: REPO_ROOT }), /confidence/);
  const { violations } = lintVault(dir, REPO_ROOT);
  assert.equal(violations.length, 0, JSON.stringify(violations));
});

test('comma lists are trimmed: --topics "tdd, go" aliases and stores go, --sources "a, b" stores b (spec 13)', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'note', title: 'Trimmed', topics: 'tdd, go', sources: '2026-01-01-a, 2026-01-02-b', related: '2026-01-01-a, ', now: '2026-05-27', repoRoot: REPO_ROOT });
  const e = readEntry(r.path);
  assert.deepEqual(e.data.topics, ['test-driven-development', 'go']);
  assert.deepEqual(e.data.sources, ['2026-01-01-a', '2026-01-02-b']);
  assert.deepEqual(e.data.related, ['2026-01-01-a']);
});

async function quiet(fn) {
  const err = [];
  const [so, se] = [process.stdout.write, process.stderr.write];
  process.stdout.write = () => true;
  process.stderr.write = c => { err.push(String(c)); return true; };
  try { return { code: await fn(), err: err.join('') }; }
  finally { process.stdout.write = so; process.stderr.write = se; }
}

test('capture --by-id lands in the first verification (spec 13)', async () => {
  const dir = freshVault();
  const { code } = await quiet(() => run({ type: 'question', title: 'ById', 'by-id': 'claude-x', vault: dir }));
  assert.equal(code, 0);
  const e = readEntry(join(dir, 'questions', makeId(new Date().toISOString().slice(0, 10), 'ById') + '.md'));
  assert.equal(e.data.verifications[0].by_id, 'claude-x');
});

test('a malformed binding file is reported on stderr, capture still runs with --vault (spec 13)', async () => {
  const dir = freshVault();
  const repo = mkdtempSync(join(tmpdir(), 'rv-bad-binding-'));
  writeFileSync(join(repo, '.research-vault.json'), '{ not json', 'utf8');
  const { code, err } = await quiet(() => run({ type: 'question', title: 'Bad binding', vault: dir, cwd: repo }));
  assert.equal(code, 0);
  assert.match(err, /\.research-vault\.json/);
});

test('captureEntry refuses an id already used in another folder, names it, and calls it taken (issue 72 item 7)', () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-capture-collide-'));
  cpSync(join(fileURLToPath(new URL('../vault-template', import.meta.url))), vault, { recursive: true });
  const snip = captureEntry(vault, { type: 'snippet', title: 'gate round lines', language: 'markdown', now: '2026-10-27' });
  assert.equal(snip.dedup, null);
  assert.throws(() => captureEntry(vault, { type: 'experiment', title: 'gate round lines', provider: 'local', modelId: 'none', dateRun: '2026-10-27', task: 't', outcome: 'success', now: '2026-10-27' }),
    /^Error: id taken: entry id 2026-10-27-gate-round-lines already exists in snippets\/ and is another entry; give this entry a more specific title$/);
  assert.equal(existsSync(join(vault, 'experiments', `${snip.id}.md`)), false);
});

test('capture refuses a blocklisted source, --force captures it with the override in the seed notes; run rejects without force (spec 32 D2)', async () => {
  const dir = freshVault();
  writeBlocklist(dir);
  assert.throws(() => captureEntry(dir, { type: 'source', title: 'Spam', url: 'https://spam.example.com/a' }), /blocked source: spam.example.com \(domain\): content farm/);
  assert.ok(!existsSync(join(dir, 'sources', `${makeId(new Date().toISOString().slice(0, 10), 'Spam')}.md`)));
  const r = captureEntry(dir, { type: 'source', title: 'Spam', url: 'https://spam.example.com/a', force: true });
  const e = readEntry(r.path);
  assert.match(e.data.verifications[0].notes, /captured with --force past the blocklist: spam.example.com/);
  assert.equal(e.data.captured_via, undefined);
  assert.equal(lintVault(dir, REPO_ROOT).violations.length, 0);
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    await assert.rejects(run({ type: 'source', title: 'Spam two', url: 'https://spam.example.com/b', vault: dir }), /blocked source/);
    assert.equal(await run({ type: 'source', title: 'Spam two', url: 'https://spam.example.com/b', vault: dir, force: true }), 0);
  } finally { process.stdout.write = orig; }
});

// Issue 72 item 7: a title that gives the id of another entry is an error, at the CLI and in --batch; a repeated URL is still a duplicate.
test('a source whose title gives a taken id is refused as id taken, at the CLI and in --batch; a repeated entry is still a duplicate', () => {
  const dir = freshVault();
  const cli = (...a) => spawnSync(process.execPath, [CLI, 'capture', '--vault', dir, ...a], { env: testEnv(), encoding: 'utf8' });
  assert.equal(cli('--type', 'source', '--title', 'Install guide', '--url', 'https://one.example/install').status, 0);
  const files = () => ['sources', 'questions'].flatMap(f => existsSync(join(dir, f)) ? readdirSync(join(dir, f)) : []).sort();
  const before = files();
  const clash = cli('--type', 'source', '--title', 'Install guide', '--url', 'https://two.example/setup');
  assert.equal(clash.status, 2); assert.match(clash.stderr, /^error: id taken: entry id \d{4}-\d{2}-\d{2}-install-guide already exists in sources\/ and is another entry/);
  const question = cli('--type', 'question', '--title', 'Install guide');
  assert.equal(question.status, 2); assert.match(question.stderr, /id taken: .* in sources\//);
  const again = cli('--type', 'source', '--title', 'Install guide', '--url', 'https://one.example/install');
  assert.equal(again.status, 1); assert.match(again.stdout, /^duplicate of .*existing entry with same url/);
  assert.equal(cli('--type', 'question', '--title', 'Asked once').status, 0);
  const asked = cli('--type', 'question', '--title', 'Asked once');
  assert.equal(asked.status, 1); assert.match(asked.stdout, /^duplicate of .*already exists in questions\//);
  const plan = join(dir, '..', 'plan.json');
  writeFileSync(plan, JSON.stringify([{ type: 'source', title: 'Install guide', url: 'https://two.example/setup' }, { type: 'source', title: 'Other page', url: 'https://three.example/x' }]));
  const r = runBatch(dir, plan);
  assert.deepEqual(r.skipped, []); assert.deepEqual(r.created, []);
  assert.equal(r.errors.length, 1); assert.equal(r.errors[0].index, 0); assert.match(r.errors[0].error, /^id taken: /);
  const inBatch = join(dir, '..', 'plan2.json');
  writeFileSync(inBatch, JSON.stringify([{ type: 'source', title: 'Same name', url: 'https://four.example/a' }, { type: 'source', title: 'Same name', url: 'https://five.example/b' }]));
  const r2 = runBatch(dir, inBatch);
  assert.equal(r2.errors.length, 1); assert.equal(r2.errors[0].index, 1); assert.match(r2.errors[0].error, /^id taken: .* in sources\//);
  const mixed = join(dir, '..', 'plan3.json');
  writeFileSync(mixed, JSON.stringify([{ type: 'source', title: 'Mixed name', url: 'https://six.example/a' }, { type: 'question', title: 'Mixed name' }]));
  const r3 = runBatch(dir, mixed);
  assert.equal(r3.errors.length, 1); assert.equal(r3.errors[0].index, 1); assert.match(r3.errors[0].error, /^id taken: .* in sources\//);
  // A version given with no subject name is not stored, so the same page again is still a duplicate, at the CLI and in a batch run twice.
  const bare = ['--type', 'source', '--title', 'Release notes', '--url', 'https://seven.example/rel', '--subject-version', '1.0'];
  assert.equal(cli(...bare).status, 0);
  const twice = cli(...bare);
  assert.equal(twice.status, 1); assert.match(twice.stdout, /^duplicate of .*existing entry with same url/);
  const rerun = join(dir, '..', 'plan4.json');
  writeFileSync(rerun, JSON.stringify([{ type: 'source', title: 'Rerun page', url: 'https://eight.example/r', subjectVersion: '2' }]));
  assert.equal(runBatch(dir, rerun).created.length, 1);
  const again2 = runBatch(dir, rerun);
  assert.deepEqual(again2.errors, []); assert.equal(again2.skipped.length, 1);
  assert.deepEqual(files(), [...before, ...['asked-once.md', 'release-notes.md', 'rerun-page.md'].map(e => readdirSync(join(dir, e === 'asked-once.md' ? 'questions' : 'sources')).find(f => f.endsWith(e)))].sort());
});

test('R08 ordinary capture preserves the winner when the destination appears before publication', async t => {
  const { default: fs } = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const dir = freshVault();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'questions', '2026-01-01-race.md');
  const open = fs.openSync;
  let raced = false;
  t.mock.method(fs, 'openSync', (name, flags, ...rest) => {
    if (!raced && String(name).includes('.rv-atomic-') && flags === 'wx') {
      raced = true;
      writeFileSync(path, 'winner');
    }
    return open(name, flags, ...rest);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const result = captureEntry(dir, { type: 'question', title: 'Race', now: '2026-01-01' });
  assert.equal(raced, true);
  assert.equal(readFileSync(path, 'utf8'), 'winner');
  assert.equal(result.dedup.reason, 'entry id 2026-01-01-race already exists in questions/ (supersede via verify, do not overwrite)');
  assert.deepEqual(readdirSync(join(dir, 'questions')), ['2026-01-01-race.md']);
});

test('two titles with no ASCII word captured on one day get two distinct ids (R-57)', () => {
  const dir = freshVault();
  const opts = { type: 'source', now: '2026-11-24', repoRoot: REPO_ROOT };
  const a = captureEntry(dir, { ...opts, title: '日本語のタイトル', url: 'https://ja.example/a' });
  const b = captureEntry(dir, { ...opts, title: 'Ελληνικός τίτλος', url: 'https://el.example/b' });
  assert.equal(a.dedup, null); assert.equal(b.dedup, null);
  assert.deepEqual(readdirSync(join(dir, 'sources')).sort(), ['2026-01-01-a.md', '2026-11-24-t-348774f3.md', '2026-11-24-t-7bdc654f.md']);
});

test('single capture refuses a reference to no entry in --sources, --contributing-ids or --related as the batch does, and writes nothing (R-57)', () => {
  for (const args of [
    ['--type', 'note', '--title', 'Note one', '--sources', 'no-such-id'],
    ['--type', 'synthesis', '--title', 'Synthesis one', '--contributing-ids', 'no-such-id'],
    ['--type', 'note', '--title', 'Note two', '--sources', '2026-01-01-a', '--related', 'no-such-id'],
  ]) {
    const dir = freshVault();
    const listing = () => readdirSync(dir, { recursive: true }).sort();
    const manifest = () => existsSync(join(dir, '.vault-manifest.json')) ? readFileSync(join(dir, '.vault-manifest.json')) : null;
    const listingBefore = listing(), manifestBefore = manifest();
    const r = spawnSync(process.execPath, [CLI, 'capture', '--vault', dir, ...args],
      { env: testEnv(), encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr, 'error: unresolved reference: no-such-id\n');
    assert.deepEqual(listing(), listingBefore);
    assert.deepEqual(manifest(), manifestBefore);
  }
});

// S-11: capture's text output shows a blocklist row's fields and an existing entry's id on one line with no
// hidden characters. Tag characters spell "ignore".
const TAGS = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';
const FORGED_ROW = [{ pattern: 'spam.example.com', scope: 'domain', reason: `farm\nresearch-vault: forged${TAGS}`, added: '2026-11-02' }];

test('capture refusal: a blocklist reason is shown on one line with no hidden characters, and nothing is written', () => {
  const dir = freshVault();
  writeBlocklist(dir, FORGED_ROW);
  const before = readdirSync(join(dir, 'sources')).sort();
  assert.throws(() => captureEntry(dir, { type: 'source', title: 'Spam', url: 'https://spam.example.com/a' }),
    { message: 'blocked source: spam.example.com (domain): farm research-vault: forged; --force captures anyway' });
  assert.deepEqual(readdirSync(join(dir, 'sources')).sort(), before);
});

test('capture --fill text line: a blocklist reason is shown on one line with no hidden characters', () => {
  const dir = freshVault();
  handWrite(dir, 'sources', 'source', '2026-01-01-spam', { source_type: 'article', source_url: 'https://spam.example.com/a' });
  writeBlocklist(dir, FORGED_ROW);
  const r = spawnSync(process.execPath, [CLI, 'capture', '--vault', dir, '--fill', '2026-01-01-spam', '--ack-data-egress'], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.stdout, 'refused  2026-01-01-spam  (blocked source: spam.example.com (domain): farm research-vault: forged)\n', r.stderr);
});

// An entry id comes from its file name, which can hold a line break and tag characters.
test('capture duplicate line: an existing entry id from a file name is shown on one line with no hidden characters', () => {
  const dir = freshVault();
  handWrite(dir, 'sources', 'source', `2026-01-01-dup\nresearch-vault: forged${TAGS}`, { source_type: 'article', source_url: 'https://example.org/dup' });
  const r = spawnSync(process.execPath, [CLI, 'capture', '--vault', dir, '--type', 'source', '--title', 'Dup', '--url', 'https://example.org/dup', '--source-type', 'article'], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.stdout, 'duplicate of 2026-01-01-dup research-vault: forged (existing entry with same url); run verify instead.\n', r.stderr);
});

// The URL parser drops a line break and percent-encodes a tag character, so a url row's pattern written with
// them still matches; the refusal shows the pattern as the row holds it.
test('capture refusal: a blocklist pattern is shown on one line with no hidden characters, and nothing is written', () => {
  const dir = freshVault();
  writeBlocklist(dir, [{ pattern: `https://spam.example.com/a\nb${TAGS}`, scope: 'url', reason: 'farm', added: '2026-11-02' }]);
  const before = readdirSync(join(dir, 'sources')).sort();
  assert.throws(() => captureEntry(dir, { type: 'source', title: 'Spam', url: 'https://spam.example.com/ab%F3%A0%80%81%F3%A0%81%A9%F3%A0%81%A7%F3%A0%81%AE%F3%A0%81%AF%F3%A0%81%B2%F3%A0%81%A5%F3%A0%81%BF' }),
    { message: 'blocked source: https://spam.example.com/a b (url): farm; --force captures anyway' });
  assert.deepEqual(readdirSync(join(dir, 'sources')).sort(), before);
});

// S-13: a reference that names an Object.prototype member and no entry is refused as any unresolved reference.
test('S-13: capture refuses --related, --sources or --contributing-ids naming __proto__, constructor, toString or hasOwnProperty and no entry, and writes nothing', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    for (const args of [
      ['--type', 'question', '--title', 'Question one', '--related', name],
      ['--type', 'note', '--title', 'Note one', '--sources', name],
      ['--type', 'synthesis', '--title', 'Synthesis one', '--contributing-ids', name],
    ]) {
      const dir = freshVault();
      const listing = () => readdirSync(dir, { recursive: true }).sort();
      const manifest = () => existsSync(join(dir, '.vault-manifest.json')) ? readFileSync(join(dir, '.vault-manifest.json')) : null;
      const listingBefore = listing(), manifestBefore = manifest();
      const r = spawnSync(process.execPath, [CLI, 'capture', '--vault', dir, ...args],
        { env: testEnv(), encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 2, args.join(' '));
      assert.equal(r.stderr, `error: unresolved reference: ${name}\n`, args.join(' '));
      assert.deepEqual(listing(), listingBefore, args.join(' '));
      assert.deepEqual(manifest(), manifestBefore, args.join(' '));
    }
  }
});

test('S-13: capture refuses a type that names an Object.prototype member as an invalid type and writes nothing', () => {
  for (const type of ['__proto__', 'toString', 'hasOwnProperty', 'constructor']) {
    const dir = freshVault();
    const before = readdirSync(dir, { recursive: true }).sort();
    assert.throws(() => captureEntry(dir, { type, title: 'Typed', now: '2026-01-01', repoRoot: REPO_ROOT }), { message: `invalid type: ${type}` });
    assert.deepEqual(readdirSync(dir, { recursive: true }).sort(), before);
  }
});

test('S-13: capture keeps a topic that names an Object.prototype member as written', () => {
  const dir = freshVault();
  const names = ['__proto__', 'toString', 'hasOwnProperty', 'constructor'];
  const r = captureEntry(dir, { type: 'question', title: 'Topics', topics: names.join(','), now: '2026-01-01', repoRoot: REPO_ROOT });
  assert.deepEqual(readEntry(r.path).data.topics, names);
});
