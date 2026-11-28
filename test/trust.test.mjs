import { PassThrough } from 'node:stream';
import fs, { chmodSync, linkSync, statSync } from 'node:fs';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, realpathSync, symlinkSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { testEnv } from './helpers.mjs';
import { configPath, resolveVault } from '../bin/lib/resolve.mjs';
import { trustedBindingsPath, isBindingAcknowledged, acknowledgeBinding, revokeBinding } from '../bin/lib/trust.mjs';
import { run } from '../bin/commands/trust.mjs';

const DISPLAY_WIDTH = 76;
const NOW = new Date('2026-01-02T03:04:05.006Z');
const CLI = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-trust-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  mkdirSync(home); mkdirSync(repo);
  const env = testEnv({ HOME: home, USERPROFILE: home, APPDATA: home, XDG_CONFIG_HOME: home });
  const options = { platform: process.platform, home, env, now: NOW };
  const folder = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'research-vault') : join(home, 'research-vault');
  mkdirSync(folder, { recursive: true });
  const record = join(folder, 'trusted-bindings.json');
  const binding = join(repo, '.research-vault.json');
  writeFileSync(binding, '{"vault":"research"}');
  const cli = (...flags) => spawnSync(process.execPath, [CLI, 'trust', ...flags, repo], { cwd: root, env: testEnv(env), encoding: 'utf8', timeout: 20000 });
  return { root, home, repo, env, options, folder, record, binding, cli };
}
function link(t, target, name, type) {
  try { symlinkSync(target, name, type); return true; }
  catch (e) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) { t.skip(`links unavailable: ${e.code}`); return false; } throw e; }
}

test('non-terminal acknowledgement refuses without changing config names or existing bytes', t => {
  const f = fixture(t), names = readdirSync(f.folder);
  assert.equal(f.cli().status, 2);
  assert.equal(existsSync(f.record), false);
  assert.deepEqual(readdirSync(f.folder), names);
  writeFileSync(f.record, 'existing record');
  const before = readFileSync(f.record);
  assert.equal(f.cli().status, 2);
  assert.deepEqual(readFileSync(f.record), before);
  assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
});

test('--yes records the resolved path and independently computed byte hash', t => {
  const f = fixture(t);
  const r = f.cli('--yes'); assert.equal(r.status, 0, r.stderr);
  const record = JSON.parse(readFileSync(f.record));
  assert.equal(record.version, 1);
  assert.equal(record.bindings.length, 1);
  assert.equal(record.bindings[0].path, realpathSync(f.binding));
  assert.equal(record.bindings[0].sha256, createHash('sha256').update(readFileSync(f.binding)).digest('hex'));
  assert.ok(Number.isFinite(Date.parse(record.bindings[0].date)));
  assert.equal(isBindingAcknowledged(f.binding, f.options), true);
});

test('acknowledgeBinding records the supplied timestamp', t => {
  const f = fixture(t);
  acknowledgeBinding(f.binding, f.options);
  assert.equal(JSON.parse(readFileSync(f.record)).bindings[0].date, '2026-01-02T03:04:05.006Z');
});

test('acknowledgeBinding refuses a missing time without creating the record', t => {
  const f = fixture(t);
  const names = readdirSync(f.folder);
  assert.throws(() => acknowledgeBinding(f.binding, { home: f.home, env: f.env }), {
    name: 'Error', message: 'acknowledgeBinding: now must be a Date',
  });
  assert.equal(existsSync(f.record), false);
  assert.deepEqual(readdirSync(f.folder), names);
});

test('trust records its start time even when confirmation takes time', async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const before = Date.now();
  const status = await run({ _: ['trust', f.repo] }, {
    ...f.options, stdin: { isTTY: true }, stdout: { write() {} }, ask: async () => {
      t.mock.timers.tick(1000);
      return 'yes';
    },
  });
  const after = Date.now();
  assert.equal(status, 0);
  const time = Date.parse(JSON.parse(readFileSync(f.record)).bindings[0].date);
  assert.ok(before <= time && time <= after);
  assert.equal(time, before);
});

test('changed bytes lose acknowledgement', t => {
  const f = fixture(t); acknowledgeBinding(f.binding, f.options);
  writeFileSync(f.binding, '{"vault":"researcH"}');
  assert.equal(isBindingAcknowledged(f.binding, f.options), false);
});

test('reacknowledgement replaces the row', t => {
  const f = fixture(t); acknowledgeBinding(f.binding, f.options);
  writeFileSync(f.binding, '{"vault":"changed"}');
  assert.equal(f.cli('--yes').status, 0);
  assert.equal(isBindingAcknowledged(f.binding, f.options), true);
  assert.equal(JSON.parse(readFileSync(f.record)).bindings.length, 1);
});

test('terminal confirmation writes only for y or yes regardless of case', async t => {
  const f = fixture(t);
  for (const answer of ['n', '', undefined, 'yesterday', 'y-not', 'yes please', 'YES', 'y', 'yes', 'Y', 'Yes']) {
    rmSync(f.record, { force: true });
    let asked = 0;
    const status = await run({ _: ['trust', f.repo] }, { ...f.options, stdin: { isTTY: true }, stdout: { write() {} }, ask: async () => { asked++; return answer; } });
    const accepted = ['YES', 'y', 'yes', 'Y', 'Yes'].includes(answer);
    assert.equal(asked, 1); assert.equal(status, accepted ? 0 : 1);
    assert.equal(existsSync(f.record), accepted);
    assert.deepEqual(readdirSync(f.folder), accepted ? ['trusted-bindings.json'] : []);
  }
});

