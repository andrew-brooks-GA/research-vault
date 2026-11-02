import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEntry, walkEntries } from '../bin/lib/fsutil.mjs';
import { loadSchema, fieldOrder } from '../bin/lib/schema.mjs';
import { lintAndReport } from '../bin/commands/lint.mjs';
import { buildExport, toJsonl } from '../bin/lib/exportjsonl.mjs';
import { buildManifest } from '../bin/lib/manifest.mjs';
import { applyVerification } from '../bin/commands/verify.mjs';
import { run } from '../bin/commands/export.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';
import { readEntry } from '../bin/lib/fsutil.mjs';

// Hand-write an entry directly to disk (mirroring capture/lint tests) so we can build
// question entries with controlled state/answer_summary the fixture vault lacks.
function handWrite(dir, folder, type, id, extra) {
  const schema = loadSchema(process.cwd());
  const data = {
    title: id, type, created: '2026-01-01',
    domain: ['software-engineering'], stage: schema.taxonomy.stage_by_folder[folder].default,
    topics: ['x'], status: 'active', related: [], volatility: 'slow',
    verifications: [{ date: '2026-01-01', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }],
    ...extra,
  };
  mkdirSync(join(dir, folder), { recursive: true });
  writeEntry(join(dir, folder, `${id}.md`), data, `# ${id}\n`, fieldOrder(schema, type));
}

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-export-')), 'v');
  cpSync(fileURLToPath(new URL('./fixtures/vault', import.meta.url)), dir, { recursive: true });
  return dir;
}

function seedQuestions(dir) {
  handWrite(dir, 'questions', 'question', '2026-01-01-q-answered', { question: 'Does X hold?', state: 'answered', answer_summary: 'Yes, under condition Y.' });
  handWrite(dir, 'questions', 'question', '2026-01-01-q-empty', { question: 'Is Z true?', state: 'answered', answer_summary: '' });
  handWrite(dir, 'questions', 'question', '2026-01-01-q-open', { question: 'What about W?', state: 'open' });
}

test('default export emits only answered questions with a non-empty answer_summary', () => {
  const dir = freshVault();
  seedQuestions(dir);
  const records = buildExport(dir);
  assert.equal(records.length, 1, 'exactly one record expected');
  const r = records[0];
  assert.equal(r.meta.id, '2026-01-01-q-answered');
  assert.equal(r.input, 'Does X hold?');
  assert.equal(r.output, 'Yes, under condition Y.');
  assert.equal(r.meta.type, 'question');
  assert.ok('last_verified' in r.meta);

  const out = toJsonl(records);
  const lines = out.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'one JSONL line');
  const parsed = JSON.parse(lines[0]);
  assert.deepEqual(parsed, r, 'line round-trips through JSON');
  assert.ok(!out.includes('# 2026-01-01-q-answered'), 'no entry-body text in output');
  assert.ok(!out.includes('q-empty') && !out.includes('q-open'), 'skipped questions absent');
});

test('export is deterministic (byte-identical across runs, stable id sort)', () => {
  const dir = freshVault();
  seedQuestions(dir);
  handWrite(dir, 'questions', 'question', '2026-01-01-a-answered', { question: 'A?', state: 'answered', answer_summary: 'A.' });
  const a = toJsonl(buildExport(dir));
  const b = toJsonl(buildExport(dir));
  assert.equal(a, b, 'two runs are byte-identical');
  const ids = a.split('\n').filter(Boolean).map(l => JSON.parse(l).meta.id);
  assert.deepEqual(ids, [...ids].sort((x, y) => x.localeCompare(y)), 'records are id-sorted');
});

test('--include-bodies without --ack-data-egress refuses', () => {
  const dir = freshVault();
  seedQuestions(dir);
  assert.throws(
    () => buildExport(dir, { includeBodies: true }),
    /ack.*egress|egress.*ack/i,
  );
});

test('--include-bodies --ack-data-egress includes note/synthesis bodies and reports counts', () => {
  const dir = freshVault();
  seedQuestions(dir);
  handWrite(dir, 'notes', 'note', '2026-01-01-n', { sources: ['2026-01-01-a'], confidence: 'high' });
  const records = buildExport(dir, { scope: ['question', 'note', 'synthesis'], includeBodies: true, ackDataEgress: true });
  const note = records.find(r => r.meta.type === 'note');
  assert.ok(note, 'a note record is present');
  assert.ok(note.output.length > 0, 'note body is emitted');

  const typeCounts = {};
  for (const r of records) typeCounts[r.meta.type] = (typeCounts[r.meta.type] || 0) + 1;
  assert.ok(typeCounts.note >= 1 && typeCounts.question >= 1, 'type counts cover scope');
  const bytes = Buffer.byteLength(toJsonl(records), 'utf8');
  assert.ok(bytes > 0, 'report has a byte size');
});

