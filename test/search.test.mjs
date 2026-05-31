import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchVault } from '../bin/commands/search.mjs';
import { relatedTo } from '../bin/commands/related.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';

const VAULT = fileURLToPath(new URL('./fixtures/vault', import.meta.url));

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-search-')), 'v');
  cpSync(VAULT, dir, { recursive: true });
  return dir;
}

test('search filters by type and topic', () => {
  const r = searchVault(VAULT, { type: 'source', topic: 'x' });
  assert.ok(r.some(e => e.id === '2026-01-01-a'));
  assert.ok(!r.some(e => e.type === 'synthesis'));
});

test('related returns forward edges and backlinks', () => {
  const r = relatedTo(VAULT, '2026-01-01-a');
  assert.ok(r.backlinks.includes('2026-01-02-b'));
});

test('related forward edges are de-duplicated across edge fields', () => {
  // 2026-01-02-b references 2026-01-01-a in BOTH related and contributing_ids
  const r = relatedTo(VAULT, '2026-01-02-b');
  const counts = r.forward.filter(x => x === '2026-01-01-a').length;
  assert.equal(counts, 1, 'forward edge should appear once, not per-field: ' + JSON.stringify(r.forward));
});

test('search --body matches entry body text, not just title/topics', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'note', title: 'Plain Title', sources: '2026-01-01-a',
    confidence: 'high', now: '2026-05-30', repoRoot: process.cwd(),
  });
  appendFileSync(r.path, 'The syncer shares the host APF bucket under contention.\n');

  const hit = searchVault(dir, { body: 'apf bucket' });
  assert.ok(hit.some(e => e.id === r.id), '--body finds the appended body phrase');

  const miss = searchVault(dir, { body: 'no such phrase zzz' });
  assert.ok(!miss.some(e => e.id === r.id), '--body excludes entries without the phrase');

  const viaText = searchVault(dir, { text: 'apf bucket' });
  assert.ok(!viaText.some(e => e.id === r.id), 'title/topic --text must NOT match body-only text');
});
