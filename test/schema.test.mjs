import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { loadSchema, loadTeachSchema, stageAllowedInFolder, fieldOrder, applyTaxonomyExtensions } from '../bin/lib/schema.mjs';
import { PROJECT_CONFIG_FILENAME } from '../bin/lib/projectconfig.ts';
import { assertControlledValues, fieldShapeErrors, isAllowedValue } from '../bin/lib/validate.ts';
import { REPO_ROOT, tmpVault, put } from './helpers.mjs';
import { cpSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
        const codes = lintVault(vault, REPO_ROOT).violations.map(v => v.code);
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
    assert.throws(() => assertControlledValues(data, loadSchema(REPO_ROOT)), e => e.code === 'FIELD_SHAPE' && e.message === message);
  });
});

test('scalar edge source_id rejects a number', () => {
  assert.deepEqual(fieldShapeErrors({ source_id: 5 }), ['source_id must be a string']);
});

test('scalar edge prompt_id rejects a number', () => {
  assert.deepEqual(fieldShapeErrors({ prompt_id: 5 }), ['prompt_id must be a string']);
});

test('scalar edge superseded_by rejects a number', () => {
  assert.deepEqual(fieldShapeErrors({ superseded_by: 5 }), ['superseded_by must be a string']);
});

test('scalar edge fields accept a string', () => {
  assert.deepEqual(fieldShapeErrors({ source_id: '5', prompt_id: '5', superseded_by: '5' }), []);
});

test('scalar edge fields accept absence', () => {
  assert.deepEqual(fieldShapeErrors({}), []);
});

test('source_url rejects a list', () => {
  assert.deepEqual(fieldShapeErrors({ source_url: ['https://x.example/a'] }), ['source_url must be a string']);
});

test('source_url rejects a number', () => {
  assert.deepEqual(fieldShapeErrors({ source_url: 5 }), ['source_url must be a string']);
});

test('source_url rejects a map', () => {
  assert.deepEqual(fieldShapeErrors({ source_url: { a: 'b' } }), ['source_url must be a string']);
});

test('source_url accepts a string', () => {
  assert.deepEqual(fieldShapeErrors({ source_url: 'https://x.example/a' }), []);
});

test('source_url accepts an absent field', () => {
  assert.deepEqual(fieldShapeErrors({}), []);
});

test('source_url accepts an empty string', () => {
  assert.deepEqual(fieldShapeErrors({ source_url: '' }), []);
});

test('every scalar edge field in the schema rejects a number', () => {
  const { backlink, reference_only } = loadSchema(REPO_ROOT).fields.edge_fields;
  const listFields = ['domain', 'topics', 'related', 'sources', 'contributing_ids', 'contributing', 'attachments', 'verifications'];
  for (const field of [...backlink, ...reference_only].filter(field => !listFields.includes(field))) {
    assert.deepEqual(fieldShapeErrors({ [field]: 5 }), [`${field} must be a string`], field);
  }
});

test('scalar edge source_id rejects a boolean', () => {
  assert.deepEqual(fieldShapeErrors({ source_id: true }), ['source_id must be a string']);
});

test('scalar edge source_id rejects a list', () => {
  assert.deepEqual(fieldShapeErrors({ source_id: ['5'] }), ['source_id must be a string']);
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
      const codes = lintVault(vault, REPO_ROOT).violations.map(v => v.code);
      assert.deepEqual(codes, data.domain?.[0] === 7 ? ['ENUM_DOMAIN'] : []);
      assert.equal(searchVault(vault, { text: 'compatible' })[0].id, '2026-01-01-compatible');
    } finally { rmSync(vault, { recursive: true, force: true }); }
  });
});

test('loads taxonomy and field definitions', () => {
  const { taxonomy, fields } = loadSchema(REPO_ROOT);
  const teach = loadTeachSchema(REPO_ROOT);
  assert.equal(taxonomy.domain[0], 'software-engineering');
  assert.equal(taxonomy.volatility.fast.refresh_after_days, 90);
  assert.equal(fields.common[0], 'title');
  assert.deepEqual(teach.common, ['title', 'type', 'date']);
  assert.equal(teach.taxonomy.type_folder.attempt, 'attempts');
});