test('export is read-only: vault unchanged and lint-clean afterward', () => {
  const dir = freshVault();
  seedQuestions(dir);
  // Baseline manifest so --check has something to compare against.
  assert.equal(lintAndReport(dir, { check: false }).violations.length, 0, 'fresh hand-built vault is clean');

  const before = walkEntries(dir).map(f => [f, readFileSync(f)]);
  buildExport(dir, { scope: ['question', 'note', 'synthesis'], includeBodies: true, ackDataEgress: true });
  buildExport(dir);

  for (const [f, bytes] of before) assert.ok(readFileSync(f).equals(bytes), `entry unchanged: ${f}`);
  assert.equal(lintAndReport(dir, { check: true }).violations.length, 0, 'vault still lint-clean after export');
});

test('export --out refuses a path inside the vault and writes nothing; outside works', async () => {
  const dir = freshVault();
  seedQuestions(dir);
  const inside = join(dir, 'sources', 'leak.jsonl');
  const code = await run({ out: inside, vault: dir });
  assert.equal(code, 1, 'in-vault --out must refuse');
  assert.ok(!existsSync(inside), 'nothing written inside the vault');
  const outside = join(mkdtempSync(join(tmpdir(), 'rv-out-')), 'train.jsonl');
  assert.equal(await run({ out: outside, vault: dir }), 0, 'external --out still works');
  assert.ok(existsSync(outside), 'external file written');
});

test("export meta.last_verified matches the manifest and ignores a non-confirming verify", () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-elv-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/lv', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Claim', sources: '2026-01-01-src', summary: 'x', now: '2026-01-02' });
  const noteId = buildManifest(dir).entries.find(e => e.type === 'note').id;
  // A failed check must not move either surface's clock off the capture seed.
  applyVerification(dir, { id: noteId, method: 'refetched-source', result: 'unreachable', now: '2027-01-01', repoRoot: process.cwd() });
  const rec = buildExport(dir, { scope: ['note'] }).find(r => r.meta.id === noteId);
  const row = buildManifest(dir).entries.find(e => e.id === noteId);
  assert.equal(rec.meta.last_verified, row.last_verified, 'export meta matches manifest row');
  assert.equal(rec.meta.last_verified, '2026-01-02', 'stays on the capture seed, not the unreachable date');
});

test('note summary exports as output without the body gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-esum-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/w', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Crisp', sources: '2026-01-01-src', summary: 'A claim.', now: '2026-01-02' });
  captureEntry(dir, { type: 'note', title: 'Bare', sources: '2026-01-01-src', now: '2026-01-03' });
  const recs = buildExport(dir, { scope: ['note'] });   // no includeBodies, no ack
  assert.equal(recs.find(r => r.input === 'Crisp').output, 'A claim.');
  assert.equal(recs.find(r => r.input === 'Bare').output, '');   // unchanged: metadata-only
});

test('export --scope "question, note" trims the list and exports both types (spec 13)', async () => {
  const dir = freshVault();
  seedQuestions(dir);
  handWrite(dir, 'notes', 'note', '2026-01-01-n', { sources: ['2026-01-01-a'], confidence: 'high' });
  const outFile = join(mkdtempSync(join(tmpdir(), 'rv-out-')), 'scope.jsonl');
  const so = process.stdout.write;
  process.stdout.write = () => true;
  try { assert.equal(await run({ out: outFile, vault: dir, scope: 'question, note' }), 0); }
  finally { process.stdout.write = so; }
  const types = new Set(readFileSync(outFile, 'utf8').trim().split('\n').map(l => JSON.parse(l).meta.type));
  assert.deepEqual([...types].sort(), ['note', 'question']);
});

test('export meta carries topics, authority_tier, volatility and source_url on every record (spec 33 D0)', () => {
  const dir = freshVault();
  seedQuestions(dir);
  for (const r of buildExport(dir)) for (const k of ['topics', 'authority_tier', 'volatility', 'source_url']) assert.ok(k in r.meta, `${k} on ${r.meta.id}`);
  handWrite(dir, 'sources', 'source', '2026-01-01-tiered', { source_type: 'article', source_url: 'https://t.example.com/a', authority_tier: 'primary', topics: ['x', 'y'] });
  const m = buildExport(dir, { scope: ['source'] }).find(r => r.meta.id === '2026-01-01-tiered').meta;
  assert.deepEqual([m.topics, m.authority_tier, m.volatility, m.source_url], [['x', 'y'], 'primary', 'slow', 'https://t.example.com/a']);
});

