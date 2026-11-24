import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEntry, walkEntries, writeEntry } from '../bin/lib/fsutil.mjs';
import { fixVault, lintVault } from '../bin/lib/lintrules.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { captureOperation } from '../bin/lib/capture-operation.mjs';
import { VAULT_PATH_OUTSIDE } from '../bin/lib/containment.mjs';
import { LEDGER_FILENAME } from '../bin/lib/gate.mjs';
import { PROJECT_CONFIG_FILENAME } from '../bin/lib/projectconfig.mjs';
import { USAGE_LOG } from '../bin/lib/usagelog.mjs';
import { put, testEnv, tmpVault } from './helpers.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repoRoot, 'bin', 'research-vault.mjs');
const outsideId = '2026-01-01-outside';
const insideId = '2026-01-01-inside';
const outsideTitle = 'Containment fixture outside';
const insideTitle = 'Containment fixture inside';
const namesPath = (message, path) => message.includes(`${path}: `);
const refused = path => err => err.code === VAULT_PATH_OUTSIDE && namesPath(err.message, path);

function fixture(t) {
  const root = realpathSync(tmpVault('rv-vault-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, 'vault');
  const outside = join(root, 'outside');
  mkdirSync(vault);
  mkdirSync(outside);
  return { root, vault, outside };
}

function link(t, target, path, type) {
  try {
    symlinkSync(target, path, type);
  } catch (err) {
    if (type === 'file' && ['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(err.code)) {
      t.skip(`File symlink unavailable (${err.code})`);
      return false;
    }
    if (type !== 'dir' || process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(err.code)) throw err;
    symlinkSync(target, path, 'junction');
  }
  return true;
}

function note(root, id, title) {
  put(root, 'note', id, { title, summary: title, sources: [], confidence: 'medium' });
  return join(root, 'notes', `${id}.md`);
}

function needsFix(path) {
  const bytes = Buffer.from(readFileSync(path, 'utf8')
    .replace(/^title: .+$/m, '$& # fixture comment')
    .replace(/(^# .*)\n$/m, '$1\r\n\r\nFixture body.\r\n'));
  writeFileSync(path, bytes);
  return bytes;
}

function runCli(vault, ...args) {
  return spawnSync(process.execPath, [cli, ...args, '--vault', vault], { cwd: vault, env: testEnv(), encoding: 'utf8', timeout: 30000 });
}

for (const absolute of [false, true]) {
  for (const writer of ['verify', 'writeEntry']) {
    test(`${writer}: a ${absolute ? 'absolute' : 'relative'} link at the old temporary name leaves the entry regular`, t => {
      const { vault } = fixture(t);
      const entry = note(vault, insideId, insideTitle);
      const target = absolute ? entry : `${insideId}.md`;
      if (!link(t, target, entry + '.tmp', 'file')) return;
      if (writer === 'verify') {
        const result = runCli(vault, 'verify', '--id', insideId, '--method', 'human-spot-check', '--result', 'confirmed', '--notes', 'new verification');
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, 'verify: updated\n');
      } else {
        const { data } = readEntry(entry);
        writeEntry(entry, { ...data, title: 'New title' }, '# New body\n', undefined, vault);
      }
      assert.ok(lstatSync(entry).isFile(), 'entry remains a regular file');
      const updated = readEntry(entry);
      if (writer === 'verify') assert.equal(updated.data.verifications.at(-1).notes, 'new verification');
      else {
        assert.equal(updated.data.title, 'New title');
        assert.equal(updated.body.trim(), '# New body');
      }
      assert.ok(lstatSync(entry + '.tmp').isSymbolicLink());
      assert.equal(readlinkSync(entry + '.tmp'), target);
    });
  }
}

for (const absolute of [false, true]) {
  test(`lint leaves a regular manifest and preserves a ${absolute ? 'absolute' : 'relative'} link at its old temporary name`, t => {
    const { vault } = fixture(t);
    put(vault, 'source', insideId, { title: insideTitle, source_type: 'article', source_url: 'https://example.com/a' });
    const manifest = join(vault, '.vault-manifest.json');
    writeFileSync(manifest, '{"entries":[]}\n');
    const target = absolute ? manifest : '.vault-manifest.json';
    if (!link(t, target, manifest + '.tmp', 'file')) return;
    const result = runCli(vault, 'lint');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(lstatSync(manifest).isFile(), 'manifest remains a regular file');
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    assert.deepEqual(parsed.entries.map(e => [e.id, e.title]), [[insideId, insideTitle]]);
    assert.ok(lstatSync(manifest + '.tmp').isSymbolicLink());
    assert.equal(readlinkSync(manifest + '.tmp'), target);
  });
}

function runHook(vault, hook, tool_name, tool_input) {
  return spawnSync(process.execPath, [join(repoRoot, 'hooks', hook)], {
    cwd: vault, env: testEnv({ RESEARCH_VAULT_PATH: vault }), encoding: 'utf8',
    input: JSON.stringify({ cwd: vault, tool_name, tool_input }),
  });
}

const entryLinks = [['dir', 'type folder link'], ['file', 'entry link']];
if (process.platform === 'win32') entryLinks.push(['junction', 'type folder junction']);
for (const [type, kind] of entryLinks) {
  test(`vault maintenance skips an outside ${kind}`, t => {
    const { vault, outside } = fixture(t);
    const other = note(outside, outsideId, outsideTitle);
    put(vault, 'source', insideId, { title: insideTitle, source_url: 'https://example.org/fixture', source_type: 'article' });
    const local = join(vault, 'sources', `${insideId}.md`);
    const folder = join(vault, 'notes');
    if (type === 'file') mkdirSync(folder);
    const skipped = type === 'file' ? join(folder, `${outsideId}.md`) : folder;
    if (!link(t, type === 'file' ? other : join(outside, 'notes'), skipped, type)) return;
    const bytes = needsFix(other);

    assert.deepEqual(walkEntries(vault), [local]);
    assert.deepEqual(buildManifest(vault).entries.map(entry => entry.id), [insideId]);
    const lint = lintVault(vault, repoRoot);
    assert.deepEqual(lint.warnings.filter(row => row.code === 'WARN_ENTRY_LINK_SKIPPED').map(row => row.file), [skipped]);
    assert.throws(() => readEntry(join(folder, `${outsideId}.md`)), refused(join('notes', `${outsideId}.md`)));

    const localBytes = needsFix(local);
    assert.equal(fixVault(vault, repoRoot).fixed, 1);
    assert.doesNotMatch(readFileSync(local, 'utf8'), /\r|# fixture comment/);
    assert.deepEqual(readFileSync(other), bytes);

    writeFileSync(local, localBytes);
    const manifest = join(vault, '.vault-manifest.json');
    writeFileSync(manifest, JSON.stringify(buildManifest(outside)));
    const hook = runHook(vault, 'post-tool-use.mjs', 'Edit', { file_path: local });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, '');
    assert.equal(hook.stdout, '');
    assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).entries.map(entry => entry.id), [insideId]);
    assert.doesNotMatch(readFileSync(local, 'utf8'), /\r|# fixture comment/);
    assert.deepEqual(readFileSync(other), bytes);
  });
}

test('walk and fix accept a type folder link inside the vault', t => {
  const { vault } = fixture(t);
  const storage = join(vault, 'storage');
  const realEntry = note(storage, insideId, insideTitle);
  const folder = join(vault, 'notes');
  link(t, join(storage, 'notes'), folder, 'dir');
  needsFix(realEntry);
  assert.deepEqual(walkEntries(vault), [join(folder, `${insideId}.md`)]);
  assert.equal(fixVault(vault, repoRoot).fixed, 1);
  assert.doesNotMatch(readFileSync(realEntry, 'utf8'), /\r|# fixture comment/);
});

test('walk and fix replace an entry link inside the vault without rewriting its target', t => {
  const { vault } = fixture(t);
  const realEntry = note(join(vault, 'storage'), insideId, insideTitle);
  const folder = join(vault, 'notes');
  mkdirSync(folder);
  const entry = join(folder, `${insideId}.md`);
  if (!link(t, realEntry, entry, 'file')) return;
  needsFix(realEntry);
  const before = readFileSync(realEntry);
  assert.deepEqual(walkEntries(vault), [entry]);
  assert.equal(fixVault(vault, repoRoot).fixed, 1);
  assert.doesNotMatch(readFileSync(entry, 'utf8'), /\r|# fixture comment/);
  assert.deepEqual(readFileSync(realEntry), before);
  assert.equal(lstatSync(entry).isSymbolicLink(), false);
});

test('walk and writes accept a vault root reached through a link', t => {
  const { root, vault } = fixture(t);
  const alias = join(root, 'alias');
  link(t, vault, alias, 'dir');
  const id = '2026-01-01-z';
  note(alias, id, 'Last note');
  note(alias, insideId, insideTitle);
  writeFileSync(join(vault, 'notes', 'INDEX.md'), 'index');
  assert.deepEqual(walkEntries(alias), [insideId, id].map(name => join(alias, 'notes', `${name}.md`)));
  const result = runCli(alias, 'manifest', '--rebuild');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(vault, '.vault-manifest.json')));
});

for (const suffix of ['', '.tmp']) {
  test(`manifest rebuild ${suffix ? 'ignores the old temporary' : 'refuses the destination'} outside link at .vault-manifest.json${suffix}`, t => {
    const { vault, outside } = fixture(t);
    note(vault, insideId, insideTitle);
    const name = `.vault-manifest.json${suffix}`;
    const other = join(outside, 'manifest.json');
    const bytes = Buffer.from('{"entries":[],"fixture":true}\r\n');
    writeFileSync(other, bytes);
    if (!link(t, other, join(vault, name), 'file')) return;
    const result = runCli(vault, 'manifest', '--rebuild');
    assert.equal(result.status, suffix ? 0 : 2, result.stderr);
    if (!suffix) assert.ok(namesPath(result.stderr, name), result.stderr);
    assert.deepEqual(readFileSync(other), bytes);
    assert.equal(existsSync(join(vault, '.vault-manifest.json')), true);
    if (!suffix) assert.equal(existsSync(join(vault, '.vault-manifest.json.tmp')), false);
  });

  test(`writeEntry ${suffix ? 'ignores an outside link at the old temporary' : 'refuses an outside link at the final'} path`, t => {
    const { vault, outside } = fixture(t);
    const folder = join(vault, 'notes');
    mkdirSync(folder);
    const name = `${insideId}.md`;
    const entry = join(folder, name);
    const other = join(outside, 'entry.md');
    const bytes = Buffer.from('outside fixture\r\n');
    writeFileSync(other, bytes);
    if (!link(t, other, entry + suffix, 'file')) return;
    const write = () => writeEntry(entry, { title: insideTitle }, '# Fixture\n', ['title']);
    if (suffix) write();
    else assert.throws(write, refused(join('notes', name)));
    assert.deepEqual(readFileSync(other), bytes);
    assert.equal(existsSync(suffix ? entry : entry + '.tmp'), !!suffix);
  });
}

for (const type of ['dir', 'file']) {
  test(`pre-web and search skip an outside usage log ${type === 'dir' ? 'directory' : 'file'} link and return results`, t => {
    const { vault, outside } = fixture(t);
    note(vault, insideId, insideTitle);
    const dir = join(vault, '_index');
    const other = join(outside, 'usage.jsonl');
    const name = type === 'dir' ? '_index' : join('_index', 'usage.jsonl');
    const bytes = Buffer.from('{"kind":"fixture"}\r\n');
    if (type === 'file') {
      mkdirSync(dir);
      writeFileSync(other, bytes);
    }
    if (!link(t, type === 'dir' ? outside : other, join(vault, name), type)) return;

    const untouched = () => {
      assert.deepEqual(readdirSync(outside), type === 'dir' ? [] : ['usage.jsonl']);
      if (type === 'file') assert.deepEqual(readFileSync(other), bytes);
    };
    const hook = runHook(vault, 'pre-web.mjs', 'WebSearch', { query: insideTitle });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stderr, '');
    assert.match(hook.stdout, new RegExp(insideId));
    untouched();

    const search = runCli(vault, 'search', '--text', 'containment fixture', '--json');
    assert.equal(search.status, 0, search.stderr);
    assert.deepEqual(JSON.parse(search.stdout).map(({ id, title }) => ({ id, title })), [{ id: insideId, title: insideTitle }]);
    assert.equal(search.stderr, `search: usage log was not written because it resolves outside the vault (${USAGE_LOG})\n`);
    untouched();
  });
}

test('pre-web and search omit ids and titles from an outside type folder', t => {
  const { vault, outside } = fixture(t);
  note(outside, outsideId, outsideTitle);
  put(vault, 'source', insideId, { title: insideTitle, source_url: 'https://example.org/fixture', source_type: 'article' });
  link(t, join(outside, 'notes'), join(vault, 'notes'), 'dir');
  const query = 'containment fixture';
  for (const result of [runHook(vault, 'pre-web.mjs', 'WebSearch', { query }), runCli(vault, 'search', '--text', query)]) {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(insideId));
    assert.ok(result.stdout.includes(insideTitle));
    assert.ok(!result.stdout.includes(outsideId));
    assert.ok(!result.stdout.includes(outsideTitle));
  }
});

test('compile and capture operations refuse outside output folders', t => {
  const { root, vault, outside } = fixture(t);
  link(t, outside, join(vault, '_index'), 'dir');
  const compile = runCli(vault, 'compile');
  assert.equal(compile.status, 2, compile.stderr);
  assert.ok(namesPath(compile.stderr, '_index'), compile.stderr);

  link(t, outside, join(vault, '.capture-operations'), 'dir');
  const plan = join(root, 'plan.json');
  writeFileSync(plan, JSON.stringify([{ type: 'question', title: 'Fixture question' }]));
  const capture = captureOperation(vault, plan, 'fixture');
  assert.equal(capture.errors[0]?.code, 'RECEIPT_IO');
  assert.ok(namesPath(capture.errors[0].error, join('.capture-operations', 'fixture.json')));
  assert.deepEqual(readdirSync(outside), []);
});

test('capture operation refuses a linked destination inside the vault', t => {
  const { root, vault } = fixture(t);
  const plan = join(root, 'plan.json');
  writeFileSync(plan, JSON.stringify([{ type: 'question', title: 'Fixture question' }]));
  const initial = captureOperation(vault, plan, 'fixture', {
    event: event => { if (event === 'manifest') throw new Error('fixture manifest interruption'); },
  });
  assert.equal(initial.operation.phase, 'needs-repair');
  const [{ path }] = initial.created;
  const bytes = readFileSync(path);
  const target = join(vault, 'saved-entry.md');
  renameSync(path, target);
  if (!link(t, target, path, 'file')) return;

  const result = captureOperation(vault, plan, 'fixture');
  assert.equal(result.errors[0]?.code, 'DESTINATION_CONFLICT');
  assert.equal(result.errors[0]?.error, 'destination is not a regular file');
  assert.deepEqual(readFileSync(target), bytes);
});

test('init refuses an outside template destination and accepts a linked vault root', t => {
  const { root, vault, outside } = fixture(t);
  const alias = join(root, 'alias');
  link(t, vault, alias, 'dir');
  const init = runCli(alias, 'init');
  assert.equal(init.status, 0, init.stderr);
  assert.ok(existsSync(join(vault, 'AGENTS.md')));

  const name = join('meta', 'prompt-templates');
  rmSync(join(vault, name), { recursive: true, force: true });
  link(t, outside, join(vault, name), 'dir');
  const refresh = runCli(alias, 'init', '--force');
  assert.equal(refresh.status, 2, refresh.stderr);
  assert.ok(namesPath(refresh.stderr, name), refresh.stderr);
  assert.deepEqual(readdirSync(outside), []);
});

test('init --project refuses a dangling link at the binding path', t => {
  const { vault, outside } = fixture(t);
  const binding = join(vault, PROJECT_CONFIG_FILENAME);
  const target = join(outside, 'binding.json');
  if (!link(t, target, binding, 'file')) return;

  const init = runCli(vault, 'init', '--project');
  assert.equal(init.status, 1, init.stderr);
  assert.equal(init.stdout, '');
  assert.equal(init.stderr, `${PROJECT_CONFIG_FILENAME} already exists at ${binding}\n`);
  assert.ok(lstatSync(binding).isSymbolicLink());
  assert.equal(existsSync(target), false);
});

test('Stop skips an outside vault ledger and gate record refuses it', t => {
  const { vault, outside } = fixture(t);
  const draft = join(vault, 'draft.md');
  writeFileSync(draft, '# Fixture draft\n');
  writeFileSync(join(vault, '.research-vault.json'), JSON.stringify({ vault: '.', gates: { globs: ['draft.md'] } }));
  const other = join(outside, 'ledger.jsonl');
  const bytes = Buffer.from('{"event":"fixture"}\r\n');
  writeFileSync(other, bytes);
  if (!link(t, other, join(vault, LEDGER_FILENAME), 'file')) return;

  const stop = runHook(vault, 'stop-gate.mjs', undefined, undefined);
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stderr, '');
  const result = JSON.parse(stop.stdout);
  assert.equal(result.decision, undefined);
  assert.match(result.systemMessage, /skipped/);
  assert.ok(namesPath(result.systemMessage, LEDGER_FILENAME));

  const gate = runCli(vault, 'gate', 'record', draft, 'PASS');
  assert.equal(gate.status, 2, gate.stderr);
  assert.ok(namesPath(gate.stderr, LEDGER_FILENAME), gate.stderr);
  assert.deepEqual(readFileSync(other), bytes);
});

test('writeEntry refuses a lossy nested value before touching the file', t => {
  const { vault } = fixture(t);
  const entry = note(vault, insideId, insideTitle);
  const before = readFileSync(entry);
  const names = readdirSync(join(vault, 'notes'));
  assert.throws(() => writeEntry(entry, { subject: { version: 1.5 } }, ''), err => {
    assert.ok(err.message.includes(entry), err.message);
    assert.ok(err.message.includes('subject.version'), err.message);
    assert.equal(err.message.split('\n').length, 1);
    return true;
  });
  assert.deepEqual(readFileSync(entry), before);
  assert.deepEqual(readdirSync(join(vault, 'notes')), names);
});


test('writeEntry diagnoses unparseable fields before touching the file', t => {
  const { vault } = fixture(t);
  const entry = note(vault, insideId, insideTitle);
  const before = readFileSync(entry);
  const names = readdirSync(join(vault, 'notes'));
  assert.throws(() => writeEntry(entry, { 'bad-key': 'value' }, ''), {
    message: 'frontmatter write refused for ' + JSON.stringify(entry) + ' at "bad-key": serialized text would not parse',
  });
  assert.deepEqual(readFileSync(entry), before);
  assert.deepEqual(readdirSync(join(vault, 'notes')), names);
});

test('writeEntry refusal messages escape controls and line separators', t => {
  const { vault } = fixture(t);
  const entry = note(vault, 'controls\u2028\u2029\t', insideTitle);
  const before = readFileSync(entry);
  const names = readdirSync(join(vault, 'notes'));
  for (const data of [{ ['bad-key\u2028\u2029\t']: 'value' }, { subject: { version: 1.5 } }]) {
    assert.throws(() => writeEntry(entry, data, ''), err => {
      assert.doesNotMatch(err.message, /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u);
      assert.ok(err.message.includes('controls\\\\u2028\\\\u2029\\\\u0009.md'), err.message);
      assert.ok(err.message.includes('bad-key')
        ? err.message.includes('bad-key\\\\u2028\\\\u2029\\\\u0009')
        : err.message.includes('subject.version'), err.message);
      return true;
    });
    assert.deepEqual(readFileSync(entry), before);
    assert.deepEqual(readdirSync(join(vault, 'notes')), names);
  }
});
