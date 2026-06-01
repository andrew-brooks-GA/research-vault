import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obsidianView } from '../bin/commands/obsidian.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';

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

test('obsidian dedups forward Links in a synthesis entry note', () => {
  const dir = freshVault();
  obsidianView(dir);
  const body = readFileSync(join(dir, '_obsidian', '2026-01-02-b.md'), 'utf8');
  const count = body.split('[[2026-01-01-a]]').length - 1;
  assert.equal(count, 1, 'related+contributing_ids+sources must dedup to a single wikilink');
});
