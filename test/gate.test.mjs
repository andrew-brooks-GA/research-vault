import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync, chmodSync, mkdtempSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { tmpVault, put, fixtureVault } from './helpers.mjs';
import {
  unitHashes, changedUnits, mdUnits,
  LEDGER_FILENAME, contentHash, ledgerKey, recordVerdict, gateStatus, reviewerHash,
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

test('findWorkspaces skips .idea and _attachments', () => {
  const { root, vault } = workspaceRepo();
  for (const d of ['.idea/ws', '_attachments/ws']) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, 'MISSION.md'), '# m\n');
  }
  const found = findWorkspaces(root, vault);
  assert.ok(found.includes(join(root, 'learn/k8s')), 'a workspace outside the skipped dirs is found');
  assert.ok(!found.includes(join(root, '.idea/ws')), '.idea is skipped');
  assert.ok(!found.includes(join(root, '_attachments/ws')), '_attachments is skipped');
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

test('CLI gate staged lists staged gated files and --check exits 1 until each has a verdict', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault, gates: { globs: ['docs/*.md'] } }) + '\n');
  writeFileSync(join(root, 'docs', 'second.md'), 'Second draft.\n');
  writeFileSync(join(root, 'README.md'), 'not gated\n');
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', 'docs/reply.md', 'docs/second.md', 'README.md');
  const missing = gateCli(root, vault, 'staged', '--check');
  assert.equal(missing.code, 1, missing.err);
  assert.equal(missing.out, 'docs/reply.md: none\ndocs/second.md: none\n');
  assert.equal(gateCli(root, vault, 'staged').code, 0, 'without --check a missing verdict exits 0');
  gateCli(root, vault, 'record', 'docs/reply.md', 'PASS');
  const half = gateCli(join(root, 'docs'), vault, 'staged', '--check');
  assert.equal(half.code, 1, 'one of two still has no verdict');
  assert.equal(half.out, 'docs/reply.md: PASS\ndocs/second.md: none\n');
  gateCli(root, vault, 'record', 'docs/second.md', 'MERIT');
  const ok = gateCli(join(root, 'docs'), vault, 'staged', '--check');
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out, 'docs/reply.md: PASS\ndocs/second.md: MERIT\n');
  git('reset', '-q');
  assert.equal(gateCli(root, vault, 'staged', '--check').out, 'staged gated files: none\n');
});

test('CLI gate record rejects a bad verdict with exit 2 and no ledger', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const r = gateCli(root, vault, 'record', 'docs/reply.md', 'pass');
  assert.equal(r.code, 2);
  assert.match(r.err, /^usage: research-vault gate evidence <draft> \[--extra ids\] \[--changed\] \[--json\] \| changed <draft> \| record <file> <PASS\|FAIL-as-sent\|MERIT> \[note\] \| status <file> \[--check\] \| staged \[--check\]$/m);
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

test('per-unit gate: an edit reopens only the units it touched, and a unit passed in any row keeps its verdict', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rv-gate-units-'));
  writeFileSync(join(repo, '.research-vault.json'), JSON.stringify({ vault: 'vault' }) + '\n');
  const lesson = (p2) => `<!doctype html><html><body data-lesson="0001-x">
<section data-block="mission"><p>m</p></section>
<section data-block="fact"><p>one <a data-cite="a">a</a></p><p>${p2} <a data-cite="b">b</a></p></section>
<section data-block="quiz"><script type="application/json" data-quiz>{"items":[{"q":"q1","options":["a","b","c"],"correct":0,"why":["","",""]},{"q":"q2","options":["a","b","c"],"correct":1,"why":["","",""]}]}</script></section>
<section data-block="step"><p>s</p></section>
</body></html>`;
  const f = join(repo, 'l.html');
  writeFileSync(f, lesson('two'));
  const u = unitHashes(readFileSync(f));
  assert.deepEqual(Object.keys(u).sort(), ['fact:0', 'fact:1', 'mission', 'quiz:0', 'quiz:1', 'step']);
  assert.deepEqual(changedUnits(repo, f).sort(), ['fact:0', 'fact:1', 'mission', 'quiz:0', 'quiz:1', 'step'], 'nothing recorded yet: every unit is pending');
  recordVerdict(repo, f, 'PASS');
  assert.equal(gateStatus(repo, f).verdict, 'PASS');
  assert.deepEqual(changedUnits(repo, f), []);
  // Edit the second fact paragraph only.
  writeFileSync(f, lesson('two, revised'));
  assert.deepEqual(changedUnits(repo, f), ['fact:1']);
  const s1 = gateStatus(repo, f);
  assert.equal(s1.verdict, null);
  assert.deepEqual(s1.units, ['fact:1']);
  recordVerdict(repo, f, 'MERIT', 'fact:1 reviewed');
  assert.equal(gateStatus(repo, f).verdict, 'MERIT');
  // Revert that paragraph: these exact bytes have no row, but every unit was passed in some row.
  writeFileSync(f, lesson('two'));
  assert.deepEqual(changedUnits(repo, f), []);
  assert.equal(gateStatus(repo, f).verdict, 'PASS');
  // A FAIL row covers nothing.
  writeFileSync(f, lesson('three'));
  recordVerdict(repo, f, 'FAIL-as-sent');
  assert.deepEqual(changedUnits(repo, f), ['fact:1']);
  assert.equal(gateStatus(repo, f).verdict, null);
  // A draft without data-block elements is one unit.
  writeFileSync(f, '<p>plain</p>');
  assert.deepEqual(Object.keys(unitHashes(readFileSync(f))), ['all']);
});

