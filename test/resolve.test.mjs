import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultVaultPath, configPath, resolveVault } from '../bin/lib/resolve.mjs';

test('linux default uses XDG_DATA_HOME then ~/.local/share', () => {
  assert.equal(defaultVaultPath({ platform: 'linux', home: '/home/u', env: { XDG_DATA_HOME: '/x' } }), '/x/research-vault');
  assert.equal(defaultVaultPath({ platform: 'linux', home: '/home/u', env: {} }), '/home/u/.local/share/research-vault');
});
test('mac and windows defaults', () => {
  assert.equal(defaultVaultPath({ platform: 'darwin', home: '/Users/u', env: {} }), '/Users/u/Library/Application Support/research-vault');
  assert.equal(defaultVaultPath({ platform: 'win32', home: 'C:\\Users\\u', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' } }), 'C:\\Users\\u\\AppData\\Local\\research-vault');
});
test('resolution order: flag > env > config > default', () => {
  assert.deepEqual(resolveVault({ flag: '/explicit', env: { RESEARCH_VAULT_PATH: '/fromenv' }, platform: 'linux', home: '/home/u', readConfig: () => null }),
    { path: '/explicit', source: 'flag' });
  assert.deepEqual(resolveVault({ flag: null, env: { RESEARCH_VAULT_PATH: '/fromenv' }, platform: 'linux', home: '/home/u', readConfig: () => null }),
    { path: '/fromenv', source: 'env' });
  assert.deepEqual(resolveVault({ flag: null, env: {}, platform: 'linux', home: '/home/u', readConfig: () => '/fromcfg' }),
    { path: '/fromcfg', source: 'config' });
  assert.deepEqual(resolveVault({ flag: null, env: {}, platform: 'linux', home: '/home/u', readConfig: () => null }),
    { path: '/home/u/.local/share/research-vault', source: 'default' });
});
