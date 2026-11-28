import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync, chmodSync, mkdtempSync, rmSync, utimesSync, cpSync, realpathSync, readdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, tmpVault, put, fixtureVault, testEnv } from './helpers.mjs';
import { missingGates } from '../hooks/stop-gate.mjs';
import { run as gateRun } from '../bin/commands/gate.mjs';
import { VAULT_PATH_OUTSIDE } from '../bin/lib/containment.ts';
import {
  unitHashes, changedUnits, mdUnits,
  LEDGER_FILENAME, contentHash, ledgerKey, recordVerdict, gateStatus, reviewerHash,
  evidenceFor, renderEvidence, findWorkspaces, gatedFiles, referencedImages, taskFile,
} from '../bin/lib/gate.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gate');

test('gate record refuses a draft linked outside the vault', async (t) => {
  const root = realpathSync(codeRepo({ code: false }).root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, 'research');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  const other = join(outside, 'draft.md');
  const bytes = Buffer.from('# Outside draft fixture\r\n');
  writeFileSync(other, bytes);
  const file = join(vault, 'draft.md');
  try {
    symlinkSync(other, file, 'file');
  } catch (err) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(err.code)) throw err;
    t.skip(`File symlink unavailable (${err.code})`);
    return;
  }
  const names = readdirSync(outside).sort();
  try {
    await assert.rejects(gateRun({ _: ['gate', 'record', file, 'PASS'], cwd: vault, vault }), { code: VAULT_PATH_OUTSIDE });
  } finally {
    assert.deepEqual(readdirSync(outside).sort(), names, 'outside folder names are unchanged');
    assert.deepEqual(readFileSync(other), bytes, 'outside draft bytes are unchanged');
  }
});

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

// S-11: `gate evidence` and the Codex review runner's evidence list print entry values; an id or type from
// an entry cannot add a line or hide text. Tag characters spell "ignore".
test('renderEvidence: an entry id or type cannot add a line or hide text', () => {
  const tags = '\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';
  const out = renderEvidence({
    entries: [{ id: `2026-01-01-a\n2026-01-01-forged [note, active]${tags}`, type: `source${tags}\nuncovered: x`, status: 'active', stale: false, noBody: false }],
    uncovered: [],
  });
  assert.equal(out, '2026-01-01-a 2026-01-01-forged [note, active] [source uncovered: x, active]\n');
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

function runCli(cwd, vault, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', env: testEnv({ RESEARCH_VAULT_PATH: vault }), timeout: 20000,
  });
  let err = r.stderr;
  if (r.error) {
    const signal = r.signal ? ` (${r.signal})` : '';
    err = [r.error.message + signal, r.stderr].filter(Boolean).join('\n');
  }
  return { code: r.status, out: r.stdout, err };
}

const gateCli = (cwd, vault, ...args) => runCli(cwd, vault, 'gate', ...args);

// gate evidence output without its last line, `review hash: <hex>`. Output with no hash line comes back unchanged, so a
// comparison through this helper passes without one (the R-12 tests below pin that the line is present); a hash line
// that is not last is left in, so an exact comparison fails.
const listed = (out) => out.replace(/(^|\n)review hash: [0-9a-f]{64}\n$/, '$1');

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

test('S-12: after a PASS, an edit outside the blocks, a repeated block name or a change to a loaded script reopens a lesson page and keeps it out of the export', (t) => {
  const root = tmpVault('rv-gate-s12-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = fixtureVault(join(root, 'vault'));
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'vault' }) + '\n');
  const lesson = 'lessons/0001-x.html';
  const rel = `ws/${lesson}`;
  const page = join(root, rel);
  const asset = join(root, 'ws/assets/lesson.js');
  mkdirSync(dirname(page), { recursive: true });
  mkdirSync(dirname(asset));
  writeFileSync(join(root, 'ws/MISSION.md'), '# Mission\n');
  const sources = '<section data-block="sources"><p>Sources</p></section>';
  const html = `<!doctype html><html><head><title>Example</title></head><body data-lesson="0001-x">
<section data-block="mission"><p>Mission</p></section>
${sources}
<script src="../assets/lesson.js"></script>
</body></html>\n`;
  const script = 'document.title = "Example";\n';
  writeFileSync(page, html);
  writeFileSync(asset, script);
  const check = () => gateCli(root, vault, 'status', rel, '--check');
  const exportTo = (out) => runCli(root, vault, 'teach', 'export', 'ws', '--out', out);
  const rec = gateCli(root, vault, 'record', rel, 'PASS');
  assert.equal(rec.code, 0, rec.err);
  const passed = check();
  assert.equal(passed.code, 0, passed.err);
  assert.ok(passed.out?.startsWith(`${rel}: PASS @ `), passed.out);
  const baselineOut = join(root, 'export-passed');
  const baseline = exportTo(baselineOut);
  assert.equal(baseline.code, 0, baseline.err);
  assert.ok(existsSync(join(baselineOut, lesson)));

  const cases = [
    ['paragraph between blocks', html.replace(sources, `<p>A new claim.</p>\n${sources}`), script, 'rest'],
    ['second mission block', html.replace(sources, `<section data-block="mission"><p>Another claim.</p></section>\n${sources}`), script, 'mission#2, rest'],
    ['loaded script bytes', html, 'document.title = "Edited";\n', 'script:../assets/lesson.js'],
  ];
  for (const [i, [edit, pageBytes, scriptBytes, units]] of cases.entries()) {
    writeFileSync(page, pageBytes);
    writeFileSync(asset, scriptBytes);
    const status = check();
    assert.equal(status.code, 1, `${edit}\n${status.out ?? ''}${status.err ?? ''}`);
    assert.equal(status.out?.replace(/ @ [0-9a-f]{12} /, ' '), `${rel}: none (changed units: ${units})\n`, edit);
    const out = join(root, `export-${i}`);
    const exported = exportTo(out);
    assert.equal(exported.code, 1, `${edit}\n${exported.out ?? ''}${exported.err ?? ''}`);
    assert.ok(exported.out?.split('\n').includes(`ungated ${lesson}`), `${edit}\n${exported.out}`);
    assert.equal(existsSync(out), false, `${edit} wrote an export`);
  }
});

test('CLI gate staged lists staged gated files and --check exits 1 until each has a verdict', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault, gates: { globs: ['docs/*.md'] } }) + '\n');
  writeFileSync(join(root, 'docs', 'second.md'), 'Second draft.\n');
  writeFileSync(join(root, 'README.md'), 'not gated\n');
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { env: testEnv(), encoding: 'utf8' });
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
  assert.match(r.err, /^usage: research-vault gate evidence <draft> \[--extra ids\] \[--changed\] \[--json\] \[--packet <dir> --run <key>\] \| changed <draft> \| record <file> <PASS\|FAIL-as-sent\|MERIT> \[note\] \[--expect <hash>\] \| status <file> \[--check\] \| staged \[--check\]$/m);
  assert.equal(existsSync(join(root, LEDGER_FILENAME)), false);
  assert.equal(gateCli(root, vault, 'bogus').code, 2);
  assert.equal(gateCli(root, vault).code, 2);
});

test('evidenceFor lists the sources of a listed note once each, and does not follow a note named by a note (spec 52 point 1)', () => {
  const dir = fixtureVault();
  put(dir, 'source', '2026-01-02-deep', { source_type: 'article', source_url: 'https://example.org/deep' });
  put(dir, 'note', '2026-01-02-inner', { sources: ['2026-01-02-deep'], confidence: 'medium' });
  put(dir, 'note', '2026-01-02-n', { sources: ['2026-01-01-fx-doc-nobody', '2026-01-01-fx-doc', '2026-01-02-inner', '2026-01-02-missing'], confidence: 'medium' });
  const draft = join(tmpVault('rv-draft-'), 'd.md');
  writeFileSync(draft, '# D\n\nPer 2026-01-02-n and 2026-01-01-fx-doc, it prints.\n\n## Two\n\nNothing cited here.\n');
  const ids = (o) => evidenceFor(draft, dir, o).entries.map((e) => e.id);
  assert.deepEqual(ids(), ['2026-01-01-fx-doc', '2026-01-01-fx-doc-nobody', '2026-01-02-inner', '2026-01-02-n']);
  assert.equal(evidenceFor(draft, dir).entries.find((e) => e.id === '2026-01-01-fx-doc-nobody').noBody, true);
  assert.deepEqual(ids({ changed: ['sec:d'] }), ['2026-01-01-fx-doc', '2026-01-01-fx-doc-nobody', '2026-01-02-inner', '2026-01-02-n'], '--changed keeps working');
});

