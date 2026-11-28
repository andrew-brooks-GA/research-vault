import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, tmpVault, put, testEnv } from './helpers.mjs';
import { context } from '../scripts/deps.mjs';

const CLI = join(REPO_ROOT, 'bin', 'research-vault.mjs');

test('CLI prints usage and exits 0 with no args', () => {
  const out = execFileSync(process.execPath, [CLI, '--help'], { env: testEnv(), encoding: 'utf8' });
  assert.match(out, /research-vault/);
  assert.match(out, /init\|lint\|capture\|verify\|search\|related\|manifest/);
});

test('CLI does not truncate large piped stdout (process.exit after write)', () => {
  const dir = tmpVault('rv-pipe-');
  for (let i = 0; i < 400; i++) put(dir, 'source', `2026-01-01-s${i}`, { source_type: 'article', source_url: `https://example.com/${i}` });
  const out = execFileSync(process.execPath, [CLI, 'manifest', '--vault', dir], { env: testEnv(), maxBuffer: 1 << 26 });
  assert.ok(out.length > 65536, `expected > 64 KB, got ${out.length}`);
  assert.doesNotThrow(() => JSON.parse(out.toString()));
});

function referenceRows() {
  const reference = readFileSync(join(REPO_ROOT, 'docs', 'REFERENCE.md'), 'utf8');
  return reference.split(/^## Commands\n/m)[1].split(/^## /m)[0].split('\n');
}

// Guard the reference table against the CLI dispatch map, including commands missing from usage.
test('source scan: every CLI command has a reference table row', () => {
  const rows = referenceRows();
  for (const cmd of context().commands) {
    assert.ok(rows.some(row => row.startsWith(`| \`${cmd}\` | `)), `missing command table row for ${cmd}`);
  }
});

// Issue 72 item 9: --help or -h after a command prints usage and runs nothing, even with no vault yet.
test('a command given --help or -h prints its row of the command table and writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'rv-help-'));
  const overrides = { HOME: root, USERPROFILE: root, APPDATA: join(root, 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'AppData', 'Local'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), RESEARCH_VAULT_PATH: join(root, 'vault') };
  const run = (...argv) => spawnSync(process.execPath, [CLI, ...argv], { cwd: root, env: testEnv(overrides), encoding: 'utf8', timeout: 20000 });
  const usage = run('--help');
  assert.equal(usage.status, 0, usage.stderr);
  const names = usage.stdout.match(/commands: ([\w|-]+)/)[1].split('|');
  const rows = referenceRows();
  for (const [cmd, flag] of [...names.map((c) => [c, '--help']), ['init', '-h']]) {
    const head = `| \`${cmd}\` | `;
    const row = rows.find(line => line.startsWith(head));
    assert.ok(row, `missing command table row for ${cmd}`);
    const expected = row.slice(head.length, -2).replace(/ *<!--.*?-->/g, '').replaceAll('\\|', '|');
    const r = run(cmd, flag);
    assert.equal(r.status, 0, `${cmd} ${flag}: ${r.stderr}`);
    assert.equal(r.stdout, `research-vault ${cmd}: ${expected}\n`, `${cmd} ${flag}`);
    assert.deepEqual(readdirSync(root), [], `${cmd} ${flag} wrote nothing`);
  }
  const unknown = run('nosuch', '--help');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown command: nosuch/);
  // -h given as the value of a flag is that value, not a request for help.
  const text = run('search', '--vault', mkdtempSync(join(tmpdir(), 'rv-help-vault-')), '--text', '-h');
  assert.ok(!text.stdout.startsWith('research-vault search:'), text.stdout);
});

test('the Node version check accepts the floor and every newer release', async () => {
  const { nodeTooOld } = await import('../bin/lib/node-floor.mjs');
  assert.equal(nodeTooOld('24.12.0'), null);
  assert.equal(nodeTooOld('24.12.1'), null);
  assert.equal(nodeTooOld('24.22.3'), null);
  assert.equal(nodeTooOld('25.0.0'), null);
  assert.equal(nodeTooOld('26.13.1'), null);
});

