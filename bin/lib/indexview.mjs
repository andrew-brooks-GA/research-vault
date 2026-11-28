import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TYPE_FOLDER as FOLDER } from './fsutil.ts';
import { buildManifest } from './manifest.ts';
import { assertInsideVault } from './containment.ts';
function row(e) { return `- ${e.id} — ${e.title || '(untitled)'} [${e.status}] (verified ${e.last_verified || 'never'})`; }
export function rootIndex(manifest) {
  const byType = Object.create(null); // keyed by entry types, `constructor` too (S-13)
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

export function compileVault(vaultPath) {
  const m = buildManifest(vaultPath);
  const out = join(vaultPath, '_index');
  assertInsideVault(vaultPath, out);
  mkdirSync(out, { recursive: true });
  const write = (name, text) => {
    const path = join(out, name);
    assertInsideVault(vaultPath, path);
    writeFileSync(path, text, 'utf8');
  };
  write('INDEX.md', rootIndex(m));
  for (const type of Object.keys(FOLDER)) write(`${FOLDER[type]}.md`, folderIndex(m, type));
  return { entries: m.entries.length };
}
