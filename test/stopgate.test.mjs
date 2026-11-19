import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, mkdirSync, utimesSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpVault } from './helpers.mjs';
import { recordVerdict, contentHash } from '../bin/lib/gate.mjs';
import { missingGates, sinceFrom, TWELVE_HOURS } from '../hooks/stop-gate.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'stop-gate.mjs');

// A bound repo with one workspace holding two lessons.
function repo() {
  const root = tmpVault('rv-stopgate-');
  const vault = join(root, 'research');
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault }) + '\n');
  mkdirSync(join(root, 'learn', 'lessons'), { recursive: true });
  writeFileSync(join(root, 'learn', 'MISSION.md'), '# m\n');
  writeFileSync(join(root, 'learn', 'lessons', 'a.html'), 'a\n');
  writeFileSync(join(root, 'learn', 'lessons', 'b.html'), 'b\n');
  return { root, vault };
}

function hook(evt) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(evt), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('missingGates lists a changed lesson with no record and omits a recorded one', () => {
  const { root, vault } = repo();
  recordVerdict(root, join(root, 'learn/lessons/b.html'), 'PASS');
  assert.deepEqual(missingGates(root, vault, {}, 0), [
    { file: 'learn/lessons/a.html', sha256: contentHash('a\n') },
  ]);
});

test('missingGates skips files older than since', () => {
  const { root, vault } = repo();
  const old = new Date(Date.now() - 86400000);
  utimesSync(join(root, 'learn/lessons/a.html'), old, old);
  assert.deepEqual(missingGates(root, vault, {}, Date.now() - 3600000).map((m) => m.file), ['learn/lessons/b.html']);
});

test('missingGates lists a lesson again after it changes post-record', () => {
  const { root, vault } = repo();
  recordVerdict(root, join(root, 'learn/lessons/a.html'), 'MERIT');
  recordVerdict(root, join(root, 'learn/lessons/b.html'), 'PASS');
  assert.deepEqual(missingGates(root, vault, {}, 0), []);
  appendFileSync(join(root, 'learn/lessons/a.html'), 'edit\n');
  assert.deepEqual(missingGates(root, vault, {}, 0), [
    { file: 'learn/lessons/a.html', sha256: contentHash('a\nedit\n') },
  ]);
});

test('missingGates ignores a tracked file git reports clean, whatever its mtime, and lists it once edited', () => {
  const { root, vault } = repo();
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fixtures');
  // Fresh mtimes, nothing edited: a worktree or checkout looks like this.
  assert.deepEqual(missingGates(root, vault, {}, 0), []);
  appendFileSync(join(root, 'learn/lessons/a.html'), 'edit\n');
  assert.deepEqual(missingGates(root, vault, {}, 0).map((m) => m.file), ['learn/lessons/a.html']);
});

