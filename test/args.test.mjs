import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../bin/lib/args.ts';
import { fixtureVault, put, testEnv, tmpVault } from './helpers.mjs';

test('a value-taking command flag skips its value before the command', () => {
  assert.deepEqual(parseArgs(['--title', 'lint', 'capture']), { _: ['capture'], title: 'lint' });
});

test('an inherited property name is refused as a command', () => {
  const argv = ['toString'];
  assert.throws(() => parseArgs(argv), { message: 'no options table for toString' });
  assert.deepEqual(argv, ['toString']);
});

test('a zero-padded sentinel decodes to undefined', () => {
  assert.deepEqual(parseArgs(['lint', 'word', '\0' + '01'])._, ['lint', 'word', undefined]);
});

test('repeated needle flags retain their values in order', () => {
  assert.deepEqual(parseArgs(['teach', '--needle', 'first', '--needle', 'second']).needle, ['first', 'second']);
});

test('parses flags, --key value, --bool, and positionals', () => {
  const a = parseArgs(['capture', '--type', 'source', '--title', 'X', '--json', 'pos1']);
  assert.equal(a._[0], 'capture');
  assert.equal(a.type, 'source');
  assert.equal(a.json, true);
  assert.deepEqual(a._.slice(1), ['pos1']);
});

test('boolean flags do not swallow the following --option', () => {
  // --project and --report are booleans; the token after them is a separate flag,
  // not their value. Regression: previously --project consumed --vault.
  const a = parseArgs(['init', '--project', '--vault', '/v']);
  assert.equal(a.project, true);
  assert.equal(a.vault, '/v');
  const b = parseArgs(['check', 'plan/**/*.md', '--report', '--check']);
  assert.equal(b.report, true);
  assert.equal(b.check, true);
  assert.deepEqual(b._.slice(1), ['plan/**/*.md']);
});

test('--include-superseded is boolean and does not swallow the next token', () => {
  const a = parseArgs(['search', '--include-superseded', '--type', 'source']);
  assert.equal(a['include-superseded'], true);
  assert.equal(a.type, 'source');
});

// R-23: a value flag followed by a --flag, or at the end, has no value and is refused (it was undefined before).
test('a value flag followed by a --flag, or at the end, is refused as needing a value', () => {
  assert.throws(() => parseArgs(['capture', '--title', '--url', 'X']), { message: 'option --title needs a value' });
  assert.throws(() => parseArgs(['capture', '--title']), { message: 'option --title needs a value' });
});

// R-23: --json=x was a junk key `json=x` before; a value given to a flag that takes none is refused.
test('a value joined to a flag that takes none is refused', () => {
  assert.throws(() => parseArgs(['lint', '--json=x']), { message: 'option --json takes no value' });
});

test('trust boolean flags preserve a following directory positional', () => {
  for (const flag of ['show', 'revoke', 'yes']) {
    const args = parseArgs(['trust', `--${flag}`, 'somedir']);
    assert.equal(args[flag], true);
    assert.deepEqual(args._, ['trust', 'somedir']);
  }
});

