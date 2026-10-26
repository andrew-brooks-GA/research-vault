// Claims-gate ledger: append-only JSONL of reviewer verdicts keyed to a draft's sha256,
// so any edit to the draft invalidates the record.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

export const LEDGER_FILENAME = '.research-vault-ledger.jsonl';
export const VERDICTS = ['PASS', 'FAIL-as-sent', 'MERIT'];
const SATISFIES = new Set(['PASS', 'MERIT']);

export function contentHash(text) { return createHash('sha256').update(text).digest('hex'); }

export function ledgerKey(repoRoot, filePath) {
  return relative(resolve(repoRoot), resolve(repoRoot, filePath)).replace(/\\/g, '/');
}

export function recordVerdict(repoRoot, filePath, verdict, note) {
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of ${VERDICTS.join(', ')}`);
  const row = {
    ts: new Date().toISOString(), event: 'claims', file: ledgerKey(repoRoot, filePath),
    sha256: contentHash(readFileSync(resolve(repoRoot, filePath), 'utf8')), verdict,
  };
  if (note !== undefined) row.note = note;
  appendFileSync(join(repoRoot, LEDGER_FILENAME), JSON.stringify(row) + '\n');
  return row;
}

export function gateStatus(repoRoot, filePath) {
  const file = ledgerKey(repoRoot, filePath);
  const sha256 = contentHash(readFileSync(resolve(repoRoot, filePath), 'utf8'));
  const ledger = join(repoRoot, LEDGER_FILENAME);
  const rows = existsSync(ledger)
    ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const hit = rows.findLast((r) => r.event === 'claims' && r.file === file && r.sha256 === sha256 && SATISFIES.has(r.verdict));
  return { file, sha256, verdict: hit?.verdict ?? null, ts: hit?.ts ?? null };
}
