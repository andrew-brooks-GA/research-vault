import { readFileSync, existsSync } from 'node:fs';
import { assertInsideVault, compareContainment } from './containment.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { walkEntries, readEntry, TYPE_FOLDER, writeAtomic } from './fsutil.ts';
import { normalizeUrlSafe } from './ids.ts';
import { isRecord, parseJson } from './unknowns.ts';

// Edge fields are declared once in the schema (see edge_fields) and shared with lint's
// dangling-ref check; read the plugin's own schema so callers can pass just the vault path.
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'frontmatter.schema.json');
const schemaText = readFileSync(SCHEMA_PATH, 'utf8');
let schema;
try { schema = parseJson(schemaText); } catch { throw new Error(`${SCHEMA_PATH}: expected valid JSON`); }
if (!isRecord(schema)) throw new Error(`${SCHEMA_PATH}: expected an object`);
const edgeFields = schema.edge_fields;
if (!isRecord(edgeFields)) throw new Error(`${SCHEMA_PATH}: edge_fields must be an object`);
const requireEdgeField = (name, value) => {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string'))
    throw new Error(`${SCHEMA_PATH}: edge_fields.${name} must be an array of strings`);
  return value;
};
const BACKLINK_FIELDS = requireEdgeField('backlink', edgeFields.backlink);
const REFERENCE_ONLY_FIELDS = requireEdgeField('reference_only', edgeFields.reference_only);
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

export function buildManifest(vaultPath, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('buildManifest: now must be a Date');
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
    for (const rel of EDGE_FIELDS) for (const to of [data[rel] ?? []].flat()) {
      if (!to) continue;
      if (typeof to !== 'string') throw new Error('buildManifest: expected a string edge target');
      const key = `${id}\0${rel}\0${to}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: id, rel, to });
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.rel.localeCompare(b.rel) || a.to.localeCompare(b.to));
  // Keyed by references from entries, so a Map: `constructor` or `__proto__` is an id like any other (S-13).
  const backlinks = new Map();
  for (const e of edges) if (BACKLINK_FIELDS.includes(e.rel)) {
    let from = backlinks.get(e.to);
    if (!from) {
      from = new Set();
      backlinks.set(e.to, from);
    }
    from.add(e.from);
  }
  // fromEntries defines each key as its own property, `__proto__` too; read it with Object.hasOwn.
  const sortedBacklinks = Object.fromEntries([...backlinks].sort(([a], [b]) => a < b ? -1 : Number(a > b)).map(([k, from]) => [k, [...from].sort()]));
  return { generated: now.toISOString().slice(0, 10), entries, edges, backlinks: sortedBacklinks };
}

// Edges whose `to` names no entry: what lint reports as DANGLING_REF, for the command that writes.
export function danglingEdges(manifest) {
  const ids = new Set(manifest.entries.map((e) => e.id));
  return manifest.edges.filter((e) => !ids.has(e.to));
}

const hasTypeFolder = type => Object.hasOwn(TYPE_FOLDER, type);

// Shrink guard (spec 18 D1). A missing row counts as a shrink when its type folder is missing or its
// file still exists, except when the folder or file is known to resolve outside the vault.
// Removing the derived file overrides the guard.
function refuseShrink(vaultPath, path, manifest) {
  let prev;
  try { prev = parseJson(readFileSync(path, 'utf8')); } catch { return; } // none, or unreadable: nothing to guard
  if (!isRecord(prev)) return;
  const entries = prev.entries ?? [];
  if (!Array.isArray(entries)) return;
  const ids = new Set(manifest.entries.map((e) => e.id));
  const kept = [];
  for (const e of entries) {
    if (!isRecord(e) || typeof e.id !== 'string' || typeof e.type !== 'string') continue;
    const folder = hasTypeFolder(e.type) ? TYPE_FOLDER[e.type] : null;
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

// The in-memory filters (type, domain, series, topic through the aliases, text over title, topics and
// summary) over manifest rows; shared with `teach path candidates`, which runs them over one manifest.
export function matchRows(rows, q, aliases = {}) {
  const expand = t => {
    const key = String(t);
    return Object.hasOwn(aliases, key) ? aliases[key] : t; // S-13: a topic is not an Object.prototype member
  };
  if (q.type) rows = rows.filter(e => e.type === q.type);
  if (q.domain) rows = rows.filter(e => e.domain.includes(q.domain));
  if (q.series) rows = rows.filter(e => e.series === q.series);
  if (q.topic) { const want = expand(q.topic); rows = rows.filter(e => e.topics.map(expand).includes(want)); }
  if (q.text) { const t = q.text.toLowerCase(); rows = rows.filter(e => String(e.title ?? '').toLowerCase().includes(t) || e.topics.join(' ').toLowerCase().includes(t) || String(e.summary ?? '').toLowerCase().includes(t)); }
  return rows;
}
