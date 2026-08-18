import { TYPE_FOLDER as FOLDER } from './fsutil.mjs';
function row(e) { return `- ${e.id} — ${e.title || '(untitled)'} [${e.status}] (verified ${e.last_verified || 'never'})`; }
export function rootIndex(manifest) {
  const byType = {};
  for (const e of manifest.entries) (byType[e.type] ||= []).push(e);
  const out = ['# Vault Index', '', '_Generated, derived view — do not edit. Source of truth: entry files + .vault-manifest.json._', ''];
  for (const t of Object.keys(FOLDER)) { const rows = byType[t] || []; out.push(`## ${FOLDER[t]} (${rows.length})`, '', ...rows.map(row), ''); }
  return out.join('\n').trimEnd() + '\n';
}
export function folderIndex(manifest, type) {
  const rows = manifest.entries.filter(e => e.type === type);
  return [`# ${FOLDER[type]}`, '', ...rows.map(row), ''].join('\n').trimEnd() + '\n';
}
export { FOLDER };