test('--show reports current acknowledgement without writing', t => {
  const f = fixture(t);
  const r = f.cli('--show'); assert.equal(r.status, 0); assert.match(r.stdout, /Acknowledged: no/);
  assert.deepEqual(readdirSync(f.folder), []);
  acknowledgeBinding(f.binding, f.options);
  const before = readFileSync(f.record), names = readdirSync(f.folder);
  assert.match(f.cli('--show').stdout, /Acknowledged: yes/);
  assert.deepEqual(readFileSync(f.record), before);
  assert.deepEqual(readdirSync(f.folder), names);
});

test('--revoke preserves another row', t => {
  const f = fixture(t), other = join(f.repo, 'other.json');
  writeFileSync(other, '{}'); acknowledgeBinding(other, f.options); acknowledgeBinding(f.binding, f.options);
  const before = JSON.parse(readFileSync(f.record)).bindings[0];
  const r = f.cli('--revoke'); assert.equal(r.status, 0); assert.match(r.stdout, /Acknowledgement revoked/);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings, [before]);
  assert.equal(isBindingAcknowledged(f.binding, f.options), false);
  assert.match(f.cli('--revoke').stdout, /No acknowledgement to revoke/);
});

for (const layout of ['file', 'folder']) test(`acknowledgement refuses a linked record ${layout} without outside changes`, t => {
  const f = fixture(t), outside = join(f.root, 'outside'); mkdirSync(outside);
  const target = join(outside, 'trusted-bindings.json'); writeFileSync(target, 'outside bytes');
  if (layout === 'folder') rmSync(f.folder, { recursive: true });
  if (!link(t, layout === 'file' ? target : outside, layout === 'file' ? f.record : f.folder, layout === 'file' ? 'file' : 'dir')) return;
  const names = readdirSync(outside), bytes = readFileSync(target);
  assert.equal(f.cli('--yes').status, 2);
  assert.deepEqual(readFileSync(target), bytes); assert.deepEqual(readdirSync(outside), names);
  assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
});

test('explicit acknowledgement replaces malformed records', t => {
  const f = fixture(t);
  for (const content of ['not json', '{"version":2,"bindings":[]}', JSON.stringify({ version: 1, bindings: [{ path: f.binding, date: '2026-01-01' }] })]) {
    writeFileSync(f.record, content);
    assert.equal(isBindingAcknowledged(f.binding, f.options), false);
    assert.equal(f.cli('--yes').status, 0);
    assert.equal(isBindingAcknowledged(f.binding, f.options), true);
    assert.equal(JSON.parse(readFileSync(f.record)).bindings.length, 1);
  }
});

test('linked binding directories share the resolved acknowledgement identity', t => {
  const f = fixture(t), alias = join(f.root, 'alias');
  if (!link(t, f.repo, alias, 'dir')) return;
  const linked = join(alias, '.research-vault.json');
  acknowledgeBinding(linked, f.options);
  assert.equal(isBindingAcknowledged(f.binding, f.options), true);
  assert.equal(JSON.parse(readFileSync(f.record)).bindings[0].path, f.binding);
  rmSync(f.record); acknowledgeBinding(f.binding, f.options);
  assert.equal(isBindingAcknowledged(linked, f.options), true);
});

test('invalid bindings return 2 and leave config untouched', t => {
  const f = fixture(t);
  const keep = join(f.root, 'keep.json'); writeFileSync(keep, '{}'); acknowledgeBinding(keep, f.options);
  const recordBefore = readFileSync(f.record);
  for (const raw of ['{"vault":42}', '{']) {
    writeFileSync(f.binding, raw);
    const r = f.cli('--yes'); assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, /invalid/);
    assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
  assert.deepEqual(readFileSync(f.record), recordBefore);
  }
});

test('missing bindings return 1 without creating config entries', t => {
  const f = fixture(t); rmSync(f.binding);
  const r = f.cli('--yes'); assert.equal(r.status, 1); assert.equal(r.stdout, 'No binding found.\n');
  assert.deepEqual(readdirSync(f.folder), []);
});

test('config pointer and trust record use the injected platform locations', () => {
  for (const [platform, home, env, pointer, record] of [
    ['win32', 'C:\\Users\\test', { APPDATA: 'D:\\Config' }, 'D:\\Config\\research-vault\\config.json', 'D:\\Config\\research-vault\\trusted-bindings.json'],
    ['win32', 'C:\\Users\\test', {}, 'C:\\Users\\test\\AppData\\Roaming\\research-vault\\config.json', 'C:\\Users\\test\\AppData\\Roaming\\research-vault\\trusted-bindings.json'],
    ['darwin', '/tmp/test-home', {}, '/tmp/test-home/Library/Application Support/research-vault/config.json', '/tmp/test-home/Library/Application Support/research-vault/trusted-bindings.json'],
    ['linux', '/tmp/test-home', { XDG_CONFIG_HOME: '/tmp/config' }, '/tmp/config/research-vault/config.json', '/tmp/config/research-vault/trusted-bindings.json'],
    ['linux', '/tmp/test-home', {}, '/tmp/test-home/.config/research-vault/config.json', '/tmp/test-home/.config/research-vault/trusted-bindings.json'],
  ]) {
    assert.equal(configPath({ platform, home, env }), pointer);
    assert.equal(trustedBindingsPath({ platform, home, env }), record);
  }
});

function validRow(f) {
  return { path: f.binding, sha256: createHash('sha256').update(readFileSync(f.binding)).digest('hex'), date: '2026-01-01' };
}