test('CLI exits 0 with no output when stop_hook_active is true', () => {
  const { root } = repo();
  const r = hook({ stop_hook_active: true, transcript_path: join(root, 'nope.jsonl'), cwd: root });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('CLI exits 0 with no output outside a bound repo', () => {
  const root = tmpVault('rv-stopgate-unbound-');
  const r = hook({ stop_hook_active: false, transcript_path: join(root, 'nope.jsonl'), cwd: root });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('CLI blocks with the file key in the reason', () => {
  const { root } = repo();
  recordVerdict(root, join(root, 'learn/lessons/b.html'), 'PASS');
  const transcript = join(root, 't.jsonl');
  writeFileSync(transcript, '');
  // a.html was written before the transcript was born; push its mtime past that to count as changed this session.
  const now = new Date(Date.now() + 1000);
  utimesSync(join(root, 'learn/lessons/a.html'), now, now);
  const r = hook({ stop_hook_active: false, transcript_path: transcript, cwd: join(root, 'learn') });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.decision, 'block');
  assert.deepEqual(Object.keys(out), ['decision', 'reason']);
  assert.match(out.reason, /^- learn\/lessons\/a\.html: run the research-claims-gate skill, then research-vault gate record learn\/lessons\/a\.html PASS\|MERIT$/m);
  assert.doesNotMatch(out.reason, /b\.html/);
});

test('CLI exits 0 with no output on a missing transcript and nothing changed', () => {
  const { root } = repo();
  const old = new Date(Date.now() - 86400000);
  for (const f of ['a.html', 'b.html']) utimesSync(join(root, 'learn/lessons', f), old, old);
  const r = hook({ stop_hook_active: false, transcript_path: join(root, 'missing.jsonl'), cwd: root });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, '');
});

test('sinceFrom uses birth time, and falls back to now minus twelve hours when it is 0 or missing', () => {
  const now = 1_800_000_000_000;
  assert.equal(sinceFrom('/t', now, () => ({ birthtimeMs: 1234 })), 1234);
  assert.equal(sinceFrom('/t', now, () => ({ birthtimeMs: 0 })), now - TWELVE_HOURS);
  assert.equal(sinceFrom('/t', now, () => { throw new Error('ENOENT'); }), now - TWELVE_HOURS);
  assert.equal(sinceFrom(join(tmpVault('rv-nots-'), 'missing.jsonl'), now), now - TWELVE_HOURS);
});

test('CLI fails open with a systemMessage when the binding file is malformed', () => {
  const root = tmpVault('rv-stopgate-bad-');
  writeFileSync(join(root, '.research-vault.json'), '{ not json\n');
  const r = hook({ stop_hook_active: false, transcript_path: join(root, 'nope.jsonl'), cwd: root });
  assert.equal(r.code, 0);
  assert.equal(r.err, '');
  assert.match(JSON.parse(r.out).systemMessage, /^research-vault: stop-gate skipped \(.+\)$/);
});

// ---- code links (spec 15 D3, D4) ----
import { readFileSync } from 'node:fs';
import { codeRepo } from './helpers.mjs';
import { reasonLine } from '../hooks/stop-gate.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { parseProjectConfig } from '../bin/lib/projectconfig.mjs';

const parsed = (root) => parseProjectConfig(readFileSync(join(root, '.research-vault.json'), 'utf8'), loadSchema(process.cwd()));

test('missingGates lists linked code files without a verdict, then the links a changed versions file unpins', () => {
  const { root, vault } = codeRepo();
  const cfg = parsed(root);
  assert.deepEqual(missingGates(root, vault, cfg, 0).map((m) => m.file), ['src/a.lua', 'src/b.lua']);
  recordVerdict(root, join(root, 'src/a.lua'), 'MERIT');
  recordVerdict(root, join(root, 'src/b.lua'), 'PASS');
  assert.deepEqual(missingGates(root, vault, cfg, 0), []);
  writeFileSync(join(root, 'deps.txt'), 'dep 2.0.0\n');
  assert.deepEqual(missingGates(root, vault, cfg, 0), [
    { file: 'src/b.lua', line: 1, symbol: 'ns.g', id: '2026-01-01-fx-missing', key: 'dep', version: '1.2.3', declared: '2.0.0' },
  ]);
  assert.equal(reasonLine(missingGates(root, vault, cfg, 0)[0]),
    '- src/b.lua:1 ns.g: pinned dep=1.2.3, declared 2.0.0; re-verify 2026-01-01-fx-missing and move the pin, or capture the new version and replace the id');
  const old = new Date(Date.now() - 86400000);
  utimesSync(join(root, 'deps.txt'), old, old);
  assert.deepEqual(missingGates(root, vault, cfg, Date.now() - 3600000), [], 'a versions file untouched this session blocks nothing');
});

test('CLI blocks with the pin line after a versions bump', () => {
  const { root } = codeRepo();
  recordVerdict(root, join(root, 'src/a.lua'), 'MERIT');
  recordVerdict(root, join(root, 'src/b.lua'), 'PASS');
  const transcript = join(root, 't.jsonl');
  writeFileSync(transcript, '');
  writeFileSync(join(root, 'deps.txt'), 'dep 2.0.0\n');
  const now = new Date(Date.now() + 1000);
  utimesSync(join(root, 'deps.txt'), now, now);
  const r = hook({ stop_hook_active: false, transcript_path: transcript, cwd: root });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^- src\/b\.lua:1 ns\.g: pinned dep=1\.2\.3, declared 2\.0\.0; re-verify 2026-01-01-fx-missing and move the pin, or capture the new version and replace the id$/m);
  assert.doesNotMatch(out.reason, /a\.lua/);
});

// Absent state (spec 15 D7): a .lua file changed this session is not gated without a code block.
test('CLI gives no decision for a changed .lua file in a repo without a code block', () => {
  const { root } = codeRepo({ code: false });
  const transcript = join(root, 't.jsonl');
  writeFileSync(transcript, '');
  const now = new Date(Date.now() + 1000);
  utimesSync(join(root, 'src', 'a.lua'), now, now);
  const r = hook({ stop_hook_active: false, transcript_path: transcript, cwd: root });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, '');
});

// Issue 72 item 12: the Stop hook names the cited ids this vault lacks.
test('missingGates counts the cited ids this vault lacks, and the reason line names them (issue 72 item 12)', () => {
  const { root, vault } = repo();
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'x.md'), '# X\n\n<!-- evidence: 2026-09-09-not-here -->\n\nA claim.\n');
  const cfg = { gates: { globs: ['docs/*.md'] } };
  const m = missingGates(root, vault, cfg, 0).find((r) => r.file === 'docs/x.md');
  assert.equal(m.missing, 1);
  assert.equal(reasonLine(m), '- docs/x.md: 1 cited id not in this vault: rebuild that evidence, then run the research-claims-gate skill, then research-vault gate record docs/x.md PASS|MERIT');
  assert.equal(reasonLine({ file: 'docs/y.md', sha256: 'x' }), '- docs/y.md: run the research-claims-gate skill, then research-vault gate record docs/y.md PASS|MERIT');
});

test('missingGates lists a checked task\'s lesson when only its requirements.json changed (issue 79 D9)', () => {
  const root = tmpVault('rv-stopgate-task-');
  const vault = join(root, 'research');
  mkdirSync(vault);
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault }) + '\n');
  cpSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'teach-task'), join(root, 'ws'), { recursive: true });
  const page = join(root, 'ws', 'lessons', '0001-files.html');
  const req = join(root, 'ws', 'evidence', '0001', 'requirements.json');
  recordVerdict(root, page, 'PASS');
  recordVerdict(root, join(root, 'ws', 'lessons', '0002-more.html'), 'PASS'); // the fixture's second task
  const old = new Date(Date.now() - 3600000);
  utimesSync(page, old, old);
  assert.deepEqual(missingGates(root, vault, {}, Date.now() - 60000), []);
  writeFileSync(req, readFileSync(req, 'utf8').replace('hello', 'goodbye'));
  assert.deepEqual(missingGates(root, vault, {}, Date.now() - 60000).map((m) => m.file), ['ws/lessons/0001-files.html']);
});
