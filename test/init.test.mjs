import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInit, refreshDocs, profileHint } from '../bin/commands/init.mjs';
import { configPath } from '../bin/lib/resolve.mjs';

const CLI = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));

function relativeInit(t, { args = ['--vault', 'research'], env: envOverrides = {}, existingPointer = false, beforeInit = () => {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-init-relative-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'a');
  const home = join(root, 'home');
  mkdirSync(cwd);
  mkdirSync(home);
  const env = testEnv({
    HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'),
    ...(typeof envOverrides === 'function' ? envOverrides({ root, cwd }) : envOverrides),
  });
  const pointer = configPath({ platform: process.platform, home, env });
  assert.equal(existsSync(pointer), false);
  if (existingPointer) {
    const other = join(root, 'other');
    mkdirSync(other);
    mkdirSync(dirname(pointer), { recursive: true });
    writeFileSync(pointer, JSON.stringify({ vaultPath: other }));
  }
  beforeInit({ root, cwd, env, pointer });
  const init = spawnSync(process.execPath, [CLI, 'init', ...(typeof args === 'function' ? args({ root, cwd }) : args)], {
    cwd, env: testEnv(env), encoding: 'utf8', timeout: 20000,
  });
  assert.equal(init.status, 0, init.stderr);
  return { root, env, pointer, init, vault: join(realpathSync(cwd), 'research') };
}

test('init with a relative vault stores and prints an absolute default pointer', (t) => {
  const { pointer, init, vault } = relativeInit(t);
  assert.deepEqual(JSON.parse(readFileSync(pointer, 'utf8')), { vaultPath: vault });
  assert.ok(existsSync(join(vault, 'AGENTS.md')));
  assert.ok(init.stdout.includes(`Initialized vault at ${vault} (resolved via flag); set as default.\n`));
  assert.doesNotMatch(init.stdout, /^.*"research".*$/m);
});

test('a default initialized with a relative vault resolves from another working directory', (t) => {
  const { root, env, vault } = relativeInit(t);
  const cwd = join(root, 'b');
  mkdirSync(cwd);
  const before = readdirSync(cwd);
  const paths = spawnSync(process.execPath, [CLI, 'host', 'paths'], {
    cwd, env: testEnv(env), encoding: 'utf8', timeout: 20000,
  });
  assert.equal(paths.status, 0, paths.stderr);
  assert.deepEqual(readdirSync(cwd), before);
  assert.equal(JSON.parse(paths.stdout).vault, vault);
});

test('init with a relative environment vault stores an absolute default pointer', (t) => {
  const { pointer, vault } = relativeInit(t, {
    args: [], env: { RESEARCH_VAULT_PATH: 'research' },
  });
  assert.deepEqual(JSON.parse(readFileSync(pointer, 'utf8')), { vaultPath: vault });
});

test('init with a relative vault and --set-default replaces an existing pointer with an absolute path', (t) => {
  const { pointer, vault } = relativeInit(t, {
    args: ['--vault', 'research', '--set-default'], existingPointer: true,
  });
  assert.deepEqual(JSON.parse(readFileSync(pointer, 'utf8')), { vaultPath: vault });
});

test('first init omits the environment hint when the new default finds the vault', (t) => {
  const { init, vault } = relativeInit(t);
  assert.ok(init.stdout.includes(`Initialized vault at ${vault} (resolved via flag); set as default.\n`));
  assert.doesNotMatch(init.stdout, /RESEARCH_VAULT_PATH/);
});

test('second init hints at the other vault', (t) => {
  const { root, env } = relativeInit(t);
  const vault = join(root, 'second');
  const init = spawnSync(process.execPath, [CLI, 'init', '--vault', vault], {
    cwd: root, env: testEnv(env), encoding: 'utf8', timeout: 20000,
  });
  assert.equal(init.status, 0, init.stderr);
  assert.ok(init.stdout.includes(`Initialized vault at ${vault} (resolved via flag). Default pointer unchanged (use --set-default to repoint).\n`));
  const hint = process.platform === 'win32'
    ? `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vault}","User")\n`
    : `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vault}"\n`;
  assert.ok(init.stdout.endsWith(hint));
});

test('init warns when an environment vault overrides the newly set default', (t) => {
  const { init, vault } = relativeInit(t, {
    args: ['--vault', 'research', '--set-default'],
    env: { RESEARCH_VAULT_PATH: 'third' }, existingPointer: true,
  });
  assert.ok(init.stdout.includes('RESEARCH_VAULT_PATH is set to "third" and takes precedence over the default pointer; commands will use that folder until the variable is changed or unset.\n'));
  const hint = process.platform === 'win32'
    ? `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vault}","User")\n`
    : `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vault}"\n`;
  assert.ok(init.stdout.endsWith(hint));
});

test('plain init omits the hint when the environment already names the vault', (t) => {
  const { init } = relativeInit(t, {
    args: [], existingPointer: true,
    env: ({ cwd }) => ({ RESEARCH_VAULT_PATH: join(cwd, 'research') }),
  });
  assert.doesNotMatch(init.stdout, /RESEARCH_VAULT_PATH/);
});

test('plain init warns and hints with an absolute path for a relative environment vault', (t) => {
  const { init, vault } = relativeInit(t, { args: [], env: { RESEARCH_VAULT_PATH: 'research' } });
  assert.ok(init.stdout.includes('RESEARCH_VAULT_PATH is set to "research" and takes precedence over the default pointer; commands will use that folder until the variable is changed or unset.\n'));
  const hint = process.platform === 'win32'
    ? `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vault}","User")\n`
    : `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vault}"\n`;
  assert.ok(init.stdout.endsWith(hint));
});

test('plain init hints with an absolute path for an existing relative default pointer', (t) => {
  const { init, vault } = relativeInit(t, {
    args: [], existingPointer: true,
    beforeInit: ({ pointer }) => writeFileSync(pointer, '{"vaultPath":"research"}'),
  });
  const hint = process.platform === 'win32'
    ? `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vault}","User")\n`
    : `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vault}"\n`;
  assert.ok(init.stdout.endsWith(hint));
});

test('init inside a bound repository hints when the global pointer names another vault', (t) => {
  const { init, vault } = relativeInit(t, {
    existingPointer: true,
    beforeInit: ({ cwd }) => writeFileSync(join(cwd, '.research-vault.json'), '{"vault":"research"}'),
  });
  const hint = process.platform === 'win32'
    ? `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vault}","User")\n`
    : `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vault}"\n`;
  assert.ok(init.stdout.endsWith(hint));
});

test('init omits warning and hint when the environment links to the explicit vault', (t) => {
  const { init, root } = relativeInit(t, {
    args: ({ cwd }) => ['--vault', join(cwd, 'research')], existingPointer: true,
    env: ({ root }) => ({ RESEARCH_VAULT_PATH: join(root, 'link') }),
    beforeInit: ({ root, cwd }) => {
      mkdirSync(join(cwd, 'research'));
      symlinkSync(join(cwd, 'research'), join(root, 'link'), 'dir');
      writeFileSync(join(root, 'outside.txt'), 'keep');
    },
  });
  assert.equal(readFileSync(join(root, 'outside.txt'), 'utf8'), 'keep');
  assert.doesNotMatch(init.stdout, /RESEARCH_VAULT_PATH/);
});

test('init warns and hints when the environment and unchanged pointer name other folders', (t) => {
  let before;
  const { init, vault, env, pointer } = relativeInit(t, {
    existingPointer: true,
    env: ({ root }) => ({ RESEARCH_VAULT_PATH: join(root, 'third') }),
    beforeInit: ({ root, pointer }) => {
      mkdirSync(join(root, 'third'));
      before = readFileSync(pointer);
    },
  });
  assert.deepEqual(readFileSync(pointer), before);
  assert.ok(init.stdout.includes(`RESEARCH_VAULT_PATH is set to "${env.RESEARCH_VAULT_PATH}" and takes precedence over the default pointer; commands will use that folder until the variable is changed or unset.\n`));
  const hint = process.platform === 'win32'
    ? `Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","${vault}","User")\n`
    : `Add to your shell profile:\n  export RESEARCH_VAULT_PATH="${vault}"\n`;
  assert.ok(init.stdout.endsWith(hint));
});

test('plain init omits the hint at the OS default with an unreadable pointer', (t) => {
  const { init } = relativeInit(t, {
    args: [], existingPointer: true,
    beforeInit: ({ pointer }) => writeFileSync(pointer, '{'),
  });
  assert.doesNotMatch(init.stdout, /RESEARCH_VAULT_PATH/);
});

test('second init preserves the default pointer bytes', (t) => {
  const { root, env, pointer } = relativeInit(t);
  const before = readFileSync(pointer);
  const init = spawnSync(process.execPath, [CLI, 'init', '--vault', join(root, 'second')], {
    cwd: root, env: testEnv(env), encoding: 'utf8', timeout: 20000,
  });
  assert.equal(init.status, 0, init.stderr);
  assert.deepEqual(readFileSync(pointer), before);
});

test('init scaffolds vault, generates AGENTS.md, is idempotent', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'vault');
  const r1 = runInit({ vaultPath: dir, repoRoot: REPO_ROOT });
  assert.equal(r1.created, true);
  assert.ok(existsSync(join(dir, 'AGENTS.md')));
  assert.ok(existsSync(join(dir, 'sources')), 'entry folders are created by init');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /Research Vault/);
  // taxonomy is copied verbatim from the single source of truth (no hand-maintained duplicate)
  assert.equal(
    readFileSync(join(dir, 'taxonomy.json'), 'utf8'),
    readFileSync(join(REPO_ROOT, 'schema', 'taxonomy.json'), 'utf8'),
    'vault taxonomy.json must be a verbatim copy of schema/taxonomy.json');
  writeFileSync(join(dir, 'sources', '2026-01-01-x.md'), 'content');
  const r2 = runInit({ vaultPath: dir, repoRoot: REPO_ROOT });
  assert.equal(r2.created, false);
  assert.match(r2.reason, /non-empty/);
});

