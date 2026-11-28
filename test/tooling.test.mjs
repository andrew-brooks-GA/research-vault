import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../bin/lib/git.ts';
import { installationFiles } from '../bin/lib/host-install.ts';
import { build } from '../scripts/deps.ts';
import { findSuppressions } from '../tooling/suppressions.mjs';
import { testEnv } from './helpers.mjs';
import { javascriptFiles } from './launcher-paths.mjs';

const repo = new URL('../', import.meta.url);
const tooling = new URL('tooling/', repo);
const readJson = (dir, file) => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
const toolVersions = ({ devDependencies }) => Object.entries(devDependencies ?? {});
const trackedFiles = (...paths) => runGit(['ls-files', '-z', '--', ...paths],
  { processCwd: fileURLToPath(repo) }).split('\0').filter(Boolean);

function readJsonc(dir, file) {
  const text = readFileSync(new URL(file, dir), 'utf8');
  // Match JSON strings first so comment markers inside a value stay intact.
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith('"') ? token : ' '));
}

test('the TypeScript project has only compilerOptions and include at the top level', () => {
  assert.deepEqual(Object.keys(readJsonc(repo, 'tsconfig.json')).sort(), ['compilerOptions', 'include']);
});

test('the TypeScript project uses exactly the migration compiler options', () => {
  const { compilerOptions } = readJsonc(repo, 'tsconfig.json');
  assert.deepEqual(compilerOptions, {
    noEmit: true,
    allowImportingTsExtensions: true,
    module: 'nodenext',
    target: 'esnext',
    lib: ['es2024'],
    erasableSyntaxOnly: true,
    verbatimModuleSyntax: true,
    types: ['node'],
    typeRoots: ['./tooling/node_modules/@types'],
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
    allowJs: false,
    skipLibCheck: true,
  });
});

test('the TypeScript project includes only converted sources in bin, hooks and scripts', () => {
  const { include } = readJsonc(repo, 'tsconfig.json');
  assert.deepEqual(include, ['bin/**/*.ts', 'hooks/**/*.ts', 'scripts/**/*.ts']);
});

test('the typecheck script starts the TypeScript entry point through Node', () => {
  assert.equal(readJson(repo, 'package.json').scripts.typecheck,
    'node tooling/node_modules/typescript/bin/tsc -p tsconfig.json');
});

test('the pretypecheck script starts the compiler check through Node', () => {
  assert.equal(readJson(repo, 'package.json').scripts.pretypecheck, 'node tooling/pretypecheck.mjs');
});

