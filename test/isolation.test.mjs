// This source scan sees direct calls by name. It cannot follow aliases, method calls, template
// substitutions, generated code or calls made inside imported modules.
// It checks for `env: testEnv(` in `*.test.mjs` calls, so it misses spawns in `test/helpers.mjs`
// and cannot see what overrides restore. A division sign earlier on the same line can hide a call
// because the regular-expression mask is heuristic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { testEnv, testHome } from './helpers.mjs';

const literals = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/(?:\\[^\n]|\[(?:\\[^\n]|[^\]\\\n])*\]|[^/[\\\n])+\/[a-z]*|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`/g;

function hasTestEnv(code, start) {
  const tokens = /[()[\]{}]|(?<![\w$.])env\s*:\s*testEnv(?=\s*\()/g;
  tokens.lastIndex = start;
  let open = '(';
  for (let token; open && (token = tokens.exec(code));) {
    const value = token[0];
    if ('([{'.includes(value)) open += value;
    else if (')]}'.includes(value)) open = open.slice(0, -1);
    else if (open === '({') return true;
  }
  return false;
}

// Guard isolation on every direct process call; running tests cannot establish that unvisited
// branches pass the isolated environment. The lexical limits are documented above.
test('source scan: direct child process calls in tests pass env: testEnv(...)', () => {
  const dir = new URL('./', import.meta.url);
  const missing = [];
  for (const file of readdirSync(dir, { recursive: true }).filter((name) => name.endsWith('.test.mjs')).sort()) {
    const source = readFileSync(new URL(file.replaceAll('\\', '/'), dir), 'utf8');
    const code = source.replace(literals, (literal) => literal.replace(/[^\n]/g, ' '));
    for (const call of code.matchAll(/(?<![\w$.])(spawnSync|spawn|execFileSync|execFile|execSync|exec|fork)\s*\(/g)) {
      if (hasTestEnv(code, call.index + call[0].length)) continue;
      const line = code.slice(0, call.index).split('\n').length;
      missing.push(`${file}:${line}: ${call[1]} needs env: testEnv(...)`);
    }
  }
  assert.deepEqual(missing, []);
});

test('testEnv isolates home, git config and research-vault settings and applies overrides', (t) => {
  for (const key of ['RESEARCH_VAULT_PATH', 'RESEARCH_VAULT_ALLOW_NETWORK', 'RESEARCH_VAULT_EMBED_KEY', 'RV_TEST_CANARY']) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = 'parent-value';
  }
  const env = testEnv();
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
    assert.equal(dirname(env[key]), testHome, key);
    assert.ok(statSync(env[key]).isDirectory(), key);
  }
  assert.equal(dirname(env.GIT_CONFIG_GLOBAL), testHome);
  const config = statSync(env.GIT_CONFIG_GLOBAL);
  assert.ok(config.isFile());
  assert.equal(config.size, 0);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.deepEqual(Object.keys(env).filter((key) => key.startsWith('RESEARCH_VAULT_')), []);
  assert.ok(!Object.hasOwn(env, 'RV_TEST_CANARY'));

  const home = join(testHome, 'override');
  const overridden = testEnv({ HOME: home, RESEARCH_VAULT_PATH: testHome, GIT_CONFIG_NOSYSTEM: undefined });
  assert.equal(overridden.HOME, home);
  assert.equal(overridden.RESEARCH_VAULT_PATH, testHome);
  assert.ok(!Object.hasOwn(overridden, 'GIT_CONFIG_NOSYSTEM'));
  assert.notStrictEqual(testEnv(), env);
  assert.deepEqual(testEnv(), env);

  const isPath = (key) => (process.platform === 'win32' ? key.toUpperCase() : key) === 'PATH';
  const pathKey = Object.keys(process.env).find(isPath);
  assert.deepEqual(Object.keys(env).filter(isPath), pathKey ? [pathKey] : []);
  if (pathKey) {
    assert.equal(env[pathKey], process.env[pathKey]);
    const overrideKey = process.platform === 'win32' && pathKey === 'PATH' ? 'path' : 'PATH';
    const changedPath = testEnv({ [overrideKey]: testHome });
    assert.deepEqual(Object.keys(changedPath).filter(isPath), [pathKey]);
    assert.equal(changedPath[pathKey], testHome);
    assert.deepEqual(Object.keys(testEnv({ PATH: undefined })).filter(isPath), []);
  }
});
