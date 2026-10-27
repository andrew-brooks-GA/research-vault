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
  const target = scaffoldProjectConfig('/repo', { vault: '/v', domain: 'learning', topics: ['cpp'], globs: ['plan/**/*.md'], schema: SCHEMA }, fs);
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
  assert.throws(() => scaffoldProjectConfig('/repo', { vault: '/v', schema: SCHEMA }, fs), /already exists/);
});

// ---- code links (spec 15 D7) ----
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');

test('scaffoldProjectConfig with codeLinks writes the code block, and only on a relative vault', () => {
  const fs = memFs();
  const target = scaffoldProjectConfig('/repo', { vault: 'research', codeLinks: ['src/**/*.lua'], schema: SCHEMA }, fs);
  const cfg = parseProjectConfig(fs.files.get(target), SCHEMA);
  assert.deepEqual(cfg.code, { globs: ['src/**/*.lua'], languages: {}, versions: {} });
  assert.deepEqual(JSON.parse(fs.files.get(target)).code, { globs: ['src/**/*.lua'], languages: {}, versions: {} });
  const bad = memFs();
  assert.throws(() => scaffoldProjectConfig('/repo', { vault: '../Research', codeLinks: ['src/**/*.lua'], schema: SCHEMA }, bad),
    /code links need a project-specific vault inside the repo \(a relative vault path\); this binding points at \.\.\/Research/);
  assert.equal(bad.files.size, 0, 'nothing written');
});

// Absent state: without codeLinks the file is byte for byte today's.
test('scaffoldProjectConfig without codeLinks writes today\'s file', () => {
  const fs = memFs();
  const target = scaffoldProjectConfig('/repo', { vault: '/v', domain: 'learning', topics: ['cpp'], globs: ['plan/**/*.md'], schema: SCHEMA }, fs);
  assert.equal(fs.files.get(target), [
    '{', '  "vault": "/v",', '  "defaults": {', '    "domain": "learning",', '    "topics": [', '      "cpp"', '    ],', '    "volatility": "fast"', '  },',
    '  "references": {', '    "globs": [', '      "plan/**/*.md"', '    ]', '  },', '  "capture": {', '    "enabled": true', '  }', '}', '',
  ].join('\n'));
});

test('CLI init --project --code-links writes the block and prints where the versions key goes; a vault outside the repo exits 1', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rv-init-code-'));
  const run = (...args) => spawnSync(process.execPath, [CLI, 'init', '--project', ...args], { cwd: repo, encoding: 'utf8' });
  let r = run('--vault', '../Research', '--code-links', 'src/**/*.lua');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^invalid \.research-vault\.json: code links need a project-specific vault inside the repo \(a relative vault path\); this binding points at \.\.\/Research$/m);
  assert.equal(existsSync(join(repo, PROJECT_CONFIG_FILENAME)), false);
  r = run('--vault', 'research', '--code-links', 'src/**/*.lua,tools/*.lua');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Bound this repo to research via .*\.research-vault\.json\.$/m);
  assert.match(r.stdout, /^Code links on for src\/\*\*\/\*\.lua, tools\/\*\.lua: in .*\.research-vault\.json, add a code\.versions key \(\{ file, pattern \}\) per dependency to pin to, and a code\.languages row \(\{ comment, decl \}\) for a language the plugin does not ship\.$/m);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, PROJECT_CONFIG_FILENAME), 'utf8')).code, { globs: ['src/**/*.lua', 'tools/*.lua'], languages: {}, versions: {} });
});
