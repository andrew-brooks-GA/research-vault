import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { REPO_ROOT, testEnv, tmpVault } from './helpers.mjs';
import {
  PROJECT_CONFIG_FILENAME,
  findProjectConfig,
  parseProjectConfig,
  loadProjectConfig,
  scaffoldProjectConfig,
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

test('parseProjectConfig preserves the returned object for a binding with every section', () => {
  const cfg = parseProjectConfig(JSON.stringify({
    vault: 'research',
    defaults: { domain: 'learning', volatility: 'fast', topics: ['cpp'] },
    references: { globs: ['plan/**/*.md'] },
    gates: { globs: ['drafts/*.md'] },
    capture: { enabled: false },
    usage: { text: true },
    taxonomy_extensions: { domain: ['local-domain'], topic_aliases: { k8s: 'kubernetes' } },
    embedding: { url: 'http://localhost/embed' },
    code: {
      globs: ['src/*.py'],
      languages: { '.py': { comment: '^#(.*)$', decl: '^def (\\w+)' } },
      versions: { dep: { file: 'deps.txt', pattern: '^dep (\\S+)' } },
    },
    lab: { docs: ['docs/lab.md'], uses: ['lab/lib.sh'], bypass: ['kind create cluster'] },
  }), SCHEMA);
  assert.deepEqual(cfg, {
    vault: 'research',
    defaults: { domain: 'learning', volatility: 'fast', topics: ['cpp'] },
    references: { globs: ['plan/**/*.md'] },
    gates: { globs: ['drafts/*.md'] },
    capture: { enabled: false },
    usage: { text: true },
    taxonomyExtensions: { domain: ['local-domain'], topic_aliases: { k8s: 'kubernetes' } },
    embedding: { url: 'http://localhost/embed', model: undefined, chunk: 800, overlap: 100 },
    code: {
      globs: ['src/*.py'],
      languages: { '.py': { comment: /^#(.*)$/, decl: /^def (\w+)/ } },
      versions: { dep: { file: 'deps.txt', pattern: /^dep (\S+)/m } },
    },
    lab: { docs: ['docs/lab.md'], uses: ['lab/lib.sh'], bypass: ['kind create cluster'] },
  });
});

test('parseProjectConfig treats null optional sections as absent', () => {
  assert.deepEqual(parseProjectConfig('{"defaults":null,"references":null,"gates":null,"capture":null,"usage":null}', SCHEMA), {
    vault: undefined, defaults: {}, references: {}, gates: {}, capture: {}, usage: {}, taxonomyExtensions: {},
  });
});

for (const [name, raw, message] of [
  ['a null binding', 'null', 'invalid .research-vault.json: must be a JSON object'],
  ['an array binding', '[]', 'invalid .research-vault.json: must be a JSON object'],
  ['a number binding', '7', 'invalid .research-vault.json: must be a JSON object'],
  ['a string binding', '"x"', 'invalid .research-vault.json: must be a JSON object'],
  ['number defaults', '{"defaults":7}', 'invalid .research-vault.json: defaults must be an object'],
  ['array references', '{"references":[]}', 'invalid .research-vault.json: references must be an object'],
  ['string gates', '{"gates":"x"}', 'invalid .research-vault.json: gates must be an object'],
  ['boolean capture', '{"capture":false}', 'invalid .research-vault.json: capture must be an object'],
  ['number usage', '{"usage":7}', 'invalid .research-vault.json: usage must be an object'],
  ['a number in references.globs', '{"references":{"globs":[7]}}', 'invalid .research-vault.json: references.globs must be an array of strings'],
  ['an object in gates.globs', '{"gates":{"globs":[{}]}}', 'invalid .research-vault.json: gates.globs must be an array of strings'],
  ['an object in defaults.topics', '{"defaults":{"topics":[{"toString":null}]}}', 'invalid .research-vault.json: defaults.topics must be an array of strings'],
  ['an object instead of defaults.domain', '{"defaults":{"domain":{"toString":null}}}', 'invalid .research-vault.json: defaults.domain must be a string'],
  ['an object instead of defaults.volatility', '{"defaults":{"volatility":{"toString":null}}}', 'invalid .research-vault.json: defaults.volatility must be a string'],
]) {
  test(`parseProjectConfig refuses ${name}`, () => {
    assert.throws(() => parseProjectConfig(raw, SCHEMA), { name: 'Error', message });
  });
}

test('check prints the null binding refusal and leaves the directory intact', { timeout: 10000 }, (t) => {
  const cwd = tmpVault('rv-invalid-binding-');
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const binding = join(cwd, PROJECT_CONFIG_FILENAME);
  writeFileSync(binding, 'null');
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'research-vault.mjs'), 'check'], {
    cwd, env: testEnv(), encoding: 'utf8', timeout: 5000,
  });
  assert.deepEqual(readdirSync(cwd), [PROJECT_CONFIG_FILENAME]);
  assert.equal(readFileSync(binding, 'utf8'), 'null');
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, 'error: invalid .research-vault.json: must be a JSON object\n');
});

