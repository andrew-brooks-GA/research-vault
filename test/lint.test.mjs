import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintVault, fixVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { writeEntry } from '../bin/lib/fsutil.ts';
import { loadSchema, fieldOrder } from '../bin/lib/schema.mjs';
import { CONTROLLED_FIELDS, VERIFICATION_CONTROLLED_FIELDS } from '../bin/lib/validate.ts';
import { writeBlocklist } from './blocklist.test.mjs';
import { BLOCKLIST } from '../bin/lib/blocklist.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { REPO_ROOT, tmpVault, put, testEnv } from './helpers.mjs';
import { readEntry } from '../bin/lib/fsutil.ts';

const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
const badId = '2026-01-01-bad';
function damagedVault(t, extra = {}) {
  const vault = tmpVault();
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  put(vault, 'source', '2026-01-01-good', { source_type: 'article', source_url: 'https://example.org/good' });
  put(vault, 'source', badId, { source_type: 'article', source_url: 'https://example.org/bad', ...extra });
  const path = join(vault, 'sources', `${badId}.md`);
  return { vault, path };
}
function invoke(vault, args) {
  const r = spawnSync(process.execPath, [cli, ...args, '--vault', vault], { cwd: vault, env: testEnv(), encoding: 'utf8', timeout: 15000 });
  assert.ifError(r.error);
  return r;
}
const readers = [
  ['search', '--text', 'good'],
  ['capture', '--type', 'source', '--title', 'New', '--source-type', 'article', '--url', 'https://example.org/new'],
  ['check', 'sources/2026-01-01-good.md'],
  ['verify', '--id', badId, '--method', 'human-spot-check', '--result', 'confirmed'],
  ['related', badId], ['compile'], ['export'],
];
for (const args of [...readers.slice(0, 3), ['lint', '--check']]) {
  test(`bad-entry parse failure names the path: ${args[0]}`, t => {
    const { vault, path } = damagedVault(t);
    writeFileSync(path, 'not frontmatter\n');
    const before = readFileSync(path);
    const r = invoke(vault, args);
    assert.notEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes(`sources/${badId}.md`));
    assert.deepEqual(readFileSync(path), before);
    assert.deepEqual(readdirSync(join(vault, 'sources')).sort(), [`${badId}.md`, '2026-01-01-good.md']);
    assert.equal(existsSync(join(vault, '.vault-manifest.json')), false);
  });
}
for (const flags of [[], ['--check']]) {
  test(`bad-entry lint ${flags.join(' ')} prints PARSE and preserves manifest bytes`, t => {
    const { vault, path } = damagedVault(t);
    writeFileSync(path, 'not frontmatter\n');
    const manifest = join(vault, '.vault-manifest.json');
    const bytes = '{"sentinel":true}\n';
    writeFileSync(manifest, bytes);
    const r = invoke(vault, ['lint', ...flags]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /PARSE.*sources\/2026-01-01-bad\.md/);
    assert.equal(readFileSync(manifest, 'utf8'), bytes);
  });
}
for (const [field, value] of Object.entries({ verifications: 'nope', topics: 7, related: 5, subject: 'nope', domain: 7, sources: 7, contributing_ids: 7, contributing: 7, attachments: 7 })) {
  test(`bad-entry ${field} shape is a finding and stops consumers before output or writes`, t => {
    const { vault, path } = damagedVault(t, { [field]: value });
    const before = readFileSync(path);
    const lint = invoke(vault, ['lint']);
    assert.equal(lint.status, 1);
    assert.match(lint.stdout, new RegExp(`FIELD_SHAPE.*sources/${badId}\\.md.*${field}`));
    for (const args of readers) {
      const r = invoke(vault, args);
      assert.equal(r.status, args[0] === 'export' ? 1 : 2, args[0]);
      assert.doesNotMatch(r.stderr, /is not a function|Cannot read properties/);
      assert.ok(r.stderr.includes(`${badId}.md`) && r.stderr.includes(field), `${args[0]}: ${r.stderr}`);
      assert.equal(r.stdout, '', args[0]);
    }
    assert.deepEqual(readFileSync(path), before);
    assert.deepEqual(readdirSync(join(vault, 'sources')).sort(), [`${badId}.md`, '2026-01-01-good.md']);
    assert.equal(existsSync(join(vault, '.vault-manifest.json')), false);
    assert.equal(existsSync(join(vault, '_index')), false);
  });
}
test('bad-entry CRLF is searchable, linted, and fixed to LF', t => {
  const { vault, path } = damagedVault(t);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(readEntry(path).hasCrlf, true);
  assert.equal(invoke(vault, ['search', '--text', 'bad']).status, 0);
  const lint = invoke(vault, ['lint']);
  assert.equal(lint.status, 1);
  assert.match(lint.stdout, /ENCODING_CRLF.*2026-01-01-bad/);
  assert.equal(invoke(vault, ['lint', '--fix']).status, 0);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /\r/);
});
test('bad-entry writeEntry normalizes CRLF throughout', t => {
  const { path } = damagedVault(t);
  const lf = readFileSync(path, 'utf8');
  writeFileSync(path, lf.replace(/\n/g, '\r\n'));
  const entry = readEntry(path);
  writeEntry(path, entry.data, entry.body);
  assert.equal(readFileSync(path, 'utf8'), lf);
});
test('bad-entry parse errors escape path controls', t => {
  const vault = tmpVault();
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const path = join(vault, 'bad\nname.md');
  writeFileSync(path, 'broken');
  assert.throws(() => readEntry(path), e => e.code === 'ENTRY_PARSE' && e.message.includes('bad\\u000aname.md') && !e.message.includes('\n'));
});
test('bad-entry read errors retain filesystem codes and escape path controls', t => {
  const vault = tmpVault();
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const path = join(vault, 'missing\nname.md');
  assert.throws(() => readEntry(path), e => e.code === 'ENOENT' && e.entryCode === 'ENTRY_READ' && !e.message.includes('\n'));
});

