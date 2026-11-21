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
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultVaultPath } from '../bin/lib/resolve.mjs';
import { testEnv } from './helpers.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');

test('init --project writes a relative vault that resolves from a nested working directory', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'rv-init-project-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const nested = join(repo, 'docs');
  mkdirSync(nested);
  mkdirSync(join(repo, 'research'));
  const init = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', 'research'], {
    cwd: repo, env: testEnv(), encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(init.stderr, '');
  assert.equal(JSON.parse(readFileSync(join(repo, PROJECT_CONFIG_FILENAME), 'utf8')).vault, 'research');
  const paths = spawnSync(process.execPath, [CLI, 'host', 'paths'], { cwd: nested, env: testEnv(), encoding: 'utf8' });
  assert.equal(paths.status, 0, paths.stderr);
  assert.equal(JSON.parse(paths.stdout).vault, join(repo, 'research'));
});

test('first-run project init binds the default vault and plain init creates it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-init-project-default-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  const overrides = {
    HOME: home, USERPROFILE: home, LOCALAPPDATA: home, APPDATA: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home,
  };
  const run = (...args) => spawnSync(process.execPath, [CLI, 'init', ...args], {
    cwd: repo, env: testEnv(overrides), encoding: 'utf8',
  });
  const vault = defaultVaultPath({ platform: process.platform, home, env: testEnv(overrides) });
  const binding = join(repo, PROJECT_CONFIG_FILENAME);
  const project = run('--project');
  assert.equal(project.status, 0, project.stderr);
  assert.equal(project.stderr, '');
  assert.equal(project.stdout, `Bound this repo to ${vault} via ${binding}.\n`);
  assert.equal(JSON.parse(readFileSync(binding, 'utf8')).vault, vault);
  assert.equal(existsSync(vault), false);
  const init = run();
  assert.equal(init.status, 0, init.stderr);
  assert.equal(init.stderr, '');
  assert.ok(init.stdout.startsWith(`Initialized vault at ${vault} (resolved via project); set as default.\n`));
  assert.ok(existsSync(join(vault, 'AGENTS.md')));
});

test('project init warns about an outside vault that search requires an override to use', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-init-project-outside-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const vault = join(root, 'outside');
  mkdirSync(repo);
  mkdirSync(vault);
  const overrides = { HOME: root, USERPROFILE: root, APPDATA: root, XDG_CONFIG_HOME: root };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: repo, env: testEnv(overrides), encoding: 'utf8',
  });
  const binding = join(repo, PROJECT_CONFIG_FILENAME);
  const project = run('init', '--project', '--vault', vault);
  assert.equal(project.status, 0, project.stderr);
  assert.equal(project.stdout, `Bound this repo to ${vault} via ${binding}.\n`);
  assert.equal(project.stderr,
    'Warning: this binding names a vault outside the repository. It will be used only when RESEARCH_VAULT_PATH points at it or --vault is passed.\n');
  assert.equal(JSON.parse(readFileSync(binding, 'utf8')).vault, vault);

  const refused = run('search');
  assert.equal(refused.status, 2, refused.stderr);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^error: The binding at /);
  const init = run('init', '--vault', vault);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(init.stderr, '');
  assert.ok(existsSync(join(vault, 'AGENTS.md')));
  const search = run('search', '--vault', vault);
  assert.equal(search.status, 0, search.stderr);
  assert.equal(search.stderr, '');
  assert.equal(search.stdout, '');
});

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
  const run = (...args) => spawnSync(process.execPath, [CLI, 'init', '--project', ...args], { env: testEnv(), cwd: repo, encoding: 'utf8' });
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
