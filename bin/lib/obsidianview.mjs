import { FOLDER } from './indexview.mjs';
import { staleness } from './stale.mjs';

function wikilinks(ids) { return [...new Set(ids)].map(id => `- [[${id}]]`); }

// Obsidian tags allow [A-Za-z0-9_/-] only. Controlled facets are already safe; topics are
// free text, so: lowercase, collapse every run of anything else to '-', trim, skip empties.
const topicTag = t => String(t).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

function tags(e, schema, now) {
  const s = staleness(e, schema, now);
  const out = [`type/${e.type}`, `status/${e.status}`, ...e.domain.map(d => `domain/${d}`)];
  if (e.volatility) out.push(`volatility/${e.volatility}`);
  out.push(`freshness/${s === null ? 'unassessed' : s ? 'stale' : 'fresh'}`);
  out.push(...[...new Set(e.topics.map(topicTag).filter(Boolean))].sort().map(t => `topic/${t}`));
  return out;
}

// `now` must be a Date: staleness subtracts dates numerically and a string would mark everything fresh.
export function entryNote(manifest, e, { schema, now }) {
  const byRel = {};
  for (const x of manifest.edges) if (x.from === e.id) (byRel[x.rel] ||= []).push(x.to);
  const back = manifest.backlinks[e.id] || [];
  const out = [
    '---', 'tags:', ...tags(e, schema, now).map(t => `  - ${t}`), '---',
    `# ${e.title || e.id}`, '',
    `_Derived Obsidian view — do not edit. Canonical: ${FOLDER[e.type]}/${e.id}.md. Freshness as of ${now.toISOString().slice(0, 10)}; regenerate to refresh._`, '',
    `- type: ${e.type}`, `- status: ${e.status}`, `- verified: ${e.last_verified || 'never'}`, '',
  ];
  if (Object.keys(byRel).length) {
    out.push('## Links', '');
    for (const [rel, ids] of Object.entries(byRel)) out.push(`### ${rel}`, '', ...wikilinks(ids), '');
  }
  if (back.length) out.push('## Backlinks', '', ...wikilinks(back), '');
  return out.join('\n').trimEnd() + '\n';
}

export function moc(manifest) {
  const byType = {};
  for (const e of manifest.entries) (byType[e.type] ||= []).push(e);
  const out = ['# Map of Content', '', '_Derived Obsidian view — regenerated from the manifest; do not edit._', ''];
  for (const t of Object.keys(FOLDER)) {
    const rows = byType[t] || [];
    out.push(`## ${FOLDER[t]} (${rows.length})`, '', ...rows.map(e => `- [[${e.id}]] ${e.title || ''}`.trimEnd()), '');
  }
  return out.join('\n').trimEnd() + '\n';
}
