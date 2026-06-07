import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PROJECT_CONFIG_FILENAME, scaffoldProjectConfig, parseProjectConfig } from '../bin/lib/projectconfig.mjs';

const SCHEMA = {
  taxonomy: {
    domain: ['software-engineering', 'learning', 'meta'],
    volatility: { stable: {}, slow: {}, fast: {}, volatile: {} },
  },
};

function memFs() {
  const files = new Map();
  return {
    files,
    existsSync: (p) => files.has(p),
    writeFileSync: (p, c) => files.set(p, c),
  };
}

test('scaffoldProjectConfig writes a parseable .research-vault.json binding the vault', () => {
  const fs = memFs();
  const target = scaffoldProjectConfig('/repo', { vault: '/v', domain: 'learning', topics: ['cpp'], globs: ['plan/**/*.md'] }, fs);
  assert.equal(target, join('/repo', PROJECT_CONFIG_FILENAME));
  const cfg = parseProjectConfig(fs.files.get(target), SCHEMA);
  assert.equal(cfg.vault, '/v');
  assert.equal(cfg.defaults.domain, 'learning');
  assert.deepEqual(cfg.defaults.topics, ['cpp']);
  assert.deepEqual(cfg.references.globs, ['plan/**/*.md']);
  assert.equal(cfg.capture.enabled, true);
});

test('scaffoldProjectConfig refuses to overwrite an existing binding', () => {
  const fs = memFs();
  fs.files.set(join('/repo', PROJECT_CONFIG_FILENAME), '{}');
  assert.throws(() => scaffoldProjectConfig('/repo', { vault: '/v' }, fs), /already exists/);
});