test('parseProjectConfig rejects an unknown default domain', () => {
  assert.throws(
    () => parseProjectConfig('{"defaults":{"domain":"not-a-domain"}}', SCHEMA),
    { name: 'Error', message: 'invalid .research-vault.json: unknown defaults.domain: not-a-domain (allowed: software-engineering, learning, meta)' },
  );
});

test('parseProjectConfig rejects an unknown default volatility', () => {
  assert.throws(
    () => parseProjectConfig('{"defaults":{"volatility":"glacial"}}', SCHEMA),
    { name: 'Error', message: 'invalid .research-vault.json: unknown defaults.volatility: glacial (allowed: stable, slow, fast, volatile)' },
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

function loadWithVersionFile(file) {
  const root = resolve('/repo');
  const raw = JSON.stringify({ vault: 'v', code: { versions: { dep: { file, pattern: '^dep (\\S+)' } } } });
  return loadProjectConfig(root, { schema: SCHEMA, ...fakeFs([root], { [root]: raw }) });
}

const refusedVersionFiles = [
  ['a parent path', '../outside.txt'],
  ['an absolute path', resolve('outside.txt')],
  ['an empty path', ''],
  ['a path with a middle .. segment', 'a/../../b'],
  ['a drive-relative parent path', 'C:..\\outside.txt'],
  ['a drive-relative file path', 'C:name.txt'],
  ['a drive-qualified absolute path', 'c:/name.txt'],
];
const otherAbsolute = process.platform === 'win32' ? '/outside.txt' : 'C:\\outside.txt';
if (isAbsolute(otherAbsolute)) refusedVersionFiles.push(['an alternate absolute path', otherAbsolute]);

for (const [name, file] of refusedVersionFiles) {
  test(`loadProjectConfig refuses ${name} in code.versions`, () => {
    assert.throws(() => loadWithVersionFile(file), {
      message: `invalid ${PROJECT_CONFIG_FILENAME}: code.versions.dep.file must be a relative path inside the repository with no .. segment`,
    });
  });
}

test('loadProjectConfig accepts a relative path in code.versions', () => {
  assert.equal(loadWithVersionFile('config/deps.txt').config.code.versions.dep.file, 'config/deps.txt');
});

test('a __proto__ row in code.languages or code.versions is refused; constructor and toString rows are kept as own keys', () => {
  const lang = '{ "comment": "^#(.*)$", "decl": "^def (\\\\w+)" }';
  const ver = '{ "file": "deps.txt", "pattern": "^dep (\\\\S+)" }';
  const parse = (code) => parseProjectConfig(`{ "vault": "v", "code": ${code} }`, SCHEMA);
  assert.throws(() => parse(`{ "versions": { "__proto__": ${ver} } }`),
    { message: `invalid ${PROJECT_CONFIG_FILENAME}: code.versions cannot have the key "__proto__"` });
  assert.throws(() => parse(`{ "languages": { "__proto__": ${lang} } }`),
    { message: `invalid ${PROJECT_CONFIG_FILENAME}: code.languages cannot have the key "__proto__"` });
  const { code } = parse(`{ "languages": { "constructor": ${lang}, "toString": ${lang} }, "versions": { "constructor": ${ver}, "toString": ${ver} } }`);
  for (const t of [code.languages, code.versions]) {
    assert.deepEqual(Object.keys(t), ['constructor', 'toString']);
    assert.equal(Object.getPrototypeOf(t), Object.prototype);
  }
  assert.equal(code.versions.toString.file, 'deps.txt');
  assert.ok(code.languages.constructor.decl instanceof RegExp);
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

test('readTaxonomyExtensions refuses a null binding', () => {
  const dir = resolve('/repo');
  const fs = fakeFs([dir], { [dir]: 'null' });
  assert.throws(() => readTaxonomyExtensions(dir, fs), {
    name: 'Error', message: 'invalid .research-vault.json: must be a JSON object',
  });
});

test('parseProjectConfig keeps gates.globs', () => {
  const cfg = parseProjectConfig('{"vault":"/v","gates":{"globs":["docs/drafts/*.md"]}}', SCHEMA);
  assert.deepEqual(cfg.gates.globs, ['docs/drafts/*.md']);
  assert.throws(() => parseProjectConfig('{"gates":{"globs":"x"}}', SCHEMA), /gates\.globs must be an array of strings/);
});

test('validateTaxonomyExtensions accepts a topic_aliases map and rejects a malformed one (spec 24 D1)', () => {
  assert.deepEqual(validateTaxonomyExtensions({ topic_aliases: { k8s: 'kubernetes' } }), { topic_aliases: { k8s: 'kubernetes' } });
  for (const bad of [['k8s'], { k8s: 1 }, { k8s: '' }, { '': 'kubernetes' }, null])
    assert.throws(() => validateTaxonomyExtensions({ topic_aliases: bad }), /topic_aliases must be an object of non-empty strings/);
});

test('parseProjectConfig accepts usage.text as a boolean and rejects anything else (spec 29 D1)', async () => {
  const { loadSchema } = await import('../bin/lib/schema.mjs');
  const schema = loadSchema(REPO_ROOT);
  assert.deepEqual(parseProjectConfig('{"vault":"v","usage":{"text":true}}', schema).usage, { text: true });
  assert.deepEqual(parseProjectConfig('{"vault":"v"}', schema).usage, {});
  assert.throws(() => parseProjectConfig('{"vault":"v","usage":{"text":"yes"}}', schema), /usage\.text must be a boolean/);
});

test('parseProjectConfig validates the embedding block: an http(s) url, an optional model, integer chunk and overlap (spec 34 D1)', async () => {
  const { loadSchema } = await import('../bin/lib/schema.mjs');
  const schema = loadSchema(REPO_ROOT);
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

for (const [name, raw, message] of [
  ['refuses an array as the code languages table', '{"vault":"v","code":{"languages":[]}}',
    'invalid .research-vault.json: code.languages must be an object'],
  ['reports a missing comment pattern for a language array row', '{"vault":"v","code":{"languages":{".js":[]}}}',
    'invalid .research-vault.json: code.languages[".js"].comment must be a string'],
  ['reports a missing declaration pattern after a valid comment pattern', '{"vault":"v","code":{"languages":{".js":{"comment":"(x)"}}}}',
    'invalid .research-vault.json: code.languages[".js"].decl must be a string'],
  ['reports a missing version pattern after a valid version file', '{"vault":"v","code":{"versions":{"dep":{"file":"deps.txt"}}}}',
    'invalid .research-vault.json: code.versions.dep.pattern must be a string'],
  ['refuses an array as the embedding block', '{"embedding":[]}',
    'invalid .research-vault.json: embedding must be an object'],
  ['reports the embedding field for a malformed URL', '{"embedding":{"url":"/embed"}}',
    'invalid .research-vault.json: embedding.url must be an http or https URL'],
  ['refuses a null embedding chunk in place of the default', '{"embedding":{"url":"https://localhost/embed","chunk":null}}',
    'invalid .research-vault.json: embedding.chunk must be an integer'],
  ['refuses a fractional embedding overlap', '{"embedding":{"url":"https://localhost/embed","overlap":0.5}}',
    'invalid .research-vault.json: embedding.overlap must be an integer'],
]) {
  test(`parseProjectConfig ${name}`, () => {
    let config;
    assert.throws(() => { config = parseProjectConfig(raw, SCHEMA); }, { name: 'Error', message });
    assert.equal(config, undefined);
  });
}

test('parseProjectConfig keeps different configured embedding sizes', () => {
  const { embedding } = parseProjectConfig('{"embedding":{"url":"https://localhost/embed","chunk":512,"overlap":64}}', SCHEMA);
  assert.deepEqual([embedding.chunk, embedding.overlap], [512, 64]);
});

test('scaffoldProjectConfig preserves a binding created after the existence check', (t) => {
  const dir = tmpVault('rv-binding-race-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binding = join(dir, '.research-vault.json');
  assert.throws(() => scaffoldProjectConfig(dir, { schema: SCHEMA }, {
    writeFileSync(path, content, options) {
      writeFileSync(binding, 'concurrent binding\n', { flag: 'wx' });
      writeFileSync(path, content, options);
    },
  }), { message: `.research-vault.json already exists at ${binding}` });
  assert.deepEqual(readdirSync(dir), ['.research-vault.json']);
  assert.equal(readFileSync(binding, 'utf8'), 'concurrent binding\n');
});

test('scaffoldProjectConfig propagates ENOENT when the binding directory is missing', (t) => {
  const dir = tmpVault('rv-missing-binding-dir-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => scaffoldProjectConfig(join(dir, 'missing'), { schema: SCHEMA }), { code: 'ENOENT' });
  assert.deepEqual(readdirSync(dir), []);
});
