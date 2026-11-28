// The source blocklist (spec 32): `meta/source-blocklist.json` in the vault, an array of rows
// `{ pattern, scope: 'url' | 'domain', reason, added }`. Absent means empty. A `domain` row covers
// its subdomains; a `url` row is a prefix after normalisation. Read by capture, lint and the
// pre-web hook; never written by the plugin.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrlSafe } from './ids.ts';
import { isRecord, parseJson } from './unknowns.ts';

export const BLOCKLIST: string = join('meta', 'source-blocklist.json');
export const SOURCE_BLOCKED: 'SOURCE_BLOCKED' = 'SOURCE_BLOCKED';

type BlockRow = { pattern: string; scope: 'url' | 'domain'; reason: string };

function isBlockRow(row: unknown): row is BlockRow {
  return isRecord(row) && typeof row.pattern === 'string' && !!row.pattern &&
    (row.scope === 'url' || row.scope === 'domain') && typeof row.reason === 'string' && !!row.reason;
}

export function loadBlocklist(vaultPath: string): BlockRow[] {
  const p = join(vaultPath, BLOCKLIST);
  if (!existsSync(p)) return [];
  let rows: unknown;
  try { rows = parseJson(readFileSync(p, 'utf8')); } catch (e) {
    if (!(e instanceof Error)) throw e;
    throw new Error(`invalid meta/source-blocklist.json: ${e.message}`);
  }
  if (!Array.isArray(rows)) throw new Error('invalid meta/source-blocklist.json: must be a JSON array');
  return rows.map((r: unknown, i: number) => {
    if (isBlockRow(r)) return r;
    throw new Error(`invalid meta/source-blocklist.json: row ${i} needs a pattern, a scope of url or domain and a reason`);
  });
}

export function matchBlock(rows: readonly BlockRow[], url: unknown): BlockRow | null {
  let host = null;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { /* no domain match for an unparsable URL */ }
  const norm = normalizeUrlSafe(String(url ?? ''));
  if (typeof norm !== 'string') return null;
  return rows.find((r: BlockRow) => {
    if (r.scope === 'domain') return host !== null && (host === r.pattern.toLowerCase() || host.endsWith('.' + r.pattern.toLowerCase()));
    const pattern = normalizeUrlSafe(r.pattern);
    return typeof pattern === 'string' && norm.startsWith(pattern);
  }) || null;
}

export function blockedSourceMessage({ pattern, scope, reason }: BlockRow, screen: (value: string) => string = String): string {
  return `blocked source: ${screen(pattern)} (${screen(scope)}): ${screen(reason)}`;
}

export function sourceBlockCheck(rows: readonly BlockRow[]): (url: unknown) => void {
  return (url: unknown) => {
    const block = matchBlock(rows, url);
    if (block) throw Object.assign(new Error(blockedSourceMessage(block)), { code: SOURCE_BLOCKED, block });
  };
}
