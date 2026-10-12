import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obsidianView } from '../bin/commands/obsidian.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { tmpVault, put } from './helpers.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('obsidian writes a derived stub note with a backlink wikilink', () => {
  const dir = freshVault();
  obsidianView(dir);
  const p = join(dir, '_obsidian', '2026-01-01-a.md');
  assert.ok(existsSync(p), 'expected _obsidian/2026-01-01-a.md to exist');
  assert.ok(readFileSync(p, 'utf8').includes('[[2026-01-02-b]]'), 'note should include backlink wikilink');
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
