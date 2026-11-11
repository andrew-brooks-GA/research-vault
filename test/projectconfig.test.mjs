import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import {
  PROJECT_CONFIG_FILENAME,
  findProjectConfig,
  parseProjectConfig,
  loadProjectConfig,
  validateTaxonomyExtensions,
  readTaxonomyExtensions,
} from '../bin/lib/projectconfig.mjs';

const SCHEMA = {
  taxonomy: {
    domain: ['software-engineering', 'learning', 'meta'],
    volatility: { stable: {}, slow: {}, fast: {}, volatile: {} },
  },
};

// Build an injectable fs where .research-vault.json exists in exactly the given dirs.
// Keys go through the same join() the code uses, so the harness is separator-agnostic.
function fakeFs(configDirs, contents = {}) {
  const files = new Map();
  for (const d of configDirs) files.set(join(d, PROJECT_CONFIG_FILENAME), contents[d] ?? '{}');
  return {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => files.get(p),
  };
}

test('findProjectConfig walks up and returns the nearest config', () => {
  const fs = fakeFs(['/a'], { '/a': '{"vault":"/v"}' });
  const hit = findProjectConfig('/a/b/c', fs);
  assert.equal(hit.path, join('/a', PROJECT_CONFIG_FILENAME));
  assert.equal(hit.raw, '{"vault":"/v"}');
});

test('findProjectConfig prefers the closest config when several exist', () => {
  const fs = fakeFs(['/a', '/a/b'], { '/a': '{"vault":"/far"}', '/a/b': '{"vault":"/near"}' });
  const hit = findProjectConfig('/a/b/c', fs);
  assert.equal(hit.raw, '{"vault":"/near"}');
});

test('findProjectConfig returns null when no config up to root', () => {
  const fs = fakeFs([]);
  assert.equal(findProjectConfig('/a/b/c', fs), null);
});

test('parseProjectConfig accepts a valid config and normalizes', () => {
  const cfg = parseProjectConfig(
    '{"vault":"/v","defaults":{"domain":"learning","topics":["cpp","cmake"],"volatility":"fast"},"references":{"globs":["plan/**/*.md"]},"capture":{"enabled":true}}',
    SCHEMA,
  );
  assert.equal(cfg.vault, '/v');
  assert.equal(cfg.defaults.domain, 'learning');
  assert.deepEqual(cfg.defaults.topics, ['cpp', 'cmake']);
  assert.equal(cfg.defaults.volatility, 'fast');
  assert.deepEqual(cfg.references.globs, ['plan/**/*.md']);
  assert.equal(cfg.capture.enabled, true);
});

test('parseProjectConfig rejects an unknown default domain', () => {
  assert.throws(
    () => parseProjectConfig('{"defaults":{"domain":"not-a-domain"}}', SCHEMA),
    /unknown.*domain/i,
  );
});

test('parseProjectConfig rejects an unknown default volatility', () => {
  assert.throws(
    () => parseProjectConfig('{"defaults":{"volatility":"glacial"}}', SCHEMA),
    /unknown.*volatility/i,
  );
});

test('parseProjectConfig rejects malformed JSON with a clear message', () => {
  assert.throws(() => parseProjectConfig('{not json', SCHEMA), /\.research-vault\.json/);
});

test('parseProjectConfig rejects non-string vault and non-array globs', () => {
  assert.throws(() => parseProjectConfig('{"vault":123}', SCHEMA), /vault/);
  assert.throws(() => parseProjectConfig('{"references":{"globs":"plan/**"}}', SCHEMA), /globs/);
});

test('loadProjectConfig finds, parses, and validates in one call', () => {
  const fs = fakeFs(['/repo'], { '/repo': '{"vault":"/v","defaults":{"domain":"learning"}}' });
  const { path, config } = loadProjectConfig('/repo/plan', { schema: SCHEMA, ...fs });
  assert.equal(path, join('/repo', PROJECT_CONFIG_FILENAME));
  assert.equal(config.vault, '/v');
  assert.equal(config.defaults.domain, 'learning');
});

test('loadProjectConfig returns null when no config is found', () => {
  assert.equal(loadProjectConfig('/repo/plan', { schema: SCHEMA, ...fakeFs([]) }), null);
});

// --- taxonomy_extensions ---

test('parseProjectConfig accepts additive taxonomy_extensions', () => {
  const cfg = parseProjectConfig(
    '{"vault":"/v","taxonomy_extensions":{"verification_method":["experiment","lab-run"],"verification_result":["partial"]}}',
    SCHEMA,
  );
  assert.deepEqual(cfg.taxonomyExtensions.verification_method, ['experiment', 'lab-run']);
  assert.deepEqual(cfg.taxonomyExtensions.verification_result, ['partial']);
});

test('parseProjectConfig defaults taxonomyExtensions to an empty object', () => {
  const cfg = parseProjectConfig('{"vault":"/v"}', SCHEMA);
  assert.deepEqual(cfg.taxonomyExtensions, {});
});

test('validateTaxonomyExtensions rejects a non-extensible field', () => {
  assert.throws(() => validateTaxonomyExtensions({ volatility: ['glacial'] }), /not extensible/);
  assert.throws(() => validateTaxonomyExtensions({ topics: ['x'] }), /not extensible/);
});

test('validateTaxonomyExtensions rejects non-array and non-string values', () => {
  assert.throws(() => validateTaxonomyExtensions({ verification_method: 'experiment' }), /must be an array/);
  assert.throws(() => validateTaxonomyExtensions({ verification_method: [''] }), /non-empty strings/);
  assert.throws(() => validateTaxonomyExtensions({ verification_method: [1] }), /non-empty strings/);
  assert.throws(() => validateTaxonomyExtensions(['verification_method']), /must be an object/);
});