for (const layout of ['missing binding', 'unreadable binding', 'record folder is a file']) {
  test(`acknowledgement query fails closed: ${layout}`, t => {
    const f = fixture(t);
    writeFileSync(f.record, JSON.stringify({ version: 1, bindings: [validRow(f)] }));
    if (layout === 'missing binding') rmSync(f.binding);
    if (layout === 'unreadable binding') {
      chmodSync(f.binding, 0);
      t.after(() => { if (existsSync(f.binding)) chmodSync(f.binding, 0o600); });
      try { readFileSync(f.binding); t.skip('user can read mode 000'); return; } catch {}
    }
    if (layout === 'record folder is a file') {
      rmSync(f.folder, { recursive: true }); writeFileSync(f.folder, 'not a directory');
    }
    assert.equal(isBindingAcknowledged(f.binding, f.options), false);
  });
}

test('identical binding bytes in another repository are not acknowledged', t => {
  const f = fixture(t), other = join(f.root, 'other'); mkdirSync(other);
  const binding = join(other, '.research-vault.json'); writeFileSync(binding, readFileSync(f.binding));
  acknowledgeBinding(f.binding, f.options);
  assert.equal(isBindingAcknowledged(binding, f.options), false);
});

for (const defect of ['version', 'path', 'hash', 'duplicate', 'date']) {
  test(`a matching row cannot rescue a record with invalid ${defect}`, t => {
    const f = fixture(t), good = validRow(f);
    const record = { version: 1, bindings: [good] };
    if (defect === 'date') record.bindings[0].date = 'not a date';
    if (defect === 'version') record.version = 2;
    if (defect === 'path') record.bindings.push({ ...good, path: 'relative' });
    if (defect === 'hash') record.bindings.push({ ...good, path: join(f.repo, 'other'), sha256: 'bad' });
    if (defect === 'duplicate') record.bindings.push({ ...good });
    writeFileSync(f.record, JSON.stringify(record));
    assert.equal(isBindingAcknowledged(f.binding, f.options), false);
  });
}

for (const layout of ['directory', 'inside link', 'dangling link']) {
  test(`record ${layout} is refused without changing names or bytes`, t => {
    const f = fixture(t), target = join(f.folder, 'target');
    if (layout === 'directory') { mkdirSync(f.record); writeFileSync(join(f.record, 'keep'), 'keep'); }
    else {
      if (layout === 'inside link') writeFileSync(target, 'keep');
      if (!link(t, target, f.record, 'file')) return;
    }
    const names = readdirSync(f.folder);
    assert.throws(() => acknowledgeBinding(f.binding, f.options), { code: 'VAULT_PATH_OUTSIDE' });
    assert.deepEqual(readdirSync(f.folder), names);
    if (layout === 'directory') {
      assert.deepEqual(readdirSync(f.record), ['keep']);
      assert.equal(readFileSync(join(f.record, 'keep'), 'utf8'), 'keep');
    } else {
      assert.ok(fs.lstatSync(f.record).isSymbolicLink());
      if (layout === 'inside link') assert.equal(readFileSync(target, 'utf8'), 'keep');
      else assert.equal(existsSync(target), false);
    }
  });
}

// Patch builtin operations only within a synchronous callback, restoring ESM bindings even on failure.
function withBuiltin(object, name, replacement, action) {
  const original = object[name];
  object[name] = replacement; syncBuiltinESMExports();
  try { return action(); }
  finally { object[name] = original; syncBuiltinESMExports(); }
}

test('exclusive temporary creation preserves an existing temporary file', t => {
  const f = fixture(t), temporary = join(f.folder, '.trusted-bindings-collision.tmp');
  writeFileSync(temporary, 'keep');
  withBuiltin(crypto, 'randomUUID', () => 'collision', () => {
    assert.throws(() => acknowledgeBinding(f.binding, f.options), { code: 'EEXIST' });
  });
  assert.deepEqual(readdirSync(f.folder), ['.trusted-bindings-collision.tmp']);
  assert.equal(readFileSync(temporary, 'utf8'), 'keep');
});

test('failed rename cleans up the temporary file and preserves the record', t => {
  const f = fixture(t); writeFileSync(f.record, 'keep');
  withBuiltin(fs, 'renameSync', () => { throw new Error('injected rename failure'); }, () => {
    assert.throws(() => acknowledgeBinding(f.binding, f.options), /injected rename failure/);
  });
  assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
  assert.equal(readFileSync(f.record, 'utf8'), 'keep');
});

test('record replacement leaves a hard-linked file unchanged', t => {
  const f = fixture(t), other = join(f.root, 'hard-link'); writeFileSync(other, 'keep');
  try { linkSync(other, f.record); } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(e.code)) { t.skip(`hard links unavailable: ${e.code}`); return; } throw e;
  }
  acknowledgeBinding(f.binding, f.options);
  assert.equal(readFileSync(other, 'utf8'), 'keep');
  assert.equal(JSON.parse(readFileSync(f.record)).bindings[0].path, f.binding);
  assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
});

test('binding changed during confirmation refuses without writing a row', async t => {
  const f = fixture(t); let error = '';
  const keep = join(f.root, 'keep.json'); writeFileSync(keep, '{}'); acknowledgeBinding(keep, f.options);
  const recordBefore = readFileSync(f.record);
  const status = await run({ _: ['trust', f.repo] }, {
    ...f.options, stdin: { isTTY: true }, stdout: { write() {} }, stderr: { write(value) { error += value; } },
    ask: async () => { writeFileSync(f.binding, '{"vault":"changed"}'); return 'yes'; },
  });
  assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
  assert.deepEqual(readFileSync(f.record), recordBefore);
  assert.equal(status, 2);
  assert.equal(error, 'trust: binding changed; run research-vault trust again\n');
});

test('revoke through a linked folder removes the real-path row', t => {
  const f = fixture(t), alias = join(f.root, 'alias');
  if (!link(t, f.repo, alias, 'dir')) return;
  acknowledgeBinding(f.binding, f.options);
  assert.equal(revokeBinding(join(alias, '.research-vault.json'), f.options), true);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings, []);
});