test('CLI gate evidence prints the entry lines and uncovered lines', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const r = gateCli(root, vault, 'evidence', 'docs/reply.md', '--extra', '2026-01-01-fx-doc');
  assert.equal(r.code, 0, r.err);
  assert.equal(listed(r.out), [
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
  const root = boundRepo('research');
  fixtureVault(join(root, 'research'));
  const r = gateCli(join(root, 'docs'), '/nonexistent-env-vault', 'evidence', 'reply.md');
  assert.equal(r.code, 0, r.err);
  assert.equal(listed(r.out), ['2026-01-01-fx-experiment [experiment, active]', 'uncovered: https://nowhere.example/x'].join('\n') + '\n');
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
  assert.deepEqual(Object.keys(u).sort(), ['fact:0', 'fact:1', 'mission', 'quiz:0', 'quiz:1', 'rest', 'step']);
  assert.deepEqual(changedUnits(repo, f).sort(), ['fact:0', 'fact:1', 'mission', 'quiz:0', 'quiz:1', 'rest', 'step'], 'nothing recorded yet: every unit is pending');
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
  assert.equal(listed(r.out), 'changed units: sec:commands/init\nunit sec:commands/init docs/ref.md:9-9 prose\n');
  // Prose outside the table still reopens the section, and only the section.
  writeFileSync(join(root, 'docs', 'ref.md'), md('Scaffold.').replace('Intro.', 'Intro, revised.'));
  assert.deepEqual(changedUnits(root, join(root, 'docs', 'ref.md')), ['sec:commands']);
});

// Exact unit bytes are a persisted ledger contract: changing these hashes reopens previously reviewed units.
// To print these pins, save the following as /tmp/rv-unit-pins.mjs and run from the repo: node /tmp/rv-unit-pins.mjs
// import { readFileSync } from 'node:fs';
// const { unitHashes } = await import(process.cwd() + '/bin/lib/gate.mjs');
// console.log(unitHashes(readFileSync('test/fixtures/teach/lessons/0001-good.html')));
// console.log(unitHashes('# A\n\ntext\n\n## B\n\n| k | v |\n|---|---|\n| x | y |\n', null, 'a.md'));
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
    rest: 'b20889b3a534f72225c05d0e2b915a4c55d8118f8c522fe705b0a988382c920c',
  });
});

test('a Markdown draft is cut into its own sections whatever data-block HTML it quotes, and a lesson page is cut as before', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const md = (rule) => `# Format\n\nWrite a note as \`<p data-block="note">\`.\n\n## Example\n\n\`\`\`html\n<section data-block="mission"><p>m</p></section>\n<section data-block="fact"><p>f</p></section>\n\`\`\`\n\n## Rules\n\n${rule}\n`;
  const file = join(root, 'docs', 'format.md');
  writeFileSync(file, md('One rule.'));
  assert.deepEqual(Object.keys(unitHashes(readFileSync(file), null, file)), ['sec:format', 'sec:example', 'sec:rules']);
  assert.equal(gateCli(root, vault, 'record', 'docs/format.md', 'PASS').code, 0);
  writeFileSync(file, md('One rule, revised.'));
  assert.deepEqual(changedUnits(root, file), ['sec:rules']);
  const r = gateCli(root, vault, 'evidence', 'docs/format.md', '--changed');
  assert.equal(listed(r.out), 'changed units: sec:rules\nunit sec:rules docs/format.md:12-14 prose\n', r.err);
  // Regenerate the persisted ledger pins: node /tmp/rv-unit-pins.mjs (script above the spec 13 test).
  // A Markdown file with no data-block text keeps the hashes its ledger rows were keyed to.
  assert.deepEqual(unitHashes('# A\n\ntext\n\n## B\n\n| k | v |\n|---|---|\n| x | y |\n', null, join(root, 'a.md')), {
    'sec:a': 'd22b769515dfe6ca62b802e396c03708b2d0992608de48bbdcaf3544a31e4f12',
    'sec:b': '5cf51c0783ce360dcec432f24b59c128437d5880a453afae3e941e0c8a26dbd8',
    'sec:b/x': '149f958a2ac77025c943700ae54fa157052ab0a2d3ae363e2613b0bf011e7e06',
  });
  // An HTML lesson given its path gets the units and hashes pinned above.
  const lesson = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'teach', 'lessons', '0001-good.html');
  assert.deepEqual(unitHashes(readFileSync(lesson), null, lesson), { ...unitHashes(readFileSync(lesson)), 'script:../assets/quiz.js': 'c88961ca29f62717915122a4abd516711ad16cd1ba0cce1eb03b62409a6d38b7' });
});

// ---- code links (spec 15 D4) ----
import { codeRepo, LUA_A } from './helpers.mjs';
import { codeLang } from '../bin/lib/gate.mjs';
import { LANGS } from '../bin/lib/codelinks.mjs';
import { parseProjectConfig } from '../bin/lib/projectconfig.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';

function codeCli(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, 'gate', ...args], { cwd, encoding: 'utf8', env: testEnv({ RESEARCH_VAULT_PATH: '/nonexistent-env-vault' }) });
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
  const parsed = parseProjectConfig(readFileSync(join(root, '.research-vault.json'), 'utf8'), loadSchema(REPO_ROOT));
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
  assert.equal(listed(r.out), [
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
  assert.deepEqual(unitHashes(Buffer.from(LUA_A)), { all: createHash('sha256').update(LUA_A).digest('hex') });
  const { root } = codeRepo({ code: false });
  assert.deepEqual(changedUnits(root, join(root, 'src', 'a.lua')), ['all']);
  assert.equal(codeLang(root, join(root, 'src', 'a.lua')), null);
  writeFileSync(join(root, 'docs', 'reply.md'), 'See 2026-01-01-fx-experiment and https://nowhere.example/x.\n');
  const r = codeCli(root, 'evidence', 'docs/reply.md', '--changed');
  assert.equal(listed(r.out), '2026-01-01-fx-experiment [experiment, active]\nuncovered: https://nowhere.example/x\nchanged units: all\n');
  assert.doesNotMatch(r.out, /^unit /m);
});

test('a row carries the reviewer hash; a row from another reviewer counts for nothing; a row without the field keeps standing (spec 18 D3)', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const file = join(root, 'docs', 'reply.md');
  writeFileSync(file, 'hello\n\n## One\n\ntext\n');
  const row = recordVerdict(root, file, 'PASS');
  assert.equal(row.reviewer, contentHash(readFileSync(join(REPO_ROOT, 'agents', 'claims-reviewer.md'))));
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

// ---- image units (issue 58) ----
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);
function imageRepo({ alt = 'a terminal', cap = 'Figure caption', example = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rv-gate-img-'));
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'vault' }) + '\n');
  mkdirSync(join(root, 'ws', 'lessons'), { recursive: true });
  mkdirSync(join(root, 'ws', 'assets'));
  writeFileSync(join(root, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(root, 'ws', 'assets', 'shot.png'), PNG_A);
  const fig = `<figure><img src="../assets/shot.png" alt="${alt}"><figcaption>${cap}</figcaption></figure>`;
  const page = join(root, 'ws', 'lessons', '0001-x.html');
  const write = (o = {}) => writeFileSync(page, `<!doctype html><html><body data-lesson="0001-x">
<section data-block="mission"><p>m</p></section>
<section data-block="fact"><p>one <a data-cite="a">a</a></p>${example ? '' : fig}<p>two <a data-cite="b">b</a></p></section>
<section data-block="example"><p>e</p>${example ? fig : ''}</section>
</body></html>`.replace(/alt="[^"]*"/, `alt="${o.alt ?? alt}"`).replace(/<figcaption>[^<]*/, `<figcaption>${o.cap ?? cap}`));
  write();
  return { root, page, write, png: join(root, 'ws', 'assets', 'shot.png') };
}

test('image bytes reopen only img; caption and alt between fact paragraphs also reopen rest', () => {
  const { root, page, write, png } = imageRepo();
  assert.deepEqual(Object.keys(unitHashes(readFileSync(page), null, page)).sort(), ['example', 'fact:0', 'fact:1', 'img:../assets/shot.png', 'mission', 'rest']);
  recordVerdict(root, page, 'PASS');
  assert.deepEqual(changedUnits(root, page), []);
  writeFileSync(png, PNG_B);
  assert.deepEqual(changedUnits(root, page), ['img:../assets/shot.png']);
  writeFileSync(png, PNG_A);
  write({ cap: 'A new caption' });
  assert.deepEqual(changedUnits(root, page), ['rest', 'img:../assets/shot.png']);
  write({ alt: 'a different alt' });
  assert.deepEqual(changedUnits(root, page), ['rest', 'img:../assets/shot.png']);
});

test('a figure inside an example block reopens that block as well as its img: unit; an <img> with no <figure> hashes its own tag', () => {
  const { root, page, write } = imageRepo({ example: true });
  recordVerdict(root, page, 'PASS');
  write({ cap: 'Changed' });
  assert.deepEqual(changedUnits(root, page).sort(), ['example', 'img:../assets/shot.png']);
  const html = readFileSync(page, 'utf8').replace(/<figure>|<\/figure>|<figcaption>[^<]*<\/figcaption>/g, '');
  writeFileSync(page, html);
  const before = unitHashes(html, null, page)['img:../assets/shot.png'];
  writeFileSync(page, html.replace('alt="a terminal"', 'alt="b"'));
  assert.notEqual(unitHashes(readFileSync(page), null, page)['img:../assets/shot.png'], before);
});

test('a missing image file is still an img: unit and changes when the file appears', () => {
  const { root, page, png } = imageRepo();
  rmSync(png);
  recordVerdict(root, page, 'PASS');
  assert.ok('img:../assets/shot.png' in unitHashes(readFileSync(page), null, page));
  writeFileSync(png, PNG_A);
  assert.deepEqual(changedUnits(root, page), ['img:../assets/shot.png']);
});

test('gate evidence prints one image: line with the workspace-relative path and the file sha256, and none for a lesson without an image', () => {
  const { root, page } = imageRepo();
  const vault = fixtureVault();
  const r = gateCli(root, vault, 'evidence', 'ws/lessons/0001-x.html', '--changed');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`^image: assets/shot\\.png sha256:${contentHash(PNG_A)}$`, 'm'));
  assert.match(r.out, /^changed units: .*img:\.\.\/assets\/shot\.png/m);
  writeFileSync(page, '<section data-block="mission"><p>m</p></section>');
  assert.doesNotMatch(gateCli(root, vault, 'evidence', 'ws/lessons/0001-x.html').out, /^image:/m);
});

