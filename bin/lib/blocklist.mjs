// The source blocklist (spec 32): `meta/source-blocklist.json` in the vault, an array of rows
// `{ pattern, scope: 'url' | 'domain', reason, added }`. Absent means empty. A `domain` row covers
// its subdomains; a `url` row is a prefix after normalisation. Read by capture, lint and the
// pre-web hook; never written by the plugin.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrlSafe } from './ids.ts';
import { isRecord, parseJson } from './unknowns.ts';

export const BLOCKLIST = join('meta', 'source-blocklist.json');
export const SOURCE_BLOCKED = 'SOURCE_BLOCKED';

function isBlockRow(row) {
  return isRecord(row) && typeof row.pattern === 'string' && !!row.pattern &&
    (row.scope === 'url' || row.scope === 'domain') && typeof row.reason === 'string' && !!row.reason;
}

export function loadBlocklist(vaultPath) {
  const p = join(vaultPath, BLOCKLIST);
  if (!existsSync(p)) return [];
  let rows;
  try { rows = parseJson(readFileSync(p, 'utf8')); } catch (e) {
    if (!(e instanceof Error)) throw e;
    throw new Error(`invalid meta/source-blocklist.json: ${e.message}`);
  }
  if (!Array.isArray(rows)) throw new Error('invalid meta/source-blocklist.json: must be a JSON array');
  return rows.map((r, i) => {
    if (isBlockRow(r)) return r;
    throw new Error(`invalid meta/source-blocklist.json: row ${i} needs a pattern, a scope of url or domain and a reason`);
  });
}

export function matchBlock(rows, url) {
  let host = null;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { /* no domain match for an unparsable URL */ }
  const norm = normalizeUrlSafe(String(url ?? ''));
  if (typeof norm !== 'string') return null;
  return rows.find(r => {
    if (r.scope === 'domain') return host !== null && (host === r.pattern.toLowerCase() || host.endsWith('.' + r.pattern.toLowerCase()));
    const pattern = normalizeUrlSafe(r.pattern);
    return typeof pattern === 'string' && norm.startsWith(pattern);
  }) || null;
}

export function blockedSourceMessage({ pattern, scope, reason }, screen = String) {
  return `blocked source: ${screen(pattern)} (${screen(scope)}): ${screen(reason)}`;
}

export function sourceBlockCheck(rows) {
  return url => {
    const block = matchBlock(rows, url);
    if (block) throw Object.assign(new Error(blockedSourceMessage(block)), { code: SOURCE_BLOCKED, block });
  };
}
