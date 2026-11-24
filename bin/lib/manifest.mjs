import { readFileSync, existsSync } from 'node:fs';
import { assertInsideVault, compareContainment } from './containment.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { walkEntries, readEntry, TYPE_FOLDER, writeAtomic } from './fsutil.mjs';
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
// Rows that are not an independent check of a source: the capture-time seed, and a quote found on
// its page by a program (spec 53 point 4: the words are on the page and no more).
const UNCHECKED_METHODS = ['captured', 'quote-matched'];
export const isUnverifiedSource = data => data.type === 'source' && !(data.verifications || []).some(v => v.method && !UNCHECKED_METHODS.includes(v.method));

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
    const { id, data } = readEntry(abs, { vaultPath });
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
      // Per-type facets an agent needs to judge a node without opening it (spec 08); null when absent.
      stage: data.stage || null, state: data.state || null, confidence: data.confidence || null,
      outcome: data.outcome || null, authority_tier: data.authority_tier || null,
      authority_basis: data.authority_basis || null, superseded_by: data.superseded_by || null,
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

// Edges whose `to` names no entry: what lint reports as DANGLING_REF, for the command that writes.
export function danglingEdges(manifest) {
  const ids = new Set(manifest.entries.map((e) => e.id));
  return manifest.edges.filter((e) => !ids.has(e.to));
}

// Shrink guard (spec 18 D1). A missing row counts as a shrink when its type folder is missing or its
// file still exists, except when the folder or file is known to resolve outside the vault.
// Removing the derived file overrides the guard.
function refuseShrink(vaultPath, path, manifest) {
  let prev;
  try { prev = JSON.parse(readFileSync(path, 'utf8')); } catch { return; } // none, or unreadable: nothing to guard
  const ids = new Set(manifest.entries.map((e) => e.id));
  const kept = [];
  for (const e of prev.entries ?? []) {
    const folder = TYPE_FOLDER[e.type];
    if (ids.has(e.id) || !folder) continue;
    const dir = join(vaultPath, folder);
    const entry = join(dir, `${e.id}.md`);
    if (compareContainment(vaultPath, dir) === false || compareContainment(vaultPath, entry) === false) continue;
    if (!existsSync(dir)) kept.push(`${e.id}: ${folder}/ is missing`);
    else if (existsSync(entry)) kept.push(`${e.id}: ${folder}/${e.id}.md still exists`);
  }
  if (kept.length) throw new Error(`manifest not written: it would drop ${kept.length} listed ${kept.length === 1 ? 'entry that is' : 'entries that are'} not gone (${kept[0]}); remove ${path} to accept the shrink`);
}

export function writeManifest(vaultPath, manifest = buildManifest(vaultPath)) {
  const path = join(vaultPath, '.vault-manifest.json');
  assertInsideVault(vaultPath, path);
  refuseShrink(vaultPath, path, manifest);
  const text = JSON.stringify(manifest, null, 2);
  writeAtomic(path, text, { vaultPath });
}
