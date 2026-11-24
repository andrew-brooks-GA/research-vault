import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertVaultUntouched, outsideVaultRepo, tmpVault, put, testEnv } from './helpers.mjs';
import { runInit } from '../bin/commands/init.mjs';
import { workspaceBrief } from '../hooks/session-start.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'session-start.mjs');
const NOW = new Date(); // the CLI reads the real clock, so the fixture dates hang off it too
const day = (n) => new Date(NOW.getTime() - n * 86400000);
const ver = (date) => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

const iso = (d) => d.toISOString().slice(0, 10);
const record = (date) => `---\ntitle: r\ntype: learning-record\ndate: ${iso(date)}\nstatus: active\nkind: understanding\n---\n# r\n`;

// A bound repo with one workspace: two learning records (one review-due) and two reference docs
// (one stale); `attempt` adds one graded attempt (1 of 3 wrong) on lesson 0001-x. The mission asks for reminders
// every 21 days unless `reminders` is false (issue 79 D2).
function repo({ due = true, attempt = false, reminders = true } = {}) {
  const root = tmpVault('rv-sessionstart-');
  const vault = join(root, 'research');
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'research' }) + '\n');
  put(vault, 'source', '2026-07-10-fresh', { source_type: 'article', source_url: 'https://e.com/fresh', volatility: 'fast', verifications: ver(day(1).toISOString().slice(0, 10)) });
  put(vault, 'source', '2020-01-01-old', { source_type: 'article', source_url: 'https://e.com/old', volatility: 'fast', verifications: ver('2020-01-01') });
  const ws = join(root, 'learn', 'k8s');
  mkdirSync(join(ws, 'learning-records'), { recursive: true });
  mkdirSync(join(ws, 'reference'), { recursive: true });
  writeFileSync(join(ws, 'MISSION.md'), reminders ? '# m\n\n## Constraints\n- Reminders: every 21 days\n' : '# m\n');
  writeFileSync(join(ws, 'learning-records', '0001-a.md'), record(due ? day(21 + 1) : day(1)));
  writeFileSync(join(ws, 'learning-records', '0002-b.md'), record(day(1)));
  writeFileSync(join(ws, 'reference', 'fresh.html'), '<a href="https://e.com/fresh">x</a>\n');
  writeFileSync(join(ws, 'reference', 'stale.html'), `<a href="https://e.com/${due ? 'old' : 'fresh'}">x</a>\n`);
  if (attempt) {
    mkdirSync(join(ws, 'attempts'), { recursive: true });
    writeFileSync(join(ws, 'attempts', 'a-20260101-120000-0001.md'),
      '---\ntype: attempt\ndate: 2026-01-01\nlesson: 0001-x\ntotal: 3\nwrong: [2]\nrecords: []\n---\n');
  }
  return { root, vault, ws };
}

test('workspaceBrief counts review-due records and stale reference docs', () => {
  const { vault, ws } = repo();
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'),
    'research-teach learn/k8s: 1 record(s) review-due; 1 reference doc(s) with a stale citation');
});

test('workspaceBrief adds the last attempt clause', () => {
  const { vault, ws } = repo({ attempt: true });
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'),
    'research-teach learn/k8s: 1 record(s) review-due; 1 reference doc(s) with a stale citation; last attempt 2/3 on 0001-x');
  // An attempt alone is enough to print the line.
  const quiet = repo({ due: false, attempt: true });
  assert.equal(workspaceBrief(quiet.ws, quiet.vault, NOW, 'learn/k8s'),
    'research-teach learn/k8s: 0 record(s) review-due; 0 reference doc(s) with a stale citation; last attempt 2/3 on 0001-x');
});

test('workspaceBrief is empty when nothing is due and there is no attempt', () => {
  const { vault, ws } = repo({ due: false });
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'), '');
});

test('workspaceBrief without reminders leaves out the review-due count (issue 79 D2)', () => {
  const { vault, ws } = repo({ reminders: false, attempt: true });
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'),
    'research-teach learn/k8s: 1 reference doc(s) with a stale citation; last attempt 2/3 on 0001-x');
  const quiet = repo({ reminders: false, due: false });
  assert.equal(workspaceBrief(quiet.ws, quiet.vault, NOW, 'learn/k8s'), '');
});

// Issue 79 D6: a task attempt is named by its summary, never a score.
test('workspaceBrief names a task attempt by its summary (issue 79 D6)', () => {
  const { vault, ws } = repo({ reminders: false, due: false });
  mkdirSync(join(ws, 'attempts'), { recursive: true });
  writeFileSync(join(ws, 'attempts', 'a-20260101-120000-0001.md'),
    '---\ntype: attempt\ndate: 2026-01-01\nlesson: 0001-x\ntotal: 3\nwrong: [0, 1, 2]\nrecords: []\npassed: []\nfailed: [a-exists]\nunreached: [b-exists, b-text]\ntested: []\n---\n');
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'),
    'research-teach learn/k8s: 0 reference doc(s) with a stale citation; last attempt on 0001-x: failed a-exists; not reached b-exists, b-text');
  writeFileSync(join(ws, 'attempts', 'a-20260101-120001-0001.md'),
    '---\ntype: attempt\ndate: 2026-01-01\nlesson: 0001-x\ntotal: 1\nwrong: [0]\nrecords: []\ntested: []\nanswered: [b-text]\n---\n');
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'),
    'research-teach learn/k8s: 0 reference doc(s) with a stale citation; last attempt on 0001-x: answered b-text');
});

