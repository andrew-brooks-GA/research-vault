import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildManifest } from './manifest.mjs';
import { listStale } from './stale.mjs';
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

// An entry is an orphan only if nothing links to it AND it links to nothing. "Links to
// nothing" must weigh every declared edge field (incl. source_id / prompt_id / contributing /
// superseded_by), not just the three backlink arrays the manifest row happens to carry.
function idsWithOutgoingEdges(vaultPath, schema) {
  const fields = [...schema.fields.edge_fields.backlink, ...schema.fields.edge_fields.reference_only];
  const out = new Set();
  for (const abs of walkEntries(vaultPath)) {
    try {
      const { id, data } = readEntry(abs);
      for (const f of fields) {
        const val = data[f];
        if (Array.isArray(val) ? val.length : val) { out.add(id); break; }
      }
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

export function advise(vaultPath, repoRoot) {
  const m = buildManifest(vaultPath);
  const schema = loadSchema(repoRoot);
  const aliases = schema.taxonomy.topic_aliases;
  const noteSources = new Set(m.entries.filter(e => e.type === 'note').flatMap(e => e.sources));
  const outgoing = idsWithOutgoingEdges(vaultPath, schema);
  return {
    stale: listStale(vaultPath, { repoRoot }),
    orphans: m.entries.filter(e => !(m.backlinks[e.id]?.length) && !outgoing.has(e.id)).map(e => e.id),
    sourcesWithoutNotes: m.entries.filter(e => e.type === 'source' && !noteSources.has(e.id)).map(e => e.id),
    unverifiedSources: listUnverifiedSources(vaultPath),
    missingSummaries: m.entries.filter(e => (e.type === 'note' || e.type === 'synthesis') && !(e.summary && e.summary.trim())).map(e => e.id),
    stubBodies: listStubBodies(vaultPath),
    aliasable: m.entries.filter(e => e.topics.some(t => aliases[t])).map(e => e.id),
    quoteResidue: listQuoteResidue(vaultPath),
  };
}
