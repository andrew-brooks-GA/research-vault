import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../bin/lib/git.mjs';
import { installationFiles } from '../bin/lib/host-install.mjs';
import { build } from '../scripts/deps.mjs';
import { testEnv } from './helpers.mjs';

const repo = new URL('../', import.meta.url);
const tooling = new URL('tooling/', repo);
const readJson = (dir, file) => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
const toolVersions = ({ devDependencies }) => Object.entries(devDependencies ?? {});

test('the repository root keeps no dependency declarations', () => {
  const manifest = readJson(repo, 'package.json');
  const keys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  assert.deepEqual(keys.filter((key) => Object.hasOwn(manifest, key)), []);
});

test('tracked package-manager lockfiles live only under tooling/', { timeout: 10000 }, () => {
  const lockfiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);
  const tracked = runGit(['ls-files', '-z'], { processCwd: fileURLToPath(repo) }).split('\0');
  assert.deepEqual(tracked.filter((file) => lockfiles.has(posix.basename(file)) && !file.startsWith('tooling/')), []);
});

test('the tooling manifest declares dependencies only under devDependencies', () => {
  const manifest = readJson(tooling, 'package.json');
  const keys = ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies', 'overrides'];
  assert.deepEqual(keys.filter((key) => Object.hasOwn(manifest, key)), []);
});

test('tooling dependency versions are exact pins', () => {
  const exact = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  for (const [name, version] of toolVersions(readJson(tooling, 'package.json'))) {
    assert.match(version, exact, `${name} must use an exact version`);
  }
});

test('the tooling package is private', () => {
  assert.equal(readJson(tooling, 'package.json').private, true);
});

test('the tooling package declares no scripts', () => {
  assert.equal(Object.hasOwn(readJson(tooling, 'package.json'), 'scripts'), false);
});

function npmConfig() {
  const text = readFileSync(new URL('.npmrc', tooling), 'utf8');
  const entries = text.matchAll(/^[ \t]*([\w-]+)[ \t]*=[ \t]*([^\r\n]*)/gm);
  return Object.fromEntries(Array.from(entries, ([, key, value]) => [key, value.trim()]));
}

test('tooling npm config disables install scripts', () => {
  assert.equal(npmConfig()['ignore-scripts'], 'true');
});

test('tooling npm config requires a release age of at least seven days', () => {
  const days = npmConfig()['min-release-age'];
  assert.ok(/^\d+$/.test(days) && Number(days) >= 7, `min-release-age must be at least 7, got ${days}`);
});

test('tooling npm config saves exact versions', () => {
  assert.equal(npmConfig()['save-exact'], 'true');
});

test('the tooling lockfile exists and uses version 3', async (t) => {
  const lock = readJson(tooling, 'package-lock.json');
  assert.equal(lock.lockfileVersion, 3);
  const packages = Object.entries(lock.packages).filter(([path]) => path !== '');

  await t.test('locked packages have SHA-512 integrity values', () => {
    for (const [path, entry] of packages) assert.match(entry.integrity ?? '', /^sha512-/, path);
  });

  await t.test('locked packages resolve from the npm registry', () => {
    for (const [path, entry] of packages) assert.match(entry.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, path);
  });

  await t.test('locked packages declare no install scripts', () => {
    for (const [path, entry] of packages) assert.notEqual(entry.hasInstallScript, true, path);
  });

  await t.test('locked versions match the tooling manifest pins', () => {
    for (const [name, version] of toolVersions(readJson(tooling, 'package.json'))) {
      assert.equal(lock.packages[`node_modules/${name}`]?.version, version, name);
    }
  });
});

// The graph records literal relative imports in scanned .mjs and .js files, including dynamic
// import() with a literal argument. It does not record bare specifiers or scan its own source.
test('the import graph has no edges from plugin code into tooling/', { timeout: 10000 }, () => {
  const { edges } = build();
  const imports = edges.filter(({ kind, from, to }) =>
    kind === 'import' && /^(?:bin|hooks|scripts|skills)\//.test(from) && to.startsWith('tooling/'));
  assert.deepEqual(imports, []);
});

test('the Codex installation excludes tooling/', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'rv-codex-tooling-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const { files } = installationFiles(project);
  assert.deepEqual([...files.keys()].filter((file) => file.split('/').includes('tooling')), []);
});

function lintConfig() {
  const text = readFileSync(new URL('tooling/.oxlintrc.json', repo), 'utf8');
  // Match JSON strings first so comment markers inside a value stay intact.
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith('"') ? token : ' '));
}

for (const rule of [
  'typescript/no-explicit-any',
  'typescript/no-non-null-assertion',
  'typescript/consistent-type-assertions',
  'typescript/no-unsafe-type-assertion',
  'typescript/no-unsafe-assignment',
  'typescript/no-unsafe-member-access',
  'typescript/no-unsafe-call',
  'typescript/no-unsafe-return',
  'typescript/no-unsafe-argument',
]) {
  test(`the linter reports ${rule} as an error`, () => {
    const setting = lintConfig().rules[rule];
    assert.equal(Array.isArray(setting) ? setting[0] : setting, 'error');
  });
}

