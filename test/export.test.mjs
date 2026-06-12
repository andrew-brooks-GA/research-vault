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
import { run } from '../bin/commands/export.mjs';
import { captureEntry } from '../bin/commands/capture.mjs';

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

test('note summary exports as output without the body gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rv-esum-'));
  captureEntry(dir, { type: 'source', title: 'Src', url: 'https://example.com/w', now: '2026-01-01' });
  captureEntry(dir, { type: 'note', title: 'Crisp', sources: '2026-01-01-src', summary: 'A claim.', now: '2026-01-02' });
  captureEntry(dir, { type: 'note', title: 'Bare', sources: '2026-01-01-src', now: '2026-01-03' });
  const recs = buildExport(dir, { scope: ['note'] });   // no includeBodies, no ack
  assert.equal(recs.find(r => r.input === 'Crisp').output, 'A claim.');
  assert.equal(recs.find(r => r.input === 'Bare').output, '');   // unchanged: metadata-only
});
