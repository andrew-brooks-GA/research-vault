// The usage log (spec 29): one JSON object per line at _index/usage.jsonl in the vault, appended
// by the pre-web hook, the post-edit hook and search. _index/ is ignored by the template's
// .gitignore, pruned by SKIP_DIRS and never walked as an entry folder. Readers: the #6 report.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertInsideVault, isInsideVault } from './containment.ts';

export const USAGE_LOG: string = join('_index', 'usage.jsonl');

export function appendUsage(vaultPath: string, event: object, now: unknown): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('appendUsage: now must be a Date');
  const path = join(vaultPath, USAGE_LOG);
  const dir = dirname(path);
  const line = JSON.stringify({ ts: now.toISOString(), ...event }) + '\n';
  assertInsideVault(vaultPath, dir);
  mkdirSync(dir, { recursive: true });
  assertInsideVault(vaultPath, path);
  appendFileSync(path, line);
}

export function readUsage(vaultPath: string): unknown[] {
  const p = join(vaultPath, USAGE_LOG);
  // A line that is not JSON is skipped (spec 30), as the claims ledger's reader skips one.
  return isInsideVault(vaultPath, p) && existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l: string): unknown[] => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
}
