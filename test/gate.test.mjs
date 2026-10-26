import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpVault, put, fixtureVault } from './helpers.mjs';
import {
  LEDGER_FILENAME, contentHash, ledgerKey, recordVerdict, gateStatus,
  evidenceFor, renderEvidence, findWorkspaces, gatedFiles,
} from '../bin/lib/gate.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gate');

function draft(content = 'draft body\n') {
  const root = tmpVault('rv-gate-');
  const file = join(root, 'draft.md');
  writeFileSync(file, content);
  return { root, file };
}

test('recordVerdict appends a row keyed to the current hash and gateStatus finds it', () => {
  const { root, file } = draft('hello\n');
  const row = recordVerdict(root, file, 'PASS', 'checked');
  assert.equal(row.event, 'claims');
  assert.equal(row.file, 'draft.md');
  assert.equal(row.note, 'checked');
  const lines = readFileSync(join(root, LEDGER_FILENAME), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), row);
  const s = gateStatus(root, file);
  assert.equal(s.verdict, 'PASS');
  assert.equal(s.sha256, contentHash('hello\n'));
  assert.equal(s.ts, row.ts);
  assert.ok(!('note' in recordVerdict(root, file, 'MERIT')), 'note omitted when absent');
});

test('gateStatus skips a malformed ledger line', () => {
  const { root, file } = draft('hello\n');
  appendFileSync(join(root, LEDGER_FILENAME), '{not json\n');
  recordVerdict(root, file, 'PASS');
  assert.equal(gateStatus(root, file).verdict, 'PASS');
});

test('gateStatus returns null after the file changes', () => {
  const { root, file } = draft();
  recordVerdict(root, file, 'PASS');
  assert.equal(gateStatus(root, file).verdict, 'PASS');
  appendFileSync(file, 'x');
  const s = gateStatus(root, file);
  assert.equal(s.verdict, null);
  assert.equal(s.ts, null);
  assert.equal(s.sha256, contentHash(readFileSync(file, 'utf8')));
});

test('a FAIL-as-sent row never satisfies gateStatus', () => {
  const { root, file } = draft();
  recordVerdict(root, file, 'FAIL-as-sent');
  assert.equal(gateStatus(root, file).verdict, null);
  recordVerdict(root, file, 'MERIT');
  assert.equal(gateStatus(root, file).verdict, 'MERIT');
});

test('recordVerdict rejects an unknown verdict and writes nothing', () => {
  const { root, file } = draft();
  assert.throws(() => recordVerdict(root, file, 'pass'),
    { message: 'verdict must be one of PASS, FAIL-as-sent, MERIT' });
  assert.equal(existsSync(join(root, LEDGER_FILENAME)), false);
});

test('ledgerKey is repo-relative with forward slashes', () => {
  const root = tmpVault('rv-gate-');
  mkdirSync(join(root, 'docs', 'drafts'), { recursive: true });
  assert.equal(ledgerKey(root, join(root, 'docs', 'drafts', 'a.md')), 'docs/drafts/a.md');
  assert.equal(ledgerKey(root, './docs/drafts/a.md'), 'docs/drafts/a.md');
  assert.equal(ledgerKey(root, 'docs\\drafts\\a.md'), 'docs/drafts/a.md');
});

test('evidenceFor resolves cited ids and URLs, flags stale and no-body, lists uncovered', () => {
  const vault = fixtureVault();
  const { file } = draft([
    'See [doc](https://example.org/fx), 2026-01-01-fx-doc-nobody, 2026-01-01-fx-experiment,',
    '2026-01-01-old and https://nowhere.example/x.',
  ].join('\n'));
  const r = evidenceFor(file, vault);
  assert.deepEqual(r.entries.map((e) => e.id),
    ['2026-01-01-fx-doc', '2026-01-01-fx-doc-nobody', '2026-01-01-fx-experiment', '2026-01-01-old']);
  assert.deepEqual(r.entries.filter((e) => e.noBody).map((e) => e.id), ['2026-01-01-fx-doc-nobody']);
  assert.deepEqual(r.entries.filter((e) => e.stale).map((e) => e.id), ['2026-01-01-old']);
  assert.deepEqual(r.entries[0], { id: '2026-01-01-fx-doc', type: 'source', status: 'active', stale: false, noBody: false });
  assert.deepEqual(r.uncovered, [{ type: 'url', value: 'https://nowhere.example/x' }]);
});

