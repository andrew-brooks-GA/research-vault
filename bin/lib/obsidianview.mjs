import { FOLDER } from './indexview.mjs';

function wikilinks(ids) { return [...new Set(ids)].map(id => `- [[${id}]]`); }

export function entryNote(manifest, e) {
  const forward = [...new Set([...(e.related || []), ...(e.contributing_ids || []), ...(e.sources || [])])];
  const back = manifest.backlinks[e.id] || [];
  const out = [
    `# ${e.title || e.id}`, '',
    `_Derived Obsidian view — do not edit. Canonical: ${FOLDER[e.type]}/${e.id}.md_`, '',
    `- type: ${e.type}`, `- status: ${e.status}`, `- verified: ${e.last_verified || 'never'}`, '',
  ];
  if (forward.length) out.push('## Links', '', ...wikilinks(forward), '');
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
