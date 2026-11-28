import { test } from 'node:test';
import assert from 'node:assert/strict';
import { win32, posix } from 'node:path';
import path from 'node:path';
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync, writeFileSync, existsSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVaultLocations, isInsideVault, mayBeInside } from '../bin/lib/containment.mjs';

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

test('native resolution checks both paths and refuses a child resolved outside', () => {
  const fs = { realpathSync: (p) => p };
  fs.realpathSync.native = (p) => ({
    '/repo': '/resolved/repo',
    '/repo/inside': '/resolved/repo/versions.txt',
    '/repo/outside': '/resolved/versions.txt',
  })[p];
  assert.equal(isInsideVault('/repo', '/repo/inside', posix, fs), true);
  assert.equal(isInsideVault('/repo', '/repo/outside', posix, fs), false);
});

test('resolution without a native method uses the longest existing prefix', () => {
  const fs = {
    realpathSync(p) {
      if (p === '/repo') return '/resolved/repo';
      if (p === '/repo/versions.txt') return '/resolved/versions.txt';
      const code = p.startsWith('/repo/versions.txt/') ? 'ENOTDIR' : 'ENOENT';
      throw Object.assign(new Error(code), { code });
    },
  };
  assert.equal(isInsideVault('/repo', '/repo/missing/child', posix, fs), true);
  assert.equal(isInsideVault('/repo', '/repo/versions.txt/child', posix, fs), false);
});

test('an overlong tail follows its resolved parent for containment', () => {
  const fs = { realpathSync: (p) => p };
  fs.realpathSync.native = (p) => {
    if (p === '/repo') return '/resolved/repo';
    if (p === '/repo/inside') return '/resolved/repo/inside';
    if (p === '/repo/outside') return '/resolved/outside';
    throw Object.assign(new Error('ENAMETOOLONG'), { code: 'ENAMETOOLONG' });
  };
  assert.equal(isInsideVault('/repo', '/repo/inside/child', posix, fs), true);
  assert.equal(isInsideVault('/repo', '/repo/outside/child', posix, fs), false);
});

test('a child path longer than the filesystem limit is contained', () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  const limit = process.platform === 'win32' ? 32767 : 4096;
  const segment = 'd'.repeat(200);
  const child = join(vault, ...Array(Math.ceil(limit / segment.length)).fill(segment));
  assert.equal(isInsideVault(vault, child), true);
});

test('resolution errors other than missing path components refuse containment', () => {
  for (const code of ['ELOOP', 'EACCES']) {
    for (const failing of ['/repo', '/repo/child']) {
      const fs = {
        realpathSync(p) {
          if (p === failing) throw Object.assign(new Error(code), { code });
          return p;
        },
      };
      assert.equal(isInsideVault('/repo', '/repo/child', posix, fs), false, code + ' at ' + failing);
    }
  }
});

test('a file link with a parent traversal after a directory link is refused', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  const repo = join(root, 'repo');
  const outside = join(root, 'outside');
  mkdirSync(repo);
  mkdirSync(join(outside, 'deep'), { recursive: true });
  writeFileSync(join(repo, 'x'), 'inside\n');
  writeFileSync(join(outside, 'x'), 'outside\n');
  const file = join(repo, 'ver');
  try {
    symlinkSync('../outside/deep', join(repo, 'd'), 'dir');
    symlinkSync('d/../x', file, 'file');
  } catch (err) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(err.code)) {
      return t.skip('cannot create links (' + err.code + ')');
    }
    throw err;
  }
  if (process.platform === 'win32' && realpathSync.native(file) === realpathSync.native(join(repo, 'x'))) {
    return t.skip('Windows resolves this link to the file inside the repository');
  }
  assert.equal(isInsideVault(repo, file), false);
});

test('a file link through a directory link inside the vault is accepted', (t) => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  const versions = join(vault, 'versions');
  mkdirSync(versions);
  writeFileSync(join(versions, 'versions.txt'), 'dep 1.0.0\n');
  const file = join(vault, 'current');
  try {
    symlinkSync(versions, join(vault, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(join('alias', 'versions.txt'), file, 'file');
  } catch (err) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(err.code)) {
      return t.skip('cannot create links (' + err.code + ')');
    }
    throw err;
  }
  assert.equal(isInsideVault(vault, file), true);
});

