import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpVault, put } from './helpers.mjs';
import { workspaceBrief, SPACING_DAYS } from '../hooks/session-start.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'session-start.mjs');
const NOW = new Date(); // the CLI reads the real clock, so the fixture dates hang off it too
const day = (n) => new Date(NOW.getTime() - n * 86400000);
const ver = (date) => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

// A bound repo with one workspace: two learning records (one old) and two reference docs (one stale).
function repo({ due = true } = {}) {
  const root = tmpVault('rv-sessionstart-');
  const vault = join(root, 'research');
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify({ vault }) + '\n');
  put(vault, 'source', '2026-07-10-fresh', { source_type: 'article', source_url: 'https://e.com/fresh', volatility: 'fast', verifications: ver(day(1).toISOString().slice(0, 10)) });
  put(vault, 'source', '2020-01-01-old', { source_type: 'article', source_url: 'https://e.com/old', volatility: 'fast', verifications: ver('2020-01-01') });
  const ws = join(root, 'learn', 'k8s');
  mkdirSync(join(ws, 'learning-records'), { recursive: true });
  mkdirSync(join(ws, 'reference'), { recursive: true });
  writeFileSync(join(ws, 'MISSION.md'), '# m\n');
  writeFileSync(join(ws, 'learning-records', 'a.md'), 'a\n');
  writeFileSync(join(ws, 'learning-records', 'b.md'), 'b\n');
  writeFileSync(join(ws, 'reference', 'fresh.html'), '<a href="https://e.com/fresh">x</a>\n');
  writeFileSync(join(ws, 'reference', 'stale.html'), `<a href="https://e.com/${due ? 'old' : 'fresh'}">x</a>\n`);
  const recent = day(1);
  const old = day(SPACING_DAYS + 1);
  utimesSync(join(ws, 'learning-records', 'a.md'), due ? old : recent, due ? old : recent);
  utimesSync(join(ws, 'learning-records', 'b.md'), recent, recent);
  return { root, vault, ws };
}

test('workspaceBrief counts old learning records and stale reference docs', () => {
  const { vault, ws } = repo();
  assert.equal(SPACING_DAYS, 21);
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'),
    'research-teach learn/k8s: 1 learning record(s) older than 21 days; 1 reference doc(s) with a stale citation');
});

test('workspaceBrief is empty when nothing is due', () => {
  const { vault, ws } = repo({ due: false });
  assert.equal(workspaceBrief(ws, vault, NOW, 'learn/k8s'), '');
});

test('CLI prints the workspace line after the summary line', () => {
  const { root } = repo();
  const env = { ...process.env };
  delete env.RESEARCH_VAULT_PATH;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root }), cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^research-vault: 2 entries; 1 stale$/);
  assert.equal(lines[1], 'research-teach learn/k8s: 1 learning record(s) older than 21 days; 1 reference doc(s) with a stale citation');
  assert.equal(lines.length, 2);
});