test('evidenceFor merges --extra ids and does not throw on a malformed URL', () => {
  const vault = fixtureVault();
  const { file } = draft('Broken link http://[bad and 2026-01-01-fx-experiment.\n');
  const r = evidenceFor(file, vault, { extra: ['2026-01-01-fx-doc', '2026-01-01-fx-experiment', '2026-09-09-missing'] });
  assert.deepEqual(r.entries.map((e) => e.id), ['2026-01-01-fx-doc', '2026-01-01-fx-experiment']);
  assert.deepEqual(r.uncovered, [{ type: 'url', value: 'http://[bad' }, { type: 'id', value: '2026-09-09-missing' }]);
  const fx = evidenceFor(join(FIXTURES, 'lesson-ok.html'), vault);
  assert.deepEqual(fx.entries.map((e) => e.id),
    ['2026-01-01-fx-doc', '2026-01-01-fx-doc-nobody', '2026-01-01-fx-experiment']);
  assert.deepEqual(fx.uncovered, []);
});

test('renderEvidence prints one line per entry and an uncovered line', () => {
  const out = renderEvidence({
    entries: [
      { id: '2026-01-01-a', type: 'source', status: 'active', stale: false, noBody: true },
      { id: '2026-01-01-b', type: 'note', status: 'active', stale: true, noBody: false },
      { id: '2026-01-01-c', type: 'experiment', status: 'active', stale: false, noBody: false },
    ],
    uncovered: [{ type: 'url', value: 'https://nowhere.example/x' }],
  });
  assert.equal(out, [
    '2026-01-01-a [source, active, no-body]',
    '2026-01-01-b [note, active, STALE]',
    '2026-01-01-c [experiment, active]',
    'uncovered: https://nowhere.example/x',
  ].join('\n') + '\n');
});

function workspaceRepo() {
  const root = tmpVault('rv-gate-repo-');
  const mk = (rel, files = {}) => {
    mkdirSync(join(root, rel), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, rel, name), text);
  };
  mk('learn/k8s', { 'MISSION.md': '# m\n' });
  mk('learn/k8s/lessons', { 'one.html': 'x', 'notes.md': 'x' });
  mk('learn/k8s/reference', { 'ref.html': 'x' });
  mk('top', { 'MISSION.md': '# m\n' });
  mk('node_modules/pkg', { 'MISSION.md': '# m\n' });
  mk('.git/x', { 'MISSION.md': '# m\n' });
  mk('research/notes', { 'MISSION.md': '# m\n' });
  mk('_index/x', { 'MISSION.md': '# m\n' });
  mk('docs/drafts', { 'reply.md': 'x', 'other.txt': 'x' });
  return { root, vault: join(root, 'research') };
}

test('findWorkspaces skips node_modules, .git and the vault', () => {
  const { root, vault } = workspaceRepo();
  assert.deepEqual(findWorkspaces(root, vault).sort(), [join(root, 'learn/k8s'), join(root, 'top')]);
});

test('findWorkspaces skips an unreadable directory and keeps walking', (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores mode bits');
  const { root, vault } = workspaceRepo();
  mkdirSync(join(root, 'locked'));
  chmodSync(join(root, 'locked'), 0o000);
  try {
    assert.deepEqual(findWorkspaces(root, vault).sort(), [join(root, 'learn/k8s'), join(root, 'top')]);
  } finally {
    chmodSync(join(root, 'locked'), 0o755);
  }
});

test('gatedFiles returns workspace lessons and reference docs plus gates.globs', () => {
  const { root, vault } = workspaceRepo();
  const want = [
    join(root, 'learn/k8s/lessons/one.html'),
    join(root, 'learn/k8s/reference/ref.html'),
  ];
  assert.deepEqual(gatedFiles(root, vault, {}).sort(), want);
  assert.deepEqual(gatedFiles(root, vault, { gates: { globs: ['docs/drafts/*.md'] } }).sort(),
    [join(root, 'docs/drafts/reply.md'), ...want].sort());
});

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');

function gateCli(cwd, vault, ...args) {
  const r = spawnSync(process.execPath, [CLI, 'gate', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, RESEARCH_VAULT_PATH: vault },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function boundRepo(vault) {
  const root = tmpVault('rv-gate-cli-');
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault }) + '\n');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'reply.md'), 'See 2026-01-01-fx-experiment and https://nowhere.example/x.\n');
  return root;
}