function schemaFixture(t, file, edit) {
  const root = tmpVault('rv-schema-');
  const schema = join(root, 'schema');
  cpSync(join(REPO_ROOT, 'schema'), schema, { recursive: true });
  const path = join(schema, file);
  writeFileSync(path, edit(readFileSync(path, 'utf8')));
  const snapshot = () => readdirSync(schema).sort().map(name => [name, readFileSync(join(schema, name))]);
  const beside = readdirSync(root).sort();
  const before = snapshot();
  t.after(() => {
    try {
      assert.deepEqual(readdirSync(root).sort(), beside);
      assert.deepEqual(snapshot(), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  return root;
}

function editJson(edit) {
  return raw => {
    const data = JSON.parse(raw);
    edit(data);
    return JSON.stringify(data);
  };
}

test('loadSchema refuses a string instead of the notes allowed-stage list', t => {
  const root = schemaFixture(t, 'taxonomy.json', editJson(data => { data.stage_by_folder.notes.allowed = 'distilled'; }));
  assert.throws(() => loadSchema(root), {
    name: 'Error', message: 'schema/taxonomy.json: stage_by_folder.notes.allowed must be an array of strings',
  });
});

test('loadSchema refuses a number in the common frontmatter fields', t => {
  const root = schemaFixture(t, 'frontmatter.schema.json', editJson(data => { data.common[0] = 7; }));
  assert.throws(() => loadSchema(root), {
    name: 'Error', message: 'schema/frontmatter.schema.json: common must be an array of strings',
  });
});

test('loadTeachSchema refuses an object instead of the derived-field list', t => {
  const root = schemaFixture(t, 'teach.schema.json', editJson(data => { data.derived_forbidden = { score: true }; }));
  assert.throws(() => loadTeachSchema(root), {
    name: 'Error', message: 'schema/teach.schema.json: derived_forbidden must be an array of strings',
  });
});

test('loadTeachSchema refuses a missing type_folder map', t => {
  const root = schemaFixture(t, 'teach-taxonomy.json', editJson(data => { delete data.type_folder; }));
  assert.throws(() => loadTeachSchema(root), {
    name: 'Error', message: 'schema/teach-taxonomy.json: type_folder must be an object',
  });
});

const schemaRefusals = [
  ['loadSchema refuses a number in verification_result', loadSchema, 'taxonomy.json',
    data => { data.verification_result[0] = 7; },
    'schema/taxonomy.json: verification_result must be an array of strings'],
  ['loadSchema refuses a number in artifact_purpose', loadSchema, 'taxonomy.json',
    data => { data.artifact_purpose.notes = 7; },
    'schema/taxonomy.json: artifact_purpose.notes must be a string'],
  ['loadSchema refuses a number in topic_aliases', loadSchema, 'taxonomy.json',
    data => { data.topic_aliases.tdd = 7; },
    'schema/taxonomy.json: topic_aliases.tdd must be a string'],
  ['loadSchema refuses an array instead of the volatility map', loadSchema, 'taxonomy.json',
    data => { data.volatility = []; },
    'schema/taxonomy.json: volatility must be an object'],
  ['loadSchema refuses a string instead of the fast volatility row', loadSchema, 'taxonomy.json',
    data => { data.volatility.fast = 'fast'; },
    'schema/taxonomy.json: volatility.fast must be an object'],
  ['loadSchema refuses a string for refresh_after_days', loadSchema, 'taxonomy.json',
    data => { data.volatility.fast.refresh_after_days = '90'; },
    'schema/taxonomy.json: volatility.fast.refresh_after_days must be a number'],
  ['loadSchema refuses a number for the volatility description', loadSchema, 'taxonomy.json',
    data => { data.volatility.fast.description = 7; },
    'schema/taxonomy.json: volatility.fast.description must be a string'],
  ['loadSchema refuses an array instead of stage_by_folder', loadSchema, 'taxonomy.json',
    data => { data.stage_by_folder = []; },
    'schema/taxonomy.json: stage_by_folder must be an object'],
  ['loadSchema refuses a string instead of the notes stage row', loadSchema, 'taxonomy.json',
    data => { data.stage_by_folder.notes = 'distilled'; },
    'schema/taxonomy.json: stage_by_folder.notes must be an object'],
  ['loadSchema refuses a number for the notes default stage', loadSchema, 'taxonomy.json',
    data => { data.stage_by_folder.notes.default = 7; },
    'schema/taxonomy.json: stage_by_folder.notes.default must be a string'],
  ['loadSchema refuses a missing notes stage row', loadSchema, 'taxonomy.json',
    data => { delete data.stage_by_folder.notes; },
    'schema/taxonomy.json: stage_by_folder.notes must be an object'],
  ['loadSchema refuses an array instead of by_type', loadSchema, 'frontmatter.schema.json',
    data => { data.by_type = []; },
    'schema/frontmatter.schema.json: by_type must be an object'],
  ['loadSchema refuses a number in a by_type field list', loadSchema, 'frontmatter.schema.json',
    data => { data.by_type.source[0] = 7; },
    'schema/frontmatter.schema.json: by_type.source must be an array of strings'],
  ['loadSchema refuses a number in a required_by_type field list', loadSchema, 'frontmatter.schema.json',
    data => { data.required_by_type.source[0] = 7; },
    'schema/frontmatter.schema.json: required_by_type.source must be an array of strings'],
  ['loadSchema refuses a number in verification_subfields', loadSchema, 'frontmatter.schema.json',
    data => { data.verification_subfields[0] = 7; },
    'schema/frontmatter.schema.json: verification_subfields must be an array of strings'],
  ['loadSchema refuses an array instead of edge_fields', loadSchema, 'frontmatter.schema.json',
    data => { data.edge_fields = []; },
    'schema/frontmatter.schema.json: edge_fields must be an object'],
  ['loadSchema refuses a number in edge_fields.backlink', loadSchema, 'frontmatter.schema.json',
    data => { data.edge_fields.backlink[0] = 7; },
    'schema/frontmatter.schema.json: edge_fields.backlink must be an array of strings'],
  ['loadSchema refuses a number in edge_fields.reference_only', loadSchema, 'frontmatter.schema.json',
    data => { data.edge_fields.reference_only[0] = 7; },
    'schema/frontmatter.schema.json: edge_fields.reference_only must be an array of strings'],
  ['loadSchema refuses a number in edge_fields.intended_targets', loadSchema, 'frontmatter.schema.json',
    data => { data.edge_fields.intended_targets.sources = 7; },
    'schema/frontmatter.schema.json: edge_fields.intended_targets.sources must be a string'],
  ['loadTeachSchema refuses an array instead of edge_fields', loadTeachSchema, 'teach.schema.json',
    data => { data.edge_fields = []; },
    'schema/teach.schema.json: edge_fields must be an object'],
  ['loadTeachSchema refuses a number in kind', loadTeachSchema, 'teach-taxonomy.json',
    data => { data.kind[0] = 7; },
    'schema/teach-taxonomy.json: kind must be an array of strings'],
];

for (const [name, load, file, edit, message] of schemaRefusals) {
  test(name, t => {
    const root = schemaFixture(t, file, editJson(edit));
    assert.throws(() => load(root), { name: 'Error', message });
  });
}

test('loadSchema preserves the native syntax error for incomplete JSON', t => {
  const root = schemaFixture(t, 'frontmatter.schema.json', () => '{"common":');
  assert.throws(() => loadSchema(root), { name: 'SyntaxError', message: 'Unexpected end of JSON input' });
});

test('isAllowedValue accepts a listed taxonomy value', () => {
  assert.equal(isAllowedValue(loadSchema(REPO_ROOT), 'domain', 'software-engineering'), true);
});

test('isAllowedValue rejects an unlisted taxonomy value', () => {
  assert.equal(isAllowedValue(loadSchema(REPO_ROOT), 'domain', 'not-a-domain'), false);
});

test('isAllowedValue rejects undefined as an enum value', () => {
  assert.equal(isAllowedValue(loadSchema(REPO_ROOT), 'domain', undefined), false);
});

test('isAllowedValue rejects null as an enum value', () => {
  assert.equal(isAllowedValue(loadSchema(REPO_ROOT), 'domain', null), false);
});

test('isAllowedValue rejects a one-element list holding a listed value', () => {
  assert.equal(isAllowedValue(loadSchema(REPO_ROOT), 'status', ['active']), false);
});

test('stage/folder matrix enforced', () => {
  const s = loadSchema(REPO_ROOT);
  assert.equal(stageAllowedInFolder(s, 'sources', 'raw'), true);
  assert.equal(stageAllowedInFolder(s, 'sources', 'distilled'), false);
  assert.equal(stageAllowedInFolder(s, 'synthesis', 'stable'), true);
});

test('fieldOrder returns deterministic key order for a type', () => {
  const s = loadSchema(REPO_ROOT);
  const order = fieldOrder(s, 'source');
  assert.equal(order[0], 'title');
  assert.ok(order.includes('source_url'));
});

test('verification_method includes the capture-time seed method', () => {
  const s = loadSchema(REPO_ROOT);
  assert.ok(s.taxonomy.verification_method.includes('captured'));
});

test('taxonomy includes tool-probe method and tool-output authority basis', () => {
  const s = loadSchema(REPO_ROOT);
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
  const s = loadSchema(REPO_ROOT, { extensions: { verification_method: ['experiment'], verification_result: ['partial'] } });
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
  const s = loadSchema(REPO_ROOT, { vaultPath: vault, hooks: fs });
  assert.ok(s.taxonomy.verification_method.includes('lab-run'));
});

test('loadSchema without opts returns the bundled taxonomy unchanged', () => {
  const s = loadSchema(REPO_ROOT);
  assert.ok(!s.taxonomy.verification_method.includes('experiment'));
});

test('every edge field has an intended_targets entry, and vice versa (doc-only map, spec 06)', () => {
  const ef = loadSchema(REPO_ROOT).fields.edge_fields;
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
  const s = loadSchema(REPO_ROOT, { vaultPath: vault, hooks: fs });
  assert.equal(s.taxonomy.topic_aliases.k8s, 'kubernetes');
  assert.equal(s.taxonomy.topic_aliases.tdd, 'test-driven-development');
});

// S-13: a vault alias key or an entry type that names an Object.prototype member is an ordinary name: the alias is not
// taken for a built-in one, lint applies it, and a type with no field list orders the common fields only.
test('S-13: a vault alias or an entry type named after an Object.prototype member is an ordinary name', t => {
  const run = name => {
    const dir = tmpVault('rv-s13-schema-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({ vault: '.', taxonomy_extensions: { topic_aliases: Object.fromEntries([[name, 'target']]) } }));
    put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://example.com/s', topics: [name] });
    const schema = loadSchema(REPO_ROOT, { vaultPath: dir });
    const warnings = lintVault(dir, REPO_ROOT).warnings.filter(w => w.code === 'WARN_TOPIC_ALIAS').map(w => w.msg);
    return JSON.stringify({ alias: Object.hasOwn(schema.taxonomy.topic_aliases, name) && schema.taxonomy.topic_aliases[name], order: fieldOrder(schema, name), warnings }).replaceAll(name, 'NAME');
  };
  const plain = run('plainname');
  assert.equal(plain, JSON.stringify({ alias: 'target', order: JSON.parse(readFileSync(join(REPO_ROOT, 'schema', 'frontmatter.schema.json'), 'utf8')).common, warnings: ["topic 'NAME' should be normalized to 'target'"] }));
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(run(name), plain, name);
});