const GOOD = fileURLToPath(new URL('./fixtures/vault', import.meta.url));
const BAD = fileURLToPath(new URL('./fixtures/bad', import.meta.url));

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-lint-')), 'v');
  cpSync(GOOD, dir, { recursive: true });
  return dir;
}

// Hand-write an entry directly to disk (mimicking a non-tooling writer that bypasses
// fail-fast capture) so the detective floor can be exercised on bad enum values.
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

test('clean fixture vault passes', () => {
  const { violations } = lintVault(GOOD, REPO_ROOT);
  assert.equal(violations.length, 0);
});

test('detects stored derived field, bad stage, dangling ref', () => {
  const { violations } = lintVault(BAD, REPO_ROOT);
  const codes = violations.map(v => v.code);
  assert.ok(codes.includes('STORED_DERIVED'));
  assert.ok(codes.includes('STAGE_FOLDER'));
  assert.ok(codes.includes('DANGLING_REF'));
});

// A valid verification record with one subfield overridable to a bogus value. handWrite
// supplies its own default verifications, so verification-field probes override it here.
function verifications(badField) {
  const base = { date: '2026-01-01', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' };
  return [{ ...base, ...(badField ? { [badField]: 'definitely-not-valid' } : {}) }];
}

// One place mapping each controlled field to: the lint code lintVault must emit for a bogus
// value, plus a probe (folder/type + the surrounding fields needed so the entry is otherwise
// valid). Each probe is valid EXCEPT the targeted field, so the ONLY violation that can
// satisfy the assertion is that field's own ENUM_* check firing in lintVault.
//   field name -> { code, folder, type, extra }
// `extra` carries the bogus value for the field plus any required-by-type companions.
const PROBES = {
  // top-level CONTROLLED_FIELDS
  domain:          { code: 'ENUM_DOMAIN',          folder: 'notes',       type: 'note',       extra: { sources: ['2026-01-01-a'], confidence: 'high', domain: ['not-a-real-domain'] } },
  volatility:      { code: 'ENUM_VOLATILITY',      folder: 'notes',       type: 'note',       extra: { sources: ['2026-01-01-a'], confidence: 'high', volatility: 'not-a-real-volatility' } },
  status:          { code: 'ENUM_STATUS',          folder: 'notes',       type: 'note',       extra: { sources: ['2026-01-01-a'], confidence: 'high', status: 'not-a-real-status' } },
  confidence:      { code: 'ENUM_CONFIDENCE',      folder: 'notes',       type: 'note',       extra: { sources: ['2026-01-01-a'], confidence: 'certain' } },
  outcome:         { code: 'ENUM_OUTCOME',         folder: 'experiments', type: 'experiment', extra: { provider: 'anthropic', model_id: 'm', date_run: '2026-01-01', task: 't', outcome: 'amazing' } },
  state:           { code: 'ENUM_QUESTION_STATE',  folder: 'questions',   type: 'question',   extra: { question: 'q', state: 'resolved-ish' } },
  synthesis_basis: { code: 'ENUM_SYNTHESIS_BASIS', folder: 'synthesis',   type: 'synthesis',  extra: { contributing_ids: ['2026-01-01-a'], synthesis_basis: 'made-up-basis' } },
  authority_tier:  { code: 'ENUM_AUTHORITY_TIER',  folder: 'sources',     type: 'source',     extra: { source_type: 'docs', source_url: 'https://x', authority_tier: 'made-up-tier' } },
  authority_basis: { code: 'ENUM_AUTHORITY_BASIS', folder: 'sources',     type: 'source',     extra: { source_type: 'docs', source_url: 'https://x', authority_basis: 'made-up-basis' } },
  // VERIFICATION_CONTROLLED_FIELDS — bogus value lives in the verifications[] subrecord
  method:          { code: 'ENUM_METHOD',          folder: 'notes',       type: 'note',       extra: { sources: ['2026-01-01-a'], confidence: 'high', verifications: verifications('method') } },
  result:          { code: 'ENUM_RESULT',          folder: 'notes',       type: 'note',       extra: { sources: ['2026-01-01-a'], confidence: 'high', verifications: verifications('result') } },
  by_type:         { code: 'ENUM_BY_TYPE',         folder: 'notes',       type: 'note',       extra: { sources: ['2026-01-01-a'], confidence: 'high', verifications: verifications('by_type') } },
};

test('no silent enum gaps: every fail-fast controlled field is actually enforced by lintVault', () => {
  // Step 12 / detective floor: bind the coverage matrix to EXECUTABLE lint behavior. Drive
  // the field list from the SAME maps the fail-fast validator uses, so the test's coverage
  // and the validator's coverage cannot diverge. For every controlled field we hand-write an
  // otherwise-valid entry carrying a bogus value for that one field and assert lintVault
  // actually emits the expected ENUM_* code. If a field is controlled but lintVault does not
  // flag a bad value for it, this test FAILS — closing the "forgot the lint check" gap.
  const controlledFields = [
    ...Object.keys(CONTROLLED_FIELDS),
    ...Object.keys(VERIFICATION_CONTROLLED_FIELDS),
  ];

  // Coverage guard: every controlled field must have a probe defined above. If someone adds
  // a field to CONTROLLED_FIELDS without a probe here, fail loudly rather than silently skip.
  for (const field of controlledFields) {
    assert.ok(PROBES[field], `no lint-coverage probe defined for controlled field: ${field}`);
  }

  for (const field of controlledFields) {
    const { code, folder, type, extra } = PROBES[field];
    const dir = freshVault();
    handWrite(dir, folder, type, `2026-01-01-bad-${field}`, extra);
    const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
    assert.ok(
      codes.includes(code),
      `controlled field '${field}' bad value must emit ${code}; lintVault emitted: ${codes.join(',') || '(none)'}`,
    );
  }
});

test('lint validates confidence / outcome / question state / verification by_type enums', () => {
  const dir = freshVault();
  handWrite(dir, 'notes', 'note', '2026-01-01-bad-conf', { sources: ['2026-01-01-a'], confidence: 'certain' });
  handWrite(dir, 'experiments', 'experiment', '2026-01-01-bad-out', { provider: 'anthropic', model_id: 'm', date_run: '2026-01-01', task: 't', outcome: 'amazing' });
  handWrite(dir, 'questions', 'question', '2026-01-01-bad-state', { question: 'q', state: 'resolved-ish' });
  handWrite(dir, 'notes', 'note', '2026-01-01-bad-bytype', {
    sources: ['2026-01-01-a'], confidence: 'high',
    verifications: [{ date: '2026-01-01', by_type: 'robot', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }],
  });
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('ENUM_CONFIDENCE'), 'expected ENUM_CONFIDENCE: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_OUTCOME'), 'expected ENUM_OUTCOME: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_QUESTION_STATE'), 'expected ENUM_QUESTION_STATE: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_BY_TYPE'), 'expected ENUM_BY_TYPE: ' + codes.join(','));
});