test('CLI gate record then status --check exits 0, after an edit exits 1', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const sha = contentHash(readFileSync(join(root, 'docs', 'reply.md'), 'utf8')).slice(0, 12);
  const rec = gateCli(root, vault, 'record', 'docs/reply.md', 'PASS', 'checked');
  assert.equal(rec.code, 0, rec.err);
  assert.equal(rec.out, `recorded claims PASS for docs/reply.md @ ${sha}\n`);
  const ok = gateCli(join(root, 'docs'), vault, 'status', 'reply.md', '--check');
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out, `docs/reply.md: PASS @ ${sha}\n`);
  appendFileSync(join(root, 'docs', 'reply.md'), 'edit\n');
  const sha2 = contentHash(readFileSync(join(root, 'docs', 'reply.md'), 'utf8')).slice(0, 12);
  const stale = gateCli(root, vault, 'status', 'docs/reply.md', '--check');
  assert.equal(stale.code, 1);
  assert.equal(stale.out, `docs/reply.md: none @ ${sha2}\n`);
  assert.equal(gateCli(root, vault, 'status', 'docs/reply.md').code, 0, 'without --check a missing verdict exits 0');
});

test('CLI gate record rejects a bad verdict with exit 2 and no ledger', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const r = gateCli(root, vault, 'record', 'docs/reply.md', 'pass');
  assert.equal(r.code, 2);
  assert.match(r.err, /^usage: research-vault gate evidence <draft> \[--extra ids\] \[--json\] \| record <file> <PASS\|FAIL-as-sent\|MERIT> \[note\] \| status <file> \[--check\]$/m);
  assert.equal(existsSync(join(root, LEDGER_FILENAME)), false);
  assert.equal(gateCli(root, vault, 'bogus').code, 2);
  assert.equal(gateCli(root, vault).code, 2);
});

test('CLI gate evidence prints the entry lines and uncovered lines', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const r = gateCli(root, vault, 'evidence', 'docs/reply.md', '--extra', '2026-01-01-fx-doc');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, [
    '2026-01-01-fx-doc [source, active]',
    '2026-01-01-fx-experiment [experiment, active]',
    'uncovered: https://nowhere.example/x',
  ].join('\n') + '\n');
  const j = gateCli(root, vault, 'evidence', 'docs/reply.md', '--json');
  assert.equal(j.code, 0, j.err);
  const parsed = JSON.parse(j.out);
  assert.deepEqual(parsed.entries.map((e) => e.id), ['2026-01-01-fx-experiment']);
  assert.deepEqual(parsed.uncovered, [{ type: 'url', value: 'https://nowhere.example/x' }]);
});

test('CLI gate evidence from a subdirectory with a relative project vault lists the entries', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: relative(root, vault) }) + '\n');
  const r = gateCli(join(root, 'docs'), '/nonexistent-env-vault', 'evidence', 'reply.md');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, ['2026-01-01-fx-experiment [experiment, active]', 'uncovered: https://nowhere.example/x'].join('\n') + '\n');
});

test('CLI gate record and status work for a vault entry outside any bound repo', () => {
  const vault = fixtureVault();
  const rel = 'experiments/2026-01-01-fx-experiment.md';
  const file = join(vault, rel);
  const parent = dirname(vault);
  const sha = contentHash(readFileSync(file, 'utf8')).slice(0, 12);
  const rec = gateCli(parent, vault, 'record', file, 'PASS');
  assert.equal(rec.code, 0, rec.err);
  assert.equal(rec.out, `recorded claims PASS for ${rel} @ ${sha}\n`);
  assert.ok(existsSync(join(vault, LEDGER_FILENAME)), 'ledger lives in the vault');
  const st = gateCli(parent, vault, 'status', file, '--check');
  assert.equal(st.code, 0, st.err);
  assert.equal(st.out, `${rel}: PASS @ ${sha}\n`);
  assert.equal(gateCli(parent, vault, 'evidence', file).code, 0);
});

test('CLI gate outside a bound repo exits 2', () => {
  const vault = fixtureVault();
  const root = tmpVault('rv-gate-unbound-');
  writeFileSync(join(root, 'x.md'), 'x\n');
  const r = gateCli(root, vault, 'status', 'x.md');
  assert.equal(r.code, 2);
  assert.equal(r.err, `gate: x.md is not inside a repo bound with .research-vault.json\n`);
});
