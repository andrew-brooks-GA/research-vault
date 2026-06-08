import { buildManifest } from './manifest.mjs';
import { listStale } from './stale.mjs';
import { loadSchema } from './schema.mjs';
import { walkEntries, readEntry } from './fsutil.mjs';

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

export function advise(vaultPath, repoRoot) {
  const m = buildManifest(vaultPath);
  const aliases = loadSchema(repoRoot).taxonomy.topic_aliases;
  const noteSources = new Set(m.entries.filter(e => e.type === 'note').flatMap(e => e.sources));
  return {
    stale: listStale(vaultPath, { repoRoot }),
    orphans: m.entries.filter(e => !(m.backlinks[e.id]?.length) &&
      !(e.related.length + e.contributing_ids.length + e.sources.length)).map(e => e.id),
    sourcesWithoutNotes: m.entries.filter(e => e.type === 'source' && !noteSources.has(e.id)).map(e => e.id),
    unverifiedSources: listUnverifiedSources(vaultPath),
    aliasable: m.entries.filter(e => e.topics.some(t => aliases[t])).map(e => e.id),
  };
}