// Raw single-folder vault + entry writer for probing codes that live outside the enum matrix:
// parse failures, folder/type mismatch, presence rules, encodings. Bypasses the serializer so
// BOM/CRLF/parse-broken bytes reach lint verbatim.
function rawVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-lint-raw-')), 'v');
  mkdirSync(join(dir, 'sources'), { recursive: true });
  return dir;
}
const VALID_SOURCE = `---\ntitle: R\ntype: source\ncreated: 2026-01-01\ndomain: [meta]\nstage: raw\ntopics: []\nstatus: active\nrelated: []\nvolatility: slow\nverifications: []\nsource_type: article\nsource_url: https://e.com/r\n---\n# R\n`;

test('lint emits PARSE for an entry with no frontmatter', () => {
  const dir = rawVault();
  writeFileSync(join(dir, 'sources', '2026-01-01-noyaml.md'), '# just a body, no frontmatter\n', 'utf8');
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('PARSE'), 'expected PARSE: ' + codes.join(','));
});

test('lint emits TYPE_FOLDER when an entry type does not match its folder', () => {
  const dir = freshVault();
  handWrite(dir, 'notes', 'source', '2026-01-01-mistyped', { source_type: 'docs', source_url: 'https://x' });
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('TYPE_FOLDER'), 'expected TYPE_FOLDER: ' + codes.join(','));
});