test('a link loop is refused', (t) => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  const a = join(vault, 'a');
  try {
    symlinkSync('b', a, 'file');
    symlinkSync('a', join(vault, 'b'), 'file');
  } catch (err) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(err.code)) {
      return t.skip('cannot create file links (' + err.code + ')');
    }
    throw err;
  }
  assert.equal(isInsideVault(vault, a), false);
  assert.equal(mayBeInside(vault, a), true);
});

for (const location of ['outside', 'inside']) {
  test(`a dangling file link to a target ${location} the vault is refused`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'rv-contain-'));
    const vault = join(root, 'vault');
    mkdirSync(vault);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const target = join(location === 'inside' ? vault : outside, 'missing.txt');
    const link = join(vault, 'pending');
    try {
      symlinkSync(target, link, 'file');
    } catch (err) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(err.code)) {
        return t.skip('cannot create file links (' + err.code + ')');
      }
      throw err;
    }
    // Linux, macOS, and Windows native resolution require the file target to
    // exist. The link entry exists, so containment is unknown on each platform.
    assert.throws(() => realpathSync.native(link));
    assert.equal(isInsideVault(vault, link), false);
    assert.equal(mayBeInside(vault, link), true);
  });
}

test('missing children under existing and missing directories are contained', () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  for (const child of [join(vault, 'missing.txt'), join(vault, 'missing', 'child.txt')]) {
    assert.equal(isInsideVault(vault, child), true);
    assert.equal(mayBeInside(vault, child), true);
  }
});

test('an existing entry whose resolution fails leaves containment unknown', () => {
  for (const code of ['ENAMETOOLONG', 'EACCES', 'ELOOP']) {
    for (const failing of ['/repo', '/repo/child']) {
      const fs = {
        realpathSync(p) {
          if (p === failing) throw Object.assign(new Error(code), { code });
          return p;
        },
        lstatSync() { return {}; },
      };
      assert.equal(isInsideVault('/repo', '/repo/child', posix, fs), false, code + ' at ' + failing);
      assert.equal(mayBeInside('/repo', '/repo/child', posix, fs), true, code + ' at ' + failing);
    }
  }
});

test('an overlong entry path reported by both operations uses its resolved parent', () => {
  const fs = {
    realpathSync(p) {
      if (p === '/repo') return '/resolved/repo';
      throw Object.assign(new Error('ENAMETOOLONG'), { code: 'ENAMETOOLONG' });
    },
    lstatSync() { throw Object.assign(new Error('ENAMETOOLONG'), { code: 'ENAMETOOLONG' }); },
  };
  assert.equal(isInsideVault('/repo', '/repo/child', posix, fs), true);
  assert.equal(mayBeInside('/repo', '/repo/child', posix, fs), true);
});

