import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureEntry, run } from '../bin/commands/capture.mjs';
import { makeId, sha256 } from '../bin/lib/ids.mjs';
import { readEntry, writeEntry } from '../bin/lib/fsutil.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { refreshVault } from '../bin/commands/refresh.mjs';
import { loadSchema, fieldOrder } from '../bin/lib/schema.mjs';

// Hand-write an entry to disk (mimicking a non-tooling writer that bypasses fail-fast
// capture) so the detective floor can be exercised on bad controlled values.
function handWrite(dir, folder, type, id, extra) {
  const schema = loadSchema(process.cwd());
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
  captureEntry(dir, { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'synthesis', title: 'S', contributingIds: '2026-01-01-a', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'snippet', title: 'Sn', language: 'python', tested: true, now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'experiment', title: 'E', provider: 'anthropic', modelId: 'claude-opus-4-7', task: 't', outcome: 'success', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'question', title: 'Does X hold?', now: '2026-05-27', repoRoot: process.cwd() });
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('Kubernetes-ecosystem entry: broad domain + tech in topics is lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'source', title: 'vcluster config docs', url: 'https://docs.vcluster.com/config',
    domain: 'systems-infrastructure', topics: 'kubernetes,vcluster,multi-tenancy',
    subjectName: 'vcluster', subjectVersion: '0.19', series: 'vcluster-config',
    now: '2026-05-27', repoRoot: process.cwd(),
  });
  assert.equal(r.dedup, null);
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('creates a conformant source entry and is lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'New Article', url: 'https://new.example.com/post', now: '2026-05-27', repoRoot: process.cwd() });
  assert.equal(r.dedup, null);
  assert.ok(existsSync(r.path));
  assert.match(r.id, /^2026-05-27-new-article$/);
});

test('dedup: same normalized url + same subject.version returns existing', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'Dup', url: 'https://dup.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'Dup Again', url: 'https://dup.example.com/x/?utm_source=z', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(r2.dedup);
  assert.match(r2.dedup.reason, /url/);
});

test('dedup bypassed for distinct subject.version (version succession)', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'vc 19', url: 'https://docs.vcluster.com/config', subjectName: 'vcluster', subjectVersion: '0.19', series: 'vcluster-config', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'vc 20', url: 'https://docs.vcluster.com/config', subjectName: 'vcluster', subjectVersion: '0.20', series: 'vcluster-config', now: '2026-05-27', repoRoot: process.cwd() });
  assert.equal(r2.dedup, null);
});

test('stores content_hash and normalizes topics through aliases', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'Hashed', url: 'https://h.example.com/x', content: 'hello world', topics: 'tdd,go', now: '2026-05-27', repoRoot: process.cwd() });
  const e = readEntry(r.path);
  assert.equal(e.data.content_hash, sha256('hello world'));
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
  assert.equal(e.data.content_hash, sha256('hello world'));
});

test('captured_via persists and stays lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'CV', url: 'https://cv.example.com/x', capturedVia: 'manual paste 2026-05-27', now: '2026-05-27', repoRoot: process.cwd() });
  assert.equal(readEntry(r.path).data.captured_via, 'manual paste 2026-05-27');
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('store-body without ack throws and writes nothing', () => {
  const dir = freshVault();
  assert.throws(
    () => captureEntry(dir, { type: 'source', title: 'B', url: 'https://b.example.com/x', content: 'BODY TEXT', storeBody: true, now: '2026-05-27', repoRoot: process.cwd() }),
    /ack.*egress|egress.*ack/i,
  );
  const id = makeId('2026-05-27', 'B');
  assert.ok(!existsSync(join(dir, 'sources', `${id}.md`)), 'no entry file should be written on rejection');
});

test('store-body with ack appends content to body; default keeps it out', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'B', url: 'https://b.example.com/x', content: 'BODY TEXT', storeBody: true, ackDataEgress: true, now: '2026-05-27', repoRoot: process.cwd() });
  const { body } = readEntry(r.path);
  assert.ok(body.startsWith('# B'), 'body should start with H1');
  assert.ok(body.includes('BODY TEXT'), 'body should include the stored content');

  const dir2 = freshVault();
  const r2 = captureEntry(dir2, { type: 'source', title: 'B2', url: 'https://b2.example.com/x', content: 'BODY TEXT', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(!readEntry(r2.path).body.includes('BODY TEXT'), 'default capture body must not include the content');
});

test('tripwire: same url+version but different content surfaces ambiguity', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'V1', url: 'https://t.example.com/p', content: 'AAA', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'V2', url: 'https://t.example.com/p', content: 'BBB', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(r2.dedup);
  assert.equal(r2.dedup.ambiguous, true);
  assert.match(r2.dedup.reason, /content/);
});