test('a reference page shares the path: its images are img: units too', () => {
  const { root } = imageRepo();
  mkdirSync(join(root, 'ws', 'reference'));
  const ref = join(root, 'ws', 'reference', 'r.html');
  writeFileSync(ref, '<div data-block="note"><figure><img src="../assets/shot.png" alt="t"><figcaption>c</figcaption></figure></div>');
  assert.deepEqual(Object.keys(unitHashes(readFileSync(ref), null, ref)), ['note', 'rest', 'img:../assets/shot.png']);
});

test('a lesson with no image has the units and hashes it had before image units', () => {
  const f = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'teach', 'lessons', '0001-good.html');
  const u = unitHashes(readFileSync(f), null, f);
  // Persisted ledger compatibility; regenerate: node /tmp/rv-unit-pins.mjs (script above the spec 13 test).
  assert.equal(u.mission, '1e495a726619cc2b3d278a380870119ef5c906d411b8aa374c949af8c4093b9d');
  assert.equal(u['fact:0'], 'ad47b501da76642ec606c953af1346f5bff9952302b527710a56a33a5d2de653');
  assert.equal(u.step, 'ac86fe13d81803cbc782f402f66bffc4dba25a91e1d21505b1c0a61c38dcff30');
  assert.ok(!Object.keys(unitHashes(readFileSync(f), null, f)).some((k) => k.startsWith('img:')));
});

test('an <img> named in prose with no src is no unit', () => {
  const html = '<section data-block="mission"><p>Use an <img> with a <figcaption>.</p></section>';
  assert.deepEqual(Object.keys(unitHashes(html, null, join(tmpdir(), 'ws', 'lessons', 'x.html'))), ['mission', 'rest']);
});

test('gate status, gate staged and the stop hook see an image that changed or vanished, and a draft with no image keeps its exact-bytes verdict', () => {
  const { root, page, png } = imageRepo();
  const vault = fixtureVault();
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { env: testEnv(), encoding: 'utf8' });
  git('init', '-q');
  gateCli(root, vault, 'record', 'ws/lessons/0001-x.html', 'PASS');
  git('add', 'ws/lessons/0001-x.html', 'ws/assets/shot.png');
  assert.equal(gateCli(root, vault, 'status', 'ws/lessons/0001-x.html', '--check').code, 0);
  assert.match(gateCli(root, vault, 'status', 'ws/lessons/0001-x.html').out, /: PASS @ /);
  writeFileSync(png, PNG_B);
  const s = gateCli(root, vault, 'status', 'ws/lessons/0001-x.html', '--check');
  assert.equal(s.code, 1);
  assert.match(s.out, /\(changed units: img:\.\.\/assets\/shot\.png\)/);
  git('add', 'ws/assets/shot.png');
  const st = gateCli(root, vault, 'staged', '--check');
  assert.equal(st.code, 1);
  assert.equal(st.out, 'ws/lessons/0001-x.html: none\n');
  writeFileSync(png, PNG_A);
  git('add', 'ws/assets/shot.png');
  assert.equal(gateCli(root, vault, 'staged', '--check').code, 0);
  rmSync(png);
  const d = gateCli(root, vault, 'status', 'ws/lessons/0001-x.html', '--check');
  assert.equal(d.code, 1);
  assert.match(d.out, /changed units: img:\.\.\/assets\/shot\.png/);
  writeFileSync(png, PNG_A);
  // Only the image is staged (the page is committed unchanged): the page is still looked at.
  git('reset', '-q');
  git('-c', 'user.email=a@b', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'c');
  writeFileSync(png, PNG_B);
  git('add', 'ws/assets/shot.png');
  const only = gateCli(root, vault, 'staged', '--check');
  assert.equal(only.code, 1, only.out);
  assert.equal(only.out, 'ws/lessons/0001-x.html: none\n');
  // The stop hook: the page is old, only the image is newer than since.
  const old = new Date(Date.now() - 3600000);
  utimesSync(page, old, old);
  rmSync(join(root, '.git'), { recursive: true });
  assert.deepEqual(missingGates(root, vault, {}, Date.now() - 60000).map((m) => m.file), ['ws/lessons/0001-x.html']);
});

test('an <img> pointing at another lesson or a .txt file is no image: no image: line, no throw, a unit hashed as a missing file; a real image prints its own sha256', () => {
  const { root, page, write } = imageRepo();
  const vault = fixtureVault();
  writeFileSync(join(root, 'ws', 'lessons', '0002-y.html'), '<section data-block="mission"><p>other</p></section>');
  writeFileSync(join(root, 'ws', 'assets', 'notes.txt'), 'text');
  writeFileSync(join(root, 'ws', 'assets', 'a b.png'), PNG_B);
  const html = (src) => `<section data-block="fact"><p>x</p><figure><img src="${src}" alt="a"><figcaption>c</figcaption></figure></section>`;
  for (const src of ['0002-y.html', '../assets/notes.txt']) {
    writeFileSync(page, html(src));
    const r = gateCli(root, vault, 'evidence', 'ws/lessons/0001-x.html', '--changed');
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /^image:/m);
    assert.ok(`img:${src}` in unitHashes(readFileSync(page), null, page));
    assert.equal(gateCli(root, vault, 'record', 'ws/lessons/0001-x.html', 'PASS').code, 0);
  }
  writeFileSync(page, html('../assets/a%20b.png'));
  assert.match(gateCli(root, vault, 'evidence', 'ws/lessons/0001-x.html').out, new RegExp(`^image: assets/a b\\.png sha256:${contentHash(PNG_B)}$`, 'm'));
});

test('a caption or alt change reopens the figure\'s block or fact paragraph too, a bytes-only change reopens only the img: unit', () => {
  const lesson = (cap, where) => {
    const fig = `<figure><img src="../assets/shot.png" alt="a"><figcaption>${cap}</figcaption></figure>`;
    return `<section data-block="fact"><p>one ${where === 'fact' ? fig : ''}</p><p>two</p></section><section data-block="example"><p>e</p>${where === 'example' ? fig : ''}</section>`;
  };
  for (const [where, unit] of [['fact', 'fact:0'], ['example', 'example']]) {
    const { root, page, png } = imageRepo();
    writeFileSync(page, lesson('c', where));
    recordVerdict(root, page, 'PASS');
    writeFileSync(page, lesson('d', where));
    assert.deepEqual(changedUnits(root, page).sort(), [unit, 'img:../assets/shot.png'].sort(), where);
    writeFileSync(page, lesson('c', where));
    writeFileSync(png, PNG_B);
    assert.deepEqual(changedUnits(root, page), ['img:../assets/shot.png'], where);
  }
});

test('referencedImages lists an image by existence without reading it, and no image for a page it cannot read', (t) => {
  const { root, page, png } = imageRepo();
  chmodSync(png, 0o000);
  t.after(() => { chmodSync(png, 0o644); chmodSync(page, 0o644); });
  assert.deepEqual(referencedImages(page), [png]);
  chmodSync(page, 0o000);
  assert.deepEqual(referencedImages(page), []);
});