test('lint emits MISSING_REQUIRED for an absent AND an empty required field', () => {
  const dir = freshVault();
  // Absent: a snippet with no `tested`. Empty: a note with sources: [] (present but empty).
  handWrite(dir, 'snippets', 'snippet', '2026-01-01-nofield', { language: 'js' });
  handWrite(dir, 'notes', 'note', '2026-01-01-emptyarr', { sources: [], confidence: 'high' });
  const files = lintVault(dir, REPO_ROOT).violations.filter(v => v.code === 'MISSING_REQUIRED').map(v => v.file);
  assert.ok(files.some(f => f.includes('2026-01-01-nofield')), 'absent required field must flag MISSING_REQUIRED');
  assert.ok(files.some(f => f.includes('2026-01-01-emptyarr')), 'empty required array must flag MISSING_REQUIRED');
});

test('lint emits SUPERSEDE when status is superseded without superseded_by', () => {
  const dir = freshVault();
  handWrite(dir, 'sources', 'source', '2026-01-01-gone', { source_type: 'docs', source_url: 'https://x', status: 'superseded' });
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('SUPERSEDE'), 'expected SUPERSEDE: ' + codes.join(','));
});

test('lint emits SUBJECT_SHAPE when subject has no name', () => {
  const dir = freshVault();
  handWrite(dir, 'sources', 'source', '2026-01-01-nameless', { source_type: 'docs', source_url: 'https://x', subject: { version: '1.0' } });
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('SUBJECT_SHAPE'), 'expected SUBJECT_SHAPE: ' + codes.join(','));
});

test('lint emits URL_INVALID for a non-empty unparsable source_url (and does not crash)', () => {
  const dir = rawVault();
  const bad = VALID_SOURCE.replace('source_url: https://e.com/r', 'source_url: not-a-url');
  writeFileSync(join(dir, 'sources', '2026-01-01-badurl.md'), bad, 'utf8');
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('URL_INVALID'), 'expected URL_INVALID: ' + codes.join(','));
});

test('lint emits FIELD_SHAPE (not per-char enum garbage) for a scalar domain', () => {
  const dir = rawVault();
  const bad = VALID_SOURCE.replace('domain: [meta]', 'domain: security');
  writeFileSync(join(dir, 'sources', '2026-01-01-scalardomain.md'), bad, 'utf8');
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('FIELD_SHAPE'), 'expected FIELD_SHAPE: ' + codes.join(','));
  assert.ok(!codes.includes('ENUM_DOMAIN'), 'a scalar domain must not produce per-char ENUM_DOMAIN: ' + codes.join(','));
});

test('lint emits ENCODING_BOM and ENCODING_CRLF directly (not just via the fix path)', () => {
  const dir = rawVault();
  writeFileSync(join(dir, 'sources', '2026-01-01-bom.md'), String.fromCharCode(0xFEFF) + VALID_SOURCE, 'utf8');
  writeFileSync(join(dir, 'sources', '2026-01-01-crlf.md'), VALID_SOURCE.replace(/\n/g, '\r\n'), 'utf8');
  const codes = lintVault(dir, REPO_ROOT).violations.map(v => v.code);
  assert.ok(codes.includes('ENCODING_BOM'), 'expected ENCODING_BOM: ' + codes.join(','));
  assert.ok(codes.includes('ENCODING_CRLF'), 'expected ENCODING_CRLF: ' + codes.join(','));
});

test('lint --check flags MANIFEST_STALE when only backlinks go stale (not just entries)', () => {
  const dir = freshVault();
  lintAndReport(dir, { check: false });
  const mfPath = join(dir, '.vault-manifest.json');
  const m = JSON.parse(readFileSync(mfPath, 'utf8'));
  m.backlinks = {};
  writeFileSync(mfPath, JSON.stringify(m, null, 2), 'utf8');
  const res = lintAndReport(dir, { check: true });
  assert.ok(
    res.violations.some(v => v.code === 'MANIFEST_STALE'),
    'a stale backlinks map must make lint --check report MANIFEST_STALE',
  );
});

test('lint --check flags MANIFEST_STALE when only edges go stale', () => {
  const dir = freshVault();
  lintAndReport(dir, { check: false });
  const mfPath = join(dir, '.vault-manifest.json');
  const m = JSON.parse(readFileSync(mfPath, 'utf8'));
  m.edges = m.edges.filter(e => e.rel !== 'related');
  writeFileSync(mfPath, JSON.stringify(m, null, 2), 'utf8');
  assert.ok(lintAndReport(dir, { check: true }).violations.some(v => v.code === 'MANIFEST_STALE'));
});

