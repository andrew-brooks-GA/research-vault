import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  PROJECT_CONFIG_FILENAME,
  findProjectConfig,
  parseProjectConfig,
  loadProjectConfig,
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