test('--yes creates a missing config folder and private record', t => {
  const f = fixture(t); rmSync(f.folder, { recursive: true });
  const r = f.cli('--yes'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings.map(({ date, ...row }) => row), [{ path: f.binding, sha256: createHash('sha256').update(readFileSync(f.binding)).digest('hex') }]);
  if (process.platform !== 'win32') {
    assert.equal(statSync(f.folder).mode & 0o777, 0o700);
    assert.equal(statSync(f.record).mode & 0o777, 0o600);
  }
});

for (const existing of [false, true]) test(`linked config parent permits acknowledgement with ${existing ? 'existing' : 'missing'} config folder`, t => {
  const f = fixture(t), actual = join(f.root, 'actual'), alias = join(f.root, 'config-link');
  mkdirSync(actual); writeFileSync(join(actual, 'keep'), 'keep');
  if (!link(t, actual, alias, 'dir')) return;
  const folder = join(actual, 'research-vault');
  if (existing) mkdirSync(folder);
  const options = { platform: 'linux', home: f.home, env: testEnv({ XDG_CONFIG_HOME: alias }), now: NOW };
  acknowledgeBinding(f.binding, options);
  assert.equal(isBindingAcknowledged(f.binding, options), true);
  assert.deepEqual(readdirSync(actual).sort(), ['keep', 'research-vault']);
  assert.equal(readFileSync(join(actual, 'keep'), 'utf8'), 'keep');
  assert.deepEqual(readdirSync(folder), ['trusted-bindings.json']);
  assert.equal(JSON.parse(readFileSync(join(folder, 'trusted-bindings.json'))).bindings[0].path, f.binding);
});

for (const absolute of [false, true]) test(`linked binding final name is refused (${absolute ? 'absolute' : 'relative'})`, t => {
  const f = fixture(t), hostile = join(f.root, 'hostile'); mkdirSync(hostile); mkdirSync(join(hostile, 'research'));
  acknowledgeBinding(f.binding, f.options);
  const bytes = readFileSync(f.record), target = join(hostile, '.research-vault.json');
  if (!link(t, absolute ? f.binding : '../repo/.research-vault.json', target, 'file')) return;
  assert.equal(isBindingAcknowledged(target, f.options), false);
  for (const flag of ['--show', '--yes', '--revoke']) {
    const r = f.cli(flag, hostile);
    assert.equal(r.status, 2); assert.equal(r.stdout, '');
    assert.equal(r.stderr, 'trust: binding must be a regular file\n');
    assert.deepEqual(readFileSync(f.record), bytes);
  }
  assert.equal(isBindingAcknowledged(f.binding, f.options), true);
});

test('identity changed during confirmation refuses identical bytes', async t => {
  const f = fixture(t), alias = join(f.root, 'alias'), other = join(f.root, 'other'); mkdirSync(other);
  const keep = join(f.root, 'keep.json'); writeFileSync(keep, '{}'); acknowledgeBinding(keep, f.options);
  const recordBefore = readFileSync(f.record);
  writeFileSync(join(other, '.research-vault.json'), readFileSync(f.binding));
  if (!link(t, f.repo, alias, 'dir')) return;
  let error = '';
  const status = await run({ _: ['trust', alias] }, {
    ...f.options, stdin: { isTTY: true }, stdout: { write() {} }, stderr: { write(v) { error += v; } },
    ask: async () => { unlinkSync(alias); symlinkSync(other, alias, 'dir'); return 'y'; },
  });
  assert.equal(status, 2); assert.match(error, /binding changed/);
  assert.deepEqual(readdirSync(f.folder), ['trusted-bindings.json']);
  assert.deepEqual(readFileSync(f.record), recordBefore);
  assert.deepEqual(readFileSync(join(other, '.research-vault.json')), readFileSync(f.binding));
});

for (const layout of ['file', 'folder']) {
  test(`query refuses matching record through linked ${layout}`, t => {
    const f = fixture(t), outside = join(f.root, 'outside'); mkdirSync(outside);
    const target = join(outside, 'trusted-bindings.json');
    writeFileSync(target, JSON.stringify({ version: 1, bindings: [validRow(f)] }));
    if (layout === 'folder') rmSync(f.folder, { recursive: true });
    if (!link(t, layout === 'file' ? target : outside, layout === 'file' ? f.record : f.folder, layout === 'file' ? 'file' : 'dir')) return;
    const before = readFileSync(target);
    assert.equal(isBindingAcknowledged(f.binding, f.options), false);
    assert.deepEqual(readFileSync(target), before); assert.deepEqual(readdirSync(outside), ['trusted-bindings.json']);
  });
  test(`revoke refuses linked record ${layout} without outside changes`, t => {
    const f = fixture(t), outside = join(f.root, 'outside'); mkdirSync(outside);
    const target = join(outside, 'trusted-bindings.json');
    writeFileSync(target, JSON.stringify({ version: 1, bindings: [validRow(f)] }));
    if (layout === 'folder') rmSync(f.folder, { recursive: true });
    if (!link(t, layout === 'file' ? target : outside, layout === 'file' ? f.record : f.folder, layout === 'file' ? 'file' : 'dir')) return;
    const before = readFileSync(target);
    assert.equal(f.cli('--revoke').status, 2);
    assert.deepEqual(readFileSync(target), before); assert.deepEqual(readdirSync(outside), ['trusted-bindings.json']);
  });
}

test('display preserves duplicate keys verbatim', t => {
  const f = fixture(t); writeFileSync(f.binding, '{"vault":"first","vault":"second"}');
  const r = f.cli('--show'); assert.equal(r.status, 0);
  assert.match(r.stdout, /  \| {"vault":"first","vault":"second"}/);
});