test('lint --check flags MANIFEST_STALE when stored rows lack the spec-08 facet fields (pre-upgrade manifest)', () => {
  const dir = freshVault();
  lintAndReport(dir, { check: false });
  const mfPath = join(dir, '.vault-manifest.json');
  const m = JSON.parse(readFileSync(mfPath, 'utf8'));
  for (const row of m.entries) for (const k of ['stage', 'state', 'confidence', 'outcome', 'authority_tier', 'authority_basis', 'superseded_by']) delete row[k];
  writeFileSync(mfPath, JSON.stringify(m, null, 2), 'utf8');
  assert.ok(lintAndReport(dir, { check: true }).violations.some(v => v.code === 'MANIFEST_STALE'), 'old row shape must read as stale');
  lintAndReport(dir, { check: false });
  assert.ok(!lintAndReport(dir, { check: true }).violations.some(v => v.code === 'MANIFEST_STALE'), 'rebuild clears it');
});

test('lint --check flags MANIFEST_STALE after an out-of-band entry edit on a populated vault', () => {
  const dir = freshVault();
  // Make the on-disk manifest match reality, then confirm it is clean under --check.
  lintAndReport(dir, { check: false });
  assert.ok(
    !lintAndReport(dir, { check: true }).violations.some(v => v.code === 'MANIFEST_STALE'),
    'a freshly-rebuilt manifest must be clean under --check',
  );

  // Simulate a non-tooling writer editing an entry without rebuilding the manifest.
  const f = join(dir, 'sources', '2026-01-01-a.md');
  const original = readFileSync(f, 'utf8');
  const edited = original.replace(/^title:.*/m, 'title: Edited Out Of Band');
  assert.notEqual(edited, original, 'precondition: the entry had a title line to edit');
  writeFileSync(f, edited, 'utf8');

  const res = lintAndReport(dir, { check: true });
  assert.ok(
    res.violations.some(v => v.code === 'MANIFEST_STALE'),
    'an out-of-band entry edit must make lint --check report MANIFEST_STALE',
  );
});

test('tool-output source without subject.version is a violation; with version passes', () => {
  const dir = freshVault();
  handWrite(dir, 'sources', 'source', '2026-07-16-probe-noversion', {
    source_type: 'tool-output', source_url: 'cli://vcluster/create-help',
    authority_tier: 'primary', authority_basis: 'tool-output',
  });
  handWrite(dir, 'sources', 'source', '2026-07-16-probe-versioned', {
    source_type: 'tool-output', source_url: 'cli://vcluster/create-help',
    authority_tier: 'primary', authority_basis: 'tool-output',
    subject: { name: 'vcluster', version: '0.26.0' },
  });
  const { violations } = lintVault(dir, REPO_ROOT);
  const hits = violations.filter(v => v.code === 'TOOL_OUTPUT_VERSION');
  assert.equal(hits.length, 1);
  assert.match(hits[0].file, /probe-noversion/);
});

test('intended_targets is documentation only: a note whose sources names a question lints clean', () => {
  const dir = freshVault();
  handWrite(dir, 'questions', 'question', '2026-01-02-q', { question: 'q?', state: 'open' });
  handWrite(dir, 'notes', 'note', '2026-01-03-n', { sources: ['2026-01-02-q'], confidence: 'medium' });
  assert.deepEqual(lintVault(dir, REPO_ROOT).violations, []);
});

test('lint warns WARN_SOURCE_BLOCKED on a source matching the blocklist and reports a list that does not parse as BLOCKLIST_INVALID (spec 32 D2)', () => {
  const dir = freshVault();
  writeBlocklist(dir);
  handWrite(dir, 'sources', 'source', '2026-01-01-spam', { source_type: 'article', source_url: 'https://spam.example.com/a' });
  const r = lintVault(dir, REPO_ROOT);
  assert.equal(r.violations.length, 0);
  const w = r.warnings.filter(x => x.code === 'WARN_SOURCE_BLOCKED');
  assert.equal(w.length, 1);
  assert.match(w[0].msg, /content farm/);
  writeFileSync(join(dir, BLOCKLIST), '{}', 'utf8');
  const bad = lintVault(dir, REPO_ROOT);
  assert.equal(bad.violations.filter(x => x.code === 'BLOCKLIST_INVALID').length, 1);
});