test('an unreadable gated page that is not staged does not stop gate staged, and a staged deletion of its image alone selects nothing', (t) => {
  const { root, page, png } = imageRepo();
  const vault = fixtureVault();
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { env: testEnv(), encoding: 'utf8' });
  git('init', '-q');
  gateCli(root, vault, 'record', 'ws/lessons/0001-x.html', 'PASS');
  git('-c', 'user.email=a@b', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'c');
  git('rm', '-q', 'ws/assets/shot.png');
  assert.equal(gateStatus(root, page).verdict, null, 'gate status sees the deletion');
  const d = gateCli(root, vault, 'staged', '--check');
  assert.deepEqual([d.code, d.out], [0, 'staged gated files: none\n']);
  git('reset', '-q');
  writeFileSync(join(root, 'ws', 'lessons', '0002-z.html'), '<section data-block="mission"><p>z</p></section>');
  git('add', 'ws/lessons/0002-z.html');
  t.after(() => chmodSync(page, 0o644));
  chmodSync(page, 0o000);
  const r = gateCli(root, vault, 'staged', '--check');
  assert.equal(r.code, 1, r.err);
  assert.equal(r.out, 'ws/lessons/0002-z.html: none\n');
});

test('a gates.globs HTML page outside a workspace prints its image: path relative to the page\'s grandparent', () => {
  const root = mkdtempSync(join(tmpdir(), 'rv-gate-nows-'));
  const vault = fixtureVault();
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault, gates: { globs: ['pages/*.html'] } }) + '\n');
  mkdirSync(join(root, 'pages'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 's.png'), PNG_A);
  writeFileSync(join(root, 'pages', 'p.html'), '<section data-block="note"><figure><img src="../assets/s.png" alt="a"><figcaption>c</figcaption></figure></section>');
  assert.match(gateCli(root, vault, 'evidence', 'pages/p.html').out, /^image: assets\/s\.png sha256:/m);
});

test('an image the gate cannot read is a missing image: status names its img: unit, nothing throws, no image: line, and the verdict counts again once it is readable', (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores mode bits');
  const { root, page, png } = imageRepo();
  const vault = fixtureVault();
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { env: testEnv(), encoding: 'utf8' });
  t.after(() => chmodSync(png, 0o644));
  git('init', '-q');
  gateCli(root, vault, 'record', 'ws/lessons/0001-x.html', 'PASS');
  chmodSync(png, 0o000);
  const s = gateCli(root, vault, 'status', 'ws/lessons/0001-x.html', '--check');
  assert.equal(s.code, 1, s.err);
  assert.match(s.out, /changed units: img:\.\.\/assets\/shot\.png/);
  const c = gateCli(root, vault, 'changed', 'ws/lessons/0001-x.html');
  assert.equal(c.code, 1, c.err);
  const e = gateCli(root, vault, 'evidence', 'ws/lessons/0001-x.html', '--changed');
  assert.equal(e.code, 0, e.err);
  assert.doesNotMatch(e.out, /^image:/m);
  git('add', 'ws/lessons/0001-x.html');
  const st = gateCli(root, vault, 'staged', '--check');
  assert.deepEqual([st.code, st.out], [1, 'ws/lessons/0001-x.html: none (ws/assets/shot.png: staged and working copies differ)\n']);
  chmodSync(png, 0o644);
  assert.equal(gateCli(root, vault, 'status', 'ws/lessons/0001-x.html', '--check').code, 0);
  chmodSync(png, 0o000);
  utimesSync(page, new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));
  assert.deepEqual(missingGates(root, vault, {}, Date.now() - 60000).map((m) => m.file), ['ws/lessons/0001-x.html']);
});

test('a workspace README.md is gated: an edit after its verdict shows in gate changed and the Stop hook check; no README adds nothing (issue 66)', () => {
  const { root, vault } = workspaceRepo();
  const without = gatedFiles(root, vault, {});
  const readme = join(root, 'learn/k8s/README.md');
  writeFileSync(readme, '# Fx\n\n## Lesson map\n\nOne group.\n');
  assert.deepEqual(gatedFiles(root, vault, {}).sort(), [...without, readme].sort());
  for (const f of [...without, readme]) recordVerdict(root, f, 'PASS');
  assert.deepEqual(missingGates(root, vault, {}, 0), []);
  appendFileSync(readme, 'Edited.\n');
  assert.deepEqual(changedUnits(root, readme), ['sec:lesson-map']);
  assert.deepEqual(missingGates(root, vault, {}, 0).map((m) => m.file), ['learn/k8s/README.md']);
});

// ---- per-unit evidence (claims gate plan, item 2): with --changed, a Markdown draft's list is the changed units' citations ----
const EV_MD = [
  '# Ref', '',
  '## Alpha', '<!-- evidence: 2026-01-01-fx-doc -->', '', 'Alpha text.', '',
  '## Beta', '<!-- evidence: 2026-01-01-fx-experiment -->', '', 'Beta text.', '',
  '| Command | Does |', '|---|---|', '| `init` | Init. |', '| `gate` | Gate, per 2026-01-01-old. |', '',
  '## Gamma', '<!-- evidence: 2026-01-01-fx-doc-nobody -->', '', 'Gamma text.', '', '```md', '<!-- evidence: 2026-01-01-fx-snippet -->', '```', '',
  '## Delta', '', 'Delta text.', '', '| k | v |', '|---|---|', '| x | y |', '',
].join('\n');
const EV_ALL = ['2026-01-01-fx-doc [source, active]', '2026-01-01-fx-doc-nobody [source, active, no-body]', '2026-01-01-fx-experiment [experiment, active]', '2026-01-01-old [note, active, STALE]'];

// A bound repo whose docs/ev.md has a PASS for EV_MD, then holds EV_MD with `from` replaced by `to`.
function evRepo(from, to) {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const file = join(root, 'docs', 'ev.md');
  writeFileSync(file, EV_MD);
  assert.equal(gateCli(root, vault, 'record', 'docs/ev.md', 'PASS').code, 0);
  if (from) writeFileSync(file, EV_MD.replace(from, to));
  const ev = (...a) => { const r = gateCli(root, vault, 'evidence', 'docs/ev.md', ...a); assert.equal(r.code, 0, r.err); return r.out; };
  return { root, ev };
}
const evIds = (out) => out.split('\n').filter((l) => /^\d{4}-/.test(l));

test('gate evidence --changed lists the changed section\'s comment ids and --extra, and no unchanged section\'s ids', () => {
  const { ev } = evRepo('Alpha text.', 'Alpha text, revised.');
  assert.equal(listed(ev('--changed')), '2026-01-01-fx-doc [source, active]\nchanged units: sec:alpha\nunit sec:alpha docs/ev.md:3-6 prose\n');
  assert.deepEqual(evIds(ev('--changed', '--extra', '2026-01-01-old')), ['2026-01-01-fx-doc [source, active]', '2026-01-01-old [note, active, STALE]']);
});

test('gate evidence --changed: a changed row lists its own ids; a changed row with none lists its section\'s, from the lines outside rows', () => {
  assert.deepEqual(evIds(evRepo('Gate, per', 'Gate the draft, per').ev('--changed')), ['2026-01-01-old [note, active, STALE]']);
  const out = evRepo('Init.', 'Init a vault.').ev('--changed');
  assert.deepEqual(evIds(out), ['2026-01-01-fx-experiment [experiment, active]']);
  assert.match(out, /^changed units: sec:beta\/init$/m);
});

test('gate evidence --changed: a changed unit with no citation in range, or no changed unit, lists the whole file\'s', () => {
  assert.deepEqual(evIds(evRepo('Delta text.', 'Delta text, revised.').ev('--changed')), EV_ALL);
  assert.deepEqual(evIds(evRepo('| x | y |', '| x | z |').ev('--changed')), EV_ALL, 'a row with no id in a section with none');
  const none = evRepo().ev('--changed');
  assert.deepEqual(evIds(none), EV_ALL);
  assert.match(none, /^changed units: none$/m);
});

test('gate evidence without --changed lists every citation; --json follows the list; an id in a fenced comment is never listed', () => {
  const { ev } = evRepo('Gamma text.', 'Gamma text, revised.');
  assert.deepEqual(evIds(ev()), EV_ALL);
  assert.deepEqual(evIds(ev('--changed')), ['2026-01-01-fx-doc-nobody [source, active, no-body]']);
  assert.deepEqual(JSON.parse(ev('--changed', '--json')).entries.map((e) => e.id), ['2026-01-01-fx-doc-nobody']);
  assert.deepEqual(JSON.parse(ev('--json')).entries.map((e) => e.id), EV_ALL.map((l) => l.split(' ')[0]));
  assert.doesNotMatch(ev() + ev('--changed'), /fx-snippet/);
});