test('long values have bounded prefixed output and preserve following fields', t => {
  const f = fixture(t); writeFileSync(f.binding, JSON.stringify({ extra: ' '.repeat(600), vault: 'research', later: 'visible', gates: { globs: ['x'.repeat(600)] } }));
  const r = f.cli('--show'); assert.equal(r.status, 0);
  for (const line of r.stdout.trimEnd().split('\n')) {
    assert.match(line, /^(Binding: |Content: |  \| |  \+ |Vault: |Resolved vault: |Gate globs: |Acknowledged: no$|Vault location does not exist\.$)/);
    bounded(line);
  }
  assert.equal(displayedContent(r.stdout), readFileSync(f.binding, 'utf8'));
  assert.match(displayedContent(r.stdout), /"later":"visible"/);
  assert.equal(displayedValue(r.stdout, 'Binding: '), f.binding);
  assert.equal(displayedValue(r.stdout, 'Vault: '), 'research');
  assert.equal(displayedValue(r.stdout, 'Resolved vault: '), join(f.repo, 'research'));
  assert.equal(displayedValue(r.stdout, 'Gate globs: '), JSON.stringify(['x'.repeat(600)]));
});

const unusual = '\u00a0\u3000\ufe0f\ue000\u0378\u007f\u0085\ud83d\ude00';
const escapedUnusual = '\\u00a0\\u3000\\ufe0f\\ue000\\u0378\\u007f\\u0085\\ud83d\\ude00';
test('display escapes every non-ASCII value code unit', t => {
  const f = fixture(t); writeFileSync(f.binding, JSON.stringify({ vault: unusual }));
  const r = f.cli('--show'); assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('Vault: ' + escapedUnusual));
  assert.equal(/[^\x20-\x7e\n]/.test(r.stdout), false);
});
test('display escapes non-ASCII and newline in canonical folder paths', t => {
  const f = fixture(t);
  let folder = join(f.root, unusual + '\n'), escapedFolder = escapedUnusual;
  try { mkdirSync(folder); } catch (error) {
    if (!['EPERM', 'EINVAL', 'EILSEQ'].includes(error.code)) throw error;
    t.diagnostic('Filesystem refuses the full name including U+0378; exercising every other requested code unit.');
    folder = join(f.root, '\u00a0\u3000\ufe0f\ue000\u007f\u0085\ud83d\ude00\n');
    escapedFolder = '\\u00a0\\u3000\\ufe0f\\ue000\\u007f\\u0085\\ud83d\\ude00';
    mkdirSync(folder);
  }
  writeFileSync(join(folder, '.research-vault.json'), '{"vault":"research"}');
  const r = f.cli('--show', folder); assert.equal(r.status, 0);
  const joined = r.stdout.replace(/\n  \+ /g, '');
  assert.ok(joined.includes('Binding: ' + f.root + '/' + escapedFolder + '\\u000a/.research-vault.json'));
  assert.ok(joined.includes('Resolved vault: ' + f.root + '/' + escapedFolder + '\\u000a/research'));
  assert.equal(/[^\x20-\x7e\n]/.test(r.stdout), false);
});
test('invalid JSON diagnostics escape quoted hostile bytes', t => {
  const f = fixture(t); writeFileSync(f.binding, '\u001b' + unusual);
  const r = f.cli('--yes'); assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid binding JSON/); assert.equal(/[^\x20-\x7e\n]/.test(r.stderr), false);
  assert.ok(r.stderr.trimEnd().split('\n').every((line, i) => line.startsWith(i ? '  + ' : 'trust: '))); assert.deepEqual(readdirSync(f.folder), []);
});
for (const [name, bytes, message] of [
  ['invalid UTF-8', Buffer.from([0xff]), 'binding must be valid UTF-8'],
  ...['42', '[]', '"x"', 'null'].map(raw => [raw, raw, 'binding JSON must be an object']),
]) test(`${name} refuses before display or writing`, t => {
  const f = fixture(t); writeFileSync(f.binding, bytes);
  const r = f.cli('--yes'); assert.equal(r.status, 2); assert.equal(r.stdout, '');
  assert.equal(r.stderr, `trust: ${message}\n`); assert.deepEqual(readdirSync(f.folder), []);
});
test('linked vault displays lexical and real locations', t => {
  const f = fixture(t), outside = join(f.root, 'outside'); mkdirSync(outside);
  if (!link(t, outside, join(f.repo, 'research'), 'dir')) return;
  const r = f.cli('--show'); assert.equal(r.status, 0);
  assert.ok(r.stdout.replace(/\n  \+ /g, '').includes('Resolved vault: ' + join(f.repo, 'research')));
  assert.ok(r.stdout.replace(/\n  \+ /g, '').includes('Real vault: ' + outside));
  assert.deepEqual(readdirSync(outside), []);
});
test('--revoke removes a row after binding becomes invalid', t => {
  const f = fixture(t); acknowledgeBinding(f.binding, f.options); writeFileSync(f.binding, Buffer.from([0xff]));
  assert.equal(f.cli('--revoke').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings, []);
});
test('--yes --show never acknowledges', t => {
  const f = fixture(t), other = join(f.repo, 'other.json'); writeFileSync(other, '{}'); acknowledgeBinding(other, f.options);
  const before = readFileSync(f.record);
  const r = f.cli('--yes', '--show'); assert.equal(r.status, 0);
  assert.match(r.stdout, /Acknowledged: no/);
  assert.deepEqual(readFileSync(f.record), before);
});
test('--yes --revoke never acknowledges', t => {
  const f = fixture(t), other = join(f.repo, 'other.json'); writeFileSync(other, '{}'); acknowledgeBinding(other, f.options);
  const kept = JSON.parse(readFileSync(f.record)).bindings;
  acknowledgeBinding(f.binding, f.options);
  const r = f.cli('--yes', '--revoke'); assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings, kept);
});
test('--show --revoke never acknowledges', t => {
  const f = fixture(t), other = join(f.repo, 'other.json'); writeFileSync(other, '{}'); acknowledgeBinding(other, f.options);
  const before = readFileSync(f.record);
  const r = f.cli('--show', '--revoke'); assert.equal(r.status, 0);
  assert.match(r.stdout, /Acknowledged: no/);
  assert.deepEqual(readFileSync(f.record), before);
});
test('--show wins over --revoke for an acknowledged binding', t => {
  const f = fixture(t); acknowledgeBinding(f.binding, f.options); const before = readFileSync(f.record);
  assert.match(f.cli('--show', '--revoke').stdout, /Acknowledged: yes/);
  assert.deepEqual(readFileSync(f.record), before);
});
for (const answer of ['y\n', null]) test(`real terminal prompt ${answer ? 'accepts y' : 'returns on EOF'}`, { timeout: 3000 }, async t => {
  const f = fixture(t), stdin = new PassThrough(), stdout = new PassThrough(); stdin.isTTY = true;
  const pending = run({ _: ['trust', f.repo] }, { ...f.options, stdin, stdout });
  if (answer) stdin.write(answer); else stdin.end();
  assert.equal(await pending, answer ? 0 : 1);
  assert.equal(existsSync(f.record), !!answer);
  if (answer) assert.equal(JSON.parse(readFileSync(f.record)).bindings[0].sha256, createHash('sha256').update(readFileSync(f.binding)).digest('hex'));
  else assert.deepEqual(readdirSync(f.folder), []);
  stdin.destroy(); stdout.destroy();
});
test('malformed records fail closed', t => {
  const f = fixture(t), raw = JSON.stringify({ version: 2, bindings: [validRow(f)] });
  writeFileSync(f.record, raw);
  assert.equal(isBindingAcknowledged(f.binding, f.options), false);
  assert.equal(readFileSync(f.record, 'utf8'), raw);
});

