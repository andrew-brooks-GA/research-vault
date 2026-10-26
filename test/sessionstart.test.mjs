import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpVault, put } from './helpers.mjs';
import { workspaceBrief, SPACING_DAYS } from '../hooks/session-start.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'session-start.mjs');
const NOW = new Date(); // the CLI reads the real clock, so the fixture dates hang off it too
const day = (n) => new Date(NOW.getTime() - n * 86400000);
const ver = (date) => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

const iso = (d) => d.toISOString().slice(0, 10);
const record = (date) => `---\ntitle: r\ntype: learning-record\ndate: ${iso(date)}\nstatus: active\nkind: understanding\n---\n# r\n`;

// A bound repo with one workspace: two learning records (one review-due) and two reference docs
// (one stale); `attempt` adds one graded attempt (1 of 3 wrong) on lesson 0001-x.
function repo({ due = true, attempt = false } = {}) {
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
  writeFileSync(join(ws, 'learning-records', '0001-a.md'), record(due ? day(SPACING_DAYS + 1) : day(1)));
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
  assert.equal(SPACING_DAYS, 21);
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

test('CLI prints the workspace line after the summary line', () => {
  const { root } = repo();
  const env = { ...process.env };
  delete env.RESEARCH_VAULT_PATH;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root }), cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^research-vault: 2 entries; 1 stale$/);
  assert.equal(lines[1], 'research-teach learn/k8s: 1 record(s) review-due; 1 reference doc(s) with a stale citation');
  assert.equal(lines.length, 2);
});

test('CLI outside a bound repo prints the summary line only', () => {
  const { vault } = repo();
  // cwd has no .research-vault.json but holds a workspace with a review-due learning record.
  const elsewhere = tmpVault('rv-sessionstart-cwd-');
  mkdirSync(join(elsewhere, 'ws', 'learning-records'), { recursive: true });
  writeFileSync(join(elsewhere, 'ws', 'MISSION.md'), '# m\n');
  writeFileSync(join(elsewhere, 'ws', 'learning-records', '0001-a.md'), record(day(SPACING_DAYS + 1)));
  const env = { ...process.env, RESEARCH_VAULT_PATH: vault };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: elsewhere }), cwd: elsewhere, env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'research-vault: 2 entries; 1 stale\n');
});
