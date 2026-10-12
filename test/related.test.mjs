import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relatedTo, run } from '../bin/commands/related.mjs';
import { tmpVault, put } from './helpers.mjs';

function graphVault() {
  const dir = tmpVault('rv-related-');
  put(dir, 'source', '2026-01-01-s', { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'snippet', '2026-01-02-p', { language: 'js', tested: false, source_id: '2026-01-01-s' });
  put(dir, 'note', '2026-01-03-n', { sources: ['2026-01-01-s'], confidence: 'medium' });
  put(dir, 'synthesis', '2026-01-04-y', { contributing_ids: ['2026-01-03-n'] });
  put(dir, 'synthesis', '2026-01-05-o', { contributing_ids: ['2026-01-03-n'], status: 'superseded', superseded_by: '2026-01-04-y' });
  return dir;
}

async function capture(args) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = c => { chunks.push(String(c)); return true; };
  try { return { code: await run(args), out: chunks.join('') }; } finally { process.stdout.write = orig; }
}

test('related <snippet> forward contains its source via source_id', () => {
  const r = relatedTo(graphVault(), '2026-01-02-p');
  assert.deepEqual(r.forward, ['2026-01-01-s']);
});

test('related <superseding entry> lists incoming superseded_by in edges but not backlinks', () => {
  const r = relatedTo(graphVault(), '2026-01-04-y');
  assert.ok(r.edges.some(e => e.from === '2026-01-05-o' && e.rel === 'superseded_by' && e.to === '2026-01-04-y'));
  assert.ok(!r.backlinks.includes('2026-01-05-o'));
});

test('related --format mermaid labels edges with the rel', async () => {
  const { code, out } = await capture({ _: ['related', '2026-01-02-p'], vault: graphVault(), format: 'mermaid' });
  assert.equal(code, 0);
  assert.ok(out.includes('2026-01-02-p -->|source_id| 2026-01-01-s'), out);
});
