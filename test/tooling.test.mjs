import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../bin/lib/git.mjs';
import { installationFiles } from '../bin/lib/host-install.mjs';
import { build } from '../scripts/deps.mjs';

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
