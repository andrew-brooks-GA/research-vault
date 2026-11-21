import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, sep, win32 } from 'node:path';
import { defaultVaultPath, configPath, OUTSIDE_PROJECT_VAULT, resolveVault } from '../bin/lib/resolve.mjs';

test('linux default uses XDG_DATA_HOME then ~/.local/share', () => {
  assert.equal(defaultVaultPath({ platform: 'linux', home: '/home/u', env: { XDG_DATA_HOME: '/x' } }), '/x/research-vault');
  assert.equal(defaultVaultPath({ platform: 'linux', home: '/home/u', env: {} }), '/home/u/.local/share/research-vault');
});
test('mac and windows defaults', () => {
  assert.equal(defaultVaultPath({ platform: 'darwin', home: '/Users/u', env: {} }), '/Users/u/Library/Application Support/research-vault');
  assert.equal(defaultVaultPath({ platform: 'win32', home: 'C:\\Users\\u', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } }), 'C:\\Users\\u\\AppData\\Local\\research-vault');
});
test('resolution order: flag > project > env > config > default', (t) => {
  const base = { platform: 'linux', home: '/home/u', readConfig: () => null, readProjectConfig: () => null };
  const cwd = mkdtempSync(join(tmpdir(), 'rv-priority-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'research'));
  // flag beats everything
  assert.deepEqual(resolveVault({ ...base, flag: '/explicit', env: { RESEARCH_VAULT_PATH: '/fromenv' }, readProjectConfig: () => ({ vault: '/fromproject' }) }),
    { path: '/explicit', source: 'flag' });
  // A relative project vault beats env.
  assert.deepEqual(resolveVault({ ...base, cwd, env: { RESEARCH_VAULT_PATH: '/fromenv' }, readProjectConfig: () => ({ vault: 'research' }) }),
    { path: join(cwd, 'research'), source: 'project' });
  const withoutVault = { ...base, readProjectConfig: () => ({ defaults: { domain: 'learning' } }) };
  assert.deepEqual(resolveVault({ ...withoutVault, env: { RESEARCH_VAULT_PATH: '/fromenv' }, readConfig: () => '/fromcfg' }),
    { path: '/fromenv', source: 'env' });
  assert.deepEqual(resolveVault({ ...withoutVault, env: {}, readConfig: () => '/fromcfg' }),
    { path: '/fromcfg', source: 'config' });
  assert.deepEqual(resolveVault({ ...withoutVault, env: {} }),
    { path: '/home/u/.local/share/research-vault', source: 'default' });
  // env beats config
  assert.deepEqual(resolveVault({ ...base, flag: null, env: { RESEARCH_VAULT_PATH: '/fromenv' } }),
    { path: '/fromenv', source: 'env' });
  // config beats default
  assert.deepEqual(resolveVault({ ...base, flag: null, env: {}, readConfig: () => '/fromcfg' }),
    { path: '/fromcfg', source: 'config' });
  // default fallback
  assert.deepEqual(resolveVault({ ...base, flag: null, env: {} }),
    { path: '/home/u/.local/share/research-vault', source: 'default' });
});

test('resolveVault auto-discovers a .research-vault.json from cwd (default reader)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-proj-'));
  try {
    mkdirSync(join(dir, 'discovered'));
    writeFileSync(join(dir, '.research-vault.json'), '{"vault":"discovered","defaults":{"domain":"learning"}}');
    assert.deepEqual(
      resolveVault({ cwd: dir, env: {}, readConfig: () => null }),
      { path: join(dir, 'discovered'), source: 'project' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveVault default reader is silent when no project file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-noproj-'));
  try {
    assert.equal(resolveVault({ cwd: dir, env: { RESEARCH_VAULT_PATH: '/fromenv' }, readConfig: () => null }).source, 'env');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a relative project vault resolves against the config\'s directory, not cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-rel-'));
  try {
    writeFileSync(join(dir, '.research-vault.json'), '{"vault":"research"}');
    mkdirSync(join(dir, 'docs'));
    mkdirSync(join(dir, 'research'));
    assert.deepEqual(
      resolveVault({ cwd: join(dir, 'docs'), env: {}, readConfig: () => null }),
      { path: join(dir, 'research'), source: 'project' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function projectVaults(t) {
  const root = mkdtempSync(join(tmpdir(), 'rv-resolve-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo');
  const vault = join(root, 'OutsideVault');
  mkdirSync(cwd);
  mkdirSync(vault);
  const binding = join(cwd, '.research-vault.json');
  const options = (value, overrides = {}) => ({
    cwd, env: {}, home: root, readConfig: () => null,
    readProjectConfig: () => ({ path: binding, vault: value }), ...overrides,
  });
  return { root, cwd, vault, binding, options };
}

function assertRefused(options, binding, reason = 'a vault outside its repository that is not one of your own',
  remedy = 'Set RESEARCH_VAULT_PATH to that folder or pass --vault to the command.') {
  assert.throws(() => resolveVault(options), (err) => {
    assert.equal(err.code, OUTSIDE_PROJECT_VAULT);
    assert.equal(err.message, `The binding at ${binding} names ${reason}. ${remedy}`);
    assert.doesNotMatch(err.message, /[\r\n\u2028\u2029]/);
    assert.doesNotMatch(err.message, /init --vault|--set-default/);
    return true;
  });
}

test('an empty project vault falls through to the environment, user config and default', (t) => {
  const { root, cwd, binding, vault } = projectVaults(t);
  writeFileSync(binding, '{"vault":""}');
  const env = { RESEARCH_VAULT_PATH: vault };
  const ctx = { cwd, home: root, platform: process.platform };
  assert.deepEqual(resolveVault({ ...ctx, env, readConfig: () => root }),
    { path: vault, source: 'env' });
  assert.deepEqual(resolveVault({ ...ctx, env: {}, readConfig: () => root }),
    { path: root, source: 'config' });
  assert.deepEqual(resolveVault({ ...ctx, env: {}, readConfig: () => null }),
    { path: defaultVaultPath({ ...ctx, env: {} }), source: 'default' });
});

test('a refusal escapes bidirectional and zero-width characters in the binding path', (t) => {
  const { root, vault } = projectVaults(t);
  const cwd = join(root, 'repo-\u202e-\ufeff-\u061c-\u00ad-name');
  try {
    mkdirSync(cwd);
  } catch (err) {
    return t.skip('filesystem refused the directory name (' + err.code + ')');
  }
  writeFileSync(join(cwd, '.research-vault.json'), JSON.stringify({ vault }));
  const escapedBinding = join(root, 'repo-\\u202e-\\ufeff-\\u061c-\\u00ad-name', '.research-vault.json');
  assertRefused({ cwd, env: {}, home: root, readConfig: () => null }, escapedBinding);
});

test('a refusal escapes control characters, line separators and lone surrogates in the binding path', (t) => {
  const { root, vault, options } = projectVaults(t);
  const binding = join(root, 'repo-\t-\u2028-\u2029-\ud800-\u{e0001}-\u{1f600}', '.research-vault.json');
  const escaped = join(root, 'repo-\\u0009-\\u2028-\\u2029-\\ud800-\\u{e0001}-\u{1f600}', '.research-vault.json');
  const fs = { realpathSync: value => value };
  assertRefused(options(vault, { fs, readProjectConfig: () => ({ vault, path: binding }) }), escaped);
});

test('a project vault in a directory link loop is refused as unresolvable', (t) => {
  const { cwd, binding, options } = projectVaults(t);
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  const first = join(cwd, 'first');
  const second = join(cwd, 'second');
  try {
    symlinkSync(second, first, type);
    symlinkSync(first, second, type);
  } catch (err) {
    return t.skip('cannot create directory link loop (' + err.code + ')');
  }
  assertRefused(options('first'), binding, 'a vault that could not be resolved');
});

test('absolute network and device paths require a matching user choice without filesystem access', (t) => {
  const { binding, options } = projectVaults(t);
  const calls = [];
  const record = value => {
    calls.push(value);
    throw new Error('unexpected filesystem call');
  };
  const fs = { realpathSync: record, lstatSync: record, statSync: record };
  for (const [platform, p, vault] of [
    ['win32', win32, '\\\\some-host\\share\\vault'],
    ['win32', win32, '//some-host/share/vault'],
    ['win32', win32, '\\\\?\\C:\\vault'],
    ['win32', win32, '\\\\.\\device\\vault'],
    ['linux', posix, '//some-host/share/vault'],
  ]) {
    const overrides = { platform, fs };
    assertRefused(options(vault, overrides), binding);
    assert.deepEqual(resolveVault(options(vault, { ...overrides, env: { RESEARCH_VAULT_PATH: vault } })),
      { path: p.normalize(vault), source: 'project' });
  }
  assert.deepEqual(resolveVault(options('//some-host/share/dir/../vault', {
    platform: 'win32', fs, readConfig: () => '\\\\SOME-HOST\\SHARE\\VAULT',
  })), { path: '\\\\SOME-HOST\\SHARE\\VAULT', source: 'project' });
  assert.deepEqual(resolveVault(options('//HOST/Share/Vault', {
    platform: 'win32', fs, env: { RESEARCH_VAULT_PATH: '//host/share/vault' },
  })), { path: '\\\\host\\share\\vault', source: 'project' });
  assert.deepEqual(resolveVault(options('//some-host/share/research-vault', {
    platform: 'win32', fs, env: { LOCALAPPDATA: '\\\\some-host\\share' },
  })), { path: '\\\\some-host\\share\\research-vault', source: 'project' });
  assertRefused(options('//some-host/share/vault', {
    platform: 'linux', fs, env: { RESEARCH_VAULT_PATH: '/SOME-HOST/share/vault' },
  }), binding);
  assert.deepEqual(calls, []);
});

test('a relative project vault resolving outside through a directory link is refused', (t) => {
  const { cwd, vault, binding, options } = projectVaults(t);
  try {
    symlinkSync(vault, join(cwd, 'research'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    t.skip(`cannot create directory link (${err.code})`);
    return;
  }
  assertRefused(options('research'), binding, 'a vault that could not be resolved');
  assert.deepEqual(resolveVault(options('research', { env: { RESEARCH_VAULT_PATH: vault } })),
    { path: join(cwd, 'research'), source: 'project' });
});

test('absolute and relative project vault spellings inside the repository are used', (t) => {
  const { cwd, options } = projectVaults(t);
  const vault = join(cwd, 'research');
  const relative = ['docs', '..', 'research'].join(sep);
  for (const exists of [false, true]) {
    if (exists) mkdirSync(vault);
    for (const spelling of [vault, relative]) {
      assert.deepEqual(resolveVault(options(spelling)), { path: vault, source: 'project' });
    }
  }
});

test('an absolute outside project vault matching the environment is used', (t) => {
  const { vault, options } = projectVaults(t);
  assert.deepEqual(resolveVault(options(vault, { env: { RESEARCH_VAULT_PATH: vault } })),
    { path: vault, source: 'project' });
});

test('an absolute outside project vault matching the user config is used', (t) => {
  const { vault, cwd, options } = projectVaults(t);
  assert.deepEqual(resolveVault(options(vault, {
    env: { RESEARCH_VAULT_PATH: cwd }, readConfig: () => vault,
  })), { path: vault, source: 'project' });
});

test('an absolute outside project vault matching the OS default is used', (t) => {
  const { root, cwd, options } = projectVaults(t);
  const ctx = { platform: process.platform, home: root, env: { RESEARCH_VAULT_PATH: cwd } };
  const vault = defaultVaultPath(ctx);
  mkdirSync(vault, { recursive: true });
  assert.deepEqual(resolveVault(options(vault, { ...ctx, readConfig: () => cwd })),
    { path: vault, source: 'project' });
});

test('an outside project vault with a trailing separator in the user choice is used', (t) => {
  const { vault, options } = projectVaults(t);
  assert.deepEqual(resolveVault(options(vault, { env: { RESEARCH_VAULT_PATH: vault + sep } })),
    { path: vault, source: 'project' });
});

test('an outside project vault with different letter case on a case-insensitive filesystem is used', (t) => {
  const { root, vault, options } = projectVaults(t);
  const differentlyCased = join(root, 'outsidevault');
  if (!existsSync(differentlyCased)) {
    t.skip('temporary filesystem is case-sensitive');
    return;
  }
  assert.deepEqual(resolveVault(options(vault, { env: { RESEARCH_VAULT_PATH: differentlyCased } })),
    { path: vault, source: 'project' });
});

test('a project vault with a parent segment pointing to an unchosen outside directory is refused', (t) => {
  const { binding, options } = projectVaults(t);
  assertRefused(options(`..${sep}OutsideVault`), binding);
});

test('an unchosen absolute outside project vault is refused', (t) => {
  const { root, binding, cwd, vault, options } = projectVaults(t);
  assertRefused(options(vault, { env: { RESEARCH_VAULT_PATH: cwd }, readConfig: () => root }), binding);
});

test('a missing outside project vault that is one of the user choices is used', (t) => {
  const { root, options } = projectVaults(t);
  const missing = join(root, 'missing', 'vault');
  const defaultPath = defaultVaultPath({ platform: process.platform, home: root, env: {} });
  for (const [vault, overrides] of [
    [missing, { env: { RESEARCH_VAULT_PATH: missing } }],
    [missing, { readConfig: () => missing }],
    [defaultPath, {}],
  ]) {
    assert.equal(existsSync(vault), false);
    assert.deepEqual(resolveVault(options(vault, overrides)), { path: vault, source: 'project' });
  }
});

test('a missing outside project vault that is none of the user choices is refused', (t) => {
  const { root, binding, options } = projectVaults(t);
  assertRefused(options(join(root, 'missing', 'vault')), binding);
});

test('an unresolvable user choice is refused without advising the user to set it again', (t) => {
  const { root, binding, options } = projectVaults(t);
  const prefix = join(root, 'file');
  writeFileSync(prefix, '');
  const missing = join(prefix, 'vault');
  for (const overrides of [
    { env: { RESEARCH_VAULT_PATH: missing + sep } },
    { readConfig: () => missing },
  ]) {
    assertRefused(options(missing, overrides), binding, 'a vault that could not be resolved', 'Pass --vault to the command.');
  }
});

test('an unknown user location gives an unresolvable refusal for an outside project vault', (t) => {
  const { root, vault, binding, options } = projectVaults(t);
  const unknown = join(root, 'unknown');
  const fs = {
    realpathSync(value) {
      if (value === unknown) throw Object.assign(new Error('access denied'), { code: 'EACCES' });
      return value;
    },
  };
  assertRefused(options(vault, { fs, readConfig: () => unknown }), binding, 'a vault that could not be resolved');
});

test('refusing a known outside project vault makes no resolution probe for the message', (t) => {
  const { root, vault, binding, options } = projectVaults(t);
  const calls = [];
  const fs = { realpathSync(value) { calls.push(value); return value; } };
  assertRefused(options(vault, { fs }), binding);
  const defaultPath = defaultVaultPath({ platform: process.platform, home: root, env: {} });
  assert.deepEqual(calls, [dirname(binding), vault, defaultPath, vault]);
});

test('an explicit flag wins over a refused project vault', (t) => {
  const { vault, cwd, options } = projectVaults(t);
  assert.deepEqual(resolveVault(options(vault, { flag: cwd })), { path: cwd, source: 'flag' });
});