test('export --chunk round-trips: windows step by chunk minus overlap and reassemble to the body; without bodies the summary is windowed (spec 33 D1)', () => {
  const dir = freshVault();
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const { id, path } = captureEntry(dir, { type: 'note', title: 'Long', sources: ['2026-01-01-a'], summary: 'a short summary', body: letters });
  const body = readEntry(path).body;
  const ws = buildExport(dir, { scope: ['note'], includeBodies: true, ackDataEgress: true, chunk: 10, overlap: 3 }).filter(r => r.meta.id === id);
  assert.ok(ws.length > 1);
  ws.forEach((w, i) => {
    assert.deepEqual([w.meta.chunk.index, w.meta.chunk.start, w.meta.chunk.total], [i, i * 7, ws.length]);
    assert.equal(w.meta.chunk.end, w.meta.chunk.start + w.output.length);
  });
  const rebuilt = ws[0].output + ws.slice(1).map(w => w.output.slice(3)).join('');
  assert.equal(rebuilt, body);
  const sw = buildExport(dir, { scope: ['note'], chunk: 10, overlap: 3 }).filter(r => r.meta.id === id);
  assert.equal(sw[0].output, 'a short su');
  assert.equal(sw[0].output + sw.slice(1).map(w => w.output.slice(3)).join(''), 'a short summary');
});

test('export refuses a bad --chunk or --overlap and a bad --min-authority (spec 33 D1)', async () => {
  const dir = freshVault();
  const origOut = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true; process.stderr.write = () => true;
  try {
    assert.equal(await run({ vault: dir, chunk: '5', overlap: '5' }), 1);
    assert.equal(await run({ vault: dir, chunk: '0' }), 1);
    assert.equal(await run({ vault: dir, chunk: 'x' }), 1);
    assert.equal(await run({ vault: dir, chunk: '5', overlap: '2' }), 0);
  } finally { process.stdout.write = origOut; process.stderr.write = origErr; }
  assert.throws(() => buildExport(dir, { minAuthority: 'gold' }), /min-authority/);
});

test('export --fresh-only drops a stale source and a superseded note, keeps a fresh note (spec 33 D1)', () => {
  const dir = freshVault();
  handWrite(dir, 'sources', 'source', '2026-01-01-stale-src', { source_type: 'article', source_url: 'https://s.example.com/a', volatility: 'fast' });
  handWrite(dir, 'notes', 'note', '2026-01-01-gone', { sources: ['2026-01-01-a'], confidence: 'medium', status: 'superseded', superseded_by: '2026-01-01-kept' });
  handWrite(dir, 'notes', 'note', '2026-01-01-kept', { sources: ['2026-01-01-a'], confidence: 'medium', verifications: [{ date: '2026-11-02', by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }] });
  const ids = o => buildExport(dir, { scope: ['source', 'note'], ...o }).map(r => r.meta.id);
  const all = ids({});
  for (const id of ['2026-01-01-stale-src', '2026-01-01-gone', '2026-01-01-kept']) assert.ok(all.includes(id));
  const fresh = ids({ freshOnly: true, now: '2026-11-02' });
  assert.ok(fresh.includes('2026-01-01-kept'));
  assert.ok(!fresh.includes('2026-01-01-stale-src'));
  assert.ok(!fresh.includes('2026-01-01-gone'));
});

test('export --min-authority secondary drops a tertiary source and keeps primary, untiered and a question (spec 33 D1)', () => {
  const dir = freshVault();
  seedQuestions(dir);
  handWrite(dir, 'sources', 'source', '2026-01-01-third', { source_type: 'article', source_url: 'https://3.example.com/a', authority_tier: 'tertiary' });
  handWrite(dir, 'sources', 'source', '2026-01-01-first', { source_type: 'article', source_url: 'https://1.example.com/a', authority_tier: 'primary' });
  handWrite(dir, 'sources', 'source', '2026-01-01-untiered', { source_type: 'article', source_url: 'https://0.example.com/a' });
  const ids = buildExport(dir, { scope: ['source', 'question'], minAuthority: 'secondary' }).map(r => r.meta.id);
  assert.ok(!ids.includes('2026-01-01-third'));
  for (const id of ['2026-01-01-first', '2026-01-01-untiered', '2026-01-01-q-answered']) assert.ok(ids.includes(id), id);
});