test('the linter enables type-aware rules', () => {
  assert.equal(lintConfig().options.typeAware, true);
});

test('the linter ignores ESLint disable directives', () => {
  assert.equal(lintConfig().options.respectEslintDisableDirectives, false);
});

test('the linter disables the default rule categories', () => {
  assert.deepEqual(lintConfig().categories, { correctness: 'off' });
});

test('the linter forbids both styles of type assertion', () => {
  assert.equal(lintConfig().rules['typescript/consistent-type-assertions'][1].assertionStyle, 'never');
});

test('the linter configuration has no file overrides', () => {
  assert.equal(Object.hasOwn(lintConfig(), 'overrides'), false);
});

const dottedVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
for (const name of ['oxlint', 'oxlint-tsgolint']) {
  test(`the tooling manifest and lockfile pin ${name}`, () => {
    const pin = readJson(tooling, 'package.json').devDependencies[name];
    assert.match(pin ?? '', dottedVersion);
    assert.equal(readJson(tooling, 'package-lock.json').packages[`node_modules/${name}`]?.version, pin);
  });
}

test('the locked oxlint-tsgolint version satisfies the locked oxlint peer minimum', () => {
  const { packages } = readJson(tooling, 'package-lock.json');
  const peer = packages['node_modules/oxlint'].peerDependencies['oxlint-tsgolint'];
  const version = packages['node_modules/oxlint-tsgolint'].version;
  const minimum = peer.startsWith('>=') ? peer.slice(2) : '';
  assert.match(minimum, dottedVersion, `unsupported oxlint peer range: ${peer}`);
  assert.match(version, dottedVersion);
  const minimumParts = minimum.split('.').map(Number);
  const differences = version.split('.').map((part, index) => Number(part) - minimumParts[index]);
  assert.ok((differences.find((part) => part !== 0) ?? 0) >= 0, `${version} must satisfy ${peer}`);
});

// Source-scan guard: a tracked TypeScript conversion cannot suppress Oxlint or compiler checks.
test('source scan: tracked TypeScript has no lint or compiler suppression directives', { timeout: 10000 }, () => {
  const root = fileURLToPath(repo);
  const tracked = runGit(['ls-files', '-z', '--', 'bin/', 'hooks/', 'scripts/'],
    { processCwd: root }).split('\0');
  for (const file of tracked.filter((name) => /\.[cm]?tsx?$/.test(name))) {
    const text = readFileSync(join(root, file), 'utf8');
    const directive = /eslint-disable|oxlint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck/.exec(text);
    assert.equal(directive, null, `${file} contains a suppression directive: ${directive?.[0]}`);
  }
});

function lintProject(t, folders) {
  const project = mkdtempSync(join(tmpdir(), 'rv-lint-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  for (const folder of ['tooling', ...folders]) mkdirSync(join(project, folder));
  copyFileSync(new URL('lint.mjs', tooling), join(project, 'tooling', 'lint.mjs'));
  return project;
}

function fakeOxlint(tools, marker) {
  const bin = join(tools, 'node_modules/oxlint/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'oxlint'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`);
}

function runLint(project, tools) {
  return spawnSync(process.execPath, [join(project, 'tooling', 'lint.mjs')], {
    cwd: project,
    env: testEnv({ RV_TOOLING_DIR: tools }),
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('the lint launcher gives the install hint first when both the tools and a default folder are missing', { timeout: 10000 }, (t) => {
  const project = lintProject(t, ["bin", "scripts"]);
  const marker = join(project, 'lint-started');
  fakeOxlint(join(project, 'tooling'), marker);
  const result = runLint(project, join(project, 'missing'));
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'Run npm ci --ignore-scripts in tooling/ to install the linter.\n');
  assert.equal(result.stdout, '');
});

test('the lint launcher names a missing default folder and does not start Oxlint', { timeout: 10000 }, (t) => {
  const project = lintProject(t, ["bin", "scripts"]);
  const tools = join(project, 'tools');
  const marker = join(project, 'lint-started');
  fakeOxlint(tools, marker);
  const companion = join(tools, `node_modules/@oxlint-tsgolint/${process.platform}-${process.arch}`);
  mkdirSync(companion, { recursive: true });
  writeFileSync(join(companion, process.platform === 'win32' ? 'tsgolint.exe' : 'tsgolint'), '');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'Missing default lint folder: hooks\n');
  assert.equal(result.stdout, '');
});

test('the lint launcher gives an install hint without starting Oxlint when the type-aware package is missing', { timeout: 10000 }, (t) => {
  const project = lintProject(t, ["bin", "hooks", "scripts"]);
  const tools = join(project, 'tools');
  const marker = join(project, 'lint-started');
  fakeOxlint(tools, marker);
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, `The type-aware linter has no package for ${process.platform}-${process.arch}, or the tools are incompletely installed. Run npm ci --ignore-scripts in tooling/.\n`);
  assert.equal(result.stdout, '');
});