test('--revoke removes by path despite changed bytes', t => {
  const f = fixture(t); acknowledgeBinding(f.binding, f.options);
  writeFileSync(f.binding, '{"vault":"changed"}');
  assert.equal(f.cli('--revoke').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings, []);
});

function unescapeDisplay(text) {
  return text.replace(/\\(\\|u[0-9a-f]{4})/g, (_, escape) => escape === '\\' ? '\\' : String.fromCharCode(parseInt(escape.slice(1), 16)));
}
function displayedContent(output) {
  const pieces = output.slice(output.indexOf('\n', output.indexOf('Content: ')) + 1).split('\n');
  const content = [];
  for (const piece of pieces) {
    if (!/^  [|+] /.test(piece)) break;
    content.push(piece.slice(4));
  }
  return unescapeDisplay(content.join(''));
}
function displayedValue(output, prefix) {
  const lines = output.split('\n');
  const start = lines.findIndex(line => line.startsWith(prefix));
  assert.notEqual(start, -1, prefix);
  let value = lines[start].slice(prefix.length);
  for (let i = start + 1; lines[i]?.startsWith('  + '); i++) value += lines[i].slice(4);
  return unescapeDisplay(value);
}
function bounded(output) {
  for (const line of output.trimEnd().split('\n')) assert.ok(line.length <= DISPLAY_WIDTH, line);
}

test('named pipe binding refuses promptly without writing', { timeout: 10000 }, t => {
  const f = fixture(t); rmSync(f.binding);
  const fifo = spawnSync('mkfifo', [f.binding], { env: testEnv(f.env), timeout: 2000, encoding: 'utf8' });
  if (fifo.error?.code === 'ENOENT' || (process.platform === 'win32' && fifo.status !== 0)) { t.skip('mkfifo unavailable'); return; }
  assert.equal(fifo.status, 0, fifo.stderr);
  const query = spawnSync(process.execPath, ['--input-type=module', '-e', `import { isBindingAcknowledged } from ${JSON.stringify(new URL('../bin/lib/trust.mjs', import.meta.url).href)}; console.log(isBindingAcknowledged(process.argv[1]));`, f.binding], { cwd: f.root, env: testEnv(f.env), encoding: 'utf8', timeout: 2000 });
  assert.equal(query.status, 0, query.stderr); assert.equal(query.stdout, 'false\n');
  const shown = spawnSync(process.execPath, [CLI, 'trust', '--show', f.repo], { cwd: f.root, env: testEnv(f.env), encoding: 'utf8', timeout: 2000 }); assert.equal(shown.status, 2); assert.equal(shown.stdout, '');
  assert.deepEqual(readdirSync(f.folder), []); assert.ok(fs.lstatSync(f.binding).isFIFO());
});

test('unreadable binding can still be revoked', t => {
  if (process.getuid?.() === 0) { t.skip('root can read mode 000'); return; }
  const f = fixture(t); acknowledgeBinding(f.binding, f.options);
  chmodSync(f.binding, 0);
  t.after(() => { if (existsSync(f.binding)) chmodSync(f.binding, 0o600); });
  const r = f.cli('--revoke'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings, []);
});

test('revoke from a subfolder with a deleted binding identifies the parent row removed', t => {
  const f = fixture(t), sub = join(f.repo, 'sub'); mkdirSync(sub);
  const child = join(sub, '.research-vault.json'); writeFileSync(child, '{}');
  acknowledgeBinding(f.binding, f.options); acknowledgeBinding(child, f.options);
  const kept = JSON.parse(readFileSync(f.record)).bindings[1]; rmSync(child);
  const r = f.cli('--revoke', sub); assert.equal(r.status, 0);
  assert.equal(r.stdout.replace(/\n  \+ /g, ''), `Binding: ${f.binding}\nAcknowledgement revoked.\n`);
  assert.deepEqual(JSON.parse(readFileSync(f.record)).bindings, [kept]);
});

