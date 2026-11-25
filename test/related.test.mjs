import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relatedTo, run } from '../bin/commands/related.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { traverse } from '../bin/lib/graph.mjs';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpVault, put, testEnv } from './helpers.mjs';

const S = '2026-01-01-s', N = '2026-01-02-n', Y = '2026-01-03-y', Q = '2026-01-04-q', P = '2026-01-05-p', O = '2026-01-06-o';

// Chain fixture (no cycle): S <- N <- Y <- Q, P -> S, O superseded_by Y.
function chain({ yRelatedN = false } = {}) {
  const dir = tmpVault('rv-related-');
  put(dir, 'source', S, { source_type: 'article', source_url: 'https://e.com/s' });
  put(dir, 'note', N, { sources: [S], confidence: 'medium', summary: 'N load-bearing claim' });
  put(dir, 'synthesis', Y, { contributing_ids: [N], related: yRelatedN ? [N] : [] });
  put(dir, 'question', Q, { question: 'q', state: 'open', contributing: [Y] });
  put(dir, 'snippet', P, { language: 'js', tested: false, source_id: S });
  put(dir, 'synthesis', O, { contributing_ids: [], status: 'superseded', superseded_by: Y });
  return dir;
}

async function cli(args) {
  const out = [], err = [];
  const [so, se] = [process.stdout.write, process.stderr.write];
  process.stdout.write = c => { out.push(String(c)); return true; };
  process.stderr.write = c => { err.push(String(c)); return true; };
  try { return { code: await run(args), out: out.join(''), err: err.join('') }; }
  finally { process.stdout.write = so; process.stderr.write = se; }
}
const ids = (r, pred = () => true) => r.nodes.filter(pred).map(n => n.id).sort();

test('nodes carry the row facets: summary, state, confidence, superseded_by (spec 08)', () => {
  const r = relatedTo(chain(), Y, { depth: 2, direction: 'both' });
  const by = Object.fromEntries(r.nodes.map(n => [n.id, n]));
  assert.equal(by[Q].state, 'open');
  assert.equal(by[O].status, 'superseded');
  assert.equal(by[O].superseded_by, Y);
  assert.equal(by[N].confidence, 'medium');
  assert.equal(by[N].summary, 'N load-bearing claim');
  assert.ok('summary' in by[Y] && 'authority_tier' in by[Y] && 'subject' in by[Y], 'facet keys present even when null');
  assert.equal(by[Y].summary, null);
});

test('related <snippet> forward contains its source via source_id', () => {
  assert.deepEqual(relatedTo(chain(), P).forward, [S]);
});

test('related <superseding entry> lists incoming superseded_by in edges but not backlinks', () => {
  const r = relatedTo(chain(), Y);
  assert.ok(r.edges.some(e => e.from === O && e.rel === 'superseded_by' && e.to === Y));
  assert.ok(!r.backlinks.includes(O));
  assert.ok(ids(r).includes(O), 'both-direction traversal reaches the superseded entry');
});

test('depth 1 both from S: neighbours N and P, compatibility arrays unchanged', () => {
  const r = relatedTo(chain(), S);
  assert.deepEqual(ids(r, n => n.distance > 0), [N, P]);
  assert.deepEqual(r.forward, []);
  assert.deepEqual(r.backlinks, [N, P]);
  assert.equal(r.nodes[0].id, S);
  assert.equal(r.nodes[0].distance, 0);
  assert.equal(r.nodes[0].type, 'source');
});

test('depth 2 in from S reaches Y at distance 2 with parent N', () => {
  const t = traverse(buildManifest(chain()), S, { depth: 2, direction: 'in' });
  assert.equal(t.nodes.find(n => n.id === Y).distance, 2);
  assert.equal(t.parents[Y], N);
});

test('depth 3 out from Q walks the evidence chain Y 1, N 2, S 3', () => {
  const r = relatedTo(chain(), Q, { depth: 3, direction: 'out' });
  const d = Object.fromEntries(r.nodes.map(n => [n.id, n.distance]));
  assert.deepEqual(d, { [Q]: 0, [Y]: 1, [N]: 2, [S]: 3 });
});

test('--rel filter follows only the named relations', () => {
  const r = relatedTo(chain(), Y, { depth: 5, direction: 'out', rels: ['sources', 'contributing_ids'] });
  assert.deepEqual(ids(r), [S, N, Y].sort());
  assert.ok(!ids(r).includes(Q));
});

test('result edges are the induced subgraph (cross edges between reached nodes included)', () => {
  const r = relatedTo(chain({ yRelatedN: true }), S, { depth: 2, direction: 'in' });
  assert.ok(r.edges.some(e => e.from === Y && e.rel === 'related' && e.to === N));
});