// Round-two regressions: every subprocess uses the temporary vault and testEnv home.
for (const mode of ['verification', 'quotes', 'answer', 'fill']) {
  test('bad-entry refuses ' + mode + ' before changing a good entry', t => {
    const { vault, path } = damagedVault(t);
    const good = '2026-01-01-good';
    const question = '2026-01-01-question';
    const prose = 'This sentence provides enough stored source text for a quote check. '.repeat(6);
    put(vault, 'source', good, { source_type: 'article', source_url: 'https://example.org/good' }, mode === 'fill' ? '# Stub\n' : '# Good\n\n' + prose);
    put(vault, 'question', question, { question: 'Why?', state: 'open' });
    const quotes = join(vault, 'quotes.json');
    const content = join(vault, 'content.txt');
    writeFileSync(quotes, JSON.stringify(['This sentence provides enough stored source text for a quote check.']));
    writeFileSync(content, prose);
    const args = {
      verification: ['verify', '--id', good, '--method', 'human-spot-check', '--result', 'confirmed'],
      quotes: ['verify', '--id', good, '--quotes', quotes],
      answer: ['verify', '--id', question, '--answered-by', good],
      fill: ['capture', '--fill', good, '--content-file', content, '--ack-data-egress'],
    }[mode];
    const manifest = join(vault, '.vault-manifest.json');
    writeFileSync(manifest, '{"sentinel":true}\n');
    const snapshot = () => Object.fromEntries(readdirSync(vault, { recursive: true, withFileTypes: true }).map(d => {
      const p = join(d.parentPath, d.name);
      return [p, d.isDirectory() ? null : readFileSync(p).toString('base64')];
    }));
    for (const bad of ['not frontmatter\n', '---\nverifications: nope\n---\n']) {
      writeFileSync(path, bad);
      const before = snapshot();
      const r = invoke(vault, args);
      assert.equal(r.status, 2);
      assert.ok(r.stderr.includes('sources/' + badId + '.md'), r.stderr);
      assert.deepEqual(snapshot(), before, 'entry and manifest bytes and all folder names must stay unchanged');
    }
  });
}

test('search text accepts non-string titles and scalar summaries', t => {
  const { vault, path } = damagedVault(t);
  for (const title of [2024, true, ['a']]) {
    put(vault, 'source', badId, { title, summary: 42, topics: [2024, true], source_type: 'article', source_url: 'https://example.org/bad' });
    for (const text of [String(title), '42']) {
      const r = invoke(vault, ['search', '--text', text, '--json']);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(JSON.parse(r.stdout).some(e => e.id === badId));
    }
  }
});

test('lint fix repairs other fields on malformed shapes and retains their types for warnings', t => {
  const { vault, path } = damagedVault(t, { topics: 7, title: "'Wrapped'" });
  put(vault, 'synthesis', '2026-01-02-rollup', { contributing_ids: [badId] });
  const r = invoke(vault, ['lint', '--fix']);
  assert.equal(r.status, 1);
  assert.equal(readEntry(path, { validateShapes: false }).data.title, 'Wrapped');
  assert.match(r.stdout, /WARN_SYNTHESIS_NO_NOTE_COVERAGE/);
  assert.match(r.stdout, /FIELD_SHAPE/);
});

test('lint parse diagnostic prints the entry path once', t => {
  const { vault, path } = damagedVault(t);
  writeFileSync(path, 'broken\n');
  const r = invoke(vault, ['lint', '--check']);
  assert.equal(r.status, 1);
  const line = r.stdout.split('\n').find(l => l.startsWith('PARSE'));
  assert.equal(line.split(badId + '.md').length - 1, 1, line);
});

test('entry directory is reported by lint and skipped by fix without writes', t => {
  const { vault, path } = damagedVault(t);
  rmSync(path);
  mkdirSync(path);
  const goodPath = join(vault, 'sources', '2026-01-01-good.md');
  const before = readFileSync(goodPath);
  const manifest = join(vault, '.vault-manifest.json');
  writeFileSync(manifest, '{"sentinel":true}\n');
  for (const args of [['lint', '--fix'], ['lint', '--check'], ['search']]) {
    const r = invoke(vault, args);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /EISDIR/);
    assert.ok((r.stdout + r.stderr).includes('sources/' + badId + '.md'));
    if (args[0] === 'lint') assert.match(r.stdout, /PARSE/);
    assert.deepEqual(readFileSync(goodPath), before);
    assert.equal(readFileSync(manifest, 'utf8'), '{"sentinel":true}\n');
    assert.deepEqual(readdirSync(join(vault, 'sources')).sort(), [badId + '.md', '2026-01-01-good.md']);
    assert.deepEqual(readdirSync(path), []);
  }
});

