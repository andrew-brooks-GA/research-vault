// The usage log (spec 29): one JSON object per line at _index/usage.jsonl in the vault, appended
// by the pre-web hook, the post-edit hook and search. _index/ is ignored by the template's
// .gitignore, pruned by SKIP_DIRS and never walked as an entry folder. Readers: the #6 report.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const USAGE_LOG = join('_index', 'usage.jsonl');

export function appendUsage(vaultPath, event) {
  mkdirSync(join(vaultPath, '_index'), { recursive: true });
  appendFileSync(join(vaultPath, USAGE_LOG), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}

export function readUsage(vaultPath) {
  const p = join(vaultPath, USAGE_LOG);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}
