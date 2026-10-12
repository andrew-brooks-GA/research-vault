import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { walkEntries, readEntry } from './fsutil.mjs';
import { normalizeUrlSafe } from './ids.mjs';

// Edge fields are declared once in the schema (see edge_fields) and shared with lint's
// dangling-ref check; read the plugin's own schema so buildManifest(vaultPath) keeps its
// single-argument signature.
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'frontmatter.schema.json');
const { backlink: BACKLINK_FIELDS, reference_only: REFERENCE_ONLY_FIELDS } = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')).edge_fields;
const EDGE_FIELDS = [...BACKLINK_FIELDS, ...REFERENCE_ONLY_FIELDS];

// Only these results attest freshness. `captured`-method seeds carry `confirmed`, so
// capture-time freshness counts; `outdated`/`unreachable`/`inconclusive` must not reset the clock.
export const CONFIRMING_RESULTS = ['confirmed', 'changed-trivially'];

export function lastVerified(verifications) {
  return (verifications || [])
    .filter(v => CONFIRMING_RESULTS.includes(v.result))
    .map(v => v.date).sort().pop() || null;
}

export function buildManifest(vaultPath) {
  const entries = [];
  const edgeKeys = new Set();
  const edges = [];
  for (const abs of walkEntries(vaultPath)) {
    const { id, data } = readEntry(abs);
    const last = lastVerified(data.verifications);
    entries.push({
      id, type: data.type, title: data.title,
      summary: data.summary != null ? String(data.summary) : null,
      domain: data.domain || [], topics: data.topics || [],
      source_url: normalizeUrlSafe(data.source_url),
      content_hash: data.content_hash || null,
      volatility: data.volatility || null, last_verified: last,
      status: data.status || 'active',
      subject: data.subject || null, series: data.series || null,
      related: data.related || [], contributing_ids: data.contributing_ids || [],
      sources: data.sources || [],
    });
    // Scalar fields (source_id, prompt_id) are wrapped so they are not iterated char by char.
    for (const rel of EDGE_FIELDS) for (const to of [].concat(data[rel] ?? [])) {
      if (!to) continue;
      const key = `${id}\0${rel}\0${to}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: id, rel, to });
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.rel.localeCompare(b.rel) || a.to.localeCompare(b.to));
  const backlinks = {};
  for (const e of edges) if (BACKLINK_FIELDS.includes(e.rel)) (backlinks[e.to] ||= new Set()).add(e.from);
  const sortedBacklinks = {};
  for (const k of Object.keys(backlinks).sort()) sortedBacklinks[k] = [...backlinks[k]].sort();
  return { generated: new Date().toISOString().slice(0, 10), entries, edges, backlinks: sortedBacklinks };
}