test('gate evidence leaves the ledger file\'s bytes unchanged', () => {
  const { root, ev } = evRepo('Alpha text.', 'Alpha text, revised.');
  const before = readFileSync(join(root, LEDGER_FILENAME));
  ev(); ev('--changed'); ev('--changed', '--json', '--extra', '2026-01-01-old');
  assert.deepEqual(readFileSync(join(root, LEDGER_FILENAME)), before);
});

// Issue 72 item 12: a file with no verdict counts the ids its changed units cite that this vault does not hold, and names each cause.
test('gate staged and gate status count the cited ids of the changed units that this vault does not hold (issue 72 item 12)', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault, gates: { globs: ['docs/*.md'] } }) + '\n');
  writeFileSync(join(root, 'docs', 'elsewhere.md'), '# Elsewhere\n\n<!-- evidence: 2026-09-09-not-here 2026-09-10-nor-here 2026-01-01-fx-experiment -->\n\nA claim.\n');
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { env: testEnv(), encoding: 'utf8' });
  git('init', '-q');
  git('add', 'docs/reply.md', 'docs/elsewhere.md');
  const st = gateCli(root, vault, 'staged', '--check');
  assert.equal(st.code, 1, st.err);
  assert.equal(st.out, 'docs/elsewhere.md: none (2 cited ids not in this vault)\ndocs/reply.md: none\n');
  assert.ok(gateCli(root, vault, 'status', 'docs/elsewhere.md').out.startsWith('docs/elsewhere.md: none (2 cited ids not in this vault) @ '));
  // A row from another reviewer and the missing ids are both named.
  const row = recordVerdict(root, join(root, 'docs', 'elsewhere.md'), 'MERIT');
  writeFileSync(join(root, LEDGER_FILENAME), JSON.stringify({ ...row, reviewer: 'f'.repeat(64) }) + '\n');
  assert.ok(gateCli(root, vault, 'status', 'docs/elsewhere.md').out.startsWith('docs/elsewhere.md: none (reviewer changed; 2 cited ids not in this vault) @ '));
  gateCli(root, vault, 'record', 'docs/elsewhere.md', 'MERIT');
  assert.ok(gateCli(root, vault, 'staged').out.startsWith('docs/elsewhere.md: MERIT\n'));
  // Only the changed unit's ids count: section B cites an id the vault holds, section A one it does not.
  writeFileSync(join(root, 'docs', 'split.md'), '# Split\n\n## A\n\n<!-- evidence: 2026-09-09-not-here -->\n\nOne.\n\n## B\n\n<!-- evidence: 2026-01-01-fx-experiment -->\n\nTwo.\n');
  gateCli(root, vault, 'record', 'docs/split.md', 'PASS');
  writeFileSync(join(root, 'docs', 'split.md'), '# Split\n\n## A\n\n<!-- evidence: 2026-09-09-not-here -->\n\nOne.\n\n## B\n\n<!-- evidence: 2026-01-01-fx-experiment -->\n\nTwo, changed.\n');
  assert.ok(gateCli(root, vault, 'status', 'docs/split.md').out.startsWith('docs/split.md: none @ '));
});

// ---- a checked task's requirements file (issue 79 D9) ----
const TASK_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'teach-task');
const TASK_PAGE = 'ws/lessons/0001-files.html';
function taskRepo(vault = 'vault') {
  const root = mkdtempSync(join(tmpdir(), 'rv-gate-task-'));
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault }) + '\n');
  cpSync(TASK_FIXTURE, join(root, 'ws'), { recursive: true });
  return { root, page: join(root, TASK_PAGE), req: join(root, 'ws', 'evidence', '0001', 'requirements.json') };
}
const editRequirements = (req) => writeFileSync(req, readFileSync(req, 'utf8').replace('holds the word hello', 'holds the word goodbye'));

test('an edit to requirements.json reopens the step unit alone, and gate status --check exits 1', () => {
  const vault = fixtureVault();
  const { root, req } = taskRepo(vault);
  assert.equal(gateCli(root, vault, 'record', TASK_PAGE, 'PASS').code, 0);
  assert.equal(gateCli(root, vault, 'status', TASK_PAGE, '--check').code, 0);
  editRequirements(req);
  assert.equal(gateCli(root, vault, 'changed', TASK_PAGE).out, 'changed units: step\n');
  const s = gateCli(root, vault, 'status', TASK_PAGE, '--check');
  assert.equal(s.code, 1, s.out);
});

test('gate staged --check reports the lesson when only its requirements.json is staged', () => {
  const vault = fixtureVault();
  const { root, req } = taskRepo(vault);
  const git = (...a) => spawnSync('git', ['-C', root, '-c', 'user.email=a@b', '-c', 'user.name=t', ...a], { env: testEnv(), encoding: 'utf8' });
  git('init', '-q');
  gateCli(root, vault, 'record', TASK_PAGE, 'PASS');
  git('add', '-A');
  git('commit', '-qm', 'c');
  editRequirements(req);
  git('add', 'ws/evidence/0001/requirements.json');
  const st = gateCli(root, vault, 'staged', '--check');
  assert.equal(st.code, 1, st.out);
  assert.equal(st.out, `${TASK_PAGE}: none\n`);
});

test('a lesson with no requirements.json hashes its step unit as today', () => {
  const { page, req } = taskRepo();
  const html = readFileSync(page);
  const bare = unitHashes(html).step;
  assert.notEqual(unitHashes(html, null, page).step, bare);
  rmSync(req);
  assert.equal(unitHashes(html, null, page).step, bare);
});

test('a row written before units still gives a checked task\'s exact bytes their verdict', () => {
  const { root, page } = taskRepo();
  // Isolate the legacy step exception from the new script requirement.
  writeFileSync(page, readFileSync(page, 'utf8').replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/gi, ''));
  appendFileSync(join(root, LEDGER_FILENAME), JSON.stringify({ event: 'claims', file: TASK_PAGE, sha256: contentHash(readFileSync(page)), verdict: 'PASS' }) + '\n');
  assert.equal(gateStatus(root, page).verdict, 'PASS');
});

test('an edit to the step block\'s text alone reopens the step unit, and gate status --check exits 1', () => {
  const vault = fixtureVault();
  const { root, page } = taskRepo(vault);
  assert.equal(gateCli(root, vault, 'record', TASK_PAGE, 'PASS').code, 0);
  writeFileSync(page, readFileSync(page, 'utf8').replace('Reset the task\'s folder', 'Reset the task folder'));
  assert.equal(gateCli(root, vault, 'changed', TASK_PAGE).out, 'changed units: step\n');
  assert.equal(gateCli(root, vault, 'status', TASK_PAGE, '--check').code, 1);
});

test('taskFile is null for a page outside lessons/ and for a lesson with no four-digit number, beside an existing requirements file', () => {
  const { root, page, req } = taskRepo();
  assert.equal(taskFile(page), req);
  for (const rel of ['reference/0001-x.html', 'lessons/files/0001-x.html', 'lessons/x.html']) {
    const f = join(root, 'ws', rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, '<section data-block="step"><p>s</p></section>');
    assert.equal(taskFile(f), null, rel);
  }
});

// R-10: literal pages keep the regression independent of the lesson fixtures.
function residualDraft(t, html) {
  const root = tmpVault('rv-rest-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'page.html');
  writeFileSync(file, html);
  recordVerdict(root, file, 'PASS');
  return { root, file };
}
const differing = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);

