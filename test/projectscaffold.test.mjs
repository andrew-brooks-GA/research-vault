import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { PROJECT_CONFIG_FILENAME, scaffoldProjectConfig, parseProjectConfig } from '../bin/lib/projectconfig.ts';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, realpathSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultVaultPath, configPath } from '../bin/lib/resolve.mjs';
import { testEnv } from './helpers.mjs';
import { isBindingAcknowledged } from '../bin/lib/trust.ts';

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
    lstatSync: (p) => files.has(p) ? {} : undefined,
    writeFileSync: (p, c, opts) => {
      assert.equal(opts.flag, 'wx');
      files.set(p, c);
    },
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

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');

test('init --project writes a relative vault that resolves from a nested working directory', (t) => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-project-')));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const nested = join(repo, 'docs');
  mkdirSync(nested);
  mkdirSync(join(repo, 'research'));
  const init = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', 'research'], {
    cwd: repo, env: testEnv(), encoding: 'utf8', timeout: 20000,
  });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(init.stderr, '');
  assert.equal(JSON.parse(readFileSync(join(repo, PROJECT_CONFIG_FILENAME), 'utf8')).vault, 'research');
  const paths = spawnSync(process.execPath, [CLI, 'host', 'paths'], { cwd: nested, env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(paths.status, 0, paths.stderr);
  assert.equal(JSON.parse(paths.stdout).vault, join(repo, 'research'));
});

test('first-run project init binds the default vault and plain init creates it', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-project-default-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  const overrides = {
    HOME: home, USERPROFILE: home, LOCALAPPDATA: home, APPDATA: home, XDG_DATA_HOME: join(home, 'data'), XDG_CONFIG_HOME: home,
  };
  const run = (...args) => spawnSync(process.execPath, [CLI, 'init', ...args], {
    cwd: repo, env: testEnv(overrides), encoding: 'utf8', timeout: 20000,
  });
  const vault = defaultVaultPath({ platform: process.platform, home, env: testEnv(overrides) });
  const binding = join(repo, PROJECT_CONFIG_FILENAME);
  const project = run('--project');
  assert.equal(project.status, 0, project.stderr);
  assert.equal(project.stderr, '');
  assert.equal(project.stdout, `Bound this repo to ${vault} via ${binding}.\n`);
  assert.equal(JSON.parse(readFileSync(binding, 'utf8')).vault, vault);
  if (vault === dirname(configPath({ platform: process.platform, home, env: testEnv(overrides) }))) {
    assert.deepEqual(readdirSync(vault), ['trusted-bindings.json']);
  } else {
    assert.equal(existsSync(vault), false);
  }
  const init = run();
  assert.equal(init.status, 0, init.stderr);
  assert.equal(init.stderr, '');
  assert.ok(init.stdout.startsWith(`Initialized vault at ${vault} (resolved via project); set as default.\n`));
  assert.ok(existsSync(join(vault, 'AGENTS.md')));
});

test('project init acknowledges an outside vault for immediate use without a variable', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-project-outside-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const vault = join(root, 'outside');
  mkdirSync(repo);
  mkdirSync(vault);
  const overrides = { HOME: root, USERPROFILE: root, APPDATA: root, XDG_CONFIG_HOME: root };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: repo, env: testEnv(overrides), encoding: 'utf8', timeout: 20000,
  });
  const binding = join(repo, PROJECT_CONFIG_FILENAME);
  const project = run('init', '--project', '--vault', vault);
  assert.equal(project.status, 0, project.stderr);
  assert.equal(project.stdout, `Bound this repo to ${vault} via ${binding}.\n`);
  assert.equal(project.stderr, '');
  assert.equal(JSON.parse(readFileSync(binding, 'utf8')).vault, vault);

  const paths = run('host', 'paths');
  assert.equal(paths.status, 0, paths.stderr);
  assert.equal(JSON.parse(paths.stdout).vault, vault);
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
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-code-')));
  const run = (...args) => spawnSync(process.execPath, [CLI, 'init', '--project', ...args], { env: testEnv(), cwd: repo, encoding: 'utf8', timeout: 20000 });
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

test('init --project acknowledges the binding it creates', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-trust-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo');
  mkdirSync(home); mkdirSync(repo);
  const env = testEnv({ HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: home });
  const folder = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'research-vault') : join(home, 'research-vault');
  mkdirSync(dirname(folder), { recursive: true });
  const r = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', 'research'], { cwd: repo, env: testEnv(env), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const binding = join(repo, '.research-vault.json');
  assert.equal(JSON.parse(readFileSync(binding)).vault, 'research');
  assert.equal(r.stderr, '');
  const rows = JSON.parse(readFileSync(join(folder, 'trusted-bindings.json'))).bindings;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, binding);
  assert.equal(rows[0].sha256, createHash('sha256').update(readFileSync(binding)).digest('hex'));
  assert.equal(isBindingAcknowledged(binding, { platform: process.platform, home, env }), true);
});

