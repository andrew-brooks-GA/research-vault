import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeUrl } from '../bin/lib/ids.mjs';
import { checkCitations, renderReport, run } from '../bin/commands/check.mjs';
import { expandFiles } from '../bin/lib/files.mjs';
import { runInit } from '../bin/commands/init.mjs';

const SCHEMA = {
  taxonomy: { volatility: { fast: { refresh_after_days: 90 }, stable: { refresh_after_days: 1095 }, volatile: { refresh_after_days: 0 } } },
};
const ENTRIES = [
  { id: '2026-01-10-vulkan-sdk', source_url: normalizeUrl('https://vulkan.lunarg.com/sdk/home'), volatility: 'fast', last_verified: '2026-05-20' },
  { id: '2026-01-10-nakama-pins', source_url: normalizeUrl('https://heroiclabs.com/docs'), volatility: 'fast', last_verified: '2026-01-15' },
  { id: '2024-09-09-raii-classic', source_url: null, volatility: 'stable', last_verified: '2024-09-09' },
  { id: '2026-03-03-current-model', source_url: normalizeUrl('https://example.com/models'), volatility: 'volatile', last_verified: '2026-05-30' },
  { id: '2026-01-01-gone', source_url: normalizeUrl('https://example.com/gone'), volatility: 'stable', last_verified: '2026-05-30', status: 'superseded', superseded_by: '2024-09-09-raii-classic' },
];
const NOW = '2026-06-01';

// ---- checkCitations (pure coverage + freshness) ----
test('a URL backed by a fresh entry is ok', () => {
  assert.deepEqual(
    checkCitations([{ type: 'url', value: 'https://vulkan.lunarg.com/sdk/home' }], ENTRIES, SCHEMA, NOW),
    [{ type: 'url', value: 'https://vulkan.lunarg.com/sdk/home', status: 'ok', id: '2026-01-10-vulkan-sdk', volatility: 'fast' }],
  );
});
test('a URL backed by a past-window entry is stale', () => {
  const r = checkCitations([{ type: 'url', value: 'https://heroiclabs.com/docs' }], ENTRIES, SCHEMA, NOW)[0];
  assert.equal(r.status, 'stale');
  assert.equal(r.id, '2026-01-10-nakama-pins');
});
test('a URL with no governing entry is uncovered', () => {
  assert.deepEqual(
    checkCitations([{ type: 'url', value: 'https://unknown.example/page' }], ENTRIES, SCHEMA, NOW),
    [{ type: 'url', value: 'https://unknown.example/page', status: 'uncovered' }],
  );
});
test('a vault id citation matches by id', () => {
  const r = checkCitations([{ type: 'id', value: '2024-09-09-raii-classic' }], ENTRIES, SCHEMA, NOW)[0];
  assert.equal(r.status, 'ok');
  assert.equal(r.id, '2024-09-09-raii-classic');
});
test('a volatile entry is always stale', () => {
  assert.equal(checkCitations([{ type: 'id', value: '2026-03-03-current-model' }], ENTRIES, SCHEMA, NOW)[0].status, 'stale');
});
test('a superseded entry is stale for a prose citation, by id or URL, with its replacement as the reason', () => {
  for (const c of [{ type: 'id', value: '2026-01-01-gone' }, { type: 'url', value: 'https://example.com/gone' }]) {
    assert.deepEqual(checkCitations([c], ENTRIES, SCHEMA, NOW), [{ ...c, status: 'stale', id: '2026-01-01-gone', volatility: 'stable', reason: 'superseded by 2024-09-09-raii-classic' }]);
  }
});
test('an unknown id citation is uncovered', () => {
  assert.equal(checkCitations([{ type: 'id', value: '2099-01-01-nope' }], ENTRIES, SCHEMA, NOW)[0].status, 'uncovered');
});

