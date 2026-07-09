import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { walkEntries, readEntry } from './fsutil.mjs';
import { normalizeUrl } from './ids.mjs';

// Backlink-forming edge fields are declared once in the schema (see edge_fields) and shared
// with lint's dangling-ref check; read the plugin's own schema so buildManifest(vaultPath)
// keeps its single-argument signature.
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'frontmatter.schema.json');
const EDGE_FIELDS = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')).edge_fields.backlink;

// Only these results attest freshness. `captured`-method seeds carry `confirmed`, so
// capture-time freshness counts; `outdated`/`unreachable`/`inconclusive` must not reset the clock.
export const CONFIRMING_RESULTS = ['confirmed', 'changed-trivially'];

export function lastVerified(verifications) {
  return (verifications || [])
    .filter(v => CONFIRMING_RESULTS.includes(v.result))
    .map(v => v.date).sort().pop() || null;
}

// A hand-authored source_url can be un-parsable. Normalizing keeps manifest URLs comparable,
// but must not throw here — a crash would take down the whole lint run (lint reports the bad
// URL as a URL_INVALID violation instead). Keep the raw value when it will not normalize.
function safeNormalizeUrl(url) {
  if (!url) return null;
  try { return normalizeUrl(url); } catch { return url; }
}

export function buildManifest(vaultPath) {
  const entries = [];
  const backlinks = {};
  for (const abs of walkEntries(vaultPath)) {
    const { id, data } = readEntry(abs);
    const last = lastVerified(data.verifications);
    entries.push({
      id, type: data.type, title: data.title,
      summary: data.summary != null ? String(data.summary) : null,
      domain: data.domain || [], topics: data.topics || [],
      source_url: safeNormalizeUrl(data.source_url),
      content_hash: data.content_hash || null,
      volatility: data.volatility || null, last_verified: last,
      status: data.status || 'active',
      subject: data.subject || null, series: data.series || null,
      related: data.related || [], contributing_ids: data.contributing_ids || [],
      sources: data.sources || [],
    });
    for (const f of EDGE_FIELDS) for (const target of (data[f] || [])) {
      backlinks[target] ||= [];
      if (!backlinks[target].includes(id)) backlinks[target].push(id);
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const sortedBacklinks = {};
  for (const k of Object.keys(backlinks).sort()) sortedBacklinks[k] = backlinks[k].slice().sort();
  return { generated: new Date().toISOString().slice(0, 10), entries, backlinks: sortedBacklinks };
}