test('display distinguishes a nonbreaking space from a literal escape in file text', t => {
  const f = fixture(t);
  // The JSON texts differ by a raw NBSP versus the six ASCII characters backslash-u00a0.
  const raw = '{"extra":"\u00a0"}', typed = '{"extra":"\\u00a0"}';
  writeFileSync(f.binding, raw); const first = f.cli('--show');
  writeFileSync(f.binding, typed); const second = f.cli('--show');
  assert.equal(first.status, 0); assert.equal(second.status, 0);
  assert.notEqual(first.stdout.match(/^  \| .*/m)[0], second.stdout.match(/^  \| .*/m)[0]);
  assert.equal(displayedContent(first.stdout), raw); assert.equal(displayedContent(second.stdout), typed);
});

test('display distinguishes a nonbreaking space from a literal escape in folder names', t => {
  if (process.platform === 'win32') { t.skip('backslash is a path separator'); return; }
  const f = fixture(t), outputs = [];
  for (const name of ['\u00a0', '\\u00a0']) {
    const folder = join(f.root, name); mkdirSync(folder); writeFileSync(join(folder, '.research-vault.json'), '{}');
    const r = f.cli('--show', folder); assert.equal(r.status, 0);
    const identity = r.stdout.replace(/\n  \+ /g, '').split('\n')[0];
    assert.equal(unescapeDisplay(identity.slice(9)), join(folder, '.research-vault.json'));
    outputs.push(identity);
  }
  assert.notEqual(...outputs);
});

test('long vault and folder paths use bounded display pieces', t => {
  const f = fixture(t), folder = join(f.repo, 'p'.repeat(180)); mkdirSync(folder);
  const vault = 'v'.repeat(180), realVault = join(f.root, 'r'.repeat(180)); mkdirSync(realVault);
  if (!link(t, realVault, join(folder, vault), 'dir')) return;
  const binding = join(folder, '.research-vault.json'); writeFileSync(binding, JSON.stringify({ vault }));
  const r = f.cli('--show', folder); assert.equal(r.status, 0, r.stderr); bounded(r.stdout);
  assert.equal(displayedContent(r.stdout), readFileSync(binding, 'utf8'));
  assert.equal(displayedValue(r.stdout, 'Binding: '), binding);
  assert.equal(displayedValue(r.stdout, 'Vault: '), vault);
  assert.equal(displayedValue(r.stdout, 'Resolved vault: '), join(folder, vault));
  assert.equal(displayedValue(r.stdout, 'Real vault: '), realVault);
  assert.deepEqual(readdirSync(realVault), []);
  const revoke = f.cli('--revoke', folder); assert.equal(revoke.status, 0); bounded(revoke.stdout);
});

test('long validation errors use bounded stderr pieces without writing', t => {
  const f = fixture(t); writeFileSync(f.binding, JSON.stringify({ defaults: { domain: 'x'.repeat(400) } }));
  const r = f.cli('--yes'); assert.equal(r.status, 2); assert.equal(r.stdout, ''); bounded(r.stderr);
  assert.match(r.stderr.replace(/\n  \+ /g, ''), new RegExp('x'.repeat(400)));
  assert.deepEqual(readdirSync(f.folder), []);
});

test('multiline display includes every source line and independent byte and line counts', t => {
  const f = fixture(t);
  const raw = '{\n' + Array.from({ length: 60 }, (_, i) => `  "field${i}": "value${i}",\n`).join('') + '  "last": "visible"}';
  writeFileSync(f.binding, raw); const bytes = readFileSync(f.binding);
  const r = f.cli('--show'); assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(`Content: ${bytes.length} bytes, ${bytes.toString('utf8').split('\n').length} lines\n`));
  assert.equal(displayedContent(r.stdout), raw);
});

test('gate globs are displayed explicitly', t => {
  const f = fixture(t); writeFileSync(f.binding, '{"gates":{"globs":["src/**","docs/**"]}}');
  const r = f.cli('--show'); assert.equal(r.status, 0);
  assert.match(r.stdout, /^Gate globs: \["src\/\*\*","docs\/\*\*"\]$/m);
});

test('show through a linked folder prints the real binding identity', t => {
  const f = fixture(t), alias = join(f.root, 'alias');
  if (!link(t, f.repo, alias, 'dir')) return;
  const before = readFileSync(f.binding), names = readdirSync(f.repo);
  const r = f.cli('--show', alias); assert.equal(r.status, 0);
  assert.equal(r.stdout.replace(/\n  \+ /g, '').split('\n')[0], 'Binding: ' + f.binding);
  assert.deepEqual(readFileSync(f.binding), before); assert.deepEqual(readdirSync(f.repo), names);
  assert.deepEqual(readdirSync(f.folder), []);
});

