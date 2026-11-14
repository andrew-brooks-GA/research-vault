import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tmpVault, put } from './helpers.mjs';
import { checkQuotes } from '../bin/lib/quotes.mjs';
import { buildPacket } from '../bin/lib/packet.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';

const NOW = { now: '2026-06-12', repoRoot: process.cwd() };
const RUN = 'run-abc123';
const BIG = 'big', SMALL = 'small';
const line = k => (k === 40 ? 'The quoted sentence sits on line forty of the page.' : `Line ${k} of a long stored page, with enough words to count as text.`);
const body = id => `# 2026-01-01-${id}\n\n${Array.from({ length: 160 }, (_, i) => line(i + 3)).join('\n')}\n`;
const vault = () => {
  const dir = tmpVault();
  put(dir, 'source', `2026-01-01-${BIG}`, { source_type: 'article', source_url: 'https://example.org/big' }, body(BIG));
  put(dir, 'source', `2026-01-01-${SMALL}`, { source_type: 'article', source_url: 'https://example.org/small' }, `# 2026-01-01-${SMALL}\n\n${'A small page whose one sentence is checked here. '.repeat(6)}\nThe small page says this whole sentence.\n`);
  put(dir, 'note', '2026-01-01-n', { sources: [`2026-01-01-${BIG}`] }, '# 2026-01-01-n\n\nA note that is copied whole.\n');
  put(dir, 'source', '2026-01-01-unlisted', { source_type: 'article', source_url: 'https://example.org/u' });
  return dir;
};
const listed = [BIG, SMALL, 'n'].map(x => ({ id: `2026-01-01-${x}` }));
const out = () => join(mkdtempSync(join(tmpdir(), 'rv-packet-')), 'p');

test('gate evidence --packet: a large source is cut to the lines within three of a checked quote; a small source and a note are copied whole', async () => {
  const dir = vault();
  await checkQuotes(dir, `2026-01-01-${BIG}`, ['The quoted sentence sits on line forty of the page.'], { ...NOW, runKey: RUN });
  await checkQuotes(dir, `2026-01-01-${SMALL}`, ['The small page says this whole sentence.'], { ...NOW, runKey: RUN });
  const p = out();
  const r = buildPacket(dir, listed, p, RUN, process.cwd());
  assert.deepEqual({ entries: r.entries, excerpted: r.excerpted }, { entries: 3, excerpted: 1 });
  const big = readEntry(join(p, 'sources', `2026-01-01-${BIG}.md`));
  const kept = big.body.split('\n').filter(l => /^L\d+: /.test(l)).map(l => Number(/^L(\d+)/.exec(l)[1]));
  assert.deepEqual(kept, [37, 38, 39, 40, 41, 42, 43]);
  assert.ok(big.body.includes('L40: The quoted sentence sits on line forty of the page.'));
  assert.match(big.body, /cannot show that the page lacks something/);
  assert.equal(big.data.verifications.at(-1).method, 'quote-matched', 'the rows travel with the excerpt');
  assert.equal(readFileSync(join(p, 'sources', `2026-01-01-${SMALL}.md`), 'utf8'), readFileSync(join(dir, 'sources', `2026-01-01-${SMALL}.md`), 'utf8'));
  assert.equal(readFileSync(join(p, 'notes', '2026-01-01-n.md'), 'utf8'), readFileSync(join(dir, 'notes', '2026-01-01-n.md'), 'utf8'));
  assert.ok(!existsSync(join(p, 'sources', '2026-01-01-unlisted.md')), 'an entry off the list is not in the packet');
  assert.ok(existsSync(join(p, '.vault-manifest.json')));
  assert.equal(readEntry(join(dir, 'sources', `2026-01-01-${BIG}.md`)).body, body(BIG), 'the vault is unchanged');
});

test('gate evidence --packet: refused for rows of another run or none, for a body changed since its rows, with nothing to cut, inside the vault and into a directory that holds files', async () => {
  const dir = vault();
  await checkQuotes(dir, `2026-01-01-${BIG}`, ['The quoted sentence sits on line forty of the page.'], { ...NOW, runKey: 'run-other99' });
  assert.throws(() => buildPacket(dir, listed, out(), RUN, process.cwd()), /has a quote row of run-other99, not of run-abc123/);
  const none = vault();
  await checkQuotes(none, `2026-01-01-${BIG}`, ['The quoted sentence sits on line forty of the page.'], NOW);
  assert.throws(() => buildPacket(none, listed, out(), RUN, process.cwd()), /has a quote row of no run/);
  const stale = vault();
  await checkQuotes(stale, `2026-01-01-${BIG}`, ['The quoted sentence sits on line forty of the page.'], { ...NOW, runKey: RUN });
  const f = join(stale, 'sources', `2026-01-01-${BIG}.md`);
  writeFileSync(f, readFileSync(f, 'utf8') + 'One more line.\n');
  assert.throws(() => buildPacket(stale, listed, out(), RUN, process.cwd()), /for an earlier text of its body/);
  const bare = vault();
  await checkQuotes(bare, `2026-01-01-${SMALL}`, ['The small page says this whole sentence.'], { ...NOW, runKey: RUN });
  assert.throws(() => buildPacket(bare, listed, out(), RUN, process.cwd()), /nothing to cut/);
  assert.throws(() => buildPacket(bare, listed, join(bare, 'packet'), RUN, process.cwd()), /outside the vault/);
  assert.throws(() => buildPacket(bare, listed, bare.replace(/[^/]+$/, ''), RUN, process.cwd()), /is not empty|outside the vault/);
  assert.throws(() => buildPacket(bare, listed, out(), '2026-11-14-apf-k3', process.cwd()), /--run <key>/);
  await assert.rejects(checkQuotes(bare, `2026-01-01-${SMALL}`, ['The small page says this whole sentence.'], { ...NOW, runKey: 'nope' }), /--run/);
});

test('gate evidence --packet: the command prints the list and the packet line, and prints nothing when the packet is refused', async () => {
  const { run } = await import('../bin/commands/gate.mjs');
  const dir = vault();
  put(dir, 'synthesis', '2026-01-02-s', { contributing_ids: [`2026-01-01-${BIG}`], summary: 's', confidence: 'medium' }, `# 2026-01-02-s\n\nIt rests on 2026-01-01-${BIG}.\n`);
  const draft = join(dir, 'synthesis', '2026-01-02-s.md');
  const call = async extra => {
    const o = [], e = [];
    const so = process.stdout.write, se = process.stderr.write;
    process.stdout.write = s => { o.push(s); return true; };
    process.stderr.write = s => { e.push(s); return true; };
    try { return { code: await run({ _: ['gate', 'evidence', draft], vault: dir, cwd: dir, ...extra }), out: o.join(''), err: e.join('') }; } finally { process.stdout.write = so; process.stderr.write = se; }
  };
  const refused = await call({ packet: out(), run: RUN });
  assert.equal(refused.code, 1);
  assert.equal(refused.out, '');
  assert.match(refused.err, /^gate: no packet: /);
  await checkQuotes(dir, `2026-01-01-${BIG}`, ['The quoted sentence sits on line forty of the page.'], { ...NOW, runKey: RUN });
  const p = out();
  const ok = await call({ packet: p, run: RUN });
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, new RegExp(`^2026-01-01-${BIG} \\[source, active\\]\\n2026-01-02-s \\[synthesis, active\\]\\npacket: .* \\(1 of 2 entries cut .*cannot pass it\\)\\n$`));
  assert.ok(existsSync(join(p, 'sources', `2026-01-01-${BIG}.md`)));
});