function typecheckProject(t) {
  const project = mkdtempSync(join(tmpdir(), 'rv-typecheck-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, 'tooling'));
  mkdirSync(join(project, 'working'));
  copyFileSync(new URL('pretypecheck.mjs', tooling), join(project, 'tooling/pretypecheck.mjs'));
  return project;
}

function runPretypecheck(project) {
  return spawnSync(process.execPath, [join(project, 'tooling/pretypecheck.mjs')], {
    cwd: join(project, 'working'),
    env: testEnv(),
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('the pretypecheck launcher exits silently when the compiler is present beside it', { timeout: 10000 }, (t) => {
  const project = typecheckProject(t);
  const bin = join(project, 'tooling/node_modules/typescript/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'tsc'), 'throw new Error("TypeScript should not be started");\n');
  const result = runPretypecheck(project);
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('the pretypecheck launcher exits with the install hint when the compiler is absent', { timeout: 10000 }, (t) => {
  const project = typecheckProject(t);
  const result = runPretypecheck(project);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Run npm ci --ignore-scripts in tooling/ to install the TypeScript compiler.\n');
});

test('the lint script starts the lint launcher through Node', () => {
  assert.equal(readJson(repo, 'package.json').scripts.lint, 'node tooling/lint.mjs');
});

test('the repository root keeps no dependency declarations', () => {
  const manifest = readJson(repo, 'package.json');
  const keys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  assert.deepEqual(keys.filter((key) => Object.hasOwn(manifest, key)), []);
});

test('tracked package-manager lockfiles live only under tooling/', { timeout: 10000 }, () => {
  const lockfiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);
  assert.deepEqual(trackedFiles().filter((file) => lockfiles.has(posix.basename(file)) && !file.startsWith('tooling/')), []);
});

test('tracked JavaScript and TypeScript in bin, hooks and scripts use only .mjs or .ts', { timeout: 10000 }, () => {
  const sources = trackedFiles('bin/', 'hooks/', 'scripts/').filter((file) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file));
  assert.deepEqual(sources.filter((file) => !/\.(?:mjs|ts)$/.test(file)), []);
});

test('test/ has no tracked .ts files', { timeout: 10000 }, () => {
  assert.deepEqual(trackedFiles('test/').filter((file) => file.endsWith('.ts')), []);
});

function unexpectedTypeScriptPairs(paths) {
  return [...paths].filter((file) => {
    if (!file.endsWith('.ts')) return false;
    const launcher = file.replace(/\.ts$/, '.mjs');
    return paths.has(launcher) && javascriptFiles.get(launcher) !== file;
  });
}

// A tracked .mjs sibling is allowed only when the launcher list maps it to that .ts file.
test('tracked TypeScript files may have tracked .mjs siblings only as listed launcher pairs', { timeout: 10000 }, () => {
  assert.deepEqual(unexpectedTypeScriptPairs(new Set(trackedFiles())), []);
});

test('the tracked pair guard accepts a listed launcher and its TypeScript source', () => {
  const paths = new Set(["scripts/check-encoding.ts", "scripts/check-encoding.mjs"]);
  assert.deepEqual(unexpectedTypeScriptPairs(paths), []);
});

test('the tracked pair guard reports an unlisted pair by name', () => {
  const paths = new Set(["bin/lib/terms.ts", "bin/lib/terms.mjs"]);
  assert.deepEqual(unexpectedTypeScriptPairs(paths), ["bin/lib/terms.ts"]);
});

test('the tracked pair guard reports a listed JavaScript file with no mapped source when it has a TypeScript sibling', () => {
  const paths = new Set(["bin/lib/node-floor.ts", "bin/lib/node-floor.mjs"]);
  assert.deepEqual(unexpectedTypeScriptPairs(paths), ["bin/lib/node-floor.ts"]);
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

const lintConfig = () => readJsonc(tooling, '.oxlintrc.json');

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
  assert.deepEqual(findSuppressions(root, trackedFiles('bin/', 'hooks/', 'scripts/')), []);
});

function lintProject(t, folders, parent = tmpdir()) {
  const project = mkdtempSync(join(parent, 'rv-lint-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  for (const folder of ['tooling', ...folders]) mkdirSync(join(project, folder));
  for (const file of ['lint.mjs', 'suppressions.mjs']) copyFileSync(new URL(file, tooling), join(project, 'tooling', file));
  return project;
}

function fakeOxlint(tools, marker, prelude = '') {
  const bin = join(tools, 'node_modules/oxlint/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'oxlint'), `${prelude}require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`);
}

function fakeCompanion(tools) {
  const companion = join(tools, `node_modules/@oxlint-tsgolint/${process.platform}-${process.arch}`);
  mkdirSync(companion, { recursive: true });
  writeFileSync(join(companion, process.platform === 'win32' ? 'tsgolint.exe' : 'tsgolint'), '');
}

function runLint(project, tools, ...paths) {
  return spawnSync(process.execPath, [join(project, 'tooling', 'lint.mjs'), ...paths], {
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
  fakeCompanion(tools);
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'Missing default lint folder: hooks\n');
  assert.equal(result.stdout, '');
});

test('the lint launcher propagates Oxlint failure for an empty default selection', { timeout: 10000 }, (t) => {
  const project = lintProject(t, ["bin", "hooks", "scripts"]);
  const tools = join(project, 'tools');
  const marker = join(project, 'empty-selection-accepted');
  fakeOxlint(tools, marker, "if (!process.argv.includes('--no-error-on-unmatched-pattern')) process.exit(17);\n");
  fakeCompanion(tools);
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint accepted the empty selection');
  assert.equal(result.status, 17);
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

function lintFixture(t, parent) {
  const project = lintProject(t, ["bin", "bin/lib", "hooks", "scripts"], parent);
  const tools = join(project, 'tools');
  const marker = join(project, 'lint-started');
  fakeOxlint(tools, marker);
  fakeCompanion(tools);
  return { project, tools, marker };
}

const suppressionLine = (file, line, directive) => `${file}:${line}: ${directive}: a comment that switches a check off is not allowed\n`;

for (const directive of [
  'eslint-disable', 'oxlint-disable', '@ts-ignore', '@ts-expect-error', '@ts-nocheck',
  '@TS-NOCHECK', '@Ts-Nocheck',
]) {
  test(`the lint launcher refuses ${directive} in a default TypeScript folder before starting Oxlint`, { timeout: 10000 }, (t) => {
    const { project, tools, marker } = lintFixture(t);
    writeFileSync(join(project, "bin/lib/x.ts"), `const x = 1;\n// ${directive}\n`);
    const result = runLint(project, tools);
    assert.ifError(result.error);
    assert.equal(existsSync(marker), false, 'Oxlint started');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, suppressionLine("bin/lib/x.ts", 2, directive));
  });
}

test('the lint launcher reports each suppression in an untracked TypeScript file', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  runGit(['init', '-q'], { processCwd: project });
  const file = 'hooks/new.tsx';
  const [first, second] = ['eslint-disable', 'oxlint-disable'];
  writeFileSync(join(project, file), `/* ${first} ${second} */\n`);
  assert.equal(runGit(['ls-files', '--', file], { processCwd: project }), '');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, suppressionLine(file, 1, first) + suppressionLine(file, 1, second));
});

test('the lint launcher starts Oxlint on a TypeScript file without a suppression', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  writeFileSync(join(project, "bin/lib/x.ts"), 'const x = 1;\n');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(marker), true, 'Oxlint did not start');
});

test('the lint launcher ignores suppression markers in legacy .mjs files', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  writeFileSync(join(project, "bin/lib/x.mjs"), '// eslint-disable\n');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  assert.equal(existsSync(marker), true, 'Oxlint did not start');
});

for (const [selection, file] of [['lib/x.mts', 'lib/x.mts'], ['lib', 'lib/nested/x.cts']]) {
  test(`the lint launcher checks suppressions in the explicit path ${selection}`, { timeout: 10000 }, (t) => {
    const { project, tools, marker } = lintFixture(t);
    mkdirSync(join(project, 'lib/nested'), { recursive: true });
    const directive = 'eslint-disable';
    writeFileSync(join(project, file), `// ${directive}\n`);
    writeFileSync(join(project, "bin/lib/x.ts"), `// ${directive}\n`);
    const result = runLint(project, tools, selection);
    assert.ifError(result.error);
    assert.equal(existsSync(marker), false, 'Oxlint started');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, suppressionLine(file, 1, directive));
  });
}

test('the lint launcher reports suppressions in explicitly named node_modules files', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  const file = "bin/node_modules/x.ts";
  mkdirSync(join(project, 'bin/node_modules'));
  writeFileSync(join(project, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(project, file), '/* oxlint-disable */\n');
  const result = runLint(project, tools, file);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, suppressionLine(file, 1, 'oxlint-disable'));
});

test('the lint launcher scans nested node_modules without assuming they are ignored', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  const file = "bin/node_modules/x.ts";
  mkdirSync(join(project, 'bin/node_modules'));
  writeFileSync(join(project, file), '// eslint-disable\n');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, suppressionLine(file, 1, 'eslint-disable'));
});

function lintLinkFixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'rv-lint-links-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const outside = join(parent, 'outside');
  mkdirSync(outside);
  return { ...lintFixture(t, parent), outside };
}