test('CLI prints the workspace line after the summary line', () => {
  const { root, vault } = repo();
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root }), cwd: root, env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], `research-vault: 2 entries; 1 stale; ${vault} (project)`);
  assert.equal(lines[1], 'research-teach learn/k8s: 1 record(s) review-due; 1 reference doc(s) with a stale citation');
  assert.equal(lines.length, 2);
});

test('CLI outside a bound repo prints the summary line only', () => {
  const { vault } = repo();
  // cwd has no .research-vault.json but holds a workspace with a review-due learning record.
  const elsewhere = tmpVault('rv-sessionstart-cwd-');
  mkdirSync(join(elsewhere, 'ws', 'learning-records'), { recursive: true });
  writeFileSync(join(elsewhere, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(elsewhere, 'ws', 'learning-records', '0001-a.md'), record(day(21 + 1)));
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: elsewhere }), cwd: elsewhere, env: testEnv({ RESEARCH_VAULT_PATH: vault }), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `research-vault: 2 entries; 1 stale; ${vault} (env)\n`);
});

test('SessionStart stays silent for a refused outside vault', (t) => {
  const fixture = outsideVaultRepo(t);
  const { cwd } = fixture;
  const result = spawnSync(process.execPath, [HOOK], {
    cwd, env: testEnv(), encoding: 'utf8', input: JSON.stringify({ cwd }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assertVaultUntouched(fixture);
});

// Issue 72 item 13: in a research-vault checkout whose claims reviewer is not the one of the running plugin, the hook says so.
test('CLI names a checkout whose claims reviewer differs from the plugin running the session (issue 72 item 13)', () => {
  const run = (cwd, vault) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd }), cwd, env: testEnv({ RESEARCH_VAULT_PATH: vault }), encoding: 'utf8', timeout: 20000 });
  const own = readFileSync(join(dirname(HOOK), '..', 'agents', 'claims-reviewer.md'));
  const checkout = (dir, name, body) => {
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }) + '\n');
    writeFileSync(join(dir, 'agents', 'claims-reviewer.md'), body);
    spawnSync('git', ['-C', dir, 'init', '-q'], { env: testEnv() });
  };
  for (const [name, body, notice] of [['research-vault', 'another reviewer\n', true], ['research-vault', own, false], ['something-else', 'another reviewer\n', false]]) {
    const { root, vault } = repo({ due: false });
    checkout(root, name, body);
    const r = run(root, vault);
    assert.equal(r.status, 0);
    assert.equal(/claims reviewer/.test(r.stdout), notice, `${name}: ${r.stdout}`);
    if (notice) assert.ok(r.stdout.includes(`--plugin-dir ${realpathSync(root)}`), r.stdout);
  }
  // A checkout inside the bound repo, as a worktree is: its own reviewer decides, and the advice names it.
  const { root, vault } = repo({ due: false });
  checkout(root, 'research-vault', own);
  const inner = join(root, 'wt');
  checkout(inner, 'research-vault', 'another reviewer\n');
  const r = run(inner, vault);
  assert.ok(r.stdout.includes(`--plugin-dir ${realpathSync(inner)}`), r.stdout);
  checkout(inner, 'research-vault', own);
  writeFileSync(join(root, 'agents', 'claims-reviewer.md'), 'another reviewer\n');
  assert.ok(!/claims reviewer/.test(run(inner, vault).stdout));
});

function sessionFixture(t) {
  const root = tmpVault('rv-summary-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'repo'); mkdirSync(cwd);
  const home = join(root, 'home'); mkdirSync(home);
  const env = testEnv({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), APPDATA: join(home, 'config'), LOCALAPPDATA: join(home, 'data') });
  const run = () => spawnSync(process.execPath, [HOOK], { cwd, env: testEnv(env), input: JSON.stringify({ cwd }), encoding: 'utf8', timeout: 20000 });
  return { root, cwd, home, env, run };
}

for (const source of ['config', 'default']) {
  test(`session summary names the ${source} vault`, t => {
    const f = sessionFixture(t);
    const folder = process.platform === 'darwin' ? join(f.home, 'Library', 'Application Support', 'research-vault') : join(f.home, source === 'config' ? 'config' : 'data', 'research-vault');
    const vault = source === 'config' ? join(f.root, 'vault') : folder;
    runInit({ vaultPath: vault });
    if (source === 'config') {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'config.json'), JSON.stringify({ vaultPath: vault }));
    }
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `research-vault: 0 entries; 0 stale; ${vault} (${source})\n`);
  });
}

test('session summary escapes newline escape and format characters in a vault path', t => {
  const f = sessionFixture(t);
  const vault = join(f.root, 'vault-\n-\u001b-\u202e');
  try { mkdirSync(vault); } catch (e) {
    if (['EPERM', 'EINVAL', 'EILSEQ'].includes(e.code)) return t.skip(`filesystem refused control characters: ${e.code}`);
    throw e;
  }
  runInit({ vaultPath: vault });
  f.env.RESEARCH_VAULT_PATH = vault;
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `research-vault: 0 entries; 0 stale; ${join(f.root, 'vault-\\u000a-\\u001b-\\u202e')} (env)\n`);
  assert.doesNotMatch(r.stdout.slice(0, -1), /[\p{Cc}\p{Cf}]/u);
});
