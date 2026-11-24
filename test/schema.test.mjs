import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { loadSchema, stageAllowedInFolder, fieldOrder, applyTaxonomyExtensions } from '../bin/lib/schema.mjs';
import { PROJECT_CONFIG_FILENAME } from '../bin/lib/projectconfig.mjs';
import { assertControlledValues, fieldShapeErrors } from '../bin/lib/validate.mjs';
import { tmpVault, put } from './helpers.mjs';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { lintVault } from '../bin/lib/lintrules.mjs';
import { searchVault } from '../bin/commands/search.mjs';

test('verification scalar types remain searchable with existing enum findings', async t => {
  for (const field of ['date', 'by_type', 'by_id', 'method', 'result', 'notes']) {
    await t.test(field, () => {
      const data = { verifications: [{ date: '2026-01-01', by_type: 'human', method: 'human-spot-check', result: 'confirmed', [field]: 7 }] };
      assert.deepEqual(fieldShapeErrors(data), []);
      const vault = tmpVault();
      try {
        put(vault, 'source', '2026-01-01-scalar', { source_url: 'https://example.org', source_type: 'article', ...data });
        const codes = lintVault(vault, process.cwd()).violations.map(v => v.code);
        assert.deepEqual(codes, ({ method: ['ENUM_METHOD'], result: ['ENUM_RESULT'], by_type: ['ENUM_BY_TYPE'] })[field] || []);
        assert.equal(searchVault(vault, { text: 'scalar' })[0].id, '2026-01-01-scalar');
      } finally { rmSync(vault, { recursive: true, force: true }); }
    });
  }
});

test('collection members are validated before consumers use them', async t => {
  const rows = [
    ...['related', 'sources', 'contributing_ids', 'contributing'].map(field =>
      [{ [field]: [7] }, `${field}[0] must be a string`]),
    [{ verifications: [null] }, 'verifications[0] must be a map'],
  ];
  for (const [data, message] of rows) await t.test(message, () => {
    assert.throws(() => assertControlledValues(data, loadSchema(process.cwd())), e => e.code === 'FIELD_SHAPE' && e.message === message);
  });
});

test('non-edge members and empty containers remain searchable without shape findings', async t => {
  const rows = [
    { topics: [2024, 'k8s'] }, { domain: [7] }, { attachments: [true] },
    { subject: { name: 7, version: 26 } },
    ...['domain', 'topics', 'related', 'sources', 'contributing_ids', 'contributing', 'attachments', 'verifications', 'subject'].map(k => ({ [k]: '' })),
  ];
  for (const data of rows) await t.test(JSON.stringify(data), () => {
    assert.deepEqual(fieldShapeErrors(data), []);
    const vault = tmpVault();
    try {
      put(vault, 'source', '2026-01-01-compatible', { source_url: 'https://example.org', source_type: 'article', ...data });
      for (const [field, value] of Object.entries(data)) if (value === '') {
        const path = join(vault, 'sources', '2026-01-01-compatible.md');
        writeFileSync(path, readFileSync(path, 'utf8').replace(new RegExp(`^${field}:.*$`, 'm'), `${field}:`));
      }
      const codes = lintVault(vault, process.cwd()).violations.map(v => v.code);
      assert.deepEqual(codes, data.domain?.[0] === 7 ? ['ENUM_DOMAIN'] : []);
      assert.equal(searchVault(vault, { text: 'compatible' })[0].id, '2026-01-01-compatible');
    } finally { rmSync(vault, { recursive: true, force: true }); }
  });
});

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

test('every edge field has an intended_targets entry, and vice versa (doc-only map, spec 06)', () => {
  const ef = loadSchema(process.cwd()).fields.edge_fields;
  assert.deepEqual(Object.keys(ef.intended_targets).sort(), [...ef.backlink, ...ef.reference_only].sort());
});

test('applyTaxonomyExtensions merges vault alias pairs after the built-ins and refuses a redefinition (spec 24 D1)', () => {
  const base = { topic_aliases: { tdd: 'test-driven-development' } };
  const merged = applyTaxonomyExtensions(base, { topic_aliases: { k8s: 'kubernetes' } });
  assert.deepEqual(merged.topic_aliases, { tdd: 'test-driven-development', k8s: 'kubernetes' });
  assert.deepEqual(base.topic_aliases, { tdd: 'test-driven-development' }, 'input not mutated');
  assert.throws(() => applyTaxonomyExtensions(base, { topic_aliases: { tdd: 'anything' } }), /topic_aliases\.tdd redefines a built-in alias/);
});

test('loadSchema discovers a vault alias pair from the bound config (spec 24 D1)', () => {
  const vault = resolve('/vlt');
  const fs = {
    existsSync: (p) => p === join(vault, PROJECT_CONFIG_FILENAME),
    readFileSync: () => '{"vault":"/vlt","taxonomy_extensions":{"topic_aliases":{"k8s":"kubernetes"}}}',
  };
  const s = loadSchema(process.cwd(), { vaultPath: vault, hooks: fs });
  assert.equal(s.taxonomy.topic_aliases.k8s, 'kubernetes');
  assert.equal(s.taxonomy.topic_aliases.tdd, 'test-driven-development');
});
