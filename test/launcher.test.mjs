import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build, context } from '../scripts/deps.mjs';
import { REPO_ROOT, testEnv, tmpVault } from './helpers.mjs';
import { javascriptFiles } from './launcher-paths.mjs';

const floorModule = 'bin/lib/node-floor.mjs';
const windows = process.platform === 'win32';
const mac = process.platform === 'darwin';

function fixture(t, { folder = 'plugin', cache = true } = {}) {
  const temp = tmpVault('rv-launcher-');
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const plugin = join(temp, folder);
  const hooks = join(plugin, 'hooks');
  const cwd = join(temp, 'cwd');
  mkdirSync(cwd);
  mkdirSync(hooks, { recursive: true });
  mkdirSync(join(plugin, 'bin/lib'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'package.json'), join(plugin, 'package.json'));
  copyFileSync(join(REPO_ROOT, floorModule), join(plugin, floorModule));
  const markers = { loaded: join(hooks, 'loaded'), ran: join(hooks, 'ran') };
  const launcher = join(hooks, 'pre-web.mjs');
  // Keep the fixture specifiers out of the repository dependency graph.
  const shared = JSON.stringify('../' + floorModule);
  const source = JSON.stringify('./' + 'pre-web.ts');
  writeFileSync(launcher, `import { launch } from ${shared};
launch(import.meta.url, ${cache});
import(${source}).then(({ main }) => { main(); });
`);
  writeFileSync(join(hooks, 'pre-web.ts'), `import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./loaded', import.meta.url), 'loaded');
export function main(): void {
  writeFileSync(new URL('./ran', import.meta.url), 'ran');
  process.stdout.write('fixture ran\\n');
}
`);
  const home = join(temp, 'home');
  const xdg = join(temp, 'xdg-cache');
  const local = join(temp, 'local-app-data');
  const root = windows ? local : mac ? join(home, 'Library', 'Caches') : xdg;
  const run = (overrides = {}, args = []) => {
    const result = spawnSync(process.execPath, [...args, launcher], {
      cwd, encoding: 'utf8', timeout: 20000,
      env: testEnv({
        HOME: home, USERPROFILE: home, XDG_CACHE_HOME: xdg, LOCALAPPDATA: local,
        NODE_DISABLE_COMPILE_CACHE: undefined, ...overrides,
      }),
    });
    assert.ifError(result.error);
    return result;
  };
  return { run, temp, markers, cwd, home, root, cacheDir: join(root, 'research-vault', 'compile-cache') };
}

function assertRan(result, markers) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'fixture ran\n');
  assert.equal(result.stderr, '');
  assert.equal(readFileSync(markers.loaded, 'utf8'), 'loaded');
  assert.equal(readFileSync(markers.ran, 'utf8'), 'ran');
}

function assertCachePersisted(dir) {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  assert.ok(entries.some((entry) => entry.isFile()), `no compile-cache file in ${dir}`);
}

test('a launcher in node_modules refuses before loading TypeScript or creating a cache', (t) => {
  const { run, markers, root } = fixture(t, { folder: join('node_modules', 'research-vault') });
  const result = run();
  assert.equal(existsSync(markers.loaded), false, 'TypeScript module was loaded');
  assert.equal(existsSync(markers.ran), false, 'TypeScript main ran');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'research-vault: install as a plugin or git clone, not through npm (node_modules).\n');
  assert.equal(existsSync(root), false);
});

test('a segment containing node_modules as a substring allows TypeScript to run', (t) => {
  const { run, markers } = fixture(t, { folder: join('my_node_modules', 'node_modules_old') });
  assertRan(run(), markers);
});

test('cache opt-in creates a private compile cache and runs TypeScript', (t) => {
  const { run, markers, root, cacheDir } = fixture(t);
  assertRan(run(), markers);
  assertCachePersisted(cacheDir);
  if (windows) t.diagnostic('Windows does not expose POSIX directory modes.');
  else {
    assert.equal(statSync(join(root, 'research-vault')).mode & 0o777, 0o700);
    assert.equal(statSync(cacheDir).mode & 0o777, 0o700);
  }
});

test('cache opt-out runs TypeScript without creating a cache folder', (t) => {
  const { run, markers, root } = fixture(t, { cache: false });
  assertRan(run(), markers);
  assert.equal(existsSync(join(root, 'research-vault')), false);
});

