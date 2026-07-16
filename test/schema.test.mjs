import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { loadSchema, stageAllowedInFolder, fieldOrder, applyTaxonomyExtensions } from '../bin/lib/schema.mjs';
import { PROJECT_CONFIG_FILENAME } from '../bin/lib/projectconfig.mjs';

test('loads taxonomy and field definitions', () => {
  const s = loadSchema(process.cwd());
  assert.ok(s.taxonomy.domain.includes('software-engineering'));
  assert.equal(s.taxonomy.volatility.fast.refresh_after_days, 90);
  assert.ok(s.fields.common.includes('title'));
});

test('stage/folder matrix enforced', () => {
  const s = loadSchema(process.cwd());
  assert.equal(stageAllowedInFolder(s, 'sources', 'raw'), true);
  assert.equal(stageAllowedInFolder(s, 'sources', 'distilled'), false);
  assert.equal(stageAllowedInFolder(s, 'synthesis', 'stable'), true);
});

test('fieldOrder returns deterministic key order for a type', () => {
  const s = loadSchema(process.cwd());
  const order = fieldOrder(s, 'source');
  assert.equal(order[0], 'title');
  assert.ok(order.includes('source_url'));
});

test('verification_method includes the capture-time seed method', () => {
  const s = loadSchema(process.cwd());
  assert.ok(s.taxonomy.verification_method.includes('captured'));
});

test('taxonomy includes tool-probe method and tool-output authority basis', () => {
  const s = loadSchema(process.cwd());
  assert.ok(s.taxonomy.verification_method.includes('tool-probe'));
  assert.ok(s.taxonomy.authority_basis.includes('tool-output'));
});

// --- taxonomy_extensions ---

test('applyTaxonomyExtensions appends additively, dedupes, and keeps built-ins first', () => {
  const base = { verification_method: ['captured', 'cross-referenced'] };
  const merged = applyTaxonomyExtensions(base, { verification_method: ['experiment', 'captured'] });
  assert.deepEqual(merged.verification_method, ['captured', 'cross-referenced', 'experiment']);
  // input is not mutated
  assert.deepEqual(base.verification_method, ['captured', 'cross-referenced']);
});

test('applyTaxonomyExtensions ignores non-extensible fields and empty input', () => {
  const base = { verification_method: ['captured'], volatility: { fast: {} } };
  assert.equal(applyTaxonomyExtensions(base, {}), base);
  assert.equal(applyTaxonomyExtensions(base, undefined), base);
  // a stray non-extensible key in the extensions object is simply not merged
  const merged = applyTaxonomyExtensions(base, { volatility: ['glacial'] });
  assert.deepEqual(merged.volatility, { fast: {} });
});

test('loadSchema merges injected extensions into the taxonomy', () => {
  const s = loadSchema(process.cwd(), { extensions: { verification_method: ['experiment'], verification_result: ['partial'] } });
  assert.ok(s.taxonomy.verification_method.includes('experiment'));
  assert.ok(s.taxonomy.verification_result.includes('partial'));
  // built-ins survive
  assert.ok(s.taxonomy.verification_method.includes('cross-referenced'));
});

test('loadSchema discovers extensions from the bound vault config', () => {
  const vault = resolve('/vlt');
  const fs = {
    existsSync: (p) => p === join(vault, PROJECT_CONFIG_FILENAME),
    readFileSync: () => '{"vault":"/vlt","taxonomy_extensions":{"verification_method":["lab-run"]}}',
  };
  const s = loadSchema(process.cwd(), { vaultPath: vault, hooks: fs });
  assert.ok(s.taxonomy.verification_method.includes('lab-run'));
});

test('loadSchema without opts returns the bundled taxonomy unchanged', () => {
  const s = loadSchema(process.cwd());
  assert.ok(!s.taxonomy.verification_method.includes('experiment'));
});
