import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obsidianView } from '../bin/commands/obsidian.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { tmpVault, put, codeRepo } from './helpers.mjs';

const NOW = new Date('2026-06-01');

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('obsidian writes a derived stub note with a backlink wikilink', () => {
  const dir = freshVault();
  obsidianView(dir, '_obsidian', { now: NOW });
  const p = join(dir, '_obsidian', '2026-01-01-a.md');
  assert.ok(existsSync(p), 'expected _obsidian/2026-01-01-a.md to exist');
  const body = readFileSync(p, 'utf8');
  assert.ok(body.includes('[[2026-01-02-b]]'), 'note should include backlink wikilink');
  assert.ok(body.startsWith('---\ntags:\n'), 'stub starts with a tags frontmatter block');
  assert.ok(body.includes('  - type/source\n'));
  assert.ok(body.includes('  - freshness/fresh\n'), 'fixture source verified in-window is fresh');
  assert.ok(body.includes('Freshness as of 2026-06-01'));
});

test('obsidian never mutates the canonical entry (byte-identical)', () => {
  const dir = freshVault();
  const canon = join(dir, 'sources', '2026-01-01-a.md');
  const before = readFileSync(canon);
  obsidianView(dir);
  const after = readFileSync(canon);
  assert.equal(before.toString(), after.toString(), 'canonical entry must be byte-identical');
});

test('obsidian does not pollute the manifest and writes MOC.md', () => {
  const dir = freshVault();
  const before = buildManifest(dir).entries.length;
  obsidianView(dir);
  assert.equal(buildManifest(dir).entries.length, before, '_obsidian/ must not change manifest entry count');
  const moc = join(dir, '_obsidian', 'MOC.md');
  assert.ok(existsSync(moc), 'expected _obsidian/MOC.md to exist');
  assert.ok(readFileSync(moc, 'utf8').includes('[[2026-01-02-b]]'), 'MOC should list the synthesis entry');
});

test('obsidian groups forward Links by rel, one wikilink per rel', () => {
  const dir = freshVault();
  obsidianView(dir);
  const body = readFileSync(join(dir, '_obsidian', '2026-01-02-b.md'), 'utf8');
  const section = h => body.split(`### ${h}\n`)[1]?.split('###')[0] || '';
  for (const rel of ['related', 'contributing_ids']) {
    assert.equal(section(rel).split('[[2026-01-01-a]]').length - 1, 1, `source must appear exactly once under ### ${rel}`);
  }
});

test('obsidian snippet stub links its source under ### source_id', () => {
  const dir = tmpVault();
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '2026-01-01-s' });
  obsidianView(dir);
  const body = readFileSync(join(dir, '_obsidian', '2026-01-02-p.md'), 'utf8');
  assert.ok(body.includes('### source_id'));
  assert.ok(body.includes('[[2026-01-01-s]]'));
});

test('obsidian --out refuses canonical folders / escapes; default still works', () => {
  const dir = freshVault();
  const canon = join(dir, 'sources', '2026-01-01-a.md');
  const before = readFileSync(canon);
  assert.throws(() => obsidianView(dir, 'sources'), /refused/);
  assert.ok(readFileSync(canon).equals(before), 'canonical entry untouched after refused --out sources');
  assert.throws(() => obsidianView(dir, '..'), /refused/);
  assert.throws(() => obsidianView(dir, '.'), /refused/);
  assert.doesNotThrow(() => obsidianView(dir), 'default _obsidian still works');
});

const stub = (dir, id) => readFileSync(join(dir, '_obsidian', `${id}.md`), 'utf8');
const ver = date => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];

test('freshness tag: fast entry 200 days old is stale, volatile is stale, no volatility is unassessed', () => {
  const dir = tmpVault('rv-tags-');
  put(dir, 'source', '2026-01-01-old', { source_type: 'article', source_url: 'https://e.com/old', volatility: 'fast', verifications: ver('2026-01-01') });
  put(dir, 'source', '2026-01-02-vol', { source_type: 'article', source_url: 'https://e.com/vol', volatility: 'volatile', verifications: ver('2026-07-19') });
  put(dir, 'source', '2026-01-03-nov', { source_type: 'article', source_url: 'https://e.com/nov', volatility: undefined });
  obsidianView(dir, '_obsidian', { now: new Date('2026-07-20') });
  assert.ok(stub(dir, '2026-01-01-old').includes('  - freshness/stale\n'), 'string-vs-Date regression: 200 days past a 90-day window is stale');
  assert.ok(stub(dir, '2026-01-02-vol').includes('  - freshness/stale\n'));
  assert.ok(stub(dir, '2026-01-03-nov').includes('  - freshness/unassessed\n'));
});

test('topic tags are normalised to Obsidian-safe ASCII, deduplicated and sorted', () => {
  const dir = tmpVault('rv-tags-');
  put(dir, 'source', '2026-01-01-t', { source_type: 'article', source_url: 'https://e.com/t',
    topics: ['C++ Build Tools', 'a/b', 'snake_case-ok', 'Kubernetes', 'kubernetes!', '???', 'café'] });
  obsidianView(dir, '_obsidian', { now: NOW });
  const topics = stub(dir, '2026-01-01-t').split('---')[1].split('\n').filter(l => l.includes('topic/')).map(l => l.trim().slice(2));
  assert.deepEqual(topics, ['topic/a-b', 'topic/c-build-tools', 'topic/caf', 'topic/kubernetes', 'topic/snake_case-ok']);
});

test('obsidian writes one code note per linked file of the bound repo, wikilinks per symbol, pin as text', () => {
  const { vault } = codeRepo();
  const r = obsidianView(vault, '_obsidian', { now: NOW });
  assert.equal(r.code, 2);
  const a = readFileSync(join(vault, '_obsidian', 'code', 'src', 'a.lua.md'), 'utf8');
  assert.ok(a.includes('  - type/code\n'));
  assert.ok(a.includes('## f\n\n- [[2026-01-01-fx-doc]] (line 3)\n'));
  const b = readFileSync(join(vault, '_obsidian', 'code', 'src', 'b.lua.md'), 'utf8');
  assert.ok(b.includes('## ns.g\n\n- [[2026-01-01-fx-missing]] @dep=1.2.3 (line 1)\n'));
  assert.ok(readFileSync(join(vault, '_obsidian', 'MOC.md'), 'utf8').includes('## code (2)\n\n- [[code/src/a.lua]]\n- [[code/src/b.lua]]\n'));
  assert.equal(obsidianView(codeRepo({ code: false }).vault).code, 0, 'no code block, no code notes');
});