test('batch scalar options are written as CLI strings', async t => {
  for (const flags of [[], ['--operation-id', 'scalar-plan']]) await t.test(flags.length ? 'capture-operation' : 'batch', t => {
  const { vault } = damagedVault(t);
  const plan = join(vault, 'plan.json');
  writeFileSync(plan, JSON.stringify([{ type: 'source', title: 'Numeric plan', url: 'https://example.org/numeric', subjectName: 'Tool', subjectVersion: 26, byId: 7, summary: 42 }]));
  const r = invoke(vault, ['capture', '--batch', plan, '--json', ...flags]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const name = readdirSync(join(vault, 'sources')).find(n => n.endsWith('-numeric-plan.md'));
  const path = join(vault, 'sources', name);
  const data = readEntry(path).data;
  assert.equal(data.subject.version, '26');
  assert.equal(data.verifications[0].by_id, '7');
  assert.equal(data.summary, '42');
  assert.match(readFileSync(path, 'utf8'), /version: "26"/);
  assert.equal(invoke(vault, ['lint']).status, 0);
  const search = invoke(vault, ['search', '--text', 'Numeric plan', '--json']);
  assert.equal(search.status, 0, search.stderr);
  assert.equal(JSON.parse(search.stdout)[0].title, 'Numeric plan');
  });
});

// S-11: each lint message is a line of lint's text output, so a value it quotes from an entry or the blocklist
// is shown on one line with no hidden characters. Tag characters spell "ignore".
const TAGS = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';

test('lint WARN_SOURCE_BLOCKED: a blocklist reason is shown on one line with no hidden characters', () => {
  const dir = freshVault();
  writeBlocklist(dir, [{ pattern: 'spam.example.com', scope: 'domain', reason: `farm\nwarning WARN_FORGED  x.md: forged${TAGS}`, added: '2026-11-02' }]);
  handWrite(dir, 'sources', 'source', '2026-01-01-spam', { source_type: 'article', source_url: 'https://spam.example.com/a' });
  const w = lintVault(dir, REPO_ROOT).warnings.filter(x => x.code === 'WARN_SOURCE_BLOCKED');
  assert.deepEqual(w.map(x => x.msg), ['source_url matches the blocklist: spam.example.com (domain): farm warning WARN_FORGED x.md: forged']);
});

test('lint TYPE_FOLDER: an entry type is shown on one line with no hidden characters', () => {
  const dir = freshVault();
  handWrite(dir, 'notes', `note\nTYPE_FOLDER  forged.md: forged${TAGS}`, '2026-01-01-n', { sources: ['2026-01-01-a'], confidence: 'medium' });
  const v = lintVault(dir, REPO_ROOT).violations.filter(x => x.code === 'TYPE_FOLDER');
  assert.deepEqual(v.map(x => x.msg), ['type note TYPE_FOLDER forged.md: forged in folder notes']);
});

test('lint WARN_QUOTE_ARTIFACT: a quoted title is shown on one line with no hidden characters', () => {
  const dir = freshVault();
  handWrite(dir, 'sources', 'source', '2026-01-01-q', { title: `'zig\nwarning WARN_FORGED  x.md: forged${TAGS}'`, source_type: 'article', source_url: 'https://example.org/q' });
  const w = lintVault(dir, REPO_ROOT).warnings.filter(x => x.code === 'WARN_QUOTE_ARTIFACT');
  assert.deepEqual(w.map(x => x.msg), ["title value is itself wrapped in quotes ('zig warning WARN_FORGED x.md: forged'); run lint --fix to unwrap"]);
});

// The URL parser drops a line break and percent-encodes a tag character, so a url row's pattern written with
// them still matches; the message shows the pattern as the row holds it.
test('lint WARN_SOURCE_BLOCKED: a blocklist pattern is shown on one line with no hidden characters', () => {
  const dir = freshVault();
  writeBlocklist(dir, [{ pattern: `https://spam.example.com/a\nb${TAGS}`, scope: 'url', reason: 'farm', added: '2026-11-02' }]);
  handWrite(dir, 'sources', 'source', '2026-01-01-spam', { source_type: 'article', source_url: 'https://spam.example.com/ab%F3%A0%80%81%F3%A0%81%A9%F3%A0%81%A7%F3%A0%81%AE%F3%A0%81%AF%F3%A0%81%B2%F3%A0%81%A5%F3%A0%81%BF' });
  const w = lintVault(dir, REPO_ROOT).warnings.filter(x => x.code === 'WARN_SOURCE_BLOCKED');
  assert.deepEqual(w.map(x => x.msg), ['source_url matches the blocklist: https://spam.example.com/a b (url): farm']);
});

// Each row: a code, a source's fields with one value from the vault (or its taxonomy_extensions) holding a line
// break and tag characters, and the one message that code must give for that source.
test('lint messages: an entry value is shown on one line with no hidden characters', () => {
  const dir = freshVault();
  const forged = code => `\n${code}  x.md: forged${TAGS}`;
  const alias = `k8s${forged('WARN_TOPIC_ALIAS')}`;
  writeFileSync(join(dir, '..', '.research-vault.json'), JSON.stringify({ vault: 'v', taxonomy_extensions: { topic_aliases: { [alias]: `kubernetes${forged('WARN_TOPIC_ALIAS')}` } } }));
  const rows = [
    ['URL_INVALID', { source_type: 'article', source_url: `not a url${forged('URL_INVALID')}` }, 'source_url is not a valid URL: not a url URL_INVALID x.md: forged'],
    ['STAGE_FOLDER', { source_type: 'article', source_url: 'https://example.org/s', stage: `raw${forged('STAGE_FOLDER')}` }, 'stage raw STAGE_FOLDER x.md: forged not allowed in sources'],
    ['DANGLING_REF', { source_type: 'article', source_url: 'https://example.org/d', related: [`2026-01-09-gone${forged('DANGLING_REF')}`] }, 'related -> missing id 2026-01-09-gone DANGLING_REF x.md: forged'],
    ['ENUM_DOMAIN', { source_type: 'article', source_url: 'https://example.org/e', domain: [`security${forged('ENUM_DOMAIN')}`] }, 'unknown domain: security ENUM_DOMAIN x.md: forged'],
    ['ENUM_VOLATILITY', { source_type: 'article', source_url: 'https://example.org/v', volatility: `slow${forged('ENUM_VOLATILITY')}` }, 'unknown volatility: slow ENUM_VOLATILITY x.md: forged'],
    ['ENUM_METHOD', { source_type: 'article', source_url: 'https://example.org/m', verifications: [{ date: '2026-01-01', by_type: 'human', by_id: '', method: `human-spot-check${forged('ENUM_METHOD')}`, result: 'confirmed', notes: '' }] }, 'unknown method: human-spot-check ENUM_METHOD x.md: forged'],
    ['WARN_TOPIC_ALIAS', { source_type: 'article', source_url: 'https://example.org/t', topics: [alias] }, "topic 'k8s WARN_TOPIC_ALIAS x.md: forged' should be normalized to 'kubernetes WARN_TOPIC_ALIAS x.md: forged'"],
  ];
  rows.forEach(([code, extra], i) => handWrite(dir, 'sources', 'source', `2026-01-0${i + 1}-${code.toLowerCase()}`, extra));
  const { violations, warnings } = lintVault(dir, REPO_ROOT);
  const found = ([code], i) => [...violations, ...warnings].filter(x => x.code === code && x.file.endsWith(`2026-01-0${i + 1}-${code.toLowerCase()}.md`)).map(x => x.msg);
  assert.deepEqual(rows.map(found), rows.map(r => [r[2]]));
});

// S-13: an entry type or a topic that names an Object.prototype member lints and fixes as an ordinary unknown name.
// Each run builds the same vault with `name` as a topic and a type; a run with a prototype name must match the plain run.
function s13Vault(t, name) {
  const dir = tmpVault('rv-s13-lint-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s', topics: [name] });
  const typed = join(dir, 'notes', `${put(dir, 'note', '2026-01-02-n', { sources: ['2026-01-01-s'], confidence: 'medium' })}.md`);
  writeFileSync(typed, readFileSync(typed, 'utf8').replace(/^type: note$/m, `type: ${name}`));
  return dir;
}