test('init refuses to overwrite a vault with custom non-entry files (no entries)', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'vault');
  assert.equal(runInit({ vaultPath: dir, repoRoot: REPO_ROOT }).created, true);
  const readme = join(dir, 'README.md');
  writeFileSync(readme, 'CUSTOM README keep this', 'utf8');
  const r2 = runInit({ vaultPath: dir, repoRoot: REPO_ROOT });
  assert.equal(r2.created, false);
  assert.match(r2.reason, /non-empty/);
  assert.equal(readFileSync(readme, 'utf8'), 'CUSTOM README keep this', 'custom file untouched');
});

test('refreshDocs regenerates AGENTS.md but leaves entries untouched', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  runInit({ vaultPath: dir });                 // scaffold a real vault
  writeFileSync(join(dir, 'AGENTS.md'), 'STALE', 'utf8');
  const entryPath = join(dir, 'sources', '2026-01-01-keep.md');
  writeFileSync(entryPath, '---\ntitle: keep\n---\nbody\n', 'utf8');
  const r = refreshDocs({ vaultPath: dir });
  assert.equal(r.refreshed, true);
  assert.notEqual(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'STALE');   // regenerated
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /research vault/i);
  assert.equal(readFileSync(entryPath, 'utf8'), '---\ntitle: keep\n---\nbody\n'); // entry untouched
});

