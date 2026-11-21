// The usage log (spec 29): one JSON object per line at _index/usage.jsonl in the vault, appended
// by the pre-web hook, the post-edit hook and search. _index/ is ignored by the template's
// .gitignore, pruned by SKIP_DIRS and never walked as an entry folder. Readers: the #6 report.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertInsideVault, isInsideVault } from './containment.mjs';

export const USAGE_LOG = join('_index', 'usage.jsonl');

export function appendUsage(vaultPath, event) {
  const path = join(vaultPath, USAGE_LOG);
  const dir = dirname(path);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  assertInsideVault(vaultPath, dir);
  mkdirSync(dir, { recursive: true });
  assertInsideVault(vaultPath, path);
  appendFileSync(path, line);
}

export function readUsage(vaultPath) {
  const p = join(vaultPath, USAGE_LOG);
  // A line that is not JSON is skipped (spec 30), as the claims ledger's reader skips one.
  return isInsideVault(vaultPath, p) && existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
}