test('R10 text between blocks reopens rest', (t) => {
  const html = '<section data-block="note">one</section><section data-block="sources">two</section>';
  const { root, file } = residualDraft(t, html);
  writeFileSync(file, html.replace('</section>', '</section>added'));
  assert.deepEqual(changedUnits(root, file), ['rest']);
  assert.equal(gateStatus(root, file).verdict, null);
});
test('R10 fact text outside paragraphs reopens rest', (t) => {
  const html = '<section data-block="fact"><p>one</p><p>two</p></section>';
  const { root, file } = residualDraft(t, html);
  writeFileSync(file, html.replace('</section>', 'added</section>'));
  assert.deepEqual(changedUnits(root, file), ['rest']);
});
test('R10 quiz heading reopens rest', (t) => {
  const html = '<section data-block="quiz"><h2>Quiz</h2><script data-quiz>{"items":[{"q":"one"}]}</script></section>';
  const { root, file } = residualDraft(t, html);
  writeFileSync(file, html.replace('Quiz', 'Test'));
  assert.deepEqual(changedUnits(root, file), ['rest']);
});
test('R10 fact paragraph edit leaves rest covered', () => {
  const html = '<section data-block="fact"><p>one</p><p>two</p></section>';
  const before = unitHashes(html);
  assert.ok(before.rest);
  assert.deepEqual(differing(before, unitHashes(html.replace('two', 'three'))), ['fact:1']);
});
test('R10 residual separators distinguish moving text across a span', () => {
  const before = '<section data-block="fact">sentence<p>one</p></section>';
  const after = '<section data-block="fact"><p>one</p>sentence</section>';
  assert.deepEqual(differing(unitHashes(before), unitHashes(after)), ['rest']);
});
test('R10 repeated blocks have independent collision-free units', (t) => {
  const html = '<div data-block="note">one</div><div data-block="note">two</div><div data-block="note#2">three</div>';
  const { root, file } = residualDraft(t, html);
  const before = unitHashes(html);
  assert.deepEqual(Object.keys(before), ['note', 'note#3', 'note#2', 'rest']);
  writeFileSync(file, html.replace('two', 'second'));
  assert.deepEqual(changedUnits(root, file), ['note#3']);
  writeFileSync(file, html.replace('one', 'first'));
  assert.deepEqual(changedUnits(root, file), ['note']);
  assert.deepEqual(differing(before, unitHashes(html.replace('two', 'second'))), ['note#3']);
  assert.deepEqual(differing(before, unitHashes(html.replace('one', 'first'))), ['note']);
});
test('R10 byte walk covers every raw position outside canonical quiz JSON', (t) => {
  const json = '{"title":"Quiz","items":[{"q":"one"},{"q":"two"}]}';
  const html = 'before<div data-block="note">ordinary</div>between<section data-block="fact">lead<p>one</p>gap<p>two</p>end</section><section data-block="quiz"><h2>Quiz</h2><script data-quiz>' + json + '</script>tail</section><section data-block="step">do</section><figure><img src="assets/a.svg"><figcaption>caption</figcaption></figure><div data-block="note">repeat</div><script src="assets/a.js"></script>after';
  const { root, file } = residualDraft(t, html);
  writeFileSync(join(root, 'MISSION.md'), '# Mission');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'a.svg'), '<svg/>');
  writeFileSync(join(root, 'assets', 'a.js'), 'script');
  const hashes = (text) => unitHashes(text, null, file);
  const before = hashes(html);
  const start = html.indexOf(json), end = start + json.length;
  for (let i = 0; i < html.length; i++) {
    if (i >= start && i < end) continue; // Parsed quiz JSON deliberately ignores insignificant whitespace.
    const edited = html.slice(0, i) + (html[i] === 'x' ? 'y' : 'x') + html.slice(i + 1);
    assert.notDeepEqual(hashes(edited), before, `uncovered position ${i}`);
  }

});
test('R10 local script bytes and deletion reopen its page', (t) => {
  const root = tmpVault('rv-script-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'MISSION.md'), '# Mission');
  const asset = join(root, 'assets', 'a.js');
  writeFileSync(asset, 'one');
  const file = join(root, 'page.html');
  writeFileSync(file, '<div data-block="note">one</div><script src="assets/a.js"></script>');
  recordVerdict(root, file, 'PASS');
  writeFileSync(asset, 'two');
  assert.deepEqual(changedUnits(root, file), ['script:assets/a.js']);
  assert.equal(gateStatus(root, file).verdict, null);
  rmSync(asset);
  assert.deepEqual(changedUnits(root, file), ['script:assets/a.js']);
  assert.equal(gateStatus(root, file).verdict, null);
});
for (const edited of [false, true]) test(`R10 legacy row ${edited ? 'reopens residual edits' : 'retains exact bytes without scripts'}`, (t) => {
  const html = '<div data-block="note">one</div>';
  const { root, file } = residualDraft(t, html);
  writeFileSync(join(root, LEDGER_FILENAME), JSON.stringify({ event: 'claims', file: 'page.html', verdict: 'PASS', sha256: contentHash(html), units: { note: contentHash('one') } }) + '\n');
  if (edited) writeFileSync(file, html + 'added');
  assert.equal(gateStatus(root, file).verdict, edited ? null : 'PASS');
  if (edited) assert.deepEqual(changedUnits(root, file), ['rest']);
});

test('R10 shipped exemption and passed old copies survive plugin upgrades', async (t) => {
  const root = tmpVault('rv-shipped-script-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Relocation exercises the existing import.meta.url plugin root; never alter installed assets.
  const plugin = join(root, 'plugin');
  cpSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'bin'), join(plugin, 'bin'), { recursive: true });
  cpSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema'), join(plugin, 'schema'), { recursive: true });
  const assets = join(plugin, 'skills', 'research-teach', 'assets');
  cpSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'research-teach', 'assets'), assets, { recursive: true });
  writeFileSync(join(plugin, 'package.json'), '{"type":"module"}');
  const { changedUnits: pending, recordVerdict: record } = await import(join(plugin, 'bin', 'lib', 'gate.mjs'));
  const ws = join(root, 'workspace');
  mkdirSync(join(ws, 'assets'), { recursive: true });
  writeFileSync(join(ws, 'MISSION.md'), '# Mission');
  const file = join(ws, 'page.html');
  const html = '<div data-block="note">one</div><script src="assets/quiz.js"></script>';
  const shipped = join(assets, 'quiz.js'), local = join(ws, 'assets', 'quiz.js');
  writeFileSync(local, readFileSync(shipped));
  writeFileSync(file, html);
  assert.deepEqual(pending(ws, file), ['note', 'rest']);
  record(ws, file, 'PASS');
  writeFileSync(shipped, 'upgraded script');
  assert.deepEqual(pending(ws, file), []);
  writeFileSync(local, 'custom script');
  assert.deepEqual(pending(ws, file), ['script:assets/quiz.js']);
});

function scriptDraft(t, sources) {
  const { root, file } = residualDraft(t, '<div data-block="note">one</div>' + sources.map((src) => `<script src="${src}"></script>`).join(''));
  writeFileSync(join(root, 'MISSION.md'), '# Mission');
  for (const dir of ['assets', 'brand', 'lessons', 'reference']) mkdirSync(join(root, dir));
  return { root, file };
}

test('R10 excluded script targets have no units and outside edits change nothing', (t) => {
  const outsideDir = tmpVault('rv-outside-script-');
  t.after(() => rmSync(outsideDir, { recursive: true, force: true }));
  const outside = join(outsideDir, 'outside.js');
  const { root, file } = scriptDraft(t, ['https://host/a.js', '//host/a.js', 'data:text/javascript,one', `../${outsideDir.split('/').at(-1)}/outside.js`, 'private/a.js', 'assets\\a.js']);
  writeFileSync(outside, 'one');
  t.after(() => rmSync(outside, { force: true }));
  mkdirSync(join(root, 'private'));
  writeFileSync(join(root, 'private/a.js'), 'one');
  const before = unitHashes(readFileSync(file), null, file);
  assert.deepEqual(Object.keys(before), ['note', 'rest']);
  writeFileSync(outside, 'two');
  writeFileSync(join(root, 'private/a.js'), 'two');
  assert.deepEqual(unitHashes(readFileSync(file), null, file), before);
});

test('R10 brand script edit reopens exactly its unit', (t) => {
  const { root, file } = scriptDraft(t, ['brand/b.js']);
  writeFileSync(join(root, 'brand/b.js'), 'one');
  recordVerdict(root, file, 'PASS');
  writeFileSync(join(root, 'brand/b.js'), 'two');
  assert.deepEqual(changedUnits(root, file), ['script:brand/b.js']);
});

test('R10 swapped script bytes reopen both path identities', (t) => {
  const { root, file } = scriptDraft(t, ['assets/a.js', 'assets/b.js']);
  writeFileSync(join(root, 'assets/a.js'), 'one');
  writeFileSync(join(root, 'assets/b.js'), 'two');
  recordVerdict(root, file, 'PASS');
  writeFileSync(join(root, 'assets/a.js'), 'two');
  writeFileSync(join(root, 'assets/b.js'), 'one');
  assert.deepEqual(changedUnits(root, file), ['script:assets/a.js', 'script:assets/b.js']);
});

for (const shipped of [false, true]) test(`R10 exact legacy script row ${shipped ? 'accepts current shipped bytes' : 'reopens own script'}`, (t) => {
  const { root, file } = scriptDraft(t, ['assets/quiz.js']);
  writeFileSync(join(root, 'assets/quiz.js'), shipped ? readFileSync(new URL('../skills/research-teach/assets/quiz.js', import.meta.url)) : 'own script');
  const row = recordVerdict(root, file, 'PASS');
  delete row.units['script:assets/quiz.js'];
  writeFileSync(join(root, LEDGER_FILENAME), JSON.stringify(row) + '\n');
  assert.equal(gateStatus(root, file).verdict, shipped ? 'PASS' : null);
  assert.deepEqual(changedUnits(root, file), shipped ? [] : ['script:assets/quiz.js']);
});