// R-23: the tests below run the real CLI in a throwaway folder that is also HOME (and every other home variable), so
// the OS default vault and the user config would be created under it.
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');
function sandbox(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rv-args-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const homes = { HOME: root, USERPROFILE: root, APPDATA: join(root, 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'AppData', 'Local'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data') };
  const cli = (...argv) => spawnSync(process.execPath, [CLI, ...argv], { cwd: root, env: testEnv(homes), encoding: 'utf8', timeout: 20000 });
  const tree = () => readdirSync(root, { recursive: true }).sort();
  return { root, cli, tree };
}

test('an unknown option exits 2 with one line naming it, and the command writes and prints nothing', (t) => {
  const { root, cli, tree } = sandbox(t);
  const before = tree();
  const init = cli('init', '--vault', join(root, 'v'), '--nosuch');
  assert.equal(init.status, 2, init.stdout + init.stderr);
  assert.equal(init.stderr, 'research-vault init: unknown option --nosuch\n');
  assert.equal(init.stdout, '');
  assert.deepEqual(tree(), before, 'init created nothing');
  const read = cli('manifest', '--vault', fixtureVault(), '--nosuch', 'x');
  assert.equal(read.status, 2, read.stderr);
  assert.equal(read.stderr, 'research-vault manifest: unknown option --nosuch\n');
  assert.equal(read.stdout, '', 'no manifest printed');
});

test('a value option with no value, at the end or before another option, exits 2 and resolves no vault', (t) => {
  const { cli, tree } = sandbox(t);
  const before = tree();
  for (const argv of [['init', '--vault'], ['manifest', '--vault', '--rebuild'], ['search', '--semantic']]) {
    const r = cli(...argv);
    assert.equal(r.status, 2, `${argv.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, `research-vault ${argv[0]}: option --${argv[1].slice(2)} needs a value\n`);
    assert.equal(r.stdout, '');
    assert.deepEqual(tree(), before, `${argv.join(' ')}: no default vault and no config under HOME`);
  }
});

test('--vault=<dir> selects that vault', (t) => {
  const { cli, tree } = sandbox(t);
  const vault = tmpVault('rv-args-eq-');
  put(vault, 'source', '2026-01-01-eq', { source_type: 'article', source_url: 'https://example.org/eq' });
  const before = tree();
  const r = cli('manifest', `--vault=${vault}`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).entries.map((e) => e.id), ['2026-01-01-eq']);
  assert.deepEqual(tree(), before, 'the default vault was not used');
});

test('--topics takes no value for lint --fix and a list for capture', (t) => {
  const { root, cli } = sandbox(t);
  const vault = join(root, 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), vault, { recursive: true });
  const f = join(vault, 'sources', '2026-01-01-a.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^topics:.*$/m, 'topics: [tdd]'));
  const lint = cli('lint', '--vault', vault, '--fix', '--topics');
  assert.equal(lint.status, 0, lint.stdout + lint.stderr);
  assert.match(readFileSync(f, 'utf8'), /^topics: \[test-driven-development\]$/m, 'the alias was rewritten');
  const cap = cli('capture', '--vault', vault, '--type', 'source', '--title', 'Listed', '--url', 'https://example.org/listed', '--topics', 'alpha,beta');
  assert.equal(cap.status, 0, cap.stderr);
  assert.match(readFileSync(join(vault, 'sources', readdirSync(join(vault, 'sources')).find((n) => n.endsWith('-listed.md'))), 'utf8'), /^topics: \[alpha, beta\]$/m);
});

test('a value or positional that starts with a single dash is read as before', (t) => {
  const { root, cli } = sandbox(t);
  const vault = join(root, 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), vault, { recursive: true });
  const cap = cli('capture', '--vault', vault, '--type', 'source', '--title', '-1 reasons', '--url', 'https://example.org/minus');
  assert.equal(cap.status, 0, cap.stderr);
  assert.match(readFileSync(cap.stdout.trim().replace(/^created /, ''), 'utf8'), /^title: -1 reasons$/m);
  const limit = cli('search', '--vault', vault, '--semantic', 'q', '--limit', '-1');
  assert.equal(limit.status, 1);
  assert.equal(limit.stderr, 'search refused: no embedding endpoint in .research-vault.json\n');
  const text = cli('search', '--vault', vault, '--text', '-h');
  assert.equal(text.status, 0, text.stderr);
  assert.ok(!text.stdout.startsWith('research-vault search:'), 'not the help row');
  const repo = join(root, 'repo');
  mkdirSync(repo);
  fixtureVault(join(repo, 'v'));
  writeFileSync(join(repo, '.research-vault.json'), '{"vault":"v"}\n');
  writeFileSync(join(repo, 'reply.md'), 'See 2026-01-01-fx-doc.\n');
  const gate = spawnSync(process.execPath, [CLI, 'gate', 'record', 'reply.md', 'MERIT', '-odd note'], { cwd: repo, env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(gate.status, 0, gate.stderr);
  assert.equal(JSON.parse(readFileSync(join(repo, '.research-vault-ledger.jsonl'), 'utf8')).note, '-odd note');
});

// R-23: node's parser reads '-re-checked' as short options, its inner '-' as `--`, which ends the options.
test('a gate note that starts with a dash and holds another dash is recorded verbatim', (t) => {
  const { root } = sandbox(t);
  fixtureVault(join(root, 'v'));
  writeFileSync(join(root, '.research-vault.json'), '{"vault":"v"}\n');
  for (const [file, note] of [['a.md', '-re-checked by hand'], ['b.md', '-a note -- with dashes']]) {
    writeFileSync(join(root, file), 'See 2026-01-01-fx-doc.\n');
    const r = spawnSync(process.execPath, [CLI, 'gate', 'record', file, 'MERIT', note], { cwd: root, env: testEnv(), encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, `${note}: ${r.stdout}${r.stderr}`);
  }
  const notes = readFileSync(join(root, '.research-vault-ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).note);
  assert.deepEqual(notes, ['-re-checked by hand', '-a note -- with dashes']);
});

// R-23: as at e1db827, --help wins over a flag the command would refuse.
test('lint --help --nosuch prints the help row and exits 0', (t) => {
  const { cli } = sandbox(t);
  const r = cli('lint', '--help', '--nosuch');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith('research-vault lint: '), r.stdout);
  assert.equal(r.stderr, '');
});

// R-23: as at e1db827, a --help that a value option takes as its value still asks for help.
test('capture --title --help prints the help row, exits 0 and writes nothing', (t) => {
  const { cli, tree } = sandbox(t);
  const before = tree();
  const r = cli('capture', '--title', '--help');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.startsWith('research-vault capture: '), r.stdout);
  assert.equal(r.stderr, '');
  assert.deepEqual(tree(), before, 'nothing written in the folder, which is also HOME');
});

test('a flag before the command works as after it', (t) => {
  const { cli } = sandbox(t);
  const vault = tmpVault('rv-args-before-');
  put(vault, 'source', '2026-01-01-before', { source_type: 'article', source_url: 'https://example.org/before' });
  const after = cli('lint', '--vault', vault);
  const before = cli('--vault', vault, 'lint');
  assert.equal(before.status, after.status, before.stderr);
  assert.equal(before.stdout, after.stdout);
  assert.equal(before.stdout, 'lint: clean\n');
});

// Guard: every flag each command reads, in the forms the shipped skills, commands and docs pass them, parses (each run
// carries --help, so nothing else runs). It fails when one of these flags is dropped from a command's table, or a
// boolean one becomes value-taking (each is followed by another --flag).
const READS = {
  advise: '--json',
  capture: '--answer-summary x --authority-basis x --authority-tier x --batch x --body-file x --by-id x --captured-via x --confidence x --content x --content-file x --content-hash x --contributing-ids x --cwd x --date-run x --domain x --fill x --language x --model-id x --operation-id x --outcome x --provider x --question x --related x --series x --source-type x --sources x --state x --subject-name x --subject-version x --summary x --synthesis-basis x --task x --title x --topics a,b --type x --url x --volatility x --ack-data-egress --continue --discard --force --json --replace --scaffold --store-body --tested true',
  check: '--cwd x --now x --check --json --report',
  compile: '--stdout',
  embed: '--cwd x --ack-data-egress',
  export: '--chunk 1 --format x --min-authority x --now x --out x --overlap 1 --scope x --ack-data-egress --fresh-only --include-bodies',
  gate: '--cwd x --expect x --extra x --packet x --run x --changed --check --json',
  host: '--at x --cwd x --draft x --effort x --extra x --model x --out x --role x --dry-run --without-hooks',
  init: '--code-links x --domain x --globs x --topics a,b --volatility x --force --project --refresh-docs --set-default',
  lint: '--check --fix --json --topics',
  manifest: '--rebuild --topics',
  obsidian: '--out x',
  refresh: '--id x --dry-run --json',
  related: '--depth 2 --direction in --format x --rel x',
  search: '--body x --cwd x --domain x --limit 5 --now x --semantic x --series x --sort x --text x --topic x --type x --ack-data-egress --include-superseded --json',
  teach: '--answered x --answers 1 --body-file x --by x --kind x --lesson x --minutes 1 --needle a --needle b --out x --pass 1 --reason x --result x --title x --topic x --cancel --certify --dry-run --fix --hints --labs --no-hints --prose --skip-ungated --start --terminal',
  trust: '--revoke --show --yes',
  verify: '--answer-summary x --answered-by x --by-id x --id x --method x --notes x --quotes x --result x --run x --superseded-by x --json --stale --succession',
};
test('every flag a command reads, as shipped callers pass it, parses', (t) => {
  const { cli } = sandbox(t);
  for (const [cmd, flags] of Object.entries(READS)) {
    const r = cli(cmd, '--vault', 'x', ...flags.split(' '), '--help');
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
    assert.ok(r.stdout.startsWith(`research-vault ${cmd}: `), `${cmd}: ${r.stdout}`);
  }
});
