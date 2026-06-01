import { buildManifest } from './manifest.mjs';
import { listStale } from './stale.mjs';
import { loadSchema } from './schema.mjs';

export function advise(vaultPath, repoRoot) {
  const m = buildManifest(vaultPath);
  const aliases = loadSchema(repoRoot).taxonomy.topic_aliases;
  const noteSources = new Set(m.entries.filter(e => e.type === 'note').flatMap(e => e.sources));
  return {
    stale: listStale(vaultPath, { repoRoot }),
    orphans: m.entries.filter(e => !(m.backlinks[e.id]?.length) &&
      !(e.related.length + e.contributing_ids.length + e.sources.length)).map(e => e.id),
    sourcesWithoutNotes: m.entries.filter(e => e.type === 'source' && !noteSources.has(e.id)).map(e => e.id),
    aliasable: m.entries.filter(e => e.topics.some(t => aliases[t])).map(e => e.id),
  };
}
