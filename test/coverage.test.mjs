import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gitInvocation } from '../bin/lib/git.mjs';
import { testEnv, tmpVault } from './helpers.mjs';

const codeDir = 'bin', testDir = 'test';
const imports = (cwd, names) => names.map((name) => `import ${JSON.stringify(pathToFileURL(join(cwd, codeDir, name)).href)};\n`).join('');

function fixture(t) {
  const cwd = tmpVault('rv-coverage-fixture-');
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, codeDir));
  mkdirSync(join(cwd, testDir));
  mkdirSync(join(cwd, 'schema'));
  for (const name of ['taxonomy.json', 'frontmatter.schema.json', 'AGENTS.golden.md']) {
    cpSync(new URL(`../schema/${name}`, import.meta.url), join(cwd, 'schema', name));
  }
  const git = (...args) => {
    const invocation = gitInvocation(args, { cwd });
    return execFileSync('git', invocation.args, { ...invocation.options, env: testEnv() });
  };
  git('init', '-q');
  writeFileSync(join(cwd, codeDir, 'a.mjs'), 'export const a = 1;\n');
  // Loading a module with an uncalled function must pass: no percentage floor.
  writeFileSync(join(cwd, codeDir, 'b.mjs'), 'export function b() { return 2; }\n');
  writeFileSync(join(cwd, join(testDir, 'fixture.test.mjs')), imports(cwd, ['a.mjs']));
  git('add', '--', codeDir, testDir);
  return cwd;
}
function run(cwd, script, args = []) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), ...args], {
    cwd, env: testEnv(), encoding: 'utf8', timeout: 20000,
  });
}

test('coverage fails for an absent code file', { timeout: 30000 }, (t) => {
  const cwd = fixture(t);
  const missing = run(cwd, 'coverage.mjs');
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /^Loaded by no test:\nbin\/b.mjs\n$/m);
  assert.match(missing.stdout, /bin\/a.mjs \| 100.00%/);
  assert.equal(readFileSync(join(cwd, codeDir, 'b.mjs'), 'utf8'), 'export function b() { return 2; }\n');
});

test('coverage passes for a loaded file with an uncalled function', { timeout: 30000 }, (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, join(testDir, 'fixture.test.mjs')), imports(cwd, ['a.mjs', 'b.mjs']));
  const loaded = run(cwd, 'coverage.mjs');
  assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr);
  assert.match(loaded.stdout, /bin\/b.mjs \| .* \| .* \| 0.00%/);
  assert.match(loaded.stdout, /TOTAL \(loaded code files\)/);
});

test('coverage preserves the runner status when no coverage data was written', { timeout: 30000 }, (t) => {
  const result = run(fixture(t), 'coverage.mjs', ['--bogus-flag']);
  assert.equal(result.status, 9, result.stdout + result.stderr);
  assert.equal(result.stderr.split('\n').filter((line) => line === 'No coverage data was written.').length, 1);
  assert.doesNotMatch(result.stderr, /ENOENT|\n\s+at /);
  assert.doesNotMatch(result.stdout, /File \| Lines \| Branches \| Functions|TOTAL \(loaded code files\)/);
});

test('coverage excludes an unimported browser bundle from the full-run gate', { timeout: 30000 }, (t) => {
  const cwd = fixture(t);
  const excluded = 'skills/research-teach/terminal/xterm.mjs';
  mkdirSync(join(cwd, 'skills/research-teach/terminal'), { recursive: true });
  writeFileSync(join(cwd, excluded), 'export const browserBundle = true;\n');
  const invocation = gitInvocation(['add', '--', excluded], { cwd });
  execFileSync('git', invocation.args, { ...invocation.options, env: testEnv() });
  writeFileSync(join(cwd, join(testDir, 'fixture.test.mjs')), imports(cwd, ['a.mjs', 'b.mjs']));
  const result = run(cwd, 'coverage.mjs');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^Excluded: skills\/research-teach\/terminal\/xterm.mjs \(vendored browser terminal bundle\)$/m);
});

test('coverage skips the missing-file gate for a partial run', { timeout: 30000 }, (t) => {
  const result = run(fixture(t), 'coverage.mjs', [join(testDir, 'fixture.test.mjs')]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Not-loaded check skipped: partial run/);
  assert.doesNotMatch(result.stderr, /Loaded by no test/);
});

test('coverage distinguishes a failing suite from an unloaded file', { timeout: 30000 }, (t) => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, join(testDir, 'fixture.test.mjs')), "throw new Error('fixture failure');\n");
  const result = run(cwd, 'coverage.mjs');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Coverage suite failed \(1\)/);
  assert.doesNotMatch(result.stderr, /Loaded by no test/);
});

test('drift command rejects a changed golden without rewriting it', { timeout: 30000 }, (t) => {
  const cwd = fixture(t);
  const clean = run(cwd, 'check-agentsmd-drift.mjs');
  assert.equal(clean.status, 0, clean.stderr);
  const golden = join(cwd, 'schema/AGENTS.golden.md');
  writeFileSync(golden, 'changed golden\n');
  const result = run(cwd, 'check-agentsmd-drift.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AGENTS.md drift: generator output differs/);
  assert.equal(readFileSync(golden, 'utf8'), 'changed golden\n');
});

test('encoding command rejects a tracked BOM without rewriting it', { timeout: 30000 }, (t) => {
  const cwd = fixture(t);
  const file = join(cwd, codeDir, 'a.mjs');
  const bytes = Buffer.from('\uFEFFexport const a = 1;\n');
  writeFileSync(file, bytes);
  const result = run(cwd, 'check-encoding.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^BOM: bin\/a.mjs$/m);
  assert.deepEqual(readFileSync(file), bytes);
});
