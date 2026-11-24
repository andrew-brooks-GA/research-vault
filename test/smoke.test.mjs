import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpVault, put, testEnv } from './helpers.mjs';

test('CLI prints usage and exits 0 with no args', () => {
  const out = execFileSync(process.execPath, ['bin/research-vault.mjs', '--help'], { env: testEnv(), encoding: 'utf8' });
  assert.match(out, /research-vault/);
  assert.match(out, /init\|lint\|capture\|verify\|search\|related\|manifest/);
});

test('CLI does not truncate large piped stdout (process.exit after write)', () => {
  const dir = tmpVault('rv-pipe-');
  for (let i = 0; i < 400; i++) put(dir, 'source', `2026-01-01-s${i}`, { source_type: 'article', source_url: `https://example.com/${i}` });
  const out = execFileSync(process.execPath, ['bin/research-vault.mjs', 'manifest', '--vault', dir], { env: testEnv(), maxBuffer: 1 << 26 });
  assert.ok(out.length > 65536, `expected > 64 KB, got ${out.length}`);
  assert.doesNotThrow(() => JSON.parse(out.toString()));
});

// Issue 72 item 9: --help or -h after a command prints usage and runs nothing, even with no vault yet.
test('a command given --help or -h prints its row of the command table and writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'rv-help-'));
  const overrides = { HOME: root, USERPROFILE: root, APPDATA: join(root, 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'AppData', 'Local'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), RESEARCH_VAULT_PATH: join(root, 'vault') };
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const cli = join(repo, 'bin', 'research-vault.mjs');
  const run = (...argv) => spawnSync(process.execPath, [cli, ...argv], { cwd: root, env: testEnv(overrides), encoding: 'utf8', timeout: 20000 });
  const usage = run('--help');
  assert.equal(usage.status, 0, usage.stderr);
  const names = usage.stdout.match(/commands: ([\w|-]+)/)[1].split('|');
  const table = readFileSync(join(repo, 'docs', 'REFERENCE.md'), 'utf8');
  for (const [cmd, flag] of [...names.map((c) => [c, '--help']), ['init', '-h']]) {
    const r = run(cmd, flag);
    assert.equal(r.status, 0, `${cmd} ${flag}: ${r.stderr}`);
    assert.ok(r.stdout.startsWith(`research-vault ${cmd}: `), `${cmd} ${flag}: ${r.stdout}`);
    assert.equal(r.stdout.includes('section of docs/REFERENCE.md'), !table.includes(`\n| \`${cmd}\` | `), `${cmd}: its row, or the pointer when it has none`);
    assert.ok(!r.stdout.includes('<!--') && !r.stdout.includes('\\|'), `${cmd}: no comment and no escaped bar`);
    assert.deepEqual(readdirSync(root), [], `${cmd} ${flag} wrote nothing`);
  }
  const unknown = run('nosuch', '--help');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown command: nosuch/);
  // -h given as the value of a flag is that value, not a request for help.
  const text = run('search', '--vault', mkdtempSync(join(tmpdir(), 'rv-help-vault-')), '--text', '-h');
  assert.ok(!text.stdout.startsWith('research-vault search:'), text.stdout);
});

// R-18: the decision is made from the version string alone; the floor is package.json's engines.node (24).
test('the Node version check refuses a Node older than 24 with one line and accepts 24 and newer', async () => {
  const { nodeTooOld } = await import('../bin/lib/node-floor.mjs');
  assert.equal(nodeTooOld('22.23.5'), 'research-vault: Node.js 24 or newer is required (this is 22.23.5)');
  assert.equal(nodeTooOld('23.11.0'), 'research-vault: Node.js 24 or newer is required (this is 23.11.0)');
  assert.equal(nodeTooOld('24.0.0'), null);
  assert.equal(nodeTooOld('26.13.1'), null);
});

// R-18: under a Node that reports 22.0.0 the entry prints the one line and exits 1 before it loads any other module of
// bin/: a preload fakes the version and fails the load of every bin/ module but the entry and the check, so a static
// import of one (which ESM loads before any module body runs) makes the run fail with that error instead.
test('the CLI entry refuses an older Node before it loads any other module of the plugin', (t) => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = mkdtempSync(join(tmpdir(), 'rv-old-node-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'old-node.mjs');
  const bin = pathToFileURL(join(repo, 'bin')).href + '/';
  writeFileSync(preload, `import { registerHooks } from 'node:module';
Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '22.0.0' } });
const allowed = new Set([${JSON.stringify(bin + 'research-vault.mjs')}, ${JSON.stringify(bin + 'lib/node-floor.mjs')}]);
registerHooks({ load(url, context, next) {
  if (url.startsWith(${JSON.stringify(bin)}) && !allowed.has(url)) throw new Error('loaded before the version check: ' + url);
  return next(url, context);
} });
`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(repo, 'bin', 'research-vault.mjs'), '--help'], { cwd: dir, env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, 'research-vault: Node.js 24 or newer is required (this is 22.0.0)\n');
  assert.equal(r.stdout, '', 'no usage');
});
