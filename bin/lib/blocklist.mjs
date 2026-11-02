// The source blocklist (spec 32): `meta/source-blocklist.json` in the vault, an array of rows
// `{ pattern, scope: 'url' | 'domain', reason, added }`. Absent means empty. A `domain` row covers
// its subdomains; a `url` row is a prefix after normalisation. Read by capture, lint and the
// pre-web hook; never written by the plugin.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrlSafe } from './ids.mjs';

export const BLOCKLIST = join('meta', 'source-blocklist.json');
const SCOPES = new Set(['url', 'domain']);

export function loadBlocklist(vaultPath) {
  const p = join(vaultPath, BLOCKLIST);
  if (!existsSync(p)) return [];
  let rows;
  try { rows = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new Error(`invalid meta/source-blocklist.json: ${e.message}`); }
  if (!Array.isArray(rows)) throw new Error('invalid meta/source-blocklist.json: must be a JSON array');
  rows.forEach((r, i) => {
    if (!r || typeof r.pattern !== 'string' || !r.pattern || !SCOPES.has(r.scope) || typeof r.reason !== 'string' || !r.reason)
      throw new Error(`invalid meta/source-blocklist.json: row ${i} needs a pattern, a scope of url or domain and a reason`);
  });
  return rows;
}

export function matchBlock(rows, url) {
  let host = null;
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* no domain match for an unparsable URL */ }
  const norm = normalizeUrlSafe(String(url ?? ''));
  return rows.find(r => r.scope === 'domain'
    ? host !== null && (host === r.pattern.toLowerCase() || host.endsWith('.' + r.pattern.toLowerCase()))
    : norm.startsWith(normalizeUrlSafe(r.pattern))) || null;
}
