import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureEntry } from '../bin/commands/capture.mjs';
import { sha256 } from '../bin/lib/ids.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';
import { lintVault } from '../bin/lib/lintrules.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('capture produces lint-clean entries for ALL six types', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'note', title: 'N', sources: '2026-01-01-a', confidence: 'high', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'synthesis', title: 'S', contributingIds: '2026-01-01-a', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'snippet', title: 'Sn', language: 'python', tested: true, now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'experiment', title: 'E', provider: 'anthropic', modelId: 'claude-opus-4-7', task: 't', outcome: 'success', now: '2026-05-27', repoRoot: process.cwd() });
  captureEntry(dir, { type: 'question', title: 'Does X hold?', now: '2026-05-27', repoRoot: process.cwd() });
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('Kubernetes-ecosystem entry: broad domain + tech in topics is lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'source', title: 'vcluster config docs', url: 'https://docs.vcluster.com/config',
    domain: 'systems-infrastructure', topics: 'kubernetes,vcluster,multi-tenancy',
    subjectName: 'vcluster', subjectVersion: '0.19', series: 'vcluster-config',
    now: '2026-05-27', repoRoot: process.cwd(),
  });
  assert.equal(r.dedup, null);
  const { violations } = lintVault(dir, process.cwd());
  assert.equal(violations.length, 0, 'expected 0 violations, got: ' + JSON.stringify(violations));
});

test('creates a conformant source entry and is lint-clean', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'New Article', url: 'https://new.example.com/post', now: '2026-05-27', repoRoot: process.cwd() });
  assert.equal(r.dedup, null);
  assert.ok(existsSync(r.path));
  assert.match(r.id, /^2026-05-27-new-article$/);
});

test('dedup: same normalized url + same subject.version returns existing', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'Dup', url: 'https://dup.example.com/x', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'Dup Again', url: 'https://dup.example.com/x/?utm_source=z', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(r2.dedup);
  assert.match(r2.dedup.reason, /url/);
});

test('dedup bypassed for distinct subject.version (version succession)', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'vc 19', url: 'https://docs.vcluster.com/config', subjectName: 'vcluster', subjectVersion: '0.19', series: 'vcluster-config', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'vc 20', url: 'https://docs.vcluster.com/config', subjectName: 'vcluster', subjectVersion: '0.20', series: 'vcluster-config', now: '2026-05-27', repoRoot: process.cwd() });
  assert.equal(r2.dedup, null);
});

test('stores content_hash and normalizes topics through aliases', () => {
  const dir = freshVault();
  const r = captureEntry(dir, { type: 'source', title: 'Hashed', url: 'https://h.example.com/x', content: 'hello world', topics: 'tdd,go', now: '2026-05-27', repoRoot: process.cwd() });
  const e = readEntry(r.path);
  assert.equal(e.data.content_hash, sha256('hello world'));
  assert.ok(e.data.topics.includes('test-driven-development')); // 'tdd' alias-normalized
  assert.ok(e.data.topics.includes('go'));
});

test('tripwire: same url+version but different content surfaces ambiguity', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'V1', url: 'https://t.example.com/p', content: 'AAA', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'V2', url: 'https://t.example.com/p', content: 'BBB', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(r2.dedup);
  assert.equal(r2.dedup.ambiguous, true);
  assert.match(r2.dedup.reason, /content/);
});

test('exact duplicate: same url+version+content is a plain (non-ambiguous) dup', () => {
  const dir = freshVault();
  captureEntry(dir, { type: 'source', title: 'V1', url: 'https://e2.example.com/p', content: 'SAME', now: '2026-05-27', repoRoot: process.cwd() });
  const r2 = captureEntry(dir, { type: 'source', title: 'V1b', url: 'https://e2.example.com/p', content: 'SAME', now: '2026-05-27', repoRoot: process.cwd() });
  assert.ok(r2.dedup);
  assert.ok(!r2.dedup.ambiguous);
});