test('a Markdown draft is one unit per heading section, and an edit reopens only its section', () => {
  const { root, file } = draft('intro line\n\n# Title\n\ntext a\n\n## Gate\n\nclaim one\n\n```sh\n# not a heading\n```\n\n## Gate\n\ndup heading\n');
  assert.deepEqual(Object.keys(unitHashes(readFileSync(file))), ['sec:preamble', 'sec:title', 'sec:gate', 'sec:gate#']);
  assert.deepEqual(mdUnits(readFileSync(file, 'utf8')).map((u) => [u.unit, u.start, u.end]), [['sec:preamble', 1, 1], ['sec:title', 3, 5], ['sec:gate', 7, 13], ['sec:gate#', 15, 17]]);
  assert.deepEqual(unitHashes('no headings here\n'), { all: contentHash('no headings here\n') });
  recordVerdict(root, file, 'PASS');
  assert.deepEqual(changedUnits(root, file), []);
  writeFileSync(file, readFileSync(file, 'utf8').replace('claim one', 'claim one, revised'));
  assert.deepEqual(changedUnits(root, file), ['sec:gate']);
  assert.equal(gateStatus(root, file).verdict, null);
  recordVerdict(root, file, 'MERIT');
  assert.equal(gateStatus(root, file).verdict, 'MERIT');
});

test('a Markdown table row is its own unit keyed by its first cell, and gate evidence --changed after a one-row edit lists that row only', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const md = (init) => `# Ref\n\n## Commands\n\nIntro.\n\n| Command | Does |\n|---|---|\n| \`init\` | ${init} |\n| \`gate\` | \`a\\|b\` |\n| \`gate\` | dup |\n\nAfter.\n\n| not | a table |\n`;
  writeFileSync(join(root, 'docs', 'ref.md'), md('Scaffold.'));
  assert.deepEqual(mdUnits(md('Scaffold.')).map((u) => [u.unit, u.start, u.end]), [
    ['sec:ref', 1, 1], ['sec:commands', 3, 15], ['sec:commands/init', 9, 9], ['sec:commands/gate', 10, 10], ['sec:commands/gate#', 11, 11],
  ]);
  assert.deepEqual(unitHashes('# A\n\ntext\n'), { 'sec:a': contentHash('# A\n\ntext') }, 'a section without a table hashes as before');
  assert.equal(gateCli(root, vault, 'record', 'docs/ref.md', 'PASS').code, 0);
  writeFileSync(join(root, 'docs', 'ref.md'), md('Scaffold a vault.'));
  const r = gateCli(root, vault, 'evidence', 'docs/ref.md', '--changed');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'changed units: sec:commands/init\nunit sec:commands/init docs/ref.md:9-9 prose\n');
  // Prose outside the table still reopens the section, and only the section.
  writeFileSync(join(root, 'docs', 'ref.md'), md('Scaffold.').replace('Intro.', 'Intro, revised.'));
  assert.deepEqual(changedUnits(root, join(root, 'docs', 'ref.md')), ['sec:commands']);
});

