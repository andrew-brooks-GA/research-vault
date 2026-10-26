import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, mkdirSync, utimesSync } from 'node:fs';
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