// ---- expandFiles + run (integration) ----
test('expandFiles resolves a glob to matching files under cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-check-'));
  try {
    mkdirSync(join(dir, 'plan', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'plan', 'a.md'), '# a');
    writeFileSync(join(dir, 'plan', 'sub', 'b.md'), '# b');
    writeFileSync(join(dir, 'plan', 'note.txt'), 'x');
    const files = expandFiles(['plan/**/*.md'], dir).map(f => f.replace(dir, '').replace(/\\/g, '/'));
    assert.deepEqual(files.sort(), ['/plan/a.md', '/plan/sub/b.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- renderReport (P2a: coverage/freshness matrix) ----
const PERFILE = [{
  file: 'doc.md',
  rows: [
    { type: 'url', value: 'https://x.com/a', status: 'uncovered' },
    { type: 'id', value: '2026-01-01-foo', status: 'ok', id: '2026-01-01-foo', volatility: 'fast' },
    { type: 'url', value: 'https://y.com/b', status: 'stale', id: '2026-02-02-bar', volatility: 'volatile' },
  ],
}];

test('renderReport markdown emits a table row per citation and a summary', () => {
  const md = renderReport(PERFILE, { format: 'md', now: '2026-06-07' });
  assert.match(md, /\| doc\.md \| https:\/\/x\.com\/a \| uncovered \|/);
  assert.match(md, /\| doc\.md \| 2026-01-01-foo \| ok \| 2026-01-01-foo \(fast\) \|/);
  assert.match(md, /ok: 1.*stale: 1.*uncovered: 1/);
});

test('renderReport json carries summary counts and one row per citation', () => {
  const report = JSON.parse(renderReport(PERFILE, { format: 'json', now: '2026-06-07' }));
  assert.equal(report.generated, '2026-06-07');
  assert.deepEqual(report.summary, { files: 1, ok: 1, stale: 1, uncovered: 1 });
  assert.equal(report.rows.length, 3);
  assert.equal(report.rows[0].file, 'doc.md');
});

test('check --check takes an absolute path and a relative one to the same file', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-vault-'));
  const repo = mkdtempSync(join(tmpdir(), 'rv-repo-'));
  try {
    runInit({ vaultPath: vault });
    const abs = join(repo, 'doc.md');
    writeFileSync(abs, 'No citations here.');
    for (const pattern of [abs, 'doc.md']) {
      const files = expandFiles([pattern], repo);
      console.log(`${pattern}: ${files.length} file(s): ${files.join(', ')}`);
      assert.deepEqual(files, [abs], pattern);
      assert.equal(await run({ _: ['check', pattern], vault, cwd: repo, check: true }), 0, pattern);
    }
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('run exits non-zero under --check when a citation is uncovered', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-vault-'));
  const repo = mkdtempSync(join(tmpdir(), 'rv-repo-'));
  try {
    runInit({ vaultPath: vault });
    writeFileSync(join(repo, 'doc.md'), 'cites https://nobody.example/page that is not in the vault.');
    const code = await run({ _: ['check', 'doc.md'], vault, cwd: repo, check: true });
    assert.equal(code, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('run falls back to .research-vault.json references.globs when no positional globs given', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-vault-'));
  const repo = mkdtempSync(join(tmpdir(), 'rv-repo-'));
  try {
    runInit({ vaultPath: vault });
    writeFileSync(join(repo, '.research-vault.json'), JSON.stringify({ vault, references: { globs: ['*.md'] } }));
    writeFileSync(join(repo, 'doc.md'), 'cites https://nobody.example/page that is not in the vault.');
    // No positional glob: the config's references.globs must supply doc.md, so the uncovered
    // citation still trips --check.
    const code = await run({ _: ['check'], vault, cwd: repo, check: true });
    assert.equal(code, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('run errors with usage (exit 2) when neither positional globs nor config globs exist', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'rv-repo-'));
  try {
    const code = await run({ _: ['check'], cwd: repo });
    assert.equal(code, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI reports a URL found only in code as skipped and --check still exits 0', () => {
  const vault = mkdtempSync(join(tmpdir(), 'rv-vault-'));
  const repo = mkdtempSync(join(tmpdir(), 'rv-repo-'));
  try {
    runInit({ vaultPath: vault });
    writeFileSync(join(repo, 'doc.md'), 'run this:\n\n```\ncurl https://nobody.example/in-code\n```\n');
    const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');
    const r = spawnSync(process.execPath, [bin, 'check', 'doc.md', '--vault', vault, '--check'], { env: testEnv(), cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^skipped \(in code\): doc\.md {2}https:\/\/nobody\.example\/in-code$/m);
    assert.doesNotMatch(r.stdout, /UNCOVERED/);
    const j = spawnSync(process.execPath, [bin, 'check', 'doc.md', '--vault', vault, '--json'], { env: testEnv(), cwd: repo, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(j.stdout).skipped, [{ file: 'doc.md', type: 'url', value: 'https://nobody.example/in-code' }]);
  } finally {
    rmSync(vault, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---- code links (spec 15) ----
import { codeRepo, testEnv } from './helpers.mjs';
import { parseProjectConfig } from '../bin/lib/projectconfig.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');
const cli = (cwd, ...args) => spawnSync(process.execPath, [BIN, 'check', ...args, '--now', '2026-06-01'], { cwd, encoding: 'utf8', env: testEnv({ RESEARCH_VAULT_PATH: '/nonexistent-env-vault' }) });
const C = [
  '-- per 2026-01-01-fx-doc@dep=1.2.3', 'function ns.pinned()', 'end', '',
  '-- per 2026-01-01-fx-doc@dep=1.0.0', 'function ns.behind()', 'end', '',
  '-- per 2026-01-01-fx-doc@other=1', 'function ns.nokey()', 'end', '',
  '-- per 2026-01-01-fx-gone', 'function ns.gone()', 'end', '',
  '-- per 2026-01-01-old', 'function ns.old()', 'end', '',
  '-- per 2026-01-01-old@dep=1.2.3', 'function ns.oldPinned()', 'end', '',
  '-- per 2026-01-01-fx-doc', '  local function nested()', '  end', '',
].join('\n');

test('check with a code block reads code.globs for links, prints code rows and the versions footer, and --check exits 1', () => {
  const { root } = codeRepo();
  const r = cli(root, '--check');
  assert.equal(r.stdout, [
    'UNCOVERED src/b.lua:1 ns.g  2026-01-01-fx-missing',
    'check: 3 file(s); 2 ok, 0 stale, 1 uncovered, 0 unattached, 2 code link(s)',
    'versions: dep=1.2.3',
  ].join('\n') + '\n', r.stderr);
  assert.equal(r.status, 1);
  // A code file named positionally is still a code file, never prose.
  assert.equal(cli(root, 'src/a.lua').stdout, 'check: 1 file(s); 1 ok, 0 stale, 0 uncovered, 0 unattached, 1 code link(s)\nversions: dep=1.2.3\n');
});

test('check reports every code status with its reason, in text and JSON', () => {
  const { root } = codeRepo();
  writeFileSync(join(root, 'src', 'c.lua'), C);
  const r = cli(root, 'src/c.lua', '--check');
  assert.equal(r.stdout, [
    'STALE     src/c.lua:5 ns.behind  2026-01-01-fx-doc  (dep 1.0.0 -> 1.2.3)',
    'STALE     src/c.lua:9 ns.nokey  2026-01-01-fx-doc  (no key other in code.versions)',
    'STALE     src/c.lua:13 ns.gone  2026-01-01-fx-gone  (superseded by 2026-01-01-fx-doc)',
    'STALE     src/c.lua:17 ns.old  2026-01-01-old  (time)',
    'UNATTACHED src/c.lua:25  2026-01-01-fx-doc',
    'check: 1 file(s); 2 ok, 4 stale, 0 uncovered, 1 unattached, 7 code link(s)',
    'versions: dep=1.2.3',
  ].join('\n') + '\n', r.stderr);
  assert.equal(r.status, 1);
  const j = JSON.parse(cli(root, 'src/c.lua', '--json').stdout);
  assert.deepEqual(j.summary, { files: 1, ok: 2, stale: 4, uncovered: 0, unattached: 1, code: 7 });
  assert.deepEqual(j.versions, { dep: '1.2.3' });
  assert.deepEqual(j.rows[1], { file: 'src/c.lua', type: 'id', value: '2026-01-01-fx-doc', symbol: 'ns.behind', line: 5, key: 'dep', version: '1.0.0', id: '2026-01-01-fx-doc', volatility: 'slow', status: 'stale', reason: 'dep 1.0.0 -> 1.2.3' });
  assert.deepEqual(j.rows[5].status, 'ok', 'a pin selects the version rule over the time rule');
  const md = cli(root, 'src/c.lua', '--report').stdout;
  assert.match(md, /^\| src\/c\.lua:5 ns\.behind \| 2026-01-01-fx-doc \| stale \| dep 1\.0\.0 -> 1\.2\.3 \|$/m);
  assert.match(md, /\nversions: dep=1\.2\.3\n$/);
});

test('check exits 2 when the binding names a drive-relative versions file', () => {
  const { root, cfg } = codeRepo();
  writeFileSync(join(root, 'deps.txt'), 'dep s02-version-canary\n');
  cfg.code.versions.dep.file = 'C:deps.txt';
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify(cfg));
  const r = cli(root, 'src/a.lua');
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'error: invalid .research-vault.json: code.versions.dep.file must be a relative path inside the repository with no .. segment\n');
  assert.equal(r.stdout, '');
});

test('check exits 2 on a versions file that is missing or unmatched and on a glob with no language row', () => {
  const { root } = codeRepo();
  writeFileSync(join(root, 'deps.txt'), 'nothing here\n');
  let r = cli(root);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'error: versions.dep: pattern matched nothing in deps.txt\n');
  rmSync(join(root, 'deps.txt'));
  r = cli(root);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'error: versions.dep: cannot read deps.txt\n');
  writeFileSync(join(root, 'deps.txt'), 'dep 1.2.3\n');
  const cfg = JSON.parse(readFileSync(join(root, '.research-vault.json'), 'utf8'));
  cfg.code.globs.push('src/**/*.pyi');
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify(cfg));
  writeFileSync(join(root, 'src', 'p.pyi'), '# per 2026-01-01-fx-doc\ndef f():\n    pass\n');
  r = cli(root);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'error: no language for .pyi in code.globs; add code.languages[".pyi"] = { comment, decl }\n');
  // The project supplies the row and the engine runs on it unchanged (D0).
  cfg.code.languages['.pyi'] = { comment: '^\\s*#(.*)$', decl: '^(?:async\\s+)?def\\s+(\\w+)|^class\\s+(\\w+)|^(\\w+)\\s*=(?!=)' };
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify(cfg));
  writeFileSync(join(root, 'src', 'p.pyi'), '# per 2026-01-01-fx-doc@dep=1.0.0\ndef f():\n    pass\n');
  r = cli(root, 'src/p.pyi');
  assert.equal(r.stdout, 'STALE     src/p.pyi:1 f  2026-01-01-fx-doc  (dep 1.0.0 -> 1.2.3)\ncheck: 1 file(s); 0 ok, 1 stale, 0 uncovered, 0 unattached, 1 code link(s)\nversions: dep=1.2.3\n');
});

// Absent state (spec 15 D7): without a code block the .lua files are not read unless named, named
// positionally they are prose, and the output is byte for byte today's.
test('check without a code block runs today\'s path on the same fixture', () => {
  const { root } = codeRepo({ code: false });
  assert.equal(cli(root).stdout, 'check: 1 file(s); 1 ok, 0 stale, 0 uncovered\n');
  const r = cli(root, 'src/a.lua', 'src/b.lua', '--check');
  assert.equal(r.stdout, 'UNCOVERED src/b.lua  2026-01-01-fx-missing\ncheck: 2 file(s); 1 ok, 0 stale, 1 uncovered\n');
  assert.equal(r.status, 1);
  const j = JSON.parse(cli(root, 'src/a.lua', 'src/b.lua', '--json').stdout);
  delete j.generated;
  assert.deepEqual(j, {
    summary: { files: 2, ok: 1, stale: 0, uncovered: 1 },
    rows: [
      { file: 'src/a.lua', type: 'id', value: '2026-01-01-fx-doc', status: 'ok', id: '2026-01-01-fx-doc', volatility: 'slow' },
      { file: 'src/b.lua', type: 'id', value: '2026-01-01-fx-missing', status: 'uncovered' },
    ],
    skipped: [],
  });
  assert.deepEqual(Object.keys(parseProjectConfig(readFileSync(join(root, '.research-vault.json'), 'utf8'), loadSchema(process.cwd()))),
    ['vault', 'defaults', 'references', 'gates', 'capture', 'usage', 'taxonomyExtensions']);
});

// ---- globs that check nothing (R-13) ----
const bindGlobs = (root, globs) => writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault: 'research', references: { globs } }) + '\n');

test('a positional glob that matches no file is reported, and fails only under --check', () => {
  const { root } = codeRepo({ code: false });
  for (const [flags, status] of [[['--check'], 1], [[], 0]]) {
    const r = cli(root, 'nope/*.md', ...flags);
    assert.equal(r.stderr, 'check: nope/*.md matched no file\n', flags.join(' '));
    assert.equal(r.stdout, 'check: 0 file(s); 0 ok, 0 stale, 0 uncovered\n', flags.join(' '));
    assert.equal(r.status, status, flags.join(' '));
  }
});

test('binding globs resolve against the binding\'s folder, not the working directory', () => {
  const { root } = codeRepo({ code: false });
  const rows = (cwd) => JSON.parse(cli(cwd, '--json').stdout).rows;
  const fromRoot = rows(root);
  const fromSub = rows(join(root, 'src'));
  assert.deepEqual(fromRoot.map((r) => r.file), ['docs/d.md']);
  assert.deepEqual(fromSub.map((r) => r.file), ['../docs/d.md']);
  assert.deepEqual(fromSub.map(({ file, ...r }) => r), fromRoot.map(({ file, ...r }) => r));
});

test('a binding glob that matches no file fails --check and is named', () => {
  const { root } = codeRepo({ code: false });
  bindGlobs(root, ['docs/*.md', 'notes/*.md']);
  const r = cli(root, '--check');
  assert.equal(r.stderr, 'check: notes/*.md matched no file\n');
  assert.equal(r.stdout, 'check: 1 file(s); 1 ok, 0 stale, 0 uncovered\n');
  assert.equal(r.status, 1);
});

test('a quoted glob in the binding is a configuration error with no rows', () => {
  const { root } = codeRepo({ code: false });
  bindGlobs(root, ["'docs/*.md'"]);
  const r = cli(root, '--json');
  assert.equal(r.stderr, "check: 'docs/*.md' looks quoted; remove the quotes\n");
  assert.equal(r.stdout, '');
  assert.equal(r.status, 2);
});

test('a binding glob with a trailing quote only is a configuration error with no rows', () => {
  const { root } = codeRepo({ code: false });
  bindGlobs(root, ["docs/*.md'"]);
  const r = cli(root, '--json');
  assert.equal(r.stderr, "check: docs/*.md' looks quoted; remove the quotes\n");
  assert.equal(r.stdout, '');
  assert.equal(r.status, 2);
});

test('a glob that matches files with only ok rows passes --check with no warning', () => {
  const { root } = codeRepo({ code: false });
  const r = cli(root, 'docs/*.md', '--check');
  assert.equal(r.stdout, 'check: 1 file(s); 1 ok, 0 stale, 0 uncovered\n');
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
});

// ---- sources nobody checked independently (R-15): marked, never failed ----
import { put } from './helpers.mjs';
const vrow = (method) => ({ date: '2026-01-01', by_type: 'human', by_id: '', method, result: 'confirmed', notes: '' });

test('an ok citation of a source with only captured or quote-matched rows is printed and flagged unverified, and --check still exits 0', () => {
  const { root, vault } = codeRepo({ code: false });
  put(vault, 'source', '2026-01-01-only-captured', { source_type: 'article', source_url: 'https://example.org/c', verifications: [vrow('captured')] });
  put(vault, 'source', '2026-01-01-quote-matched', { source_type: 'article', source_url: 'https://example.org/q', verifications: [vrow('captured'), vrow('quote-matched')] });
  put(vault, 'source', '2026-01-01-refetched', { source_type: 'article', source_url: 'https://example.org/r', verifications: [vrow('refetched-source')] });
  writeFileSync(join(root, 'docs', 'u.md'), 'See 2026-01-01-only-captured, 2026-01-01-quote-matched and 2026-01-01-refetched.\n');
  const r = cli(root, 'docs/u.md', '--check');
  assert.equal(r.stdout, [
    'OK        docs/u.md  2026-01-01-only-captured  (2026-01-01-only-captured, unverified)',
    'OK        docs/u.md  2026-01-01-quote-matched  (2026-01-01-quote-matched, unverified)',
    'check: 1 file(s); 3 ok, 0 stale, 0 uncovered, 2 unverified',
  ].join('\n') + '\n', r.stderr);
  assert.equal(r.status, 0);
  const rows = JSON.parse(cli(root, 'docs/u.md', '--json').stdout).rows;
  assert.deepEqual(rows.map((x) => [x.value, x.status, x.unverified]), [
    ['2026-01-01-only-captured', 'ok', true],
    ['2026-01-01-quote-matched', 'ok', true],
    ['2026-01-01-refetched', 'ok', undefined],
  ]);
  assert.equal('unverified' in rows[2], false);
  assert.match(cli(root, 'docs/u.md', '--report').stdout, /^\| docs\/u\.md \| 2026-01-01-only-captured \| ok \| 2026-01-01-only-captured \(slow, unverified\) \|$/m);
});

test('a stale or superseded citation of an unverified source stays stale and carries no unverified mark', () => {
  const unverified = new Set(['2026-01-10-nakama-pins', '2026-01-01-gone']);
  assert.deepEqual(
    checkCitations([{ type: 'id', value: '2026-01-10-nakama-pins' }, { type: 'id', value: '2026-01-01-gone' }], ENTRIES, SCHEMA, NOW, unverified),
    [
      { type: 'id', value: '2026-01-10-nakama-pins', status: 'stale', id: '2026-01-10-nakama-pins', volatility: 'fast' },
      { type: 'id', value: '2026-01-01-gone', status: 'stale', id: '2026-01-01-gone', volatility: 'stable', reason: 'superseded by 2024-09-09-raii-classic' },
    ],
  );
});

// ---- one URL held by more than one entry (R-31): every candidate named, the best one's status ----
const PAGE = 'https://example.org/page';

test('a URL held by two active entries names both, takes the fresh one\'s status, and --check exits as for it', () => {
  const { root, vault } = codeRepo({ code: false });
  put(vault, 'source', '2026-01-01-page-v1', { source_type: 'official-docs', source_url: PAGE, subject: { name: 'lib', version: '1' } });
  put(vault, 'source', '2026-01-01-page-v2', { source_type: 'official-docs', source_url: PAGE, subject: { name: 'lib', version: '2' }, volatility: 'volatile' });
  writeFileSync(join(root, 'docs', 'a.md'), `Docs: ${PAGE}\n`);
  const r = cli(root, 'docs/a.md', '--check');
  assert.equal(r.stdout, [
    'OK        docs/a.md  https://example.org/page  (2026-01-01-page-v1, slow; ambiguous: 2026-01-01-page-v1, 2026-01-01-page-v2)',
    'check: 1 file(s); 1 ok, 0 stale, 0 uncovered',
  ].join('\n') + '\n', r.stderr);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(cli(root, 'docs/a.md', '--json').stdout).rows, [
    { file: 'docs/a.md', type: 'url', value: PAGE, status: 'ok', id: '2026-01-01-page-v1', volatility: 'slow', candidates: ['2026-01-01-page-v1', '2026-01-01-page-v2'] },
  ]);
  assert.match(cli(root, 'docs/a.md', '--report').stdout, /^\| docs\/a\.md \| https:\/\/example\.org\/page \| ok \| 2026-01-01-page-v1 \(slow\); ambiguous: 2026-01-01-page-v1, 2026-01-01-page-v2 \|$/m);
});

test('a superseded entry whose id sorts after its replacement does not hide the replacement', () => {
  const { root, vault } = codeRepo({ code: false });
  put(vault, 'source', '2026-01-01-page-new', { source_type: 'official-docs', source_url: PAGE });
  put(vault, 'source', '2026-01-01-page-old', { source_type: 'official-docs', source_url: PAGE, status: 'superseded', superseded_by: '2026-01-01-page-new' });
  writeFileSync(join(root, 'docs', 'a.md'), `Docs: ${PAGE}\n`);
  const r = cli(root, 'docs/a.md', '--check');
  assert.equal(r.stdout, 'check: 1 file(s); 1 ok, 0 stale, 0 uncovered\n', r.stderr);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(cli(root, 'docs/a.md', '--json').stdout).rows, [
    { file: 'docs/a.md', type: 'url', value: PAGE, status: 'ok', id: '2026-01-01-page-new', volatility: 'slow' },
  ]);
});