test('refreshDocs refuses a non-vault target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-empty-'));
  const r = refreshDocs({ vaultPath: dir });
  assert.equal(r.refreshed, false);
  assert.match(r.reason, /not an existing vault/);
});

// Spec 15 D7: an existing vault sees nothing from code links. An entry carrying a field the schema does
// not know survives refreshDocs and lint --check byte for byte, and lint stays clean.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { REPO_ROOT, put, testEnv } from './helpers.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { ENTRY_FOLDERS } from '../bin/lib/fsutil.ts';

test('refreshDocs and lint --check leave every entry of an existing vault unchanged, unknown field included', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  runInit({ vaultPath: dir });
  const id = put(dir, 'source', '2026-01-01-keep', { source_type: 'article', source_url: 'https://e.com/keep' });
  const entry = join(dir, 'sources', `${id}.md`);
  writeFileSync(entry, readFileSync(entry, 'utf8').replace('\n---\n', '\nrecheck: version-change\n---\n'));
  assert.match(readFileSync(entry, 'utf8'), /^recheck: version-change$/m);
  lintAndReport(dir); // rebuild the manifest after the write, as lint does
  const hashes = () => Object.fromEntries(ENTRY_FOLDERS.flatMap((f) => readdirSync(join(dir, f), { recursive: true })
    .filter((n) => n.endsWith('.md')).map((n) => [`${f}/${n}`, createHash('sha256').update(readFileSync(join(dir, f, n))).digest('hex')])));
  const before = hashes();
  assert.ok(Object.keys(before).includes(`sources/${id}.md`));
  assert.equal(refreshDocs({ vaultPath: dir }).refreshed, true);
  const { violations } = lintAndReport(dir, { check: true });
  assert.deepEqual(violations, []);
  assert.deepEqual(hashes(), before);
  assert.match(readFileSync(entry, 'utf8'), /^recheck: version-change$/m);
});

test('profileHint prints the Windows user environment command', () => {
  assert.equal(profileHint('win32', 'C:\\vault'),
    'Set vault path (PowerShell):\n  [Environment]::SetEnvironmentVariable("RESEARCH_VAULT_PATH","C:\\vault","User")');
});
