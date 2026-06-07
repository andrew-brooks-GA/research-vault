import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultVaultPath, configPath, resolveVault } from '../bin/lib/resolve.mjs';

test('linux default uses XDG_DATA_HOME then ~/.local/share', () => {
  assert.equal(defaultVaultPath({ platform: 'linux', home: '/home/u', env: { XDG_DATA_HOME: '/x' } }), '/x/research-vault');
  assert.equal(defaultVaultPath({ platform: 'linux', home: '/home/u', env: {} }), '/home/u/.local/share/research-vault');
});
test('mac and windows defaults', () => {
  assert.equal(defaultVaultPath({ platform: 'darwin', home: '/Users/u', env: {} }), '/Users/u/Library/Application Support/research-vault');
  assert.equal(defaultVaultPath({ platform: 'win32', home: 'C:\\Users\\u', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } }), 'C:\\Users\\u\\AppData\\Local\\research-vault');
});
test('resolution order: flag > project > env > config > default', () => {
  const base = { platform: 'linux', home: '/home/u', readConfig: () => null, readProjectConfig: () => null };
  // flag beats everything
  assert.deepEqual(resolveVault({ ...base, flag: '/explicit', env: { RESEARCH_VAULT_PATH: '/fromenv' }, readProjectConfig: () => ({ vault: '/fromproject' }) }),
    { path: '/explicit', source: 'flag' });
  // project file beats env
  assert.deepEqual(resolveVault({ ...base, flag: null, env: { RESEARCH_VAULT_PATH: '/fromenv' }, readProjectConfig: () => ({ vault: '/fromproject' }) }),
    { path: '/fromproject', source: 'project' });
  // a project file WITHOUT a vault key does not win; env still applies
  assert.deepEqual(resolveVault({ ...base, flag: null, env: { RESEARCH_VAULT_PATH: '/fromenv' }, readProjectConfig: () => ({ defaults: { domain: 'learning' } }) }),
    { path: '/fromenv', source: 'env' });
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
    writeFileSync(join(dir, '.research-vault.json'), '{"vault":"/discovered","defaults":{"domain":"learning"}}');
    assert.deepEqual(
      resolveVault({ cwd: dir, env: {}, readConfig: () => null }),
      { path: '/discovered', source: 'project' },
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
