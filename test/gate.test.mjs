import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpVault } from './helpers.mjs';
import { LEDGER_FILENAME, contentHash, ledgerKey, recordVerdict, gateStatus } from '../bin/lib/gate.mjs';

function draft(content = 'draft body\n') {
  const root = tmpVault('rv-gate-');
  const file = join(root, 'draft.md');
  writeFileSync(file, content);
  return { root, file };
}

test('recordVerdict appends a row keyed to the current hash and gateStatus finds it', () => {
  const { root, file } = draft('hello\n');
  const row = recordVerdict(root, file, 'PASS', 'checked');
  assert.equal(row.event, 'claims');
  assert.equal(row.file, 'draft.md');
  assert.equal(row.note, 'checked');
  const lines = readFileSync(join(root, LEDGER_FILENAME), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), row);
  const s = gateStatus(root, file);
  assert.equal(s.verdict, 'PASS');
  assert.equal(s.sha256, contentHash('hello\n'));
  assert.equal(s.ts, row.ts);
  assert.ok(!('note' in recordVerdict(root, file, 'MERIT')), 'note omitted when absent');
});

test('gateStatus returns null after the file changes', () => {
  const { root, file } = draft();
  recordVerdict(root, file, 'PASS');
  assert.equal(gateStatus(root, file).verdict, 'PASS');
  appendFileSync(file, 'x');
  const s = gateStatus(root, file);
  assert.equal(s.verdict, null);
  assert.equal(s.ts, null);
  assert.equal(s.sha256, contentHash(readFileSync(file, 'utf8')));
});

test('a FAIL-as-sent row never satisfies gateStatus', () => {
  const { root, file } = draft();
  recordVerdict(root, file, 'FAIL-as-sent');
  assert.equal(gateStatus(root, file).verdict, null);
  recordVerdict(root, file, 'MERIT');
  assert.equal(gateStatus(root, file).verdict, 'MERIT');
});

test('recordVerdict rejects an unknown verdict and writes nothing', () => {
  const { root, file } = draft();
  assert.throws(() => recordVerdict(root, file, 'pass'),
    { message: 'verdict must be one of PASS, FAIL-as-sent, MERIT' });
  assert.equal(existsSync(join(root, LEDGER_FILENAME)), false);
});

test('ledgerKey is repo-relative with forward slashes', () => {
  const root = tmpVault('rv-gate-');
  mkdirSync(join(root, 'docs', 'drafts'), { recursive: true });
  assert.equal(ledgerKey(root, join(root, 'docs', 'drafts', 'a.md')), 'docs/drafts/a.md');
  assert.equal(ledgerKey(root, './docs/drafts/a.md'), 'docs/drafts/a.md');
  assert.equal(ledgerKey(root, 'docs\\drafts\\a.md'), 'docs/drafts/a.md');
});