test('the lint launcher follows a symbolic link to a file', { timeout: 10000 }, (t) => {
  const { project, tools, marker, outside } = lintLinkFixture(t);
  const source = join(outside, 'x.ts');
  writeFileSync(source, '// @ts-nocheck\n');
  const before = readFileSync(source);
  const link = "bin/lib/link.ts";
  symlinkSync(source, join(project, link), 'file');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.deepEqual(readFileSync(source), before);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, suppressionLine(link, 1, '@ts-nocheck'));
});

test('the lint launcher follows a symbolic link to a folder', { timeout: 10000 }, (t) => {
  const { project, tools, marker, outside } = lintLinkFixture(t);
  const source = join(outside, 'x.ts');
  writeFileSync(source, '// @ts-nocheck\n');
  const before = readFileSync(source);
  symlinkSync(outside, join(project, 'bin/alias'), 'dir');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.deepEqual(readFileSync(source), before);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, suppressionLine("bin/alias/x.ts", 1, '@ts-nocheck'));
});

test('the lint launcher ends a cycle of folder links and reports each path once', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  writeFileSync(join(project, "bin/lib/x.ts"), '// @ts-nocheck\n');
  symlinkSync(join(project, 'bin/lib'), join(project, 'bin/alias'), 'dir');
  symlinkSync(join(project, 'bin'), join(project, 'bin/lib/parent'), 'dir');
  const result = runLint(project, tools, "bin", "bin/lib");
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, ["bin/alias/x.ts", "bin/lib/x.ts"]
    .map((file) => suppressionLine(file, 1, '@ts-nocheck')).join(''));
});

test('the lint launcher skips a broken symbolic link', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  symlinkSync(join(project, 'missing.ts'), join(project, "bin/lib/broken.ts"), 'file');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(existsSync(marker), true, 'Oxlint did not start');
});

test('the lint launcher judges the extension by the symbolic link name', { timeout: 10000 }, (t) => {
  const { project, tools, marker, outside } = lintLinkFixture(t);
  for (const file of ['x.txt', 'x.ts']) writeFileSync(join(outside, file), '// @ts-nocheck\n');
  symlinkSync(join(outside, 'x.txt'), join(project, "bin/lib/lk.ts"), 'file');
  symlinkSync(join(outside, 'x.ts'), join(project, "bin/lib/lk.txt"), 'file');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, suppressionLine("bin/lib/lk.ts", 1, '@ts-nocheck'));
});

test('the lint launcher scans suppressions in the other source formats selected by Oxlint', { timeout: 10000 }, (t) => {
  const { project, tools, marker } = lintFixture(t);
  const files = ['bin/lib/x.astro', 'bin/lib/x.cjs', 'bin/lib/x.jsx', 'bin/lib/x.svelte', 'bin/lib/x.vue'];
  for (const file of files) writeFileSync(join(project, file), '/* oxlint-disable */\n');
  const result = runLint(project, tools);
  assert.ifError(result.error);
  assert.equal(existsSync(marker), false, 'Oxlint started');
  assert.equal(result.status, 1);
  assert.equal(result.stderr, files.map((file) => suppressionLine(file, 1, 'oxlint-disable')).join(''));
});