test('validateTaxonomyExtensions returns {} for undefined', () => {
  assert.deepEqual(validateTaxonomyExtensions(undefined), {});
});

test('readTaxonomyExtensions returns the merged-ready map for the nearest config', () => {
  const dir = resolve('/repo');
  const fs = fakeFs([dir], { [dir]: '{"vault":"/v","taxonomy_extensions":{"verification_method":["experiment"]}}' });
  const ext = readTaxonomyExtensions(resolve('/repo/research'), fs);
  assert.deepEqual(ext.verification_method, ['experiment']);
});

test('readTaxonomyExtensions returns {} when there is no config', () => {
  assert.deepEqual(readTaxonomyExtensions(resolve('/repo'), fakeFs([])), {});
});

test('parseProjectConfig keeps gates.globs', () => {
  const cfg = parseProjectConfig('{"vault":"/v","gates":{"globs":["docs/drafts/*.md"]}}', SCHEMA);
  assert.deepEqual(cfg.gates.globs, ['docs/drafts/*.md']);
  assert.throws(() => parseProjectConfig('{"gates":{"globs":"x"}}', SCHEMA), /gates\.globs must be an array/);
});

test('validateTaxonomyExtensions accepts a topic_aliases map and rejects a malformed one (spec 24 D1)', () => {
  assert.deepEqual(validateTaxonomyExtensions({ topic_aliases: { k8s: 'kubernetes' } }), { topic_aliases: { k8s: 'kubernetes' } });
  for (const bad of [['k8s'], { k8s: 1 }, { k8s: '' }, { '': 'kubernetes' }, null])
    assert.throws(() => validateTaxonomyExtensions({ topic_aliases: bad }), /topic_aliases must be an object of non-empty strings/);
});

test('parseProjectConfig accepts usage.text as a boolean and rejects anything else (spec 29 D1)', async () => {
  const { loadSchema } = await import('../bin/lib/schema.mjs');
  const schema = loadSchema(process.cwd());
  assert.deepEqual(parseProjectConfig('{"vault":"v","usage":{"text":true}}', schema).usage, { text: true });
  assert.deepEqual(parseProjectConfig('{"vault":"v"}', schema).usage, {});
  assert.throws(() => parseProjectConfig('{"vault":"v","usage":{"text":"yes"}}', schema), /usage\.text must be a boolean/);
});

test('parseProjectConfig validates the embedding block: an http(s) url, an optional model, integer chunk and overlap (spec 34 D1)', async () => {
  const { loadSchema } = await import('../bin/lib/schema.mjs');
  const schema = loadSchema(process.cwd());
  const ok = parseProjectConfig('{"vault":"v","embedding":{"url":"http://127.0.0.1:11434/v1/embeddings","model":"nomic-embed-text"}}', schema).embedding;
  assert.deepEqual(ok, { url: 'http://127.0.0.1:11434/v1/embeddings', model: 'nomic-embed-text', chunk: 800, overlap: 100 });
  assert.equal(parseProjectConfig('{"vault":"v"}', schema).embedding, undefined);
  for (const block of ['{"url":"ftp://x"}', '{"url":42}', '{"url":"http://h/e","chunk":0}', '{"url":"http://h/e","chunk":800,"overlap":800}', '{"url":"http://h/e","model":1}'])
    assert.throws(() => parseProjectConfig(`{"vault":"v","embedding":${block}}`, schema), /embedding\./, block);
});

// Issue 60: the optional `lab` block { docs, uses, bypass }; each a non-empty array of non-empty strings,
// `docs` relative to the binding file with no `..` segment.
const LAB = { docs: ['docs/lab.md'], uses: ['lab/lib.sh'], bypass: ['kind create cluster'] };
const parseLab = (lab) => parseProjectConfig(JSON.stringify({ vault: 'v', lab }), SCHEMA);

test('a binding with a valid lab block parses it, and one without has no lab key', () => {
  assert.deepEqual(parseLab(LAB).lab, LAB);
  assert.ok(!('lab' in parseProjectConfig('{"vault":"v"}', SCHEMA)));
});

const malformedLab = [
  ['lab is not an object', [], /lab must be an object/],
  ...['docs', 'uses', 'bypass'].flatMap((f) => [
    [`lab.${f} is missing`, { ...LAB, [f]: undefined }, new RegExp(`lab\\.${f} must be a non-empty array of non-empty strings`)],
    [`lab.${f} is not an array`, { ...LAB, [f]: 'x' }, new RegExp(`lab\\.${f} must be a non-empty array`)],
    [`lab.${f} is empty`, { ...LAB, [f]: [] }, new RegExp(`lab\\.${f} must be a non-empty array`)],
    [`lab.${f} holds an empty string`, { ...LAB, [f]: ['x', ''] }, new RegExp(`lab\\.${f} must be a non-empty array`)],
    [`lab.${f} holds a non-string`, { ...LAB, [f]: [1] }, new RegExp(`lab\\.${f} must be a non-empty array`)],
  ]),
  ['lab.docs holds an absolute path', { ...LAB, docs: ['/etc/lab.md'] }, /lab\.docs entries must be relative paths with no \.\. segment/],
  ['lab.docs holds a .. segment', { ...LAB, docs: ['docs/../../lab.md'] }, /lab\.docs entries must be relative paths with no \.\. segment/],
];
for (const [name, lab, re] of malformedLab) {
  test(`parseProjectConfig rejects a malformed lab block: ${name}`, () => {
    assert.throws(() => parseLab(lab), (e) => e.message.startsWith('invalid .research-vault.json: ') && re.test(e.message), name);
  });
}
