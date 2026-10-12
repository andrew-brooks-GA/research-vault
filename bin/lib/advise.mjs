import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildManifest } from './manifest.mjs';
import { listStale, staleness } from './stale.mjs';
import { traverse, DEPENDENCY_RELS } from './graph.mjs';
import { loadSchema } from './schema.mjs';
import { walkEntries, readEntry } from './fsutil.mjs';

const isStubBody = body => !(body || '').split('\n').some(l => {
  const t = l.trim();
  return t && t !== '-' && !t.startsWith('#') && t !== '```';
});

function listStubBodies(vaultPath) {
  const out = [];
  for (const abs of walkEntries(vaultPath)) {
    const e = readEntry(abs);
    if (e.data.type !== 'source' && isStubBody(e.body)) out.push(e.id);
  }
  return out;
}

// Sources whose verification log is only `captured` (capture-time provenance) and never an
// independent check. The manifest doesn't carry methods, so read entries directly (cheap,
// off the hot path) — mirrors how listStale operates independently of the manifest row shape.
function listUnverifiedSources(vaultPath) {
  const out = [];
  for (const abs of walkEntries(vaultPath)) {
    try {
      const { id, data } = readEntry(abs);
      if (data.type === 'source' && !(data.verifications || []).some(v => v.method && v.method !== 'captured')) out.push(id);
    } catch { /* parse errors surface via lint */ }
  }
  return out;
}

// Multi-cycle quote residue: a frontmatter scalar containing a literal backslash-doublequote
// (`\"`) is almost certainly the baked-in remnant of the pre-0.3.0 emit-only escaping (see
// CHANGELOG "Upgrading an existing vault"). Read-only surfacing so residue stays visible for
// human review; the lossless 0.3.0 serializer will otherwise preserve it as genuine content.
function listQuoteResidue(vaultPath) {
  const out = [];
  for (const abs of walkEntries(vaultPath)) {
    const raw = readFileSync(abs, 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (m && m[1].includes('\\"')) out.push(basename(abs, '.md'));
  }
  return out;
}

// Notes/syntheses whose evidence chain (sources/contributing_ids, transitively) reaches a stale
// or superseded entry. The dependent's own staleness is reported under `stale`, not here.
function listStaleEvidence(m, schema, now) {
  const rows = new Map(m.entries.map(e => [e.id, e]));
  const assessed = new Map();
  const reasonFor = id => {
    if (!assessed.has(id)) {
      const r = rows.get(id);
      assessed.set(id, r.status === 'superseded' ? 'superseded' : staleness(r, schema, now) ? 'stale' : null);
    }
    return assessed.get(id);
  };
  const out = [];
  for (const e of m.entries) {
    if (!(e.type === 'note' || e.type === 'synthesis') || e.status !== 'active') continue;
    const t = traverse(m, e.id, { direction: 'out', depth: Infinity, rels: DEPENDENCY_RELS });
    const via = [];
    for (const n of t.nodes) {
      if (n.distance === 0 || n.missing) continue; // dangling refs are lint's job
      const reason = reasonFor(n.id);
      if (!reason) continue;
      const path = [n.id];
      while (path[0] !== e.id) path.unshift(t.parents[path[0]]);
      via.push({ id: n.id, reason, path });
    }
    if (via.length) out.push({ id: e.id, via: via.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return out;
}

export function advise(vaultPath, repoRoot, { now } = {}) {
  const m = buildManifest(vaultPath);
  const schema = loadSchema(repoRoot);
  const date = new Date(now || new Date().toISOString().slice(0, 10));
  const aliases = schema.taxonomy.topic_aliases;
  const noteSources = new Set(m.entries.filter(e => e.type === 'note').flatMap(e => e.sources));
  // Orphan = no backlinks and no outgoing edge of any rel (incl. superseded_by).
  const outgoing = new Set(m.edges.map(e => e.from));
  return {
    stale: listStale(vaultPath, { repoRoot, now: date, manifest: m }),
    staleEvidence: listStaleEvidence(m, schema, date),
    orphans: m.entries.filter(e => !(m.backlinks[e.id]?.length) && !outgoing.has(e.id)).map(e => e.id),
    sourcesWithoutNotes: m.entries.filter(e => e.type === 'source' && !noteSources.has(e.id)).map(e => e.id),
    unverifiedSources: listUnverifiedSources(vaultPath),
    missingSummaries: m.entries.filter(e => (e.type === 'note' || e.type === 'synthesis') && !(e.summary && e.summary.trim())).map(e => e.id),
    stubBodies: listStubBodies(vaultPath),
    aliasable: m.entries.filter(e => e.topics.some(t => aliases[t])).map(e => e.id),
    quoteResidue: listQuoteResidue(vaultPath),
  };
}
