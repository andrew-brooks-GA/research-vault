import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as writers from '../bin/lib/fsutil.ts';

function folder(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rv-atomic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function observe(t, method, fn) {
  t.mock.method(fs, method, fn);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test('R08 atomic replacement preserves the old hard-link inode and leaves no temporary file', t => {
  const dir = folder(t), path = join(dir, 'entry.md'), alias = join(dir, 'alias');
  fs.writeFileSync(path, 'old');
  try { fs.linkSync(path, alias); } catch (e) {
    if (['EPERM', 'ENOTSUP', 'EACCES'].includes(e.code)) return t.skip('hard links unavailable');
    throw e;
  }
  writers.writeAtomic(path, 'new');
  assert.equal(fs.readFileSync(path, 'utf8'), 'new');
  assert.equal(fs.readFileSync(alias, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['alias', 'entry.md']);
});

test('R08 failed publication rethrows and cleans its temporary file', t => {
  const dir = folder(t), path = join(dir, 'destination');
  fs.mkdirSync(path);
  fs.writeFileSync(join(path, 'keep'), 'unchanged');
  assert.throws(() => writers.writeAtomic(path, 'new'), e => ['EISDIR', 'EPERM', 'EACCES'].includes(e.code));
  assert.deepEqual(fs.readdirSync(dir), ['destination']);
  assert.deepEqual(fs.readdirSync(path), ['keep']);
  assert.equal(fs.readFileSync(join(path, 'keep'), 'utf8'), 'unchanged');
});

test('R08 exclusive publication refuses an existing destination without changing bytes', t => {
  const dir = folder(t), path = join(dir, 'entry.md');
  fs.writeFileSync(path, 'first capture');
  assert.throws(() => writers.writeAtomic(path, 'second capture', { exclusive: true }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(path, 'utf8'), 'first capture');
  assert.deepEqual(fs.readdirSync(dir), ['entry.md']);
});

test('R08 exclusive publication refuses a dangling link without creating its target', t => {
  const dir = folder(t), path = join(dir, 'entry.md'), target = join(dir, 'absent');
  // The link appears after containment checks, immediately before the publication syscall.
  for (const method of ['linkSync', 'renameSync']) {
    const publish = fs[method];
    observe(t, method, (from, to) => {
      fs.symlinkSync(target, path);
      return publish(from, to);
    });
  }
  assert.throws(() => writers.writeAtomic(path, 'new', { exclusive: true }), { code: 'EEXIST' });
  assert.equal(fs.readlinkSync(path), target);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(fs.readdirSync(dir), ['entry.md']);
});

test('R08 temporary names differ and old fixed names are untouched', t => {
  const dir = folder(t), path = join(dir, 'entry.md'), names = [];
  const rename = fs.renameSync;
  observe(t, 'renameSync', (from, to) => { names.push(from); return rename(from, to); });
  fs.writeFileSync(path + '.tmp', 'sentinel');
  writers.writeAtomic(path, 'one');
  writers.writeAtomic(path, 'two');
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1]);
  for (const name of names) assert.match(name, /\.rv-atomic-[0-9a-f-]{36}\.tmp$/);
  assert.equal(fs.readFileSync(path + '.tmp', 'utf8'), 'sentinel');
  assert.equal(fs.readFileSync(path, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['entry.md', 'entry.md.tmp']);
});

test('R08 writeEntry leaves the old fixed temporary name untouched', t => {
  const dir = folder(t), path = join(dir, 'entry.md');
  fs.writeFileSync(path + '.tmp', 'sentinel');
  writers.writeEntry(path, { title: 'New' }, '# New\n', ['title'], dir);
  assert.equal(fs.readFileSync(path, 'utf8'), '---\ntitle: New\n---\n# New\n');
  assert.equal(fs.readFileSync(path + '.tmp', 'utf8'), 'sentinel');
});

for (const code of ['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS']) {
  test('R08 round2 copy fallback publishes without hard links: ' + code, t => {
    const dir = folder(t), path = join(dir, 'entry.md');
    observe(t, 'linkSync', () => { throw Object.assign(new Error(code), { code }); });
    writers.writeAtomic(path, 'new', { exclusive: true });
    assert.equal(fs.readFileSync(path, 'utf8'), 'new');
    assert.deepEqual(fs.readdirSync(dir), ['entry.md']);
  });
  test('R08 round2 copy fallback refuses existing bytes: ' + code, t => {
    const dir = folder(t), path = join(dir, 'entry.md');
    fs.writeFileSync(path, 'old');
    observe(t, 'linkSync', () => { throw Object.assign(new Error(code), { code }); });
    assert.throws(() => writers.writeAtomic(path, 'new', { exclusive: true }), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(path, 'utf8'), 'old');
    assert.deepEqual(fs.readdirSync(dir), ['entry.md']);
  });
}
test('R08 round2 other link errors do not attempt a copy', t => {
  const dir = folder(t), path = join(dir, 'entry.md');
  let code, copies = 0;
  observe(t, 'linkSync', () => { throw Object.assign(new Error(code), { code }); });
  observe(t, 'copyFileSync', () => { copies++; });
  for (code of ['EEXIST', 'EACCES']) {
    assert.throws(() => writers.writeAtomic(path, 'new', { exclusive: true }), { code });
    assert.equal(copies, 0);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
});
test('R08 round2 writeEntry preserves existing permissions', t => {
  if (process.platform === 'win32') return t.skip('POSIX permission bits unavailable on Windows');
  const dir = folder(t), path = join(dir, 'entry.md');
  for (const mode of [0o600, 0o755]) {
    fs.writeFileSync(path, 'old'); fs.chmodSync(path, mode);
    writers.writeEntry(path, { title: 'New' }, '# New\n', ['title'], dir);
    assert.equal(fs.statSync(path).mode & 0o777, mode);
  }
});

test('checkFrontmatter refuses an omitted key whose expected value is undefined', t => {
  const dir = folder(t), path = join(dir, 'entry.md');
  fs.writeFileSync(path, 'old');
  assert.throws(() => writers.checkFrontmatter(path, { title: 'Kept', extra: undefined }, '---\ntitle: Kept\n---\n'), e => {
    assert.equal(e.message.slice(e.message.lastIndexOf(' at ')), ' at "extra": value does not round-trip');
    return true;
  });
  assert.equal(fs.readFileSync(path, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir), ['entry.md']);
});

test('checkFrontmatter refuses a map that round-trips as a boolean', t => {
  const dir = folder(t), path = join(dir, 'entry.md');
  fs.writeFileSync(path, 'old');
  assert.throws(() => writers.checkFrontmatter(path, { subject: {} }, '---\nsubject: false\n---\n'), {
    message: / at "subject": value does not round-trip$/,
  });
  assert.equal(fs.readFileSync(path, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir), ['entry.md']);
});
