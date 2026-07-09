import { test } from 'node:test';
import assert from 'node:assert/strict';
import { win32, posix } from 'node:path';
import path from 'node:path';
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// Windows quirks: exercised on any OS via the injected win32 impl; the explicit
// `null` fs seam forces the lexical path (nodePath === win32 on real Windows).
test('win32 drive-letter comparison is case-insensitive', () => {
  assert.equal(isInsideVault('C:\\VAULT', 'c:\\vault\\sources\\a.md', win32, null), true);
  assert.equal(isInsideVault('c:\\vault', 'C:\\VAULT\\notes\\b.md', win32, null), true);
});

test('win32 tolerates mixed separators within a drive', () => {
  assert.equal(isInsideVault('C:\\Users\\me\\vault', 'C:/Users/me/vault/sources/a.md', win32, null), true);
  assert.equal(isInsideVault('C:/Users/me/vault', 'C:\\Users\\me\\vault\\x.md', win32, null), true);
});

test('win32 UNC child under a drive-letter parent is NOT inside', () => {
  assert.equal(
    isInsideVault('C:\\Users\\me\\vault', '\\\\server\\share\\vault\\x.md', win32, null),
    false,
  );
});

test('symlink escaping the boundary is resolved and rejected', { skip: process.platform === 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-contain-')));
  const vault = join(root, 'vault');
  const outside = join(root, 'outside');
  mkdirSync(vault);
  mkdirSync(outside);
  // A link inside the vault that points across the boundary must read as outside.
  const link = join(vault, 'leak');
  symlinkSync(outside, link, 'dir');
  assert.equal(isInsideVault(vault, join(link, 'x.md'), path), false);
  // A plain nested child (no symlink) stays inside.
  assert.equal(isInsideVault(vault, join(vault, 'sources', 'a.md'), path), true);
});