test('init --project records a wall-clock acknowledgement timestamp', t => {
  const root = mkdtempSync(join(tmpdir(), 'rv-init-trust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  const overrides = { HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: home };
  const folder = dirname(configPath({ platform: process.platform, home, env: testEnv(overrides) }));
  const before = Date.now();
  const r = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', 'research'], { cwd: repo, env: testEnv(overrides), encoding: 'utf8', timeout: 20000 });
  const after = Date.now();
  assert.equal(r.status, 0, r.stderr);
  const time = Date.parse(JSON.parse(readFileSync(join(folder, 'trusted-bindings.json'))).bindings[0].date);
  assert.ok(before <= time && time <= after);
});

test('init --project omits the outside warning for an inside vault when acknowledgement storage is linked outside', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-trust-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo'), outside = join(root, 'outside');
  mkdirSync(home); mkdirSync(repo); mkdirSync(outside);
  const vault = join(repo, 'research'); mkdirSync(vault);
  const env = testEnv({ HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: home });
  const folder = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'research-vault') : join(home, 'research-vault');
  mkdirSync(dirname(folder), { recursive: true });
  const outsideFile = join(outside, 'trusted-bindings.json'); writeFileSync(outsideFile, 'unchanged');
  try { symlinkSync(outside, folder, 'dir'); } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) { t.skip(`links unavailable: ${e.code}`); return; } throw e;
  }
  const r = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', 'research'], { cwd: repo, env: testEnv(env), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(join(repo, '.research-vault.json'))).vault, 'research');
  assert.equal(r.stderr, 'Could not record the acknowledgement; run research-vault trust to record it.\n');
  assert.deepEqual(readdirSync(vault), []);
  assert.equal(readFileSync(outsideFile, 'utf8'), 'unchanged');
  assert.deepEqual(readdirSync(outside), ['trusted-bindings.json']);
});

test('init --project keeps its binding when acknowledgement storage is linked outside', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-trust-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo'), outside = join(root, 'outside');
  mkdirSync(home); mkdirSync(repo); mkdirSync(outside);
  const vault = join(root, 'vault'); mkdirSync(vault);
  const env = testEnv({ HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: home });
  const folder = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'research-vault') : join(home, 'research-vault');
  mkdirSync(dirname(folder), { recursive: true });
  const outsideFile = join(outside, 'trusted-bindings.json'); writeFileSync(outsideFile, 'unchanged');
  try { symlinkSync(outside, folder, 'dir'); } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) { t.skip(`links unavailable: ${e.code}`); return; } throw e;
  }
  const r = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', vault], { cwd: repo, env: testEnv(env), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const binding = join(repo, '.research-vault.json');
  assert.equal(JSON.parse(readFileSync(binding)).vault, vault);
  assert.equal(r.stderr, 'Could not record the acknowledgement; run research-vault trust to record it.\nWarning: this binding names a vault outside the repository. It will be used only when RESEARCH_VAULT_PATH points at it or --vault is passed.\n');
  const refused = spawnSync(process.execPath, [CLI, 'search'], { cwd: repo, env: testEnv(env), encoding: 'utf8', timeout: 20000 });
  assert.equal(refused.status, 2, refused.stderr);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /The binding at/);
  assert.deepEqual(readdirSync(vault), []);
  assert.equal(readFileSync(outsideFile, 'utf8'), 'unchanged');
  assert.deepEqual(readdirSync(outside), ['trusted-bindings.json']);
});

test('CLI init --project refuses a quoted --code-links glob before writing anything', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-quoted-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo');
  mkdirSync(home); mkdirSync(repo);
  const env = { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home };
  const r = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', 'research', '--code-links', "'src/*.js'"], { cwd: repo, env: testEnv(env), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.stderr, "init: 'src/*.js' looks quoted; remove the quotes\n");
  assert.equal(r.status, 2);
  assert.equal(existsSync(join(repo, PROJECT_CONFIG_FILENAME)), false);
  assert.deepEqual(readdirSync(repo), []);
  assert.deepEqual(readdirSync(home), [], 'no acknowledgement written');
});

test('CLI init --project refuses a --globs value with a leading quote only before writing anything', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-quoted-globs-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo');
  mkdirSync(home); mkdirSync(repo);
  const env = { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home };
  const r = spawnSync(process.execPath, [CLI, 'init', '--project', '--vault', 'research', '--globs', "'docs/*.md"], { cwd: repo, env: testEnv(env), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.stderr, "init: 'docs/*.md looks quoted; remove the quotes\n");
  assert.equal(r.status, 2);
  assert.equal(existsSync(join(repo, PROJECT_CONFIG_FILENAME)), false);
  assert.deepEqual(readdirSync(repo), []);
  assert.deepEqual(readdirSync(home), [], 'no acknowledgement written');
});