test('NODE_DISABLE_COMPILE_CACHE=1 prevents cache folder creation', (t) => {
  const { run, markers, root } = fixture(t);
  assertRan(run({ NODE_DISABLE_COMPILE_CACHE: '1' }), markers);
  assert.equal(existsSync(join(root, 'research-vault')), false);
});

test('an empty NODE_DISABLE_COMPILE_CACHE also prevents cache folder creation', (t) => {
  const { run, markers, root } = fixture(t);
  assertRan(run({ NODE_DISABLE_COMPILE_CACHE: '' }), markers);
  assert.equal(existsSync(join(root, 'research-vault')), false);
});

test('relative XDG_CACHE_HOME uses the home cache and leaves the working directory empty', {
  skip: process.platform !== 'linux' && 'Linux XDG cache fallback',
}, (t) => {
  const { run, markers, cwd, home } = fixture(t);
  assertRan(run({ XDG_CACHE_HOME: 'relative-cache' }), markers);
  assert.deepEqual(readdirSync(cwd), []);
  assertCachePersisted(join(home, '.cache', 'research-vault', 'compile-cache'));
});

test('a relative cache root and home leave the working directory empty', (t) => {
  const { run, markers, cwd } = fixture(t);
  assertRan(run({
    XDG_CACHE_HOME: 'relative-cache', LOCALAPPDATA: 'relative-cache', HOME: 'relative-home', USERPROFILE: 'relative-home',
  }), markers);
  assert.deepEqual(readdirSync(cwd), []);
});

test('a missing compile-cache API leaves the cache folder absent', (t) => {
  const { run, temp, markers, root } = fixture(t);
  const preload = join(temp, 'no-cache-api.mjs');
  writeFileSync(preload, "import module from 'node:module'; module.enableCompileCache = undefined;\n");
  assertRan(run({}, ['--import', pathToFileURL(preload).href]), markers);
  assert.equal(existsSync(root), false);
});

test('an exception from the compile-cache API leaves TypeScript output and status intact', (t) => {
  const { run, temp, markers } = fixture(t);
  const preload = join(temp, 'throwing-cache-api.mjs');
  const called = join(temp, 'cache-api-called');
  writeFileSync(preload, `import { writeFileSync } from 'node:fs';
import module from 'node:module';
module.enableCompileCache = () => {
  writeFileSync(process.env.RV_TEST_CACHE_API_CALLED, 'called');
  throw new Error('cache unavailable');
};
`);
  assertRan(run({ RV_TEST_CACHE_API_CALLED: called }, ['--import', pathToFileURL(preload).href]), markers);
  assert.equal(readFileSync(called, 'utf8'), 'called');
});

test('a regular file at the cache path is preserved while TypeScript runs', (t) => {
  const { run, markers, root, cacheDir } = fixture(t);
  mkdirSync(join(root, 'research-vault'), { recursive: true });
  const bytes = Buffer.from([0, 13, 10, 255]);
  writeFileSync(cacheDir, bytes);
  assertRan(run(), markers);
  assert.deepEqual(readFileSync(cacheDir), bytes);
});

test('an unwritable cache root leaves TypeScript output and status intact', {
  skip: windows ? 'requires POSIX directory permissions' : process.getuid?.() === 0 && 'root can write a mode 0500 directory',
}, (t) => {
  const { run, markers, root } = fixture(t);
  mkdirSync(root, { recursive: true });
  chmodSync(root, 0o500);
  try {
    assertRan(run(), markers);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    chmodSync(root, 0o700);
  }
});

test('testEnv disables the compile cache by default and lets a child opt back in', () => {
  assert.equal(testEnv().NODE_DISABLE_COMPILE_CACHE, '1');
  assert.equal(Object.hasOwn(testEnv({ NODE_DISABLE_COMPILE_CACHE: undefined }), 'NODE_DISABLE_COMPILE_CACHE'), false);
});

