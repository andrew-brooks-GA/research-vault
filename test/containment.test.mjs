import { test } from 'node:test';
import assert from 'node:assert/strict';
import { win32, posix } from 'node:path';
import { isInsideVault } from '../bin/lib/containment.mjs';

test('nested child is inside (win32 + posix)', () => {
  assert.equal(isInsideVault('C:\\Users\\me\\vault', 'C:\\Users\\me\\vault\\sources\\a.md', win32), true);
  assert.equal(isInsideVault('/home/me/vault', '/home/me/vault/sources/a.md', posix), true);
});

test('vault path itself is inside', () => {
  assert.equal(isInsideVault('C:\\Users\\me\\vault', 'C:\\Users\\me\\vault', win32), true);
  assert.equal(isInsideVault('/home/me/vault', '/home/me/vault', posix), true);
});

test('sibling <parent>-evil is NOT inside (startsWith regression)', () => {
  assert.equal(isInsideVault('C:\\Users\\me\\vault', 'C:\\Users\\me\\vault-evil\\x.md', win32), false);
  assert.equal(isInsideVault('/home/me/vault', '/home/me/vault-evil/x.md', posix), false);
});

test('literal ..foo segment under parent is inside', () => {
  assert.equal(isInsideVault('C:\\Users\\me\\vault', win32.join('C:\\Users\\me\\vault', '..foo', 'x.md'), win32), true);
  assert.equal(isInsideVault('/home/me/vault', posix.join('/home/me/vault', '..foo', 'x.md'), posix), true);
});

test('empty/missing child is not inside', () => {
  assert.equal(isInsideVault('C:\\Users\\me\\vault', '', win32), false);
  assert.equal(isInsideVault('/home/me/vault', undefined, posix), false);
});

test('upward escape is not inside', () => {
  assert.equal(isInsideVault('C:\\Users\\me\\vault', 'C:\\Users\\me\\vault\\..\\other\\x.md', win32), false);
  assert.equal(isInsideVault('/home/me/vault', '/home/me/vault/../other/x.md', posix), false);
  // win32 cross-drive: path.win32.relative returns an absolute D:\... path, so the
  // !p.isAbsolute(rel) guard must reject a child on a different drive.
  assert.equal(isInsideVault('C:\\Users\\me\\vault', 'D:\\Users\\me\\vault\\x.md', win32), false);
});