test('mermaid labels edges with the rel; an isolated entry renders its id alone', async () => {
  const dir = chain();
  const a = await cli({ _: ['related', N], vault: dir, format: 'mermaid' });
  assert.equal(a.code, 0);
  assert.ok(a.out.includes(`${N} -->|sources| ${S}`), a.out);
  put(dir, 'source', '2026-01-07-alone', { source_type: 'article', source_url: 'https://e.com/alone' });
  const b = await cli({ _: ['related', '2026-01-07-alone'], vault: dir, format: 'mermaid' });
  assert.equal(b.code, 0);
  assert.ok(b.out.includes('2026-01-07-alone'));
  assert.ok(!b.out.includes('-->'));
});

test('cycle terminates: A related B, B related A, A sources C', () => {
  const dir = tmpVault('rv-cycle-');
  put(dir, 'source', '2026-01-01-c', { source_type: 'article', source_url: 'https://e.com/c' });
  put(dir, 'note', '2026-01-02-a', { sources: ['2026-01-01-c'], related: ['2026-01-03-b'], confidence: 'medium' });
  put(dir, 'note', '2026-01-03-b', { sources: [], related: ['2026-01-02-a'], confidence: 'medium' });
  const r = relatedTo(dir, '2026-01-02-a', { depth: 5 });
  assert.deepEqual(r.nodes.map(n => [n.id, n.distance]), [['2026-01-02-a', 0], ['2026-01-01-c', 1], ['2026-01-03-b', 1]]);
});

test('a dangling reference is a node with missing: true', () => {
  const dir = tmpVault('rv-dangling-');
  put(dir, 'note', N, { sources: ['2026-01-01-gone'], confidence: 'medium' });
  const r = relatedTo(dir, N);
  assert.deepEqual(r.nodes.find(n => n.id === '2026-01-01-gone'), { id: '2026-01-01-gone', distance: 1, missing: true });
});

test('CLI rejects bad --depth/--direction/--rel with exit 2', async () => {
  const dir = chain();
  for (const bad of [{ depth: '0' }, { depth: '1.5' }, { depth: '-1' }, { depth: undefined }, { direction: 'sideways' }, { rel: 'nope' }, { rel: '' }]) {
    const { code, err } = await cli({ _: ['related', S], vault: dir, ...bad });
    assert.equal(code, 2, JSON.stringify(bad));
    assert.ok(err.includes('usage:'), JSON.stringify(bad));
  }
  assert.equal((await cli({ _: ['related', S], vault: dir, depth: '2', direction: 'in', rel: 'sources,contributing_ids' })).code, 0);
});

// S-11: mermaid is text for the agent, so an id from entry data cannot add a line or hide text.
test('related --format mermaid: an id from entry data stays on its edge line with no hidden characters', t => {
  const dir = tmpVault('rv-related-s11-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, 'note', N, { sources: [], related: ['2026-01-09-gone\n  2026-01-01-forged -->|sources| 2026-01-02-evil\u200b\u202e\u0007'], confidence: 'medium' });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'related', N, '--vault', dir, '--format', 'mermaid'], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `graph TD\n  ${N} -->|related| 2026-01-09-gone 2026-01-01-forged -->|sources| 2026-01-02-evil\n`);
});

// An entry id comes from its file name, which can hold a line break and tag characters ("ignore").
test('related --format mermaid: an entry id with no edges stays on its one line with no hidden characters', t => {
  const dir = tmpVault('rv-related-s11-alone-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const id = '2026-01-07-alone\n  2026-01-01-forged -->|sources| 2026-01-02-evil\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';
  put(dir, 'note', id, { sources: [], related: [], confidence: 'medium' });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'related', id, '--vault', dir, '--format', 'mermaid'], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'graph TD\n  2026-01-07-alone 2026-01-01-forged -->|sources| 2026-01-02-evil\n');
});

test("related --format mermaid: an edge's from id from a file name stays on its edge line with no hidden characters", t => {
  const dir = tmpVault('rv-related-s11-from-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const id = '2026-01-07-from\n  2026-01-01-forged -->|sources| 2026-01-02-evil\u{E0001}\u{E0069}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065}\u{E007F}';
  put(dir, 'note', N, { sources: [], related: [], confidence: 'medium' });
  put(dir, 'note', id, { sources: [], related: [N], confidence: 'medium' });
  const cli = fileURLToPath(new URL('../bin/research-vault.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, 'related', id, '--vault', dir, '--format', 'mermaid', '--direction', 'out'], { env: testEnv(), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `graph TD\n  2026-01-07-from 2026-01-01-forged -->|sources| 2026-01-02-evil -->|related| ${N}\n`);
});