test('unitHashes over the shared parseBlocks keeps the hashes ledger rows were keyed to (spec 13)', () => {
  const f = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'teach', 'lessons', '0001-good.html');
  assert.deepEqual(unitHashes(readFileSync(f)), {
    prereq: 'a2f78466c34816b23168b1d3a8d6197e591900357ac054ade858f1f2f137b06e',
    mission: '1e495a726619cc2b3d278a380870119ef5c906d411b8aa374c949af8c4093b9d',
    model: '829e24c9448fe39cb19782cc284912b594e307fef6f83d248dcc0e85eef744fe',
    'fact:0': 'ad47b501da76642ec606c953af1346f5bff9952302b527710a56a33a5d2de653',
    'fact:1': '3b91005be86f18c73d5e3c7a7cee5036afa1cadd975ca56c22f09632a544b6e0',
    example: '593926b55cc55250c2cae84b875476dec4cdfb6f89d8f2d14e8a60808b4f20bd',
    'quiz:0': 'db7c2f7d4a137ed47e0670825b3e8d2b1c913daf2b230d7c4c8a1784659d396d',
    'quiz:1': '1314fa197610cc4d88eab76955c7178ea233d4c90c577eb5e5468c7cbd9e125c',
    'quiz:2': 'dd6315f923221f2ad643a98e193b61e94037229cec8025ea8d4d6baf322aaf4a',
    step: 'ac86fe13d81803cbc782f402f66bffc4dba25a91e1d21505b1c0a61c38dcff30',
    sources: 'a3139580587c951b4271a1b2aa488e43690dfd6917b3439b6e91a11e7a698451',
    followup: '0d56143cfcdc326c0c4dbc65b9615fc233150b86346e096865780ef9e2dcf81e',
  });
});

// ---- code links (spec 15 D4) ----
import { codeRepo, LUA_A } from './helpers.mjs';
import { codeLang } from '../bin/lib/gate.mjs';
import { LANGS } from '../bin/lib/codelinks.mjs';
import { parseProjectConfig } from '../bin/lib/projectconfig.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';