test('an entry that cannot be inspected leaves containment unknown', () => {
  const fs = {
    realpathSync(p) {
      if (p === '/repo') return p;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    lstatSync() { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
  };
  assert.equal(isInsideVault('/repo', '/repo/child', posix, fs), false);
  assert.equal(mayBeInside('/repo', '/repo/child', posix, fs), true);
});

test('native resolution uses the on-disk spelling on a case-insensitive directory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  const parent = join(root, 'MixedCase');
  const otherName = join(root, 'mixedcase');
  mkdirSync(parent);
  try {
    mkdirSync(otherName);
    return t.skip('temp directory allows distinct names that differ only in case');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const child = join(parent, 'child');
  mkdirSync(child);
  const canonical = realpathSync.native(otherName);
  t.diagnostic(`canonical ${otherName} => ${canonical}`);
  assert.equal(path.basename(canonical), 'MixedCase');
  assert.equal(canonical, realpathSync.native(parent));
  assert.equal(isInsideVault(otherName, child), true);
});

test('resolved Windows paths that differ in case are outside each other', () => {
  const fs = { realpathSync: (p) => p };
  const parent = 'C:\\Resolved\\Vault';
  const child = 'C:\\Resolved\\vault';
  assert.equal(isInsideVault(parent, child, win32, fs), false);
  assert.equal(isInsideVault(child, parent, win32, fs), false);
  assert.equal(mayBeInside(parent, child, win32, fs), true);
});

test('a differently cased missing parent may contain a destination on disk', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  if (process.platform !== 'win32') {
    mkdirSync(join(root, 'CaseProbe'));
    if (!existsSync(join(root, 'caseprobe'))) return t.skip('temp directory is case-sensitive outside Windows');
  }
  // On non-Windows, use Windows lexical comparison with native filesystem paths.
  const p = process.platform === 'win32' ? path : {
    ...path,
    relative: (from, to) => win32.relative(from, to).replaceAll(win32.sep, path.sep),
  };
  const fs = { realpathSync, lstatSync };
  const parent = join(root, 'assets');
  const child = join(root, 'Assets', 'x');
  assert.equal(mayBeInside(parent, child, p, fs), true);
  assert.equal(isInsideVault(parent, child), false);
});

test('win32 lexical comparison includes a differently cased missing parent', () => {
  const root = 'C:\\Workspace';
  const fs = {
    realpathSync(p) {
      if (p === root) return root;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  };
  const parent = win32.join(root, 'assets');
  const child = win32.join(root, 'Assets', 'x');
  assert.equal(mayBeInside(parent, child, win32, fs), true);
  assert.equal(isInsideVault(parent, child, win32, fs), false);
});

test('distinct on-disk sibling directories with different casing are outside each other', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-contain-'));
  const parent = join(root, 'MixedCase');
  const sibling = join(root, 'mixedcase');
  mkdirSync(parent);
  try {
    mkdirSync(sibling);
  } catch (err) {
    if (err.code === 'EEXIST') return t.skip('temp directory is case-insensitive');
    throw err;
  }
  assert.equal(isInsideVault(parent, sibling), false);
  assert.equal(isInsideVault(sibling, parent), false);
});

test('a filesystem root contains an existing child', () => {
  const child = realpathSync.native(tmpdir());
  const { root } = path.parse(child);
  assert.equal(isInsideVault(root, child), true);
});

test('vault location equality normalizes parent segments before following directory links', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-same-directory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = join(root, 'a');
  const b = join(root, 'b');
  const deep = join(b, 'deep');
  const link = join(a, 'link');
  mkdirSync(a);
  mkdirSync(deep, { recursive: true });
  try {
    symlinkSync(deep, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    return t.skip('cannot create directory link (' + err.code + ')');
  }
  const throughLink = link + path.sep + '..';
  assert.equal(compareVaultLocations(throughLink, a), true);
  assert.equal(compareVaultLocations(throughLink, b), false);
  assert.equal(compareVaultLocations(link, deep), true);
  assert.equal(compareVaultLocations(join(link, 'missing', 'vault'), join(deep, 'missing', 'vault')), true);
});

test('vault location equality passes normalized absolute paths to the filesystem', () => {
  for (const p of [posix, win32]) {
    const calls = [];
    const fs = {
      realpathSync(value) { calls.push(value); return value; },
      statSync() { return { isDirectory: () => true }; },
    };
    const relative = ['link', '..', 'vault'].join(p.sep);
    const absolute = p.resolve('vault');
    assert.equal(compareVaultLocations(relative, absolute, p, fs), true);
    assert.deepEqual(calls, [absolute, absolute]);
  }
});

test('vault location equality is unknown without statSync', () => {
  const fs = { realpathSync: value => value };
  assert.equal(compareVaultLocations('/vault', '/vault', posix, fs), null);
});

test('vault location equality accepts a trailing separator and refuses files and distinct directories', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-same-location-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, 'vault');
  const other = join(root, 'other');
  const file = join(root, 'file');
  mkdirSync(vault);
  mkdirSync(other);
  writeFileSync(file, '');
  assert.equal(compareVaultLocations(vault, vault + path.sep), true);
  assert.equal(compareVaultLocations(vault, other), false);
  assert.equal(compareVaultLocations(file, file), false);
});

test('vault location equality follows the filesystem for directory letter case', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rv-same-location-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, 'MixedCase');
  const otherCase = join(root, 'mixedcase');
  mkdirSync(vault);
  if (!existsSync(otherCase)) return t.skip('temporary filesystem is case-sensitive');
  assert.equal(compareVaultLocations(vault, otherCase), true);
});