test('exact duplicate: same url+version+content is a plain (non-ambiguous) dup', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'V1', url: 'https://e2.example.com/p', content: 'SAME', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'V1b', url: 'https://e2.example.com/p', content: 'SAME', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(r2.dedup);
  assert.ok(!r2.dedup.ambiguous);
});

test('captures source with authority_tier and authority_basis, lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'source', title: 'Auth K8s', url: 'https://kubernetes.io/docs/x',
    authorityTier: 'primary', authorityBasis: 'official-docs',
    now: '2026-05-27', repoRoot: process.cwd(),
  });
  const e = readEntry(r.path);
  assert.equal(e.data.authority_tier, 'primary');
  assert.equal(e.data.authority_basis, 'official-docs');
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('captures synthesis with synthesis_basis: primary-rollup', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'synthesis', title: 'Version diff', contributingIds: '2026-01-01-a',
    synthesisBasis: 'primary-rollup', now: '2026-05-27', repoRoot: process.cwd(),
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
  const { violations } = lintVault(dir, process.cwd());
  const codes = violations.map(v => v.code);
  assert.ok(codes.includes('ENUM_SYNTHESIS_BASIS'), 'expected ENUM_SYNTHESIS_BASIS: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_AUTHORITY_TIER'), 'expected ENUM_AUTHORITY_TIER: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_AUTHORITY_BASIS'), 'expected ENUM_AUTHORITY_BASIS: ' + codes.join(','));
});

test('capture rejects unknown controlled values up front and writes nothing', () => {
  const dir = freshVault();
  assert.throws(
    () => captureEntry(dir, { type: 'note', title: 'Bad conf', sources: '2026-01-01-a', confidence: 'certain', now: '2026-05-27', repoRoot: process.cwd() }),
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
    const r = captureEntry(dir, { ...SCAFFOLD_ARGS[type], scaffold: true, now: '2026-05-27', repoRoot: process.cwd() });
    const { body, data } = readEntry(r.path);
    assert.ok(body.startsWith(`# ${data.title}`), `body should start with H1: ${body.slice(0, 40)}`);
    for (const s of sections) assert.ok(body.includes(s), `missing section ${s} in ${type} body`);
    const bodyAfterH1 = body.slice(body.indexOf('\n') + 1);
    assert.ok(!/^---/m.test(bodyAfterH1), 'no frontmatter should leak into the body');
    const { violations } = lintVault(dir, process.cwd());
    assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
  });
}

test('capture without --scaffold keeps body as bare H1', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: process.cwd() });
  const { body } = readEntry(r.path);
  assert.equal(body, '# N\n');
});

test('capture (all six types) leaves the vault lint-clean under --check', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://s.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'synthesis', title: 'S', contributingIds: '2026-01-01-a', synthesisBasis: 'primary-rollup', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'snippet', title: 'Sn', language: 'python', tested: true, now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'experiment', title: 'E', provider: 'anthropic', modelId: 'm', task: 't', outcome: 'success', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'question', title: 'Does X hold?', now: '2026-05-27', repoRoot: process.cwd() });
  const { violations } = lintAndReport(dir, { check: true });
  assert.equal(violations.length, 0, 'expected clean --check after captures: ' + JSON.stringify(violations));
});

test('capture refuses a colliding id and leaves the first entry intact', () => {
  const dir = freshVault();
  const opts = { type: 'note', title: 'Same Title', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: process.cwd() };
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
  captureEntry(dir, { type: 'source', title: 'v20', url: 'https://int.example.com/d', subjectName: 'thing', subjectVersion: '20', series: 'thing-rel', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'v20 again', url: 'https://int.example.com/d', subjectName: 'thing', subjectVersion: '20', series: 'thing-rel', now: '2026-05-27', repoRoot: process.cwd() });
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
  assert.equal(e.data.content_hash, sha256(bytes), 'hash must be over raw bytes');
  assert.notEqual(e.data.content_hash, sha256(bytes.toString('utf8')), 'must not hash the lossy UTF-8 decode');
  const results = await refreshVault(dir, {
    targets: [{ id: e.id, type: 'source', source_url: e.data.source_url, content_hash: e.data.content_hash }],
    fetch: async () => ({ status: 200, hash: sha256(bytes) }),
  });
  assert.equal(results[0].result, 'confirmed', 'capture and refresh hashing must agree');
});

test('capture seeds an honest `captured` verification, not a fake existence-check', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'Seed', url: 'https://seed.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  const v = readEntry(r.path).data.verifications;
  assert.equal(v.length, 1);
  assert.equal(v[0].method, 'captured');
  assert.equal(v[0].result, 'confirmed');
});