test('the Node version check refuses the floor major below the floor minor', async () => {
  const { nodeTooOld } = await import('../bin/lib/node-floor.mjs');
  assert.equal(nodeTooOld('24.11.1'), 'research-vault: Node.js 24.12.0 or newer is required (this is 24.11.1)');
  assert.equal(nodeTooOld('24.0.0'), 'research-vault: Node.js 24.12.0 or newer is required (this is 24.0.0)');
});

test('the Node version check compares the minor numerically', async () => {
  const { nodeTooOld } = await import('../bin/lib/node-floor.mjs');
  assert.equal(nodeTooOld('24.9.0'), 'research-vault: Node.js 24.12.0 or newer is required (this is 24.9.0)');
});

test('the Node version check refuses an older major regardless of its minor', async () => {
  const { nodeTooOld } = await import('../bin/lib/node-floor.mjs');
  assert.equal(nodeTooOld('22.23.5'), 'research-vault: Node.js 24.12.0 or newer is required (this is 22.23.5)');
  assert.equal(nodeTooOld('23.99.0'), 'research-vault: Node.js 24.12.0 or newer is required (this is 23.99.0)');
});

// The patch number and the handling of its suffix can affect the result only when the floor's patch is above 0. The test beginning 'the floor declared in package engines' checks the release just below the floor and covers the patch comparison when engines names a non-zero patch.
test('the Node version check uses the major and minor for suffixed versions at the current floor', async () => {
  const { nodeTooOld } = await import('../bin/lib/node-floor.mjs');
  assert.equal(nodeTooOld('24.12.0-rc.1'), null);
  assert.equal(nodeTooOld('24.11.0-nightly20250101abcdef'), 'research-vault: Node.js 24.12.0 or newer is required (this is 24.11.0-nightly20250101abcdef)');
});

test('the floor declared in package engines is accepted and a release just below it is refused', async () => {
  const { nodeTooOld } = await import('../bin/lib/node-floor.mjs');
  const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const floor = engines.node.slice(2);
  const [major, minor = 0, patch = 0] = floor.split('.').map(Number);
  assert.equal(nodeTooOld(floor), null);
  const below = patch > 0 ? `${major}.${minor}.${patch - 1}`
    : minor > 0 ? `${major}.${minor - 1}.999` : `${major - 1}.999.999`;
  assert.match(nodeTooOld(below), / or newer is required /);
});

// R-18: a preload fakes the version and fails the load of every bin/ module but the entry and the check, so a static
// import of one (which ESM loads before any module body runs) makes the run fail with that error instead.
function runWithNodeVersion(t, version) {
  const dir = mkdtempSync(join(tmpdir(), 'rv-old-node-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'old-node.mjs');
  const bin = pathToFileURL(join(REPO_ROOT, 'bin')).href + '/';
  writeFileSync(preload, `import { registerHooks } from 'node:module';
Object.defineProperty(process, 'versions', { value: { ...process.versions, node: ${JSON.stringify(version)} } });
const allowed = new Set([${JSON.stringify(bin + 'research-vault.mjs')}, ${JSON.stringify(bin + 'lib/node-floor.mjs')}]);
registerHooks({ load(url, context, next) {
  if (url.startsWith(${JSON.stringify(bin)}) && !allowed.has(url)) throw new Error('loaded before the version check: ' + url);
  return next(url, context);
} });
`);
  return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, CLI, '--help'], { cwd: dir, env: testEnv(), encoding: 'utf8', timeout: 20000 });
}

test('the CLI entry refuses an older Node before it loads any other module of the plugin', (t) => {
  const r = runWithNodeVersion(t, '22.0.0');
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, 'research-vault: Node.js 24.12.0 or newer is required (this is 22.0.0)\n');
  assert.equal(r.stdout, '', 'no usage');
});

test('the CLI entry refuses Node 24.11.1 before loading any command', (t) => {
  const r = runWithNodeVersion(t, '24.11.1');
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, 'research-vault: Node.js 24.12.0 or newer is required (this is 24.11.1)\n');
  assert.equal(r.stdout, '', 'no usage');
});