test('S-13: lint takes a type or topic named after an Object.prototype member as an ordinary name', t => {
  const run = name => {
    const dir = s13Vault(t, name);
    const { violations, warnings } = lintVault(dir, REPO_ROOT);
    return JSON.stringify({ violations, warnings }).replaceAll(dir, 'VAULT').replaceAll(name, 'NAME');
  };
  const plain = run('plainname');
  assert.match(plain, /"code":"TYPE_FOLDER","msg":"type NAME in folder notes"/);
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(run(name), plain, name);
});

test('S-13: lint --fix --topics takes a type or topic named after an Object.prototype member as an ordinary name', t => {
  const run = name => {
    const dir = s13Vault(t, name);
    const fixed = fixVault(dir, REPO_ROOT, { topics: true });
    const files = ['sources/2026-01-01-s.md', 'notes/2026-01-02-n.md'].map(f => readFileSync(join(dir, f), 'utf8'));
    return JSON.stringify({ fixed, files }).replaceAll(dir, 'VAULT').replaceAll(name, 'NAME');
  };
  const plain = run('plainname');
  assert.match(plain, /^\{"fixed":\{"fixed":0\},"files":\["---\\ntitle: 2026-01-01-s\\n.*topics: \[NAME\]/);
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(run(name), plain, name);
});