test('R10 nested edit changes inner and enclosing raw units only', () => {
  const html = '<div data-block="outer">before<section data-block="inner">one</section>after</div>';
  // Both whole-block hashes hold the inner text; rest holds only the outer tags.
  assert.deepEqual(Object.keys(unitHashes(html)), ['outer', 'inner', 'rest']);
  assert.deepEqual(differing(unitHashes(html), unitHashes(html.replace('one', 'two'))), ['outer', 'inner']);
});

test('R10 rest block reserves the residual name', () => {
  const html = '<div data-block="rest">one</div>outside';
  assert.deepEqual(Object.keys(unitHashes(html)), ['rest#2', 'rest']);
  assert.deepEqual(differing(unitHashes(html), unitHashes(html.replace('one', 'two'))), ['rest#2']);
  assert.deepEqual(differing(unitHashes(html), unitHashes(html + 'more')), ['rest']);
});

for (const name of ['fact', 'quiz']) test(`R10 second ${name} is a suffixed whole block`, () => {
  const inner = name === 'fact' ? '<p>one</p><p>two</p>' : '<script data-quiz>{"items":[{"q":"one"},{"q":"two"}]}</script>';
  const html = `<div data-block="${name}">${inner}</div><div data-block="${name}">${inner}</div>`;
  const before = unitHashes(html);
  assert.deepEqual(Object.keys(before), [`${name}:0`, `${name}:1`, `${name}#2`, 'rest']);
  const at = html.lastIndexOf('two');
  assert.deepEqual(differing(before, unitHashes(html.slice(0, at) + 'three' + html.slice(at + 3))), [`${name}#2`]);
});

for (const name of ['fact', 'quiz']) test(`R10 fallback ${name} inner text belongs only to whole block`, () => {
  const inner = name === 'fact' ? 'one' : '<script data-quiz>{one</script>';
  const html = `<div data-block="${name}">${inner}</div>`;
  assert.deepEqual(Object.keys(unitHashes(html)), [name, 'rest']);
  assert.deepEqual(differing(unitHashes(html), unitHashes(html.replace('one', 'two'))), [name]);
});

test('R10 two tags with one src retain two script units', (t) => {
  const { file } = scriptDraft(t, ['assets/a.js', 'assets/a.js']);
  assert.deepEqual(Object.keys(unitHashes(readFileSync(file), null, file)), ['note', 'rest', 'script:assets/a.js', 'script:assets/a.js#2']);
});

const quizHtml = '<div data-block="quiz"><script data-quiz>{"title":"Quiz","items":[{"q":"one"},{"q":"two"}]}</script></div>';
test('R10 quiz key beside items changes rest', () => {
  assert.deepEqual(differing(unitHashes(quizHtml), unitHashes(quizHtml.replace('Quiz', 'Test'))), ['rest']);
});
test('R10 quiz item added or removed changes rest and item units', () => {
  assert.deepEqual(differing(unitHashes(quizHtml), unitHashes(quizHtml.replace(',{"q":"two"}', ''))).sort(), ['quiz:1', 'rest']);
  assert.deepEqual(differing(unitHashes(quizHtml), unitHashes(quizHtml.replace('}]', '},{"q":"three"}]'))).sort(), ['quiz:2', 'rest']);
});
test('R10 quiz insignificant whitespace is exempt', () => {
  assert.deepEqual(unitHashes(quizHtml.replace('"items":', '"items" : ')), unitHashes(quizHtml));
});
test('R10 quiz item edit changes only that item', () => {
  assert.deepEqual(differing(unitHashes(quizHtml), unitHashes(quizHtml.replace('two', 'three'))), ['quiz:1']);
});

test('R10 staged script alone selects its page without verdict', (t) => {
  const { root, page } = imageRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = fixtureVault();
  const git = (...a) => {
    const r = spawnSync('git', ['-C', root, ...a], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  appendFileSync(page, '<script src="../assets/a.js"></script>');
  const script = join(root, 'ws/assets/a.js');
  writeFileSync(script, 'one');
  recordVerdict(root, page, 'PASS');
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'fixture');
  writeFileSync(script, 'two');
  git('add', 'ws/assets/a.js');
  const before = readFileSync(page), ledger = readFileSync(join(root, LEDGER_FILENAME));
  const result = gateCli(root, vault, 'staged', '--check');
  assert.equal(result.code, 1);
  assert.equal(result.out, 'ws/lessons/0001-x.html: none\n');
  assert.deepEqual(readFileSync(page), before);
  assert.deepEqual(readFileSync(join(root, LEDGER_FILENAME)), ledger);
});

test('R10 proto block retains a suffixed unit covering its bytes', () => {
  const html = '<div data-block="__proto__">one</div>';
  const before = unitHashes(html);
  assert.deepEqual(Object.keys(before), ['__proto__#2', 'rest']);
  assert.deepEqual(differing(before, unitHashes(html.replace('one', 'two'))), ['__proto__#2']);
});

test('R10 fact paragraph names cannot overwrite a real block', () => {
  const html = '<div data-block="fact:0">block</div><section data-block="fact"><p>one</p><p>two</p></section>';
  const before = unitHashes(html);
  assert.deepEqual(Object.keys(before), ['fact:0', 'fact:0#2', 'fact:1', 'rest']);
  assert.deepEqual(differing(before, unitHashes(html.replace('block</div>', 'edited</div>'))), ['fact:0']);
});

test('R10 image names cannot overwrite a real block or repeated image', (t) => {
  const { root, page, png } = imageRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const html = '<div data-block="img:../assets/shot.png">block</div><img src="../assets/shot.png"><img src="../assets/shot.png">';
  const before = unitHashes(html, null, page);
  assert.deepEqual(Object.keys(before), ['img:../assets/shot.png', 'rest', 'img:../assets/shot.png#', 'img:../assets/shot.png##']);
  writeFileSync(png, PNG_B);
  assert.deepEqual(differing(before, unitHashes(html, null, page)), ['img:../assets/shot.png#', 'img:../assets/shot.png##']);
});

test('R10 page without a teach workspace has no script unit', (t) => {
  const root = tmpVault('rv-no-workspace-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'assets'));
  mkdirSync(join(root, 'lessons'));
  writeFileSync(join(root, 'assets/a.js'), 'one');
  const html = '<div data-block="note">one</div><script src="../assets/a.js"></script>';
  assert.deepEqual(Object.keys(unitHashes(html, null, join(root, 'lessons/page.html'))), ['note', 'rest']);
});

test('R10 outer text after a nested block changes only the outer unit', () => {
  const html = '<div data-block="outer">before<section data-block="inner">one</section>after</div>';
  assert.deepEqual(differing(unitHashes(html), unitHashes(html.replace('after', 'edited'))), ['outer']);
});

test('R10 encoded script folders track served file bytes', (t) => {
  const { root } = scriptDraft(t, []);
  const page = join(root, 'lessons/page.html');
  const sources = ['../%61ssets/a.js', '/%61ssets/a.js', '../assets%2Fa.js'];
  const html = '<div data-block="note">one</div>' + sources.map((src) => `<script src="${src}"></script>`).join('') + '<script src="../%ZZssets/a.js"></script>';
  writeFileSync(join(root, 'assets/a.js'), 'one');
  const before = unitHashes(html, null, page);
  assert.deepEqual(Object.keys(before), ['note', 'rest', ...sources.map((src) => `script:${src}`)]);
  writeFileSync(join(root, 'assets/a.js'), 'two');
  assert.deepEqual(differing(before, unitHashes(html, null, page)), sources.map((src) => `script:${src}`));
});

test('R10 encoded image folders track served file bytes', (t) => {
  const { root, page, png } = imageRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sources = ['../%61ssets/shot.png', '/%61ssets/shot.png', '../assets%2Fshot.png'];
  const html = '<div data-block="note">one</div>' + sources.map((src) => `<img src="${src}">`).join('') + '<img src="../%ZZssets/shot.png">';
  const before = unitHashes(html, null, page);
  writeFileSync(png, PNG_B);
  assert.deepEqual(differing(before, unitHashes(html, null, page)), sources.map((src) => `img:${src}`));
});

// ---- R-12: a recorded verdict is bound to the bytes gate evidence saw ----
// The value of the last line of gate evidence output, `review hash: <hex>`; null when that is not the last line.
const reviewHashOf = (out) => /(?:^|\n)review hash: ([0-9a-f]{64})\n$/.exec(out)?.[1] ?? null;
const ledgerRows = (root) => readFileSync(join(root, LEDGER_FILENAME), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('gate evidence prints a review hash that changes with one byte of the draft, and for a lesson with only the bytes of an image it references', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const before = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md').out);
  assert.match(String(before), /^[0-9a-f]{64}$/);
  assert.equal(reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md', '--changed').out), before, 'the same state prints the same hash');
  writeFileSync(join(root, 'docs', 'reply.md'), readFileSync(join(root, 'docs', 'reply.md'), 'utf8').replace('See', 'Sea'));
  const after = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md').out);
  assert.match(String(after), /^[0-9a-f]{64}$/);
  assert.notEqual(after, before);
  const { root: lroot, page, png } = imageRepo();
  const pageBytes = readFileSync(page);
  const one = reviewHashOf(gateCli(lroot, vault, 'evidence', 'ws/lessons/0001-x.html').out);
  writeFileSync(png, PNG_B);
  const two = reviewHashOf(gateCli(lroot, vault, 'evidence', 'ws/lessons/0001-x.html').out);
  assert.deepEqual(readFileSync(page), pageBytes, 'the page itself is unchanged');
  assert.match(String(one), /^[0-9a-f]{64}$/);
  assert.match(String(two), /^[0-9a-f]{64}$/);
  assert.notEqual(two, one);
});

test('gate record --expect with the printed review hash appends the verdict with no manual field, and gate status --check passes', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const hash = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md', '--changed').out);
  assert.ok(hash, 'evidence printed a review hash');
  const rec = gateCli(root, vault, 'record', 'docs/reply.md', 'PASS', '--expect', hash);
  assert.equal(rec.code, 0, rec.err);
  const rows = ledgerRows(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, 'PASS');
  assert.equal(rows[0].file, 'docs/reply.md');
  assert.ok(!('manual' in rows[0]), 'a record with --expect is not manual');
  assert.equal(gateCli(root, vault, 'status', 'docs/reply.md', '--check').code, 0);
});

test('gate record --expect refuses, with one stderr line and the ledger unchanged, when the draft or an image it references changed since gate evidence', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const draftFile = join(root, 'docs', 'reply.md');
  const old = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md').out);
  assert.ok(old, 'evidence printed a review hash');
  writeFileSync(draftFile, readFileSync(draftFile, 'utf8') + 'An edit after the review.\n');
  const now = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md').out);
  const r = gateCli(root, vault, 'record', 'docs/reply.md', 'PASS', '--expect', old);
  assert.equal(r.code, 1, r.err);
  assert.equal(r.out, '');
  assert.match(r.err, /^[^\n]+\n$/, 'one stderr line');
  assert.ok(r.err.includes(old.slice(0, 12)) && r.err.includes(now.slice(0, 12)), r.err);
  assert.equal(existsSync(join(root, LEDGER_FILENAME)), false, 'no ledger is created');
  // A ledger that exists keeps its bytes; the page is the same, only its image changed.
  const { root: lroot, png } = imageRepo();
  assert.equal(gateCli(lroot, vault, 'record', 'ws/lessons/0001-x.html', 'FAIL-as-sent').code, 0);
  const ledger = readFileSync(join(lroot, LEDGER_FILENAME));
  const before = reviewHashOf(gateCli(lroot, vault, 'evidence', 'ws/lessons/0001-x.html', '--changed').out);
  assert.ok(before, 'evidence printed a review hash');
  writeFileSync(png, PNG_B);
  const img = gateCli(lroot, vault, 'record', 'ws/lessons/0001-x.html', 'PASS', '--expect', before);
  assert.equal(img.code, 1, img.err);
  assert.match(img.err, /^[^\n]+\n$/, 'one stderr line');
  assert.deepEqual(readFileSync(join(lroot, LEDGER_FILENAME)), ledger, 'the ledger bytes are unchanged');
});

test('gate record --expect with a value that is not 64 hex characters, or with no value, exits 2 and writes no ledger', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const names = readdirSync(root).sort();
  for (const tail of [['--expect', 'a'.repeat(63)], ['--expect', 'g'.repeat(64)], ['--expect']]) {
    const r = gateCli(root, vault, 'record', 'docs/reply.md', 'PASS', ...tail);
    assert.equal(r.code, 2, `${tail.join(' ')}: ${r.err}`);
    // R-23: --expect with no value is refused by the parser before gate runs.
    assert.match(r.err, tail.length === 1 ? /^research-vault gate: option --expect needs a value$/m : /^usage: research-vault gate /m);
    assert.equal(existsSync(join(root, LEDGER_FILENAME)), false, `${tail.join(' ')}: no ledger`);
    assert.deepEqual(readdirSync(root).sort(), names);
  }
});