// Guard the floor check against newer syntax and dependencies or API calls that can fail on Node 14.
test('source scan: the floor check uses ES2020 and imports only whole Node builtins', () => {
  const require = createRequire(new URL('../tooling/package.json', import.meta.url));
  const { parse } = require('acorn');
  const ast = parse(readFileSync(join(REPO_ROOT, floorModule), 'utf8'), { ecmaVersion: 2020, sourceType: 'module' });
  function check(node) {
    assert.notEqual(node.type, 'ImportExpression', 'dynamic import');
    if (node.type === 'MemberExpression' && node.object.name === 'Object') {
      assert.notEqual(node.computed ? node.property.value : node.property.name, 'hasOwn', 'Object.hasOwn needs Node 16');
    }
    if (node.source) {
      assert.equal(node.type, 'ImportDeclaration', 're-export');
      assert.ok(isBuiltin(node.source.value), node.source.value);
      assert.ok(node.specifiers.length > 0 && node.specifiers.every(({ type }) =>
        type === 'ImportDefaultSpecifier' || type === 'ImportNamespaceSpecifier'), node.source.value);
    }
    for (const child of Object.values(node).flat()) {
      if (child && typeof child.type === 'string') check(child);
    }
  }
  check(ast);
});

function launcherViolations(files, edges) {
  const launchers = new Map();
  const violations = [];
  for (const file of files) {
    if (!/^(?:bin|hooks|scripts)\/.*\.mjs$/.test(file)) continue;
    const source = file.replace(/\.mjs$/, '.ts');
    // Without a sibling the file is not yet converted.
    // at the end of phase 7 this becomes: every .mjs file here is on the list
    if (!files.has(source)) continue;
    if (javascriptFiles.get(file) === source) launchers.set(file, source);
    else violations.push(`Unexpected JavaScript and TypeScript pair: ${file} and ${source}`);
  }
  for (const { kind, from, to } of edges) {
    if (kind !== 'import' && kind !== 'tests') continue;
    if (launchers.has(to)) violations.push(`Import of launcher: ${from} -> ${to}`);
    if (launchers.has(from) && to !== floorModule && to !== launchers.get(from) && !isBuiltin(to)) {
      violations.push(`Import from launcher: ${from} -> ${to}`);
    }
  }
  return violations.sort();
}

test('the repository graph keeps launchers and TypeScript sources apart', () => {
  const { nodes, edges } = build(context());
  assert.deepEqual(launcherViolations(nodes, edges), []);
});

test('an unlisted JavaScript file may remain while it has no TypeScript sibling', () => {
  assert.deepEqual(launcherViolations(new Set(["hooks/example.mjs"]), []), []);
});

test('a JavaScript and TypeScript pair is rejected outside the launcher list', () => {
  const files = new Set(['bin/lib/node-floor.mjs', "bin/lib/node-floor.ts"]);
  assert.deepEqual(launcherViolations(files, []), ["Unexpected JavaScript and TypeScript pair: bin/lib/node-floor.mjs and bin/lib/node-floor.ts"]);
});

test('a launcher may import the floor module, a Node builtin and its own TypeScript source', () => {
  const files = new Set(['hooks/pre-web.mjs', "hooks/pre-web.ts", 'bin/lib/node-floor.mjs']);
  const edges = [
    { kind: 'import', from: 'hooks/pre-web.mjs', to: 'bin/lib/node-floor.mjs' },
    { kind: 'import', from: 'hooks/pre-web.mjs', to: 'node:fs' },
    { kind: 'import', from: 'hooks/pre-web.mjs', to: "hooks/pre-web.ts" },
  ];
  assert.deepEqual(launcherViolations(files, edges), []);
});

test('a launcher importing any other plugin source is rejected', () => {
  const files = new Set(['hooks/pre-web.mjs', "hooks/pre-web.ts", 'bin/lib/args.ts']);
  const edges = [{ kind: 'import', from: 'hooks/pre-web.mjs', to: 'bin/lib/args.ts' }];
  assert.deepEqual(launcherViolations(files, edges), ['Import from launcher: hooks/pre-web.mjs -> bin/lib/args.ts']);
});

test('plugin code importing a launcher is rejected', () => {
  const files = new Set(['hooks/pre-web.mjs', "hooks/pre-web.ts", 'bin/lib/args.ts']);
  const edges = [{ kind: 'import', from: 'bin/lib/args.ts', to: 'hooks/pre-web.mjs' }];
  assert.deepEqual(launcherViolations(files, edges), ['Import of launcher: bin/lib/args.ts -> hooks/pre-web.mjs']);
});

test('a test importing a launcher is rejected', () => {
  const files = new Set(['hooks/pre-web.mjs', "hooks/pre-web.ts", 'test/smoke.test.mjs']);
  const edges = [{ kind: 'tests', from: 'test/smoke.test.mjs', to: 'hooks/pre-web.mjs' }];
  assert.deepEqual(launcherViolations(files, edges), ['Import of launcher: test/smoke.test.mjs -> hooks/pre-web.mjs']);
});
