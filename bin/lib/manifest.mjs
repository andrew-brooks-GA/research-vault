import { walkEntries, readEntry } from './fsutil.mjs';
import { normalizeUrl } from './ids.mjs';

const EDGE_FIELDS = ['related', 'contributing_ids', 'sources'];

export function buildManifest(vaultPath) {
  const entries = [];
  const backlinks = {};
  for (const abs of walkEntries(vaultPath)) {
    const { id, data } = readEntry(abs);
    const last = (data.verifications || []).map(v => v.date).sort().pop() || null;
    entries.push({
      id, type: data.type, title: data.title,
      domain: data.domain || [], topics: data.topics || [],
      source_url: data.source_url ? normalizeUrl(data.source_url) : null,
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
  return { generated: new Date().toISOString().slice(0, 10), entries, backlinks };
}