test('gate record without --expect marks the row manual, and a manual row passes gate status as a hand-written old-style row does', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const rec = gateCli(root, vault, 'record', 'docs/reply.md', 'MERIT', 'a note');
  assert.equal(rec.code, 0, rec.err);
  const [row] = ledgerRows(root);
  assert.equal(row.manual, true);
  assert.equal(row.verdict, 'MERIT');
  assert.equal(gateCli(root, vault, 'status', 'docs/reply.md', '--check').code, 0);
  const old = boundRepo(vault);
  const sha256 = createHash('sha256').update(readFileSync(join(old, 'docs', 'reply.md'))).digest('hex');
  writeFileSync(join(old, LEDGER_FILENAME), JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', event: 'claims', file: 'docs/reply.md', sha256, verdict: 'PASS' }) + '\n');
  assert.equal(gateCli(old, vault, 'status', 'docs/reply.md', '--check').code, 0, 'a row with neither manual nor a review hash keeps its verdict');
});

test('gate evidence --json carries reviewHash, the value of the printed review hash line', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const printed = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md', '--changed').out);
  assert.ok(printed, 'evidence printed a review hash');
  assert.equal(JSON.parse(gateCli(root, vault, 'evidence', 'docs/reply.md', '--changed', '--json').out).reviewHash, printed);
});

test('the review hash of a lesson changes when only its loaded script changes, and again when only its requirements file does', () => {
  const vault = fixtureVault();
  const { root, page, req } = taskRepo(vault);
  const script = join(root, 'ws', 'assets', 'quiz.js');
  mkdirSync(dirname(script));
  writeFileSync(script, 'one\n');
  const hash = () => {
    const r = gateCli(root, vault, 'evidence', TASK_PAGE);
    assert.equal(r.code, 0, r.err);
    return reviewHashOf(r.out);
  };
  const pageBytes = readFileSync(page);
  const first = hash();
  writeFileSync(script, 'two\n');
  const second = hash();
  editRequirements(req);
  const third = hash();
  assert.deepEqual(readFileSync(page), pageBytes, 'the page itself is unchanged');
  for (const h of [first, second, third]) assert.match(String(h), /^[0-9a-f]{64}$/);
  assert.notEqual(second, first, 'the script bytes are in the hash');
  assert.notEqual(third, second, 'the requirements file bytes are in the hash');
});

test('gate record --expect takes the printed review hash in upper case', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const hash = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md').out);
  assert.ok(hash, 'evidence printed a review hash');
  assert.notEqual(hash.toUpperCase(), hash);
  const rec = gateCli(root, vault, 'record', 'docs/reply.md', 'PASS', '--expect', hash.toUpperCase());
  assert.equal(rec.code, 0, rec.err);
  const [row] = ledgerRows(root);
  assert.equal(row.verdict, 'PASS');
  assert.ok(!('manual' in row), 'a record with --expect is not manual');
});

// R-23 (D5): --expect=<hash> is the space form: a wrong hash is refused with exit 1 and no ledger, the right one records.
test('gate record --expect=<hash> refuses a wrong hash with exit 1 and no ledger, and records with the right one', () => {
  const vault = fixtureVault();
  const root = boundRepo(vault);
  const hash = reviewHashOf(gateCli(root, vault, 'evidence', 'docs/reply.md').out);
  assert.ok(hash, 'evidence printed a review hash');
  const names = readdirSync(root).sort();
  const wrong = gateCli(root, vault, 'record', 'docs/reply.md', 'MERIT', `--expect=${'0'.repeat(64)}`, 'a note');
  assert.equal(wrong.code, 1, `${wrong.out}${wrong.err}`);
  assert.equal(wrong.out, '');
  assert.match(wrong.err, /^[^\n]+\n$/, 'one stderr line');
  assert.equal(existsSync(join(root, LEDGER_FILENAME)), false, 'no ledger');
  assert.deepEqual(readdirSync(root).sort(), names);
  const right = gateCli(root, vault, 'record', 'docs/reply.md', 'MERIT', `--expect=${hash}`, 'a note');
  assert.equal(right.code, 0, right.err);
  const [row] = ledgerRows(root);
  assert.equal(row.verdict, 'MERIT');
  assert.ok(!('manual' in row), 'a record with --expect= is not manual');
});