test('byte-order mark refuses before display or writing', t => {
  const f = fixture(t); writeFileSync(f.binding, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')]));
  const before = readFileSync(f.binding);
  const r = f.cli('--yes'); assert.equal(r.status, 2); assert.equal(r.stdout, '');
  assert.deepEqual(readFileSync(f.binding), before); assert.deepEqual(readdirSync(f.folder), []);
});

test('dangling subfolder binding stops lookup without acknowledging its parent', t => {
  const f = fixture(t), sub = join(f.repo, 'sub'); mkdirSync(sub);
  const missing = join(f.root, 'missing');
  if (!link(t, missing, join(sub, '.research-vault.json'), 'file')) return;
  const before = readFileSync(f.binding), names = readdirSync(f.root);
  const r = f.cli('--yes', sub); assert.equal(r.status, 2); assert.equal(r.stdout, '');
  assert.equal(existsSync(missing), false); assert.deepEqual(readdirSync(f.root), names);
  assert.deepEqual(readFileSync(f.binding), before); assert.deepEqual(readdirSync(f.folder), []);
});

test('query refuses a matching record linked inside its config folder', t => {
  const f = fixture(t), target = join(f.folder, 'target');
  writeFileSync(target, JSON.stringify({ version: 1, bindings: [validRow(f)] }));
  if (!link(t, target, f.record, 'file')) return;
  const before = readFileSync(target), names = readdirSync(f.folder);
  assert.equal(isBindingAcknowledged(f.binding, f.options), false);
  assert.deepEqual(readFileSync(target), before); assert.deepEqual(readdirSync(f.folder), names);
});

test('network-like vault locations are displayed without real-location lookup', async t => {
  const f = fixture(t);
  for (const vault of ['//host/share', '\\\\host\\share']) {
    writeFileSync(f.binding, JSON.stringify({ vault }));
    const original = fs.realpathSync.native;
    let contacted = false, stdout = '', stderr = '';
    // Observe calls without permitting a network lookup, including if the guard is removed.
    fs.realpathSync.native = value => {
      if (value === resolve(f.repo, vault)) { contacted = true; throw new Error('unexpected vault lookup'); }
      return original(value);
    };
    try {
      const status = await run({ _: ['trust', f.repo], show: true }, { ...f.options, stdout: { write(v) { stdout += v; } }, stderr: { write(v) { stderr += v; } } });
      assert.equal(status, 0, stderr); assert.equal(contacted, false);
      assert.match(stdout, /^Resolved vault: /m);
      assert.ok(stdout.includes('Vault location was not looked up.\n')); assert.doesNotMatch(stdout, /^Real vault: /m);
      assert.deepEqual(readdirSync(f.folder), []);
    } finally { fs.realpathSync.native = original; }
  }
});

test('binding swapped to a final link before open refuses without writing', t => {
  const f = fixture(t), target = join(f.root, 'target'); writeFileSync(target, '{}');
  const probe = join(f.root, 'probe'); if (!link(t, target, probe, 'file')) return; rmSync(probe);
  const before = readFileSync(target), open = fs.openSync;
  withBuiltin(fs, 'openSync', (name, ...args) => {
    if (name === f.binding) { rmSync(f.binding); symlinkSync(target, f.binding); }
    return open(name, ...args);
  }, () => assert.throws(() => acknowledgeBinding(f.binding, f.options), /binding must be a regular file/));
  assert.deepEqual(readFileSync(target), before); assert.deepEqual(readdirSync(f.folder), []);
});

test('binding swapped to a pipe before open refuses promptly without writing', { timeout: 10000 }, t => {
  const f = fixture(t), fifo = join(f.root, 'pipe');
  const made = spawnSync('mkfifo', [fifo], { env: testEnv(f.env), timeout: 2000, encoding: 'utf8' });
  if (made.error?.code === 'ENOENT' || (process.platform === 'win32' && made.status !== 0)) { t.skip('mkfifo unavailable'); return; }
  assert.equal(made.status, 0, made.stderr);
  const script = `import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { run } from ${JSON.stringify(new URL('../bin/commands/trust.mjs', import.meta.url).href)};
    const open = fs.openSync;
    fs.openSync = (name, ...args) => {
      if (name === process.argv[1]) { fs.renameSync(process.argv[2], name); }
      return open(name, ...args);
    };
    syncBuiltinESMExports();
    process.exitCode = await run({ _: ['trust', process.argv[3]], show: true });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, f.binding, fifo, f.repo], { cwd: f.root, env: testEnv(f.env), encoding: 'utf8', timeout: 2000 });
  assert.equal(r.status, 2, r.stderr); assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'trust: binding must be a regular file\n');
  assert.deepEqual(readdirSync(f.folder), []); assert.ok(fs.lstatSync(f.binding).isFIFO());
});

test('show through a linked folder displays the plugin vault and alternate location', t => {
  const f = fixture(t), project = join(f.repo, 'data', 'project'), view = join(f.repo, 'view');
  mkdirSync(join(project, 'evil'), { recursive: true });
  mkdirSync(join(f.repo, 'data', 'vault'));
  const binding = join(project, '.research-vault.json');
  writeFileSync(binding, '{"vault":"../vault"}');
  if (!link(t, 'data/project', view, 'dir')) return;
  if (!link(t, 'data/project/evil', join(f.repo, 'vault'), 'dir')) return;
  const before = readFileSync(binding), names = readdirSync(project);
  const resolved = resolveVault({ cwd: view, ...f.options });
  assert.equal(resolved.source, 'project');
  const r = f.cli('--show', view); assert.equal(r.status, 0, r.stderr); bounded(r.stdout);
  assert.equal(displayedValue(r.stdout, 'Binding: '), binding);
  assert.equal(displayedValue(r.stdout, 'Resolved vault: '), resolved.path);
  assert.equal(displayedValue(r.stdout, 'Real vault: '), join(f.repo, 'data', 'project', 'evil'));
  assert.equal(displayedValue(r.stdout, 'Binding-folder vault: '), join(f.repo, 'data', 'vault'));
  assert.ok(r.stdout.includes('Linked folder: vault locations differ depending on the path.\n'));
  assert.deepEqual(readFileSync(binding), before); assert.deepEqual(readdirSync(project), names);
  assert.deepEqual(readdirSync(join(project, 'evil')), []);
  assert.deepEqual(readdirSync(join(f.repo, 'data', 'vault')), []);
  assert.deepEqual(readdirSync(f.folder), []);
});
