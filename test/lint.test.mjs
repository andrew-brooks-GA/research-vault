import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { writeEntry } from '../bin/lib/fsutil.mjs';
import { loadSchema, fieldOrder } from '../bin/lib/schema.mjs';
import { CONTROLLED_FIELDS, VERIFICATION_CONTROLLED_FIELDS } from '../bin/lib/validate.mjs';

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

test('clean fixture vault passes', () => {
  const { violations } = lintVault(GOOD, process.cwd());
  assert.equal(violations.length, 0);
});

test('detects stored derived field, bad stage, dangling ref', () => {
  const { violations } = lintVault(BAD, process.cwd());
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
    const codes = lintVault(dir, process.cwd()).violations.map(v => v.code);
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
  const codes = lintVault(dir, process.cwd()).violations.map(v => v.code);
  assert.ok(codes.includes('ENUM_CONFIDENCE'), 'expected ENUM_CONFIDENCE: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_OUTCOME'), 'expected ENUM_OUTCOME: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_QUESTION_STATE'), 'expected ENUM_QUESTION_STATE: ' + codes.join(','));
  assert.ok(codes.includes('ENUM_BY_TYPE'), 'expected ENUM_BY_TYPE: ' + codes.join(','));
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