function codeCli(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, 'gate', ...args], { cwd, encoding: 'utf8', env: { ...process.env, RESEARCH_VAULT_PATH: '/nonexistent-env-vault' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('a linked declaration is a sym: unit: the ledger keys it, an edit outside it passes by unit, a move keeps it', () => {
  const { root } = codeRepo();
  const a = join(root, 'src', 'a.lua');
  assert.deepEqual(codeLang(root, a).lang, LANGS['.lua']);
  assert.equal(codeLang(root, join(root, 'docs', 'd.md')), null);
  assert.deepEqual(changedUnits(root, a), ['sym:f']);
  assert.equal(gateStatus(root, a).verdict, null);
  const row = recordVerdict(root, a, 'MERIT', 'in-game call not runnable here');
  assert.deepEqual(Object.keys(row.units), ['sym:f']);
  assert.equal(gateStatus(root, a).verdict, 'MERIT');
  // An edit outside every unit (the file header) passes by unit; a body edit reopens the unit.
  writeFileSync(a, LUA_A.replace('local _, ns = ...', 'local addon, ns = ...'));
  assert.deepEqual(changedUnits(root, a), []);
  assert.equal(gateStatus(root, a).verdict, 'MERIT (by unit)');
  writeFileSync(a, LUA_A.replace('  return 1', '  return 2'));
  assert.deepEqual(changedUnits(root, a), ['sym:f']);
  assert.equal(gateStatus(root, a).verdict, null);
  // Moving the whole block to the end of the file leaves its hash, and the verdict, in place.
  const block = '-- per 2026-01-01-fx-doc\nlocal function f()\n  return 1\nend\n';
  writeFileSync(a, LUA_A.replace(block, '') + 'function ns.other()\nend\n\n' + block);
  assert.equal(gateStatus(root, a).verdict, 'MERIT (by unit)');
  // A pin bump is not a change to the unit.
  writeFileSync(a, LUA_A.replace('2026-01-01-fx-doc', '2026-01-01-fx-doc@dep=1.2.3'));
  recordVerdict(root, a, 'PASS');
  writeFileSync(a, LUA_A.replace('2026-01-01-fx-doc', '2026-01-01-fx-doc@dep=9'));
  assert.equal(gateStatus(root, a).verdict, 'PASS (by unit)');
});

test('gatedFiles includes a code.globs file only when it has an attached link', () => {
  const { root, vault, cfg } = codeRepo();
  writeFileSync(join(root, 'src', 'plain.lua'), 'local x = 1\n');
  writeFileSync(join(root, 'src', 'loose.lua'), '-- 2026-01-01-fx-doc\n  local function nested() end\n');
  const parsed = parseProjectConfig(readFileSync(join(root, '.research-vault.json'), 'utf8'), loadSchema(process.cwd()));
  assert.deepEqual(gatedFiles(root, vault, parsed), [join(root, 'src', 'a.lua'), join(root, 'src', 'b.lua')]);
  assert.deepEqual(gatedFiles(root, vault, { ...cfg, code: undefined }), [], 'no code block, no code file gated');
});

test('CLI gate evidence --changed on a code file prints the entry lines, the changed sym: units and one unit line each', () => {
  const { root } = codeRepo();
  writeFileSync(join(root, 'src', 'c.lua'), [
    '-- per 2026-01-01-fx-doc@dep=1.0.0', 'function ns.behind()', 'end', '',
    '-- per 2026-01-01-fx-experiment', '-- and 2026-01-01-old', 'function ns.two()', '  return 1', 'end', '',
    'function ns.plain()', 'end', '',
  ].join('\n'));
  const r = codeCli(root, 'evidence', 'src/c.lua', '--changed');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, [
    '2026-01-01-fx-doc [source, active]',
    '2026-01-01-fx-experiment [experiment, active]',
    '2026-01-01-old [note, active, STALE]',
    'changed units: sym:ns.behind, sym:ns.two',
    'unit sym:ns.behind src/c.lua:1-3 stale (dep 1.0.0 -> 1.2.3)',
    'unit sym:ns.two src/c.lua:5-9 stale (time)',
  ].join('\n') + '\n');
  const rec = codeCli(root, 'record', 'src/c.lua', 'PASS');
  assert.equal(rec.code, 0, rec.err);
  const ledger = JSON.parse(readFileSync(join(root, LEDGER_FILENAME), 'utf8').trim());
  assert.deepEqual(Object.keys(ledger.units), ['sym:ns.behind', 'sym:ns.two']);
  assert.equal(codeCli(root, 'status', 'src/c.lua', '--check').code, 0);
  const j = JSON.parse(codeCli(root, 'evidence', 'src/c.lua', '--json').out);
  assert.deepEqual(j.units.map((u) => u.unit), ['sym:ns.behind', 'sym:ns.two']);
});

// Absent state (spec 15 D7): one argument is today's { all }; a .lua file in a repo without a code
// block is one unit; evidence --changed on a markdown draft is today's output with no unit line.
test('unitHashes and gate evidence without a code block are today\'s', () => {
  assert.deepEqual(unitHashes(Buffer.from(LUA_A)), { all: '08a740866bb6fbb6fa7810b5f84c52a7904346fd5adb38391f979829afdf18d2' });
  const { root } = codeRepo({ code: false });
  assert.deepEqual(changedUnits(root, join(root, 'src', 'a.lua')), ['all']);
  assert.equal(codeLang(root, join(root, 'src', 'a.lua')), null);
  writeFileSync(join(root, 'docs', 'reply.md'), 'See 2026-01-01-fx-experiment and https://nowhere.example/x.\n');
  const r = codeCli(root, 'evidence', 'docs/reply.md', '--changed');
  assert.equal(r.out, '2026-01-01-fx-experiment [experiment, active]\nuncovered: https://nowhere.example/x\nchanged units: all\n');
  assert.doesNotMatch(r.out, /^unit /m);
});

test('a row carries the reviewer hash; a row from another reviewer counts for nothing; a row without the field keeps standing (spec 18 D3)', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const file = join(root, 'docs', 'reply.md');
  writeFileSync(file, 'hello\n\n## One\n\ntext\n');
  const row = recordVerdict(root, file, 'PASS');
  assert.equal(row.reviewer, contentHash(readFileSync(join(process.cwd(), 'agents', 'claims-reviewer.md'))));
  assert.equal(reviewerHash(), row.reviewer);
  assert.equal(gateStatus(root, file).verdict, 'PASS');
  const ledger = join(root, LEDGER_FILENAME);
  writeFileSync(ledger, JSON.stringify({ ...row, reviewer: 'f'.repeat(64) }) + '\n');
  const s = gateStatus(root, file);
  assert.equal(s.verdict, null);
  assert.equal(s.reviewerChanged, true);
  assert.deepEqual(changedUnits(root, file), ['sec:preamble', 'sec:one'], 'its units cover nothing');
  const r = gateCli(root, vault, 'status', 'docs/reply.md');
  assert.ok(r.out.startsWith('docs/reply.md: none (reviewer changed) @ '), r.out);
  const { reviewer, ...old } = row;
  writeFileSync(ledger, JSON.stringify(old) + '\n');
  const t = gateStatus(root, file);
  assert.equal(t.verdict, 'PASS');
  assert.ok(!('reviewerChanged' in t));
});
